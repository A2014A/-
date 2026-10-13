"""
cheese_ocr.py — זיהוי משקלים ומספרי קרטון מתמונה (POST /cheese-ocr).

האפליקציה שולחת תמונה אחת בכל בקשה (שדה multipart בשם "image").
התמונה מוקטנת כאן ונשלחת ל-Claude, שמחזיר JSON לפי סכמה קבועה:
לכל קרטון בתמונה: המספר שנכתב עליו בטוש, המשקל נטו בק"ג, ורמת ביטחון.

דורש בקובץ .env:
    ANTHROPIC_API_KEY=sk-ant-...
ולא חובה:
    CHEESE_OCR_MODEL=claude-opus-5-5

הקובץ הזה לא נוגע ב-webhook_receiver.py ולא ב-JP Quality.
"""

import base64
import io
import json
import logging
import os

from flask import Blueprint, jsonify, request

from cheese_upload import UploadError, decode_base64_upload

cheese_ocr_bp = Blueprint("cheese_ocr", __name__)

DEFAULT_MODEL = "claude-opus-5-5"
MAX_UPLOAD_BYTES = 20 * 1024 * 1024
MAX_SIDE_PX = 1568  # תמונה גדולה יותר לא משפרת את הזיהוי, רק מייקרת
# Cloudflare מנתק בקשה אחרי 100 שניות; משאירים מרווח.
API_TIMEOUT_S = 80.0

_NULLABLE_STRING = {"anyOf": [{"type": "string"}, {"type": "null"}]}
_NULLABLE_NUMBER = {"anyOf": [{"type": "number"}, {"type": "null"}]}

OCR_SCHEMA = {
    "type": "object",
    "properties": {
        "cartons": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "cartonNo": _NULLABLE_STRING,
                    "weightKg": _NULLABLE_NUMBER,
                    "weightText": {"type": "string"},
                    "confidence": {"type": "string", "enum": ["high", "medium", "low"]},
                    "note": {"type": "string"},
                },
                "required": ["cartonNo", "weightKg", "weightText", "confidence", "note"],
                "additionalProperties": False,
            },
        },
        "batchNumber": _NULLABLE_STRING,
    },
    "required": ["cartons", "batchNumber"],
    "additionalProperties": False,
}

PROMPT = """This photo shows one or more cartons (or wheels) of imported cheese in a warehouse.
Each carton has a supplier label, and the worker has usually written a carton number (1-30) on it by hand with a marker.

For every carton you can see, report:
- cartonNo: the number handwritten with a marker on that carton (only the handwritten one, not a printed number). null if there is none or it cannot be read.
- weightKg: the NET weight in kilograms, exactly as printed on that carton's label. Labels use a comma as the decimal separator ("4,74 kg" = 4.74). Never use "Approx." / nominal weights, gross weight, or tare. If the net weight is only in grams, convert to kg. If the label has a GS1 barcode text with "(3103)xxxxxx", that is the net weight in kg with 3 decimals (003286 = 3.286) and can confirm the printed number. null if no net weight is readable.
- weightText: the weight text exactly as printed (e.g. "Net weight 4,74 kg"), or "" if none.
- confidence: "high" only if both the weight and the carton number are clearly readable; "low" if you had to guess any digit.
- note: a short note in Hebrew when something is unclear (e.g. "הספרה האחרונה לא ברורה"), otherwise "".

batchNumber: the supplier batch / lot number if the same one appears on the labels (prefer the field named "Batch"), otherwise null.

If there are no cartons or no labels in the photo, return an empty cartons list. Do not invent values."""


class OcrError(Exception):
    def __init__(self, message, code, status=500):
        super().__init__(message)
        self.message = message
        self.code = code
        self.status = status


def prepare_image(raw: bytes) -> tuple[str, str]:
    """מסובב לפי EXIF, מקטין ל-MAX_SIDE_PX ומחזיר (media_type, base64)."""
    from PIL import Image, ImageOps

    try:
        img = Image.open(io.BytesIO(raw))
        img = ImageOps.exif_transpose(img)
    except Exception:
        raise OcrError("הקובץ שנשלח אינו תמונה תקינה", "BAD_IMAGE", 400)
    if img.mode not in ("RGB", "L"):
        img = img.convert("RGB")
    img.thumbnail((MAX_SIDE_PX, MAX_SIDE_PX))
    out = io.BytesIO()
    img.save(out, format="JPEG", quality=85)
    return "image/jpeg", base64.standard_b64encode(out.getvalue()).decode("ascii")


def _clean_weight(value):
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        return None
    w = round(float(value), 3)
    return w if 0 < w < 100 else None


def _clean_carton_no(value):
    if value is None:
        return None
    s = "".join(str(value).split())
    return s or None


def normalize_result(data: dict) -> dict:
    """מנקה את תשובת המודל: משקל סביר, מספר קרטון בלי רווחים."""
    cartons = []
    for c in data.get("cartons") or []:
        if not isinstance(c, dict):
            continue
        cartons.append({
            "cartonNo": _clean_carton_no(c.get("cartonNo")),
            "weightKg": _clean_weight(c.get("weightKg")),
            "weightText": str(c.get("weightText") or ""),
            "confidence": c.get("confidence") if c.get("confidence") in ("high", "medium", "low") else "low",
            "note": str(c.get("note") or ""),
        })
    batch = data.get("batchNumber")
    batch = "".join(str(batch).split()) if batch else None
    return {"cartons": cartons, "batchNumber": batch or None}


