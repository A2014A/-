# webhook_receiver.py
# שרת מקומי שרץ על המחשב עם BarTender.
#
# תומך בשני "מסלולים" נפרדים:
#  1) המפתחות הרשמיים של JP Quality (5 templateKey קבועים, בלי כשרות/פסח,
#     כל הנתונים כולל תאריכים מגיעים מוכנים מ-JP Quality עצמו)
#  2) התוויות של הכלי העצמאי שלנו (print.html) - standalone_cartons/standalone_bags,
#     עם כשרות/פסח, ותאריכים שמחושבים כאן בשרת מקובץ האקסל
#
# עושה:
#  1) POST /webhook       - מקבל בקשת הדפסה חתומה (HMAC + חותמת זמן), מונע
#                           הדפסה כפולה לפי id (יומן קבוע ב-SQLite), מדפיס
#                           תווית-כותרת ואז את הסט עצמו.
#  2) GET  /status/<id>   - סטטוס עבודת הדפסה קודמת, חתום גם הוא.
#  3) GET  /health        - בדיקת זמינות בלבד, בלי BarTender ובלי הדפסה.
#  4) GET  /items         - חיפוש פריטים בקובץ האקסל (לכלי העצמאי בלבד).
#  וגם מגיש את print.html בכתובת הראשית "/".
#
# אימות:
#  - /items דורש מפתח גישה תקין בכותרת X-Api-Key (ראו api_keys.py).
#  - /webhook מקבל בקשה אם יש לה חתימת HMAC תקינה (JP Quality, ללא שינוי),
#    או מפתח גישה תקין (print.html והאפליקציה). בלי אף אחד מהם -> 401.
#
# דורש: pip install flask pywin32 python-dotenv pandas openpyxl python-dateutil

from flask import Flask, request, jsonify, send_from_directory
from dotenv import load_dotenv
from datetime import datetime, date
from dateutil.relativedelta import relativedelta
import win32com.client, pythoncom, hmac, hashlib, json, logging, os, pathlib, re, time, sqlite3, pandas as pd

from api_keys import load_api_keys, check_api_key

load_dotenv()
app = Flask(__name__)
SECRET = os.environ["PRINT_WEBHOOK_SECRET"]
BASE_DIR = pathlib.Path(__file__).parent

logging.basicConfig(filename="print_log.txt", level=logging.INFO)

API_KEYS = load_api_keys()

# ---------------------------------------------------------------
# הגדרות שצריך להתאים אצלכם
# ---------------------------------------------------------------

# חלון הזמן המקסימלי שבו מתקבלת בקשה (מגן מפני replay attacks)
MAX_CLOCK_DRIFT_SECONDS = 300  # 5 דקות

# יומן עבודות קבוע - שורד הפעלה מחדש של המחשב/השירות
DB_PATH = r"C:\BarTenderWebhook\print_jobs.db"

# --- תוויות ---
# כאן רק התבניות של JP Quality. סוגי המדבקות של הכלי העצמאי (print.html והאפליקציה)
# מוגדרים בקובץ label_types.json - ראו load_label_types() בהמשך.
LABEL_TEMPLATES = {
    # 5 המפתחות הרשמיים שסוכמו מול JP Quality - כרגע רק הראשון בנוי בפועל
    "carton_retail_color_85x85": r"C:\Labels\CartonRetailColor85x85.btw",
    "carton_yellow_100x50": r"C:\Labels\carton_yellow_100x50.btw",
    "package_white_small_60x45": r"C:\Labels\PackageWhiteSmall60x45.btw",
    "package_cohen_bottle_230x60": None,   # טרם נבנה
    "package_cohen_pail_5kg_230x99": None, # טרם נבנה
}

HEADER_TEMPLATES = {
    "carton_retail_color_85x85": r"C:\Labels\HeaderCartonRetailColor85x85.btw",
    "carton_yellow_100x50": r"C:\Labels\HeaderCartonYellow100x50.btw",
    "package_white_small_60x45": r"C:\Labels\HeaderPackageWhiteSmall60x45.btw",
    "package_cohen_bottle_230x60": None,
    "package_cohen_pail_5kg_230x99": None,
}

