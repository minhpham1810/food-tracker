"""Rasterise the brand mark into the Expo asset set: python3 scripts/build-icons.py.

Artwork is copied verbatim from the "Freshness Tracker Logo" design canvas.

qlmanage is the only SVG renderer on this machine; it writes <name>.svg.png at
the requested max edge, which PIL then trims to the exact square.
"""
import shutil
import subprocess
from pathlib import Path

from PIL import Image, ImageChops

HERE = Path(__file__).parent / "build"
HERE.mkdir(exist_ok=True)
OUT = Path(__file__).parent.parent / "assets/images"

YELLOW = "#FFD93D"
INK = "#2A2100"

# Mark artwork, verbatim from the canvas's project/Icon.dc.html (viewBox 292 29 400 400).
MARK = """
<path d="M420 146 L421 162 M548 146 L549 162" fill="none"/>
<path d="M366 78 L598 88 L596 146 L369 141 Z" fill="#FFF3B0"/>
<ellipse cx="428" cy="108" rx="22" ry="18" transform="rotate(-15 428 108)" fill="#FFFFFF"/>
<ellipse cx="428" cy="110" rx="9" ry="12" transform="rotate(-15 428 110)" fill="#FFD93D"/>
<ellipse cx="520" cy="104" rx="26" ry="20" transform="rotate(-10 520 104)" fill="#FFFFFF"/>
<ellipse cx="520" cy="105" rx="12" ry="10" transform="rotate(-10 520 105)" fill="#FFD93D"/>
<path d="M470 130 Q485 138 500 131" fill="none"/>
<path d="M354 208 Q343 292 356 380 L637 378 Q640 296 609 208 Z" fill="#FFFBE0"/>
<path d="M347 164 L609 166 L610 208 L354 208 Z" fill="#F2B705"/>
<path d="M376 170 L378 190 M402 170 L404 192 M430 170 L431 188 M458 170 L459 190 M497 170 L498 190 M527 170 L528 188 M561 170 L562 190 M578 170 L579 186" fill="none" stroke-width="3.5" stroke-dasharray="7 6"/>
<path d="M448 258 C452 232 490 222 535 234 C575 246 572 292 540 300 C520 304 500 300 488 296 C470 290 446 278 448 258 Z" fill="#E09A00"/>
<path d="M480 290 L416 322" fill="none" stroke-width="22"/>
<path d="M480 290 L416 322" fill="none" stroke="#FFFBE0" stroke-width="12"/>
<circle cx="405" cy="320" r="8" fill="#FFFBE0"/>
<circle cx="431" cy="332" r="16" fill="#FFFBE0"/>
"""

# Outline-only variant, from project/Notification.dc.html -- Android tints the
# monochrome layer flat, so fills would collapse into one blob.
MONO = """
<path d="M420 146 L421 162 M548 146 L549 162" fill="none"/>
<path d="M366 78 L598 88 L596 146 L369 141 Z" fill="none"/>
<ellipse cx="428" cy="108" rx="22" ry="18" transform="rotate(-15 428 108)" fill="none"/>
<ellipse cx="428" cy="110" rx="9" ry="12" transform="rotate(-15 428 110)" fill="none"/>
<ellipse cx="520" cy="104" rx="26" ry="20" transform="rotate(-10 520 104)" fill="none"/>
<ellipse cx="520" cy="105" rx="12" ry="10" transform="rotate(-10 520 105)" fill="none"/>
<path d="M470 130 Q485 138 500 131" fill="none"/>
<path d="M354 208 Q343 292 356 380 L637 378 Q640 296 609 208 Z" fill="none"/>
<path d="M347 164 L609 166 L610 208 L354 208 Z" fill="none"/>
<path d="M376 170 L378 190 M402 170 L404 192 M430 170 L431 188 M458 170 L459 190 M497 170 L498 190 M527 170 L528 188 M561 170 L562 190 M578 170 L579 186" fill="none" stroke-width="5" stroke-dasharray="7 6"/>
<path d="M448 258 C452 232 490 222 535 234 C575 246 572 292 540 300 C520 304 500 300 488 296 C470 290 446 278 448 258 Z" fill="none"/>
<path d="M480 290 L416 322" fill="none" stroke-width="7"/>
<circle cx="405" cy="320" r="8" fill="none"/>
<circle cx="431" cy="332" r="16" fill="none"/>
"""

VB_X, VB_Y, VB_SIDE = 292.0, 29.0, 400.0


def svg(size: int, fraction: float, *, bg: str | None, art: str, stroke: str, width: float) -> str:
    """Square canvas with the mark centred at `fraction` of the edge."""
    drawn = size * fraction
    scale = drawn / VB_SIDE
    offset = (size - drawn) / 2
    rect = f'<rect width="{size}" height="{size}" fill="{bg}"/>' if bg else ""
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" '
        f'viewBox="0 0 {size} {size}">{rect}'
        f'<g transform="translate({offset - VB_X * scale} {offset - VB_Y * scale}) scale({scale})" '
        f'stroke="{stroke}" stroke-width="{width}" stroke-linecap="round" stroke-linejoin="round">'
        f"{art}</g></svg>"
    )


def rasterise(name: str, source: str, size: int) -> Image.Image:
    src = HERE / f"{name}.svg"
    src.write_text(source)
    subprocess.run(["qlmanage", "-t", "-s", str(size), "-o", str(HERE), str(src)], check=True,
                   capture_output=True)
    image = Image.open(HERE / f"{name}.svg.png").convert("RGB")
    return image if image.size == (size, size) else image.resize((size, size), Image.LANCZOS)


def render(name: str, source: str, size: int) -> None:
    """qlmanage always flattens onto white, so a transparent asset is recovered
    by rendering over white and over black: alpha = 1 - (white - black)."""
    if 'BG_KEY' not in source:
        image = rasterise(name, source, size).convert("RGBA")
    else:
        on_white = rasterise(name, source.replace("BG_KEY", "#FFFFFF"), size)
        on_black = rasterise(name, source.replace("BG_KEY", "#000000"), size)
        alpha = ImageChops.invert(ImageChops.subtract(on_white, on_black)).convert("L")
        image = Image.new("RGBA", (size, size))
        image.paste(on_black, mask=None)
        # on_black is the premultiplied color; PIL wants straight alpha.
        px, ax = image.load(), alpha.load()
        for y in range(size):
            for x in range(size):
                a = ax[x, y]
                r, g, b, _ = px[x, y]
                px[x, y] = (0, 0, 0, 0) if a == 0 else (
                    min(255, r * 255 // a), min(255, g * 255 // a), min(255, b * 255 // a), a)
        image = image
    image.save(OUT / f"{name}.png")
    print(f"{name}.png {image.size}")


render("icon", svg(1024, 0.75, bg=YELLOW, art=MARK, stroke=INK, width=5), 1024)
render("favicon", svg(96, 0.78, bg=YELLOW, art=MARK, stroke=INK, width=5), 96)
render("android-icon-background", f'<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="1024" height="1024" fill="{YELLOW}"/></svg>', 1024)
render("android-icon-foreground", svg(1024, 0.575, bg="BG_KEY", art=MARK, stroke=INK, width=5), 1024)
render("android-icon-monochrome", svg(1024, 0.575, bg="BG_KEY", art=MONO, stroke=INK, width=7), 1024)
render("splash-icon", svg(512, 0.92, bg="BG_KEY", art=MARK, stroke=INK, width=5), 512)
shutil.rmtree(HERE / "cache", ignore_errors=True)
