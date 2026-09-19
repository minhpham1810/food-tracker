import io
import json

import httpx
import pillow_heif
import pytest
from fastapi.testclient import TestClient
from PIL import Image, ImageDraw, ImageFont

from apps.api.main import app

client = TestClient(app)


@pytest.fixture(autouse=True)
def use_tesseract_for_existing_ocr_tests(monkeypatch):
    """Keep legacy OCR tests deterministic and independent of a running model."""
    monkeypatch.setenv("OCR_ENGINE", "tesseract")


def render_label_image(lines: list[str]) -> Image.Image:
    img = Image.new("RGB", (520, 60 + 45 * len(lines)), "white")
    draw = ImageDraw.Draw(img)
    font = ImageFont.load_default(size=32)
    y = 10
    for line in lines:
        draw.text((10, y), line, fill="black", font=font)
        y += 45
    return img


def render_label(lines: list[str]) -> bytes:
    buffer = io.BytesIO()
    render_label_image(lines).save(buffer, format="PNG")
    return buffer.getvalue()


def render_label_heic(lines: list[str]) -> bytes:
    buffer = io.BytesIO()
    pillow_heif.from_pillow(render_label_image(lines)).save(buffer, quality=90)
    return buffer.getvalue()


def test_ocr_scan_extracts_fields_from_a_rendered_label():
    png = render_label(["Whole Milk", "Meadow Gold", "BEST BY SEP 05", "1 gal  LOT L2309A"])
    response = client.post("/api/ocr/scan", files={"image": ("label.png", png, "image/png")})
    assert response.status_code == 200
    body = response.json()
    assert "Milk" in body["product_name"]
    assert body["suggested_profile_id"] == "milk"
    assert body["package_size"] and "gal" in body["package_size"].lower()
    assert body["lot_code"] == "L2309A"
    assert 0.0 <= body["confidence"] <= 1.0


def test_ocr_scan_handles_heic_photos():
    # iPhone camera/photo-library captures default to HEIC -- this is the format that
    # broke every scan before pillow-heif was registered as an opener.
    heic = render_label_heic(["Whole Milk", "Meadow Gold", "BEST BY SEP 05", "1 gal  LOT L2309A"])
    response = client.post("/api/ocr/scan", files={"image": ("label.heic", heic, "image/heic")})
    assert response.status_code == 200
    body = response.json()
    assert "Milk" in body["product_name"]
    assert body["suggested_profile_id"] == "milk"


def test_ocr_scan_matches_a_different_known_profile():
    png = render_label(["Chicken Breast", "Farmhouse", "USE BY SEP 04"])
    response = client.post("/api/ocr/scan", files={"image": ("label.png", png, "image/png")})
    assert response.json()["suggested_profile_id"] == "chicken"


def test_ocr_scan_rejects_unreadable_image_data():
    response = client.post(
        "/api/ocr/scan", files={"image": ("not-an-image.png", b"this is not image data", "image/png")}
    )
    assert response.status_code == 400


def test_ocr_confirm_creates_item_with_scanned_metadata():
    png = render_label(["Baby Spinach", "GreenLeaf", "BEST BY SEP 06", "5 oz  LOT S0042"])
    scanned = client.post("/api/ocr/scan", files={"image": ("label.png", png, "image/png")}).json()
    created = client.post(
        "/api/ocr/confirm",
        json={
            "profile_id": scanned["suggested_profile_id"],
            "name": scanned["product_name"],
            "brand": scanned["brand"],
            "printed_date": scanned["printed_date"],
            "package_size": scanned["package_size"],
            "lot_code": scanned["lot_code"],
        },
    )
    assert created.status_code == 201
    body = created.json()
    assert body["profile_id"] == "spinach"
    assert body["brand"] == "GreenLeaf"
    assert body["lot_code"] == "S0042"


def test_ocr_confirm_rejects_unknown_profile():
    response = client.post("/api/ocr/confirm", json={"profile_id": "made-up"})
    assert response.status_code == 400