# ---------------------------------------------------------------
# סוגי המדבקות של הכלי העצמאי - נקראים מ-label_types.json
# ---------------------------------------------------------------
# הקובץ נקרא מחדש בכל פעם שהוא משתנה, כך שסוג מדבקה חדש נכנס לתוקף בלי
# להפעיל את השרת מחדש. print.html והאפליקציה מקבלים את הרשימה מ-/label-types.
# templateKey חייב להתחיל ב-standalone_, כדי שלעולם לא ידרוס מפתח של JP Quality.

LABEL_TYPES_PATH = BASE_DIR / "label_types.json"

# ברירת מחדל אם הקובץ חסר - זהה לארבעת הסוגים שהיו כתובים כאן קודם
DEFAULT_LABEL_TYPES = [
    {"key": "bags", "name": "שקיות", "templateKey": "standalone_bags", "labelType": "package",
     "template": r"C:\Labels\BagLabel.btw", "headerTemplate": r"C:\Labels\HeaderLabel_Bags.btw",
     "fields": ["sku", "product", "barcode", "kosher", "passover", "weight"], "dates": True},
    {"key": "cartons", "name": "קרטונים", "templateKey": "standalone_cartons", "labelType": "carton",
     "template": r"C:\Labels\CartonLabel.btw", "headerTemplate": r"C:\Labels\HeaderLabel_Cartons.btw",
     "fields": ["sku", "product", "barcode", "kosher", "passover", "packagesInfo"], "dates": True},
    {"key": "kosher_landa", "name": "כשרות לנדא", "templateKey": "standalone_kosher_landa", "labelType": "kosher",
     "template": r"C:\Labels\KosherStampLanda.btw", "headerTemplate": None,
     "fields": ["sku", "product"], "dates": False, "group": "תוויות כשרות"},
    {"key": "kosher_badatz", "name": 'כשרות בד"ץ', "templateKey": "standalone_kosher_badatz", "labelType": "kosher",
     "template": r"C:\Labels\KosherStampBadatz.btw", "headerTemplate": None,
     "fields": ["sku", "product"], "dates": False, "group": "תוויות כשרות"},
]

# השדות שאפשר לשלוח לתבנית - אלה השדות שמוחזרים מ-/items
ITEM_FIELDS = {"sku", "product", "barcode", "kosher", "passover", "weight", "packagesInfo", "expiryDate"}

_label_types_cache = {"mtime": None, "types": DEFAULT_LABEL_TYPES}


def _validate_label_type(t) -> bool:
    if not isinstance(t, dict):
        return False
    for k in ("key", "name", "templateKey", "labelType", "template"):
        if not isinstance(t.get(k), str) or not t[k].strip():
            logging.warning(f"label_types.json: לסוג חסר השדה '{k}' - מדלגים עליו: {t}")
            return False
    if not t["templateKey"].startswith("standalone_") or t["templateKey"] in LABEL_TEMPLATES:
        logging.warning(f"label_types.json: templateKey חייב להתחיל ב-standalone_ - מדלגים: {t['templateKey']}")
        return False
    if t.get("group") is not None and not isinstance(t.get("group"), str):
        logging.warning(f"label_types.json: group חייב להיות טקסט - מדלגים על {t['key']}")
        return False
    allowed = t.get("allowedUsers")
    if allowed is not None and (not isinstance(allowed, list) or any(not isinstance(u, str) for u in allowed)):
        logging.warning(f"label_types.json: allowedUsers חייב להיות רשימת שמות - מדלגים על {t['key']}")
        return False
    fields = t.get("fields")
    if not isinstance(fields, list) or not fields or any(f not in ITEM_FIELDS for f in fields):
        logging.warning(f"label_types.json: fields לא תקין בסוג {t['key']} (מותר: {sorted(ITEM_FIELDS)})")
        return False
    return True


