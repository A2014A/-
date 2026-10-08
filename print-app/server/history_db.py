"""
history_db.py - היסטוריית הדפסות משותפת לשני השרתים.

webhook_receiver.py כבר רושם כל עבודת מדבקות בטבלה print_jobs (בשביל מניעת
הדפסה כפולה). הקובץ הזה:
  - מוסיף לטבלה שלוש עמודות: sku, product, key_owner (מי שלח, לפי מפתח הגישה).
    עבודות ישנות פשוט נשארות בלי ערכים בעמודות האלה.
  - מאפשר ל-cheese_app.py לרשום גם סבבי גבינות באותה טבלה.
  - מחזיר את ההדפסות האחרונות לנתיב /print-history.

מי רואה מה (HISTORY_ADMINS בקובץ .env, שמות מתוך API_KEYS, מופרדים בפסיקים):
  - מנהל רואה את כל ההדפסות, כולל של JP Quality.
  - כל השאר רואים רק את ההדפסות שנשלחו עם המפתח שלהם.
"""

import logging
import os
import sqlite3
from datetime import datetime

DB_PATH = r"C:\BarTenderWebhook\print_jobs.db"

EXTRA_COLUMNS = ("sku", "product", "key_owner")


def ensure_history_columns(db_path: str = DB_PATH) -> None:
    conn = sqlite3.connect(db_path)
    try:
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
        existing = {row[1] for row in conn.execute("PRAGMA table_info(print_jobs)")}
        for col in EXTRA_COLUMNS:
            if col not in existing:
                conn.execute(f"ALTER TABLE print_jobs ADD COLUMN {col} TEXT")
        conn.commit()
    finally:
        conn.close()


def record_job(job_id, status, label_type, template_key, quantity, requested_by, message,
               sku="", product="", key_owner=None, db_path: str = DB_PATH) -> str:
    processed_at = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
    conn = sqlite3.connect(db_path)
    try:
        conn.execute(
            """INSERT OR REPLACE INTO print_jobs
               (id, status, label_type, template_key, quantity, requested_by, message, processed_at,
                sku, product, key_owner)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (job_id, status, label_type, template_key, quantity, requested_by, message, processed_at,
             sku, product, key_owner),
        )
        conn.commit()
    finally:
        conn.close()
    return processed_at


def load_history_admins() -> set:
    raw = os.environ.get("HISTORY_ADMINS", "")
    return {n.strip() for n in raw.split(",") if n.strip()}


def query_history(user: str, is_admin: bool, limit: int = 100, db_path: str = DB_PATH) -> list:
    limit = max(1, min(int(limit), 500))
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        cols = "id, status, label_type, template_key, quantity, requested_by, processed_at, sku, product, key_owner"
        if is_admin:
            rows = conn.execute(
                f"SELECT {cols} FROM print_jobs ORDER BY processed_at DESC, rowid DESC LIMIT ?", (limit,)
            ).fetchall()
        else:
            rows = conn.execute(
                f"SELECT {cols} FROM print_jobs WHERE key_owner = ? ORDER BY processed_at DESC, rowid DESC LIMIT ?",
                (user, limit),
            ).fetchall()
    except sqlite3.Error as e:
        logging.error(f"שגיאה בקריאת היסטוריית ההדפסות: {e}")
        return []
    finally:
        conn.close()
    return [dict(r) for r in rows]