def render_two_size_label() -> bytes:
    """A realistic carton: small brand line, large product name below it.

    Real packaging sets the product in the biggest type, so the naive
    "first line is the product, second is the brand" rule inverts them.
    """
    img = Image.new("RGB", (620, 320), "white")
    draw = ImageDraw.Draw(img)
    draw.text((20, 20), "Fresh Valley", fill="black", font=ImageFont.load_default(size=28))
    draw.text((20, 80), "WHOLE MILK", fill="black", font=ImageFont.load_default(size=56))
    draw.text((20, 170), "BEST BY SEP 12", fill="black", font=ImageFont.load_default(size=30))
    draw.text((20, 230), "1 gal  LOT A7734", fill="black", font=ImageFont.load_default(size=30))
    buffer = io.BytesIO()
    img.save(buffer, format="PNG")
    return buffer.getvalue()


def test_product_name_beats_brand_when_the_label_uses_two_type_sizes():
    response = client.post(
        "/api/ocr/scan", files={"image": ("label.png", render_two_size_label(), "image/png")}
    )
    assert response.status_code == 200
    body = response.json()

    # The large line is the product; the small line above it is the brand.
    assert "MILK" in body["product_name"].upper()
    assert body["brand"] is not None and "VALLEY" in body["brand"].upper()
    assert body["suggested_profile_id"] == "milk"


def test_metadata_lines_are_never_offered_as_the_product_or_brand():
    response = client.post(
        "/api/ocr/scan", files={"image": ("label.png", render_two_size_label(), "image/png")}
    )
    body = response.json()
    for field in (body["product_name"], body["brand"] or ""):
        assert "BEST BY" not in field.upper()
        assert "LOT" not in field.upper()
        assert "GAL" not in field.upper()


def test_sideways_photo_is_rotated_before_reading():
    """A phone photo can reach the API on its side.

    EXIF orientation covers cameras that set the tag; this checks the pixel-level
    fallback, which is what catches crops, screenshots and re-encoded images that
    lost their metadata. Read sideways, Tesseract returns mirrored nonsense
    ("MII ATOHM" for "WHOLE MILK").
    """
    upright = render_label_image(["Whole Milk", "Meadow Gold", "BEST BY SEP 05"])
    buffer = io.BytesIO()
    upright.rotate(90, expand=True).save(buffer, format="PNG")

    response = client.post(
        "/api/ocr/scan", files={"image": ("sideways.png", buffer.getvalue(), "image/png")}
    )
    assert response.status_code == 200
    body = response.json()
    assert "Milk" in body["product_name"]
    assert body["suggested_profile_id"] == "milk"
    assert "SEP" in body["raw_text"].upper()


def test_upright_photos_are_never_rotated():
    """The orientation probe must not touch an image that already reads.

    Scores for 0 and 270 degrees are often identical on a clean label, so a
    rotation has to beat upright by a margin rather than merely tie it --
    rotating a good photo costs far more than leaving a sideways one alone.
    """
    from apps.api.ocr import _best_rotation

    upright = render_label_image(["Whole Milk", "Meadow Gold", "BEST BY SEP 05"])
    assert _best_rotation(upright) == 0