def load_label_types():
    """מחזיר את רשימת סוגי המדבקות. קורא מחדש רק אם הקובץ השתנה.
    קובץ שבור - נשארים עם הגרסה התקינה האחרונה ורושמים שגיאה ביומן."""
    try:
        mtime = LABEL_TYPES_PATH.stat().st_mtime
    except OSError:
        return DEFAULT_LABEL_TYPES
    if mtime == _label_types_cache["mtime"]:
        return _label_types_cache["types"]
    try:
        raw = json.loads(LABEL_TYPES_PATH.read_text(encoding="utf-8-sig"))
        # "enabled": false = סוג שהוגדר מראש אבל התבנית שלו עוד לא מוכנה - לא מוצג ולא מודפס
        types = [t for t in raw if _validate_label_type(t) and t.get("enabled", True) is not False]
        keys = [t["key"] for t in types]
        if not types or len(keys) != len(set(keys)):
            raise ValueError("אין סוגים תקינים, או שיש key כפול")
        _label_types_cache.update(mtime=mtime, types=types)
        logging.info(f"label_types.json נטען: {keys}")
    except Exception as e:
        logging.error(f"שגיאה בקריאת label_types.json - ממשיכים עם הגרסה הקודמת: {e}")
        _label_types_cache["mtime"] = mtime
    return _label_types_cache["types"]


def user_may_print(label_type: dict, user: str) -> bool:
    """allowedUsers חסר = כולם. אחרת רק השמות שברשימה (השמות מ-API_KEYS ב-.env)."""
    allowed = label_type.get("allowedUsers")
    return allowed is None or user in allowed


def label_config():
    """תבניות, תבניות כותרת ומפתחות עם תאריכים - JP Quality + הכלי העצמאי."""
    templates = dict(LABEL_TEMPLATES)
    headers = dict(HEADER_TEMPLATES)
    date_keys = set()
    for t in load_label_types():
        templates[t["templateKey"]] = t["template"]
        headers[t["templateKey"]] = t.get("headerTemplate") or None
        if t.get("dates"):
            date_keys.add(t["templateKey"])
    return templates, headers, date_keys

# שדות שמערבבים עברית עם ספרה מובילה (כמו '500 גרם') וזקוקים לתיקון כיווניות
RTL_FIX_FIELDS = {"weight", "packagesInfo", "cartonContents", "targetWeight"}

# שדות שמערבבים עברית עם קטע לועזי (כמו 'FINE' בתוך שם מוצר) וזקוקים לעטיפת RLM
BIDI_MIXED_FIELDS = {"product"}

# *** קובץ ניסיון בלבד - רלוונטי רק לכלי העצמאי (standalone_*) ***
ITEMS_EXCEL_PATH = r"C:\BarTenderWebhook\test_items.xlsx"

EXCEL_COLUMNS = {
    "sku": "מקט",
    "product": "שם",
    "barcode": "ברקוד",
    "shelf_life_months": "חודשים מרחק לפג תוקף",
    "kosher": "כשרות",
    "weight": "משקל",
    "package_count": "מספר אריזות בקרטון",
    "passover": "פסח",
}

# ---------------------------------------------------------------
# יומן עבודות קבוע (SQLite) - מונע הדפסה כפולה גם אחרי הפעלה מחדש
# ---------------------------------------------------------------

def init_db():
    conn = sqlite3.connect(DB_PATH)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS print_jobs (
            id TEXT PRIMARY KEY,
            status TEXT NOT NULL,
            label_type TEXT,
            template_key TEXT,
            quantity INTEGER,
            requested_by TEXT,
            message TEXT,
            processed_at TEXT NOT NULL
        )
    """)
    conn.commit()
    conn.close()

init_db()


def get_job(job_id: str):
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    row = conn.execute("SELECT * FROM print_jobs WHERE id = ?", (job_id,)).fetchone()
    conn.close()
    return dict(row) if row else None


def save_job(job_id, status, label_type, template_key, quantity, requested_by, message) -> str:
    processed_at = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        """INSERT OR REPLACE INTO print_jobs
           (id, status, label_type, template_key, quantity, requested_by, message, processed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        (job_id, status, label_type, template_key, quantity, requested_by, message, processed_at),
    )
    conn.commit()
    conn.close()
    return processed_at


