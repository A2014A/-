"""
cheese_upload.py — פענוח קובץ שנשלח כ-base64 בתוך JSON (משותף ל-/cheese-ocr ול-/cheese-preview-upload).

האפליקציה בטלפון לא מצליחה לשלוח multipart עם uri, ולכן שולחת את הקובץ כ-base64.
ה-multipart הישן (cheese-labels.html בדפדפן) ממשיך לעבוד במקביל.
"""

import base64
import binascii
import re

MAX_JSON_UPLOAD_BYTES = 15 * 1024 * 1024

_DATA_URL_PREFIX = re.compile(r"^data:[^;,]*;base64,", re.IGNORECASE)


class UploadError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.message = message
        self.status = status


def _too_large(max_bytes):
    return UploadError(f"הקובץ גדול מדי (מעל {max_bytes // (1024 * 1024)}MB)", 413)


def decode_base64_upload(value, max_bytes=MAX_JSON_UPLOAD_BYTES) -> bytes:
    """מחרוזת base64 (אפשר עם קידומת data: ועם מעברי שורה) -> bytes.
    חסר/לא תקין -> UploadError 400. גדול מ-max_bytes -> UploadError 413."""
    if not isinstance(value, str) or not value.strip():
        raise UploadError("לא נשלח קובץ (שדה ה-base64 חסר או ריק)", 400)
    text = "".join(_DATA_URL_PREFIX.sub("", value.strip()).split())
    if len(text) * 3 // 4 > max_bytes + 3:
        raise _too_large(max_bytes)
    try:
        raw = base64.b64decode(text, validate=True)
    except (binascii.Error, ValueError):
        raise UploadError("הקובץ שנשלח אינו base64 תקין", 400)
    if not raw:
        raise UploadError("לא נשלח קובץ (שדה ה-base64 ריק)", 400)
    if len(raw) > max_bytes:
        raise _too_large(max_bytes)
    return raw