def test_qwen_vision_extracts_structured_label_fields(monkeypatch):
    monkeypatch.setenv("OCR_ENGINE", "qwen")
    captured = {}

    def fake_post(url, **kwargs):
        captured["url"] = url
        captured["payload"] = kwargs["json"]
        return httpx.Response(
            200,
            request=httpx.Request("POST", url),
            json={
                "message": {
                    "content": json.dumps(
                        {
                            "product_name": "Whole Milk",
                            "brand": "Fresh Valley",
                            "printed_date": "SEP 12",
                            "package_size": "1 gal",
                            "lot_code": "A7734",
                            "raw_text": (
                                "FRESH VALLEY\nWHOLE MILK\nBEST BY SEP 12\n1 gal LOT A7734"
                            ),
                        }
                    )
                }
            },
        )

    monkeypatch.setattr(httpx, "post", fake_post)
    response = client.post(
        "/api/ocr/scan",
        files={"image": ("label.png", render_label(["placeholder"]), "image/png")},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["product_name"] == "Whole Milk"
    assert body["brand"] == "Fresh Valley"
    assert body["printed_date"] == "SEP 12"
    assert body["package_size"] == "1 gal"
    assert body["lot_code"] == "A7734"
    assert body["suggested_profile_id"] == "milk"
    assert body["confidence"] == 1.0
    assert captured["url"] == "http://127.0.0.1:11434/api/chat"
    assert captured["payload"]["model"] == "qwen3.5:9b"
    assert captured["payload"]["messages"][0]["images"]
    assert captured["payload"]["format"]["type"] == "object"
    assert captured["payload"]["options"]["temperature"] == 0
    assert captured["payload"]["think"] is False


def test_qwen_vision_drops_fields_not_grounded_in_transcription(monkeypatch):
    monkeypatch.setenv("OCR_ENGINE", "qwen")

    def fake_post(url, **kwargs):
        return httpx.Response(
            200,
            request=httpx.Request("POST", url),
            json={
                "message": {
                    "content": json.dumps(
                        {
                            "product_name": "Whole Milk",
                            "brand": "Invented Brand",
                            "printed_date": None,
                            "package_size": None,
                            "lot_code": None,
                            "raw_text": "WHOLE MILK",
                        }
                    )
                }
            },
        )

    monkeypatch.setattr(httpx, "post", fake_post)
    response = client.post(
        "/api/ocr/scan",
        files={"image": ("label.png", render_label(["placeholder"]), "image/png")},
    )

    assert response.status_code == 200
    assert response.json()["product_name"] == "Whole Milk"
    assert response.json()["brand"] is None
    assert response.json()["confidence"] == 0.5


def test_qwen_vision_falls_back_to_tesseract_when_ollama_is_unavailable(monkeypatch):
    from apps.api import ocr as ocr_module

    monkeypatch.setenv("OCR_ENGINE", "qwen")
    fallback_called = False

    def unavailable(url, **kwargs):
        raise httpx.ConnectError("connection refused", request=httpx.Request("POST", url))

    def fallback(image):
        nonlocal fallback_called
        fallback_called = True
        return {
            "product_name": "Whole Milk",
            "brand": "Meadow Gold",
            "printed_date": "SEP 05",
            "package_size": None,
            "lot_code": None,
            "raw_text": "Whole Milk\nMeadow Gold\nBEST BY SEP 05",
            "confidence": 0.8,
            "suggested_profile_id": "milk",
        }

    monkeypatch.setattr(httpx, "post", unavailable)
    monkeypatch.setattr(ocr_module, "_scan_with_tesseract", fallback)
    response = client.post(
        "/api/ocr/scan",
        files={
            "image": (
                "label.png",
                render_label(["Whole Milk", "Meadow Gold", "BEST BY SEP 05"]),
                "image/png",
            )
        },
    )

    assert response.status_code == 200
    assert fallback_called is True
    assert "Milk" in response.json()["product_name"]
    assert response.json()["suggested_profile_id"] == "milk"


def test_qwen_failure_reports_unavailable_tesseract_cleanly(monkeypatch):
    import pytesseract

    from apps.api import ocr as ocr_module
    from apps.api.vision_ocr import VisionOCRError

    monkeypatch.setenv("OCR_ENGINE", "qwen")

    def invalid_qwen_response(image):
        raise VisionOCRError("invalid response")

    def missing_tesseract(image):
        raise pytesseract.TesseractNotFoundError()

    monkeypatch.setattr(ocr_module, "extract_label", invalid_qwen_response)
    monkeypatch.setattr(ocr_module, "_scan_with_tesseract", missing_tesseract)
    response = client.post(
        "/api/ocr/scan",
        files={"image": ("label.png", render_label(["placeholder"]), "image/png")},
    )

    assert response.status_code == 503
    assert response.json()["detail"] == (
        "Qwen vision OCR failed (invalid response); "
        "the Tesseract fallback is not installed"
    )
