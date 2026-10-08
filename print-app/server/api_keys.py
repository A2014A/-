"""
api_keys.py - בדיקת מפתח גישה (X-Api-Key) משותפת לשני השרתים.

המפתחות נקראים מהמשתנה API_KEYS בקובץ ה-.env, בפורמט:
    API_KEYS=yossi_phone:k3J9...,office_pc:Zp81...,moshe_phone:Qa7c...

כל זוג הוא "שם:מפתח". השם מופיע ביומן בלבד ומאפשר לזהות מאיזה טלפון/מחשב
הגיעה הבקשה. כדי לבטל טלפון אחד - מוחקים את הזוג שלו מהשורה ומפעילים מחדש
את השרת. שאר המפתחות ממשיכים לעבוד.

יצירת מפתח חדש (בחלון cmd על מחשב ההדפסה):
    py -c "import secrets; print(secrets.token_urlsafe(24))"
"""

import hmac
import logging
import os


def load_api_keys() -> dict:
    """מחזיר {מפתח: שם}. שורה ריקה או חסרה = אין מפתחות = כל בקשה תידחה."""
    raw = os.environ.get("API_KEYS", "")
    keys = {}
    for pair in raw.split(","):
        pair = pair.strip()
        if not pair:
            continue
        name, sep, key = pair.partition(":")
        name, key = name.strip(), key.strip()
        if not sep or not name or len(key) < 16:
            logging.warning(f"API_KEYS: מדלגים על רשומה לא תקינה '{name or pair[:8]}' (צריך name:key, מפתח של 16 תווים לפחות)")
            continue
        keys[key] = name
    if not keys:
        logging.warning("API_KEYS ריק - כל בקשה שדורשת מפתח גישה תידחה")
    return keys


def check_api_key(request, keys: dict):
    """מחזיר את שם בעל המפתח אם הכותרת X-Api-Key תקינה, אחרת None."""
    given = request.headers.get("X-Api-Key", "")
    if not given:
        return None
    for key, name in keys.items():
        if hmac.compare_digest(key.encode(), given.encode()):
            return name
    return None