def _make_client():
    api_key = os.getenv("ANTHROPIC_API_KEY", "").strip()
    if not api_key:
        raise OcrError("זיהוי מתמונה לא מוגדר בשרת (חסר ANTHROPIC_API_KEY בקובץ .env)", "OCR_NOT_CONFIGURED")
    try:
        import anthropic
    except ImportError:
        raise OcrError("חסרה ספרייה בשרת. הרץ במחשב ההדפסה: py -m pip install anthropic", "OCR_NOT_INSTALLED")
    return anthropic, anthropic.Anthropic(api_key=api_key, timeout=API_TIMEOUT_S, max_retries=1)


def recognize(media_type: str, image_b64: str, client=None, anthropic_mod=None) -> dict:
    if client is None:
        anthropic_mod, client = _make_client()
    model = os.getenv("CHEESE_OCR_MODEL", "").strip() or DEFAULT_MODEL
    try:
        response = client.beta.messages.create(
            model=model,
            max_tokens=8000,
            # אם המודל מסרב, השרת של Anthropic מנסה אוטומטית מודל חלופי
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
            output_config={"format": {"type": "json_schema", "schema": OCR_SCHEMA}},
            messages=[{
                "role": "user",
                "content": [
                    {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": image_b64}},
                    {"type": "text", "text": PROMPT},
                ],
            }],
        )
    except Exception as e:
        raise _api_error(e, anthropic_mod)

    if response.stop_reason == "refusal":
        raise OcrError("שירות הזיהוי סירב לעבד את התמונה. נסה תמונה אחרת.", "OCR_REFUSED")
    if response.stop_reason == "max_tokens":
        raise OcrError("התשובה משירות הזיהוי נקטעה. נסה לצלם פחות קרטונים בתמונה.", "OCR_TRUNCATED")
    text = next((b.text for b in response.content if b.type == "text"), "")
    try:
        data = json.loads(text)
    except ValueError:
        raise OcrError("תשובה לא תקינה משירות הזיהוי. נסה שוב.", "OCR_BAD_RESPONSE")
    usage = response.usage
    logging.info(
        f"cheese-ocr: model={response.model} in={usage.input_tokens} out={usage.output_tokens} "
        f"cartons={len(data.get('cartons') or [])} request_id={getattr(response, '_request_id', '')}"
    )
    return normalize_result(data)


def _api_error(e, anthropic_mod):
    logging.error(f"cheese-ocr: {type(e).__name__}: {e}")
    if anthropic_mod is not None:
        if isinstance(e, anthropic_mod.AuthenticationError):
            return OcrError("מפתח ANTHROPIC_API_KEY בשרת שגוי", "OCR_BAD_KEY")
        if isinstance(e, anthropic_mod.RateLimitError):
            return OcrError("שירות הזיהוי עמוס כרגע. נסה שוב בעוד דקה.", "OCR_BUSY")
        if isinstance(e, anthropic_mod.APITimeoutError):
            return OcrError("שירות הזיהוי לא ענה בזמן. נסה שוב.", "OCR_TIMEOUT")
        if isinstance(e, anthropic_mod.APIConnectionError):
            return OcrError("אין חיבור משרת ההדפסה לשירות הזיהוי", "OCR_NO_CONNECTION")
        if isinstance(e, anthropic_mod.APIStatusError):
            if e.status_code == 400 and "credit" in str(e).lower():
                return OcrError("נגמרה היתרה בחשבון Anthropic", "OCR_NO_CREDIT")
            return OcrError(f"שגיאה משירות הזיהוי (קוד {e.status_code})", "OCR_API_ERROR")
    return OcrError("שגיאה בזיהוי התמונה. נסה שוב.", "OCR_ERROR")


@cheese_ocr_bp.route("/cheese-ocr", methods=["POST"])
def cheese_ocr():
    """
    Body (multipart): image=<קובץ תמונה>
      או (JSON, מהאפליקציה): {"imageBase64": "<base64 בלי קידומת data:>", "mediaType": "image/jpeg"}
    Response: { "cartons": [{cartonNo, weightKg, weightText, confidence, note}], "batchNumber": "..." | null }
    """
    if request.is_json:
        body = request.get_json(silent=True) or {}
        try:
            raw = decode_base64_upload(body.get("imageBase64"))
        except UploadError as e:
            code = "IMAGE_TOO_LARGE" if e.status == 413 else "BAD_IMAGE_DATA"
            return jsonify({"error": e.message, "errorCode": code}), e.status
    else:
        f = request.files.get("image")
        if f is None:
            return jsonify({"error": "לא נשלחה תמונה", "errorCode": "NO_IMAGE"}), 400
        raw = f.read(MAX_UPLOAD_BYTES + 1)
        if len(raw) > MAX_UPLOAD_BYTES:
            return jsonify({"error": "התמונה גדולה מדי", "errorCode": "IMAGE_TOO_LARGE"}), 400
    try:
        media_type, image_b64 = prepare_image(raw)
        return jsonify(recognize(media_type, image_b64))
    except OcrError as e:
        return jsonify({"error": e.message, "errorCode": e.code}), e.status
