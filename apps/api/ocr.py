"""Food-label extraction for the scan -> confirm -> add-item flow.

Qwen vision reads one or more views of the same package. Tesseract is retained only
as an explicitly configured legacy engine for single-image development and tests.
"""

from dataclasses import dataclass
import io
import os
import re

import pillow_heif
import pytesseract
from PIL import Image, ImageOps, UnidentifiedImageError

from engine.profiles import load_profiles

from .vision_ocr import VisionOCRError, extract_label

# iPhone camera/photo-library captures are HEIC by default; vanilla Pillow can't open
# them without this. Registering the opener makes Image.open() handle .heic/.heif
# transparently, so the rest of the pipeline doesn't need to know the format changed.
pillow_heif.register_heif_opener()

_DATE_PATTERN = re.compile(
    r"(?:BEST\s*BY|USE\s*BY|SELL\s*BY|EXP(?:IRES)?)[:\s]*"
    r"([A-Za-z]{3,9}\.?\s+\d{1,2}(?:,?\s*\d{2,4})?|\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?)",
    re.IGNORECASE,
)
_SIZE_PATTERN = re.compile(
    r"\b\d+(?:\.\d+)?\s*(?:fl\.?\s*oz|oz|lbs?|g|kg|ml|l|gal(?:lon)?)\b",
    re.IGNORECASE,
)
_LOT_PATTERN = re.compile(r"\bLOT\s*#?\s*([A-Za-z0-9-]+)", re.IGNORECASE)


# Orientation probe: four cheap passes on a downscaled copy decide the angle
# before the real OCR run happens once at full resolution.
_PROBE_MAX_EDGE = 1000

# Longest edge of the stored item thumbnail. Twice the widest grid tile on a
# 3x device, so it stays sharp without keeping the capture-size photo.
_THUMBNAIL_MAX_EDGE = 512
_ROTATIONS = (0, 90, 180, 270)
# How much better than upright a rotation must score before it is applied.
# Upright is nearly always right once EXIF has been honoured, and rotating a
# correctly-oriented photo is far more damaging than leaving a sideways one
# alone -- scores between angles often sit close together on a busy photo.
_ROTATION_MARGIN = 1.3

@dataclass(frozen=True)
class _Line:
    """One OCR text line plus how tall its glyphs were."""

    text: str
    height: float


def scan_image(image_bytes: bytes) -> dict:
    """Backward-compatible single-photo entry point."""
    return scan_images([image_bytes])


def scan_images(image_bytes: list[bytes]) -> dict:
    if not image_bytes:
        raise ValueError("At least one image is required")

    images = [_load_image(content) for content in image_bytes]
    engine = os.environ.get("OCR_ENGINE", "qwen").strip().lower()
    if engine not in {"qwen", "tesseract"}:
        raise ValueError("OCR_ENGINE must be 'qwen' or 'tesseract'")

    if engine == "qwen":
        result = extract_label(images)
        profile_text = " ".join(
            value
            for value in (result.raw_text, result.product_name, result.brand)
            if value
        )
        return {
            "product_name": result.product_name,
            "brand": result.brand,
            "printed_date": result.printed_date,
            "package_size": result.package_size,
            "lot_code": result.lot_code,
            "raw_text": result.raw_text,
            "confidence": result.confidence,
            "suggested_profile_id": _match_profile(profile_text),
        }

    if len(images) != 1:
        raise ValueError("Tesseract mode supports exactly one image")
    try:
        return _scan_with_tesseract(images[0])
    except pytesseract.TesseractNotFoundError as exc:
        raise VisionOCRError(
            "Tesseract OCR is not installed or is not available on PATH"
        ) from exc


def thumbnail(image_bytes: bytes) -> bytes:
    """Re-encode a label photo as a small JPEG for use as the item's thumbnail.

    The originals are multi-megabyte HEICs and the store keeps them in memory for
    the item's whole life, so they are never kept at capture size.
    """
    image = _load_image(image_bytes)
    if image.mode != "RGB":
        image = image.convert("RGB")
    image.thumbnail((_THUMBNAIL_MAX_EDGE, _THUMBNAIL_MAX_EDGE))
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=80)
    return buffer.getvalue()


def _load_image(image_bytes: bytes) -> Image.Image:
    try:
        image = Image.open(io.BytesIO(image_bytes))
        image.load()
    except (UnidentifiedImageError, OSError) as exc:
        raise ValueError("Unable to read image") from exc

    # Phone cameras store the sensor frame and record the display rotation in EXIF
    # rather than rotating the pixels. PIL does not apply that tag on open, so a
    # portrait photo reaches Tesseract on its side and decodes as noise.
    image = ImageOps.exif_transpose(image) or image

    # Normalize to a format pytesseract recognizes -- HEIC/HEIF (the iPhone camera/photo
    # library default) decodes fine via pillow-heif but keeps image.format == "HEIF",
    # which pytesseract's own save-to-tempfile step rejects as unsupported.
    if image.mode not in ("RGB", "L"):
        image = image.convert("RGB")
    image.format = None
    return image