# ---------------------------------------------------------------
# עזרים כלליים
# ---------------------------------------------------------------

def clean(value) -> str:
    """הופך ערך חסר/NaN/None למחרוזת ריקה, אחרת ממיר למחרוזת רגילה."""
    if value is None:
        return ""
    if isinstance(value, float):
        if pd.isna(value):
            return ""
        if value.is_integer():
            return str(int(value))
        return str(value)
    text = str(value).strip()
    if text.lower() in ("nan", "none", "nat"):
        return ""
    return text


def is_yes(value) -> bool:
    return clean(value).lower() in ("כן", "true", "1", "yes")


def fix_rtl_leading_digit(text: str) -> str:
    """מונע היפוך כיוון תצוגה ב-BarTender כשמחרוזת עברית מתחילה בספרה."""
    if text and text[0].isdigit():
        return "\u200f" + text
    return text


def fix_bidi_mixed_latin(text: str) -> str:
    """
    מונע היפוך סדר מילים ב-BarTender כששדה עברי מכיל גם קטע לועזי
    (למשל 'פיין - כהן FINE מיונז טבעוני') - עוטף כל רצף של אותיות/ספרות
    לועזיות ב-RLM (Right-to-Left Mark) כדי לכפות על מנוע הרינדור כיוון
    ימין-לשמאל סביב הקטע הלועזי. בטוח להפעיל גם על מחרוזות בלי אנגלית בכלל -
    הן חוזרות ללא שינוי.
    """
    if not text:
        return text
    RLM = "\u200f"
    return re.sub(
        r"[A-Za-z0-9]+(?:[ \-][A-Za-z0-9]+)*",
        lambda m: RLM + m.group(0) + RLM,
        text,
    )


def verify_signature(payload: bytes, timestamp: str, signature: str) -> bool:
    signed_content = f"{timestamp}.".encode() + payload
    expected = hmac.new(SECRET.encode(), signed_content, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature or "")


def verify_status_signature(job_id: str, timestamp: str, signature: str) -> bool:
    signed_content = f"{timestamp}.{job_id}".encode()
    expected = hmac.new(SECRET.encode(), signed_content, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature or "")


def is_timestamp_fresh(timestamp: str) -> bool:
    try:
        ts = int(timestamp)
    except (TypeError, ValueError):
        return False
    return abs(time.time() - ts) <= MAX_CLOCK_DRIFT_SECONDS


def make_response(status, job_id, message="", error_code=None, http_status=200, processed_at=None):
    body = {
        "status": status,
        "id": job_id,
        "processedAt": processed_at or datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "message": message,
    }
    if error_code:
        body["errorCode"] = error_code
    return jsonify(body), http_status


def lookup_item_by_sku(sku: str):
    """רלוונטי רק לכלי העצמאי - קורא את האקסל מחדש ומחפש שורה לפי מקט."""
    try:
        df = pd.read_excel(ITEMS_EXCEL_PATH)
    except Exception as e:
        logging.error(f"שגיאה בקריאת קובץ האקסל: {e}")
        return None
    c = EXCEL_COLUMNS
    match = df[df[c["sku"]].astype(str) == str(sku)]
    return match.iloc[0] if not match.empty else None


def print_header_label(bt, header_path, requested_by, product, quantity, optional_fields=None):
    """optional_fields - שדות נוספים שממלאים רק אם הם קיימים בתבנית הכותרת.
    שדה חסר נרשם כאזהרה בלבד ולא מפיל את ההדפסה (בניגוד לשדות החובה)."""
    if not header_path or not requested_by:
        return
    header_fmt = bt.Formats.Open(header_path, False, "")
    try:
        header_fields = {
            "RequestedBy": requested_by,
            "Product": product,
            "Quantity": str(quantity),
            "Timestamp": datetime.now().strftime("%d/%m/%Y %H:%M"),
        }
        for fname, fvalue in header_fields.items():
            try:
                header_fmt.SetNamedSubStringValue(fname, fvalue)
            except Exception as e:
                raise Exception(f"שדה '{fname}' לא נמצא בקובץ הכותרת {header_path}: {e}")
        for fname, fvalue in (optional_fields or {}).items():
            try:
                header_fmt.SetNamedSubStringValue(fname, fvalue)
            except Exception as e:
                logging.warning(f"שדה '{fname}' לא נמצא בקובץ הכותרת {header_path} - מדלגים: {e}")
        header_fmt.PrintOut(False, False)
    finally:
        header_fmt.Close(2)


