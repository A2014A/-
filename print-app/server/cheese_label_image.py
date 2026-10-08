"""
Renders a visual preview PNG of a single cheese carton label — not the actual
BarTender .btw template pixel-for-pixel, but a close visual approximation
(barcode + weight + product name in Hebrew/English) so the user can sanity-check
a label's content before printing a whole batch.

Requires: python-barcode, Pillow, python-bidi, arabic-reshaper
    pip install python-barcode Pillow python-bidi arabic-reshaper --break-system-packages
"""

import io
import barcode
from barcode.writer import ImageWriter
from PIL import Image, ImageDraw, ImageFont
import bidi.algorithm as bidi_algo
import arabic_reshaper

HEBREW_FONT_PATH = r"C:\Windows\Fonts\arialbd.ttf"
HEBREW_FONT_PATH_REGULAR = r"C:\Windows\Fonts\arial.ttf"


def _rtl(text: str) -> str:
    return bidi_algo.get_display(arabic_reshaper.reshape(text))


def render_label_image(barcode_value: str, weight_kg: float, product_he: str,
                        product_en: str, cheese_no: str = "") -> bytes:
    """Returns PNG bytes for a single label preview, roughly matching the
    layout seen on the real printed labels: barcode on top, weight + cheese
    number on one line, product name (English then Hebrew) below."""

    code12 = barcode_value[:12]
    code = barcode.get("ean13", code12, writer=ImageWriter())
    buf = io.BytesIO()
    code.write(buf, options={"write_text": True})
    buf.seek(0)
    barcode_img = Image.open(buf).convert("RGB")

    # Canvas roughly matching a 100mm x 45mm label proportions, scaled up for screen legibility.
    W, H = 900, 400
    canvas = Image.new("RGB", (W, H), "white")

    # Barcode centered near the top, scaled to fit width.
    bw, bh = barcode_img.size
    scale = min((W - 60) / bw, 200 / bh)
    barcode_img = barcode_img.resize((int(bw * scale), int(bh * scale)))
    bx = (W - barcode_img.width) // 2
    canvas.paste(barcode_img, (bx, 20))

    draw = ImageDraw.Draw(canvas)
    try:
        font_bold = ImageFont.truetype(HEBREW_FONT_PATH, 30)
        font_reg = ImageFont.truetype(HEBREW_FONT_PATH_REGULAR, 26)
    except OSError:
        # Fallback if arial isn't at the expected path — still renders,
        # just with PIL's built-in font (Hebrew glyphs may not display).
        font_bold = ImageFont.load_default()
        font_reg = ImageFont.load_default()

    y = 20 + barcode_img.height + 15

    # Weight (Hebrew, right-aligned) + cheese number (left-aligned), same line.
    weight_text = _rtl(f'משקל: {weight_kg:.2f}')
    draw.text((W - 30, y), weight_text, font=font_bold, fill="black", anchor="ra")
    if cheese_no:
        draw.text((30, y), str(cheese_no), font=font_bold, fill="black", anchor="la")
    y += 45

    # Product name — English then Hebrew, each centered.
    draw.text((W // 2, y), product_en, font=font_reg, fill="black", anchor="ma")
    y += 35
    draw.text((W // 2, y), _rtl(product_he), font=font_bold, fill="black", anchor="ma")

    out = io.BytesIO()
    canvas.save(out, format="PNG")
    return out.getvalue()