def _scan_with_tesseract(image: Image.Image) -> dict:
    """Run the original deterministic OCR path as an explicit fallback."""

    # EXIF only covers cameras that wrote the tag; a screenshot, a crop or a photo of
    # a sideways carton can still arrive rotated, so confirm against the pixels.
    rotation = _best_rotation(image)
    if rotation:
        image = image.rotate(rotation, expand=True)

    raw_text = pytesseract.image_to_string(image).strip()
    # One image_to_data call serves both the confidence figure and the per-line glyph
    # heights used to tell the product name from the brand.
    data = pytesseract.image_to_data(image, output_type=pytesseract.Output.DICT)
    confidence = _average_confidence(data)
    product_name, brand = _pick_name_and_brand(_lines_with_height(data))

    date_match = _DATE_PATTERN.search(raw_text)
    size_match = _SIZE_PATTERN.search(raw_text)
    lot_match = _LOT_PATTERN.search(raw_text)

    return {
        "product_name": product_name,
        "brand": brand,
        "printed_date": date_match.group(1).strip() if date_match else None,
        "package_size": size_match.group(0).strip() if size_match else None,
        "lot_code": lot_match.group(1).strip() if lot_match else None,
        "raw_text": raw_text,
        "confidence": confidence,
        "suggested_profile_id": _match_profile(raw_text),
    }


def _text_score(data: dict) -> float:
    """Reward many confident *letters*.

    Mean confidence alone ranks garbage highly -- a page of "i | i" fragments can
    score well on a handful of tokens. Weighting each word's confidence by its
    letter count makes real prose win against noise.
    """
    total = 0.0
    for index, word in enumerate(data.get("text", [])):
        confidence = float(data["conf"][index])
        if confidence < 0:
            continue
        letters = sum(character.isalpha() for character in word)
        if letters >= 2:
            total += confidence * letters
    return total


def _best_rotation(image: Image.Image) -> int:
    """Return the rotation that reads best, or 0 unless another clearly wins.

    Runs on a downscaled copy so the four probe passes stay cheap; the real OCR
    then runs once on the full-resolution image at the winning angle.

    Upright must be beaten by a margin, not merely tied. Scores for 0 and 270 are
    frequently identical on a clean label, and a photo with background texture can
    let a wrong angle edge ahead -- turning a readable image into an unreadable
    one. Leaving a sideways photo alone costs far less than rotating a good one.
    """
    probe = image.copy()
    probe.thumbnail((_PROBE_MAX_EDGE, _PROBE_MAX_EDGE))

    def score_at(angle: int) -> float:
        candidate = probe.rotate(angle, expand=True) if angle else probe
        try:
            data = pytesseract.image_to_data(candidate, output_type=pytesseract.Output.DICT)
        except pytesseract.TesseractError:
            return 0.0
        return _text_score(data)

    upright = score_at(0)
    best_angle, best_score = 0, upright
    for angle in _ROTATIONS:
        if angle == 0:
            continue
        score = score_at(angle)
        if score > best_score:
            best_angle, best_score = angle, score

    if best_angle and best_score > upright * _ROTATION_MARGIN:
        return best_angle
    return 0


def _average_confidence(data: dict) -> float:
    scores = [float(c) for c in data.get("conf", []) if float(c) >= 0]
    return round(sum(scores) / len(scores) / 100.0, 2) if scores else 0.0


def _lines_with_height(data: dict) -> list[_Line]:
    """Regroup Tesseract's per-word output into text lines, in document order."""
    grouped: dict[tuple[int, int, int], tuple[list[str], list[float]]] = {}
    order: list[tuple[int, int, int]] = []

    for index, word in enumerate(data.get("text", [])):
        word = word.strip()
        if not word or float(data["conf"][index]) < 0:
            continue
        key = (data["block_num"][index], data["par_num"][index], data["line_num"][index])
        if key not in grouped:
            grouped[key] = ([], [])
            order.append(key)
        grouped[key][0].append(word)
        grouped[key][1].append(float(data["height"][index]))

    lines: list[_Line] = []
    for key in order:
        words, heights = grouped[key]
        lines.append(_Line(text=" ".join(words), height=sum(heights) / len(heights)))
    return lines


def _is_namelike(text: str) -> bool:
    """Reject lines that are metadata or OCR noise rather than a product/brand."""
    if sum(character.isalpha() for character in text) < 3:
        return False
    return not (
        _DATE_PATTERN.search(text) or _SIZE_PATTERN.search(text) or _LOT_PATTERN.search(text)
    )


def _pick_name_and_brand(lines: list[_Line]) -> tuple[str, str | None]:
    """Choose the product name and brand from the candidate lines.

    Packaging puts the product in the largest type and the brand smaller above it,
    so taking line 1 as the product and line 2 as the brand -- as this did
    originally -- gets real labels exactly backwards.

    A line naming a known food wins outright; otherwise the tallest text does.
    `max` keeps the first of equal heights, so labels rendered at a uniform size
    (as in the tests) still fall back to document order.
    """
    candidates = [line for line in lines if _is_namelike(line.text)]
    if not candidates:
        return "Unknown item", None

    named = [line for line in candidates if _match_profile(line.text)]
    product = named[0] if named else max(candidates, key=lambda line: line.height)

    remaining = [line for line in candidates if line is not product]
    brand = max(remaining, key=lambda line: line.height) if remaining else None
    return product.text, brand.text if brand else None


def _match_profile(raw_text: str) -> str | None:
    """First category, in foods.json order, whose name or a keyword appears as a word.

    Categories are generic ("Dairy"), so labels rarely name them; keywords map
    "Whole Milk" to dairy. Order breaks ties, e.g. "chicken sausage" is poultry.
    """
    lowered = raw_text.lower()
    for profile_id, profile in load_profiles().items():
        for word in (profile.name.lower(), *profile.keywords):
            if re.search(rf"\b{re.escape(word)}(?:e?s)?\b", lowered):
                return profile_id
    return None