# ---------------------------------------------------------------
# דף החיפוש/הדפסה (הכלי העצמאי)
# ---------------------------------------------------------------

@app.route("/")
def index():
    return send_from_directory(BASE_DIR, "print.html")


@app.route("/items")
def search_items():
    if not check_api_key(request, API_KEYS):
        return jsonify({"error": "מפתח גישה חסר או שגוי", "errorCode": "INVALID_API_KEY"}), 401

    query = request.args.get("q", "").strip().lower()
    if len(query) < 2:
        return jsonify([])

    try:
        df = pd.read_excel(ITEMS_EXCEL_PATH)
    except Exception as e:
        logging.error(f"שגיאה בקריאת קובץ האקסל: {e}")
        return jsonify({"error": f"שגיאה בקריאת קובץ הפריטים: {e}"}), 500

    c = EXCEL_COLUMNS
    try:
        mask = (
            df[c["sku"]].astype(str).str.lower().str.contains(query, na=False)
            | df[c["barcode"]].astype(str).str.lower().str.contains(query, na=False)
            | df[c["product"]].astype(str).str.lower().str.contains(query, na=False)
        )
    except KeyError as e:
        return jsonify({"error": f"עמודה חסרה בקובץ האקסל: {e}"}), 500

    matches = df[mask].head(15)
    today = date.today()

    results = []
    for _, row in matches.iterrows():
        weight = clean(row[c["weight"]])
        package_count_raw = clean(row[c["package_count"]])
        packages_info = f"{package_count_raw} אריזות של {weight}" if (weight and package_count_raw) else ""

        try:
            months = int(row[c["shelf_life_months"]])
            expiry_preview = (today + relativedelta(months=months)).strftime("%d/%m/%Y")
        except (TypeError, ValueError):
            expiry_preview = ""

        results.append({
            "sku": clean(row[c["sku"]]),
            "product": clean(row[c["product"]]),
            "barcode": clean(row[c["barcode"]]),
            "kosher": clean(row[c["kosher"]]),
            "passover": "פסח" if is_yes(row[c["passover"]]) else "",
            "cartonsOnly": False,
            "expiryDate": expiry_preview,
            "weight": weight,
            "packagesInfo": packages_info,
        })

    return jsonify(results)


@app.route("/label-types")
def label_types():
    """רשימת סוגי המדבקות לכפתורים ב-print.html ובאפליקציה (בלי נתיבי קבצים)."""
    user = check_api_key(request, API_KEYS)
    if not user:
        return jsonify({"error": "מפתח גישה חסר או שגוי", "errorCode": "INVALID_API_KEY"}), 401
    # כל משתמש רואה רק את הסוגים שמותר לו להדפיס
    return jsonify([
        {"key": t["key"], "name": t["name"], "templateKey": t["templateKey"], "labelType": t["labelType"],
         "fields": t["fields"], "dates": bool(t.get("dates")), "group": t.get("group") or ""}
        for t in load_label_types() if user_may_print(t, user)
    ])


# ---------------------------------------------------------------
# בדיקת זמינות - לא נוגעת ב-BarTender בכלל
# ---------------------------------------------------------------

@app.route("/health")
def health():
    return jsonify({
        "status": "ok",
        "processedAt": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
    }), 200


# ---------------------------------------------------------------
# בדיקת סטטוס עבודת הדפסה - חתום, לא חושף עבודות אחרות
# ---------------------------------------------------------------

@app.route("/status/<job_id>")
def status(job_id):
    timestamp = request.headers.get("X-Timestamp", "")
    signature = request.headers.get("X-Signature", "")

    if not is_timestamp_fresh(timestamp):
        return make_response("error", job_id, "חותמת זמן חסרה או ישנה מדי", "STALE_TIMESTAMP", 401)
    if not verify_status_signature(job_id, timestamp, signature):
        return make_response("error", job_id, "חתימה לא תקינה", "INVALID_SIGNATURE", 401)

    job = get_job(job_id)
    if not job:
        return make_response("not_found", job_id, "עבודה לא נמצאה", "JOB_NOT_FOUND", 404)

    return make_response(job["status"], job_id, job["message"], processed_at=job["processed_at"])


# ---------------------------------------------------------------
# הדפסה בפועל
# ---------------------------------------------------------------

@app.route("/webhook", methods=["POST"])
def webhook():
    job_id = ""
    try:
        job = request.json or {}
        job_id = str(job.get("id", ""))
        timestamp = request.headers.get("X-Timestamp", "")
        signature = request.headers.get("X-Signature", "")

        if not job_id:
            return make_response("error", "", "מזהה עבודה (id) חסר", "MISSING_ID", 400)

        # מפתח גישה תקין (print.html / האפליקציה) מספיק לבדו. בלעדיו - בודקים
        # חתימת HMAC בדיוק כמו קודם, כך ש-JP Quality ממשיכה לעבוד בלי שינוי.
        key_owner = check_api_key(request, API_KEYS)
        if key_owner:
            logging.info(f"job {job_id} התקבל עם מפתח גישה של '{key_owner}'")
        else:
            if not is_timestamp_fresh(timestamp):
                return make_response("error", job_id, "חותמת זמן חסרה או ישנה מדי", "STALE_TIMESTAMP", 401)

            if not verify_signature(request.data, timestamp, signature):
                return make_response("error", job_id, "חתימה לא תקינה", "INVALID_SIGNATURE", 401)

        # מניעת הדפסה כפולה - בדיקה ביומן הקבוע לפי מזהה
        existing = get_job(job_id)
        if existing:
            return make_response(
                "already_handled", job_id, existing["message"],
                processed_at=existing["processed_at"], http_status=200,
            )

        label_type = job.get("labelType")
        template_key = job.get("templateKey")
        requested_by = clean(job.get("requestedBy", ""))
        data = {k: clean(v) for k, v in job.get("data", {}).items()}

        # --- DEBUG זמני: לוג מלא של השדות שהתקבלו, לצורך איתור בעיית allergens ---
        # ניתן להסיר את השורה הזו אחרי שהבעיה תיפתר.
        logging.info(f"[DEBUG] job {job_id} ({template_key}) קיבל data: {data}")

        templates, header_templates, date_keys = label_config()
        template_path = templates.get(template_key)
        if not template_path:
            msg = f"templateKey לא מוכר או עדיין לא מוגדר במערכת: {template_key}"
            save_job(job_id, "error", label_type, template_key, 0, requested_by, msg)
            return make_response("error", job_id, msg, "UNKNOWN_TEMPLATE_KEY", 400)

        # הרשאה לפי סוג מדבקה (allowedUsers ב-label_types.json) - רק לבקשות עם מפתח גישה.
        # בקשות חתומות של JP Quality לא עוברות כאן בכלל. לא נרשמת ביומן העבודות,
        # כדי שאותו id יוכל להישלח שוב אחרי שההרשאה תתוקן.
        if key_owner:
            lt = next((t for t in load_label_types() if t["templateKey"] == template_key), None)
            if lt and not user_may_print(lt, key_owner):
                logging.warning(f"job {job_id}: '{key_owner}' ניסה להדפיס {template_key} בלי הרשאה")
                return make_response("error", job_id, f"אין לך הרשאה להדפיס מדבקות מסוג '{lt['name']}'", "NOT_ALLOWED", 403)

        try:
            quantity = int(job.get("quantity", 1))
            if quantity < 1:
                raise ValueError
        except (TypeError, ValueError):
            msg = "quantity לא תקין"
            save_job(job_id, "error", label_type, template_key, 0, requested_by, msg)
            return make_response("error", job_id, msg, "INVALID_QUANTITY", 400)

        if template_key in date_keys:
            # רק לתוויות הכלי העצמאי - מחשבים תאריכים כאן. תבניות JP Quality
            # מקבלות את כל השדות (כולל תאריכים) מוכנים מהם, ולא נוגעים בזה.
            production_date = date.today()
            data["productionDate"] = production_date.strftime("%d/%m/%Y")
            sku = data.get("sku")
            row = lookup_item_by_sku(sku) if sku else None
            if row is not None:
                try:
                    months = int(row[EXCEL_COLUMNS["shelf_life_months"]])
                    data["expiryDate"] = (production_date + relativedelta(months=months)).strftime("%d/%m/%Y")
                except (TypeError, ValueError):
                    data["expiryDate"] = ""
            else:
                data["expiryDate"] = ""
            if job.get("skipDates"):
                data["productionDate"] = ""
                data["expiryDate"] = ""

        pythoncom.CoInitialize()
        bt = None
        try:
            bt = win32com.client.Dispatch("BarTender.Application")

            # מק"ט על תווית הכותרת - רק לתוויות הכלי העצמאי. תבניות JP Quality לא משתנות.
            header_optional = {"sku": data.get("sku", "")} if template_key.startswith("standalone_") else None
            print_header_label(bt, header_templates.get(template_key), requested_by, data.get("product", ""), quantity, header_optional)

            fmt = bt.Formats.Open(template_path, False, "")
            try:
                for field, value in data.items():
                    if field in RTL_FIX_FIELDS:
                        value = fix_rtl_leading_digit(value)
                    if field in BIDI_MIXED_FIELDS:
                        value = fix_bidi_mixed_latin(value)
                    try:
                        fmt.SetNamedSubStringValue(field, value)
                    except Exception as e:
                        # שדה שנשלח מ-JP Quality אבל לא קיים בתבנית הזו - לא כל
                        # תבנית משתמשת בכל השדות (למשל תווית בלי תאריך ייצור,
                        # לפי החלטת עיצוב). מדלגים על השדה הזה בלבד ורושמים
                        # אזהרה, במקום להפיל את כל עבודת ההדפסה בגללו.
                        logging.warning(f"שדה '{field}' לא נמצא בקובץ {template_path} - מדלגים: {e}")

                fmt.PrintSetup.IdenticalCopiesOfLabel = quantity
                fmt.PrintOut(False, False)
            finally:
                fmt.Close(2)

            msg = f"{requested_by or 'לא ידוע'} הדפיס/ה {quantity} מדבקות ({template_key})"
            processed_at = save_job(job_id, "printed", label_type, template_key, quantity, requested_by, msg)
            logging.info(msg + f" - עבודה {job_id}")
            return make_response("printed", job_id, msg, processed_at=processed_at)

        except Exception as e:
            msg = str(e)
            processed_at = save_job(job_id, "error", label_type, template_key, quantity, requested_by, msg)
            logging.error(f"נכשל job {job_id}: {msg}")
            return make_response("error", job_id, msg, "PRINT_FAILED", 500, processed_at=processed_at)

        finally:
            if bt is not None:
                try:
                    bt.Quit(2)
                except Exception:
                    pass
            pythoncom.CoUninitialize()

    except Exception as e:
        logging.error(f"שגיאה כללית בטיפול בבקשה: {e}")
        return make_response("error", job_id, str(e), "INTERNAL_ERROR", 500)


if __name__ == "__main__":
    # threaded=True - קריטי! בלי זה, השרת מטפל בבקשה אחת בכל פעם - אם בקשת
    # הדפסה תקועה (למשל BarTender לא מגיב), כל בקשה אחרת (כולל /health,
    # /status) פשוט תמתין בתור בלי שום מענה, במקום לקבל תשובה מיידית.
    app.run(host="127.0.0.1", port=5000, threaded=True)
