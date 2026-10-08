"""
cheese_app.py — a completely SEPARATE, standalone Flask server for the
cheese-labels tool. Does not import, modify, or depend on webhook_receiver.py
in any way. Runs on its own port (5001 by default) so it can run alongside
the existing webhook_receiver.py (port 5000) without touching it.

Run it with:
    py cheese_app.py

Then open in a browser:
    http://127.0.0.1:5001/

To have it start automatically together with webhook_receiver.py, add a
second line to whatever already starts webhook_receiver.py (a .bat file, a
scheduled task, a Windows service, etc.) that also runs this file — but
that is a separate, additive step; webhook_receiver.py itself is never
edited.

Every API route (everything except the page itself at "/") requires a valid
X-Api-Key header — see api_keys.py. The keys are read from the same .env file
as webhook_receiver.py.
"""

import pathlib
from dotenv import load_dotenv
from flask import Flask, jsonify, request, send_from_directory

from api_keys import load_api_keys, check_api_key
from cheese_labels_routes import cheese_bp

load_dotenv()
BASE_DIR = pathlib.Path(__file__).parent
API_KEYS = load_api_keys()

app = Flask(__name__)
app.register_blueprint(cheese_bp)


@app.before_request
def require_api_key():
    # The page itself is public (it only asks the user for their key);
    # every data/print route behind it needs a valid key.
    if request.path == "/":
        return None
    if not check_api_key(request, API_KEYS):
        return jsonify({"error": "מפתח גישה חסר או שגוי", "errorCode": "INVALID_API_KEY"}), 401
    return None


@app.route("/")
def index():
    return send_from_directory(BASE_DIR, "cheese-labels.html")


if __name__ == "__main__":
    # threaded=True — same reasoning as webhook_receiver.py: without it, a
    # slow/stuck print job would block every other request to this server.
    # host="0.0.0.0" — listens on all network interfaces, so other computers
    # on the local network can reach this page too (not just this machine).
    app.run(host="0.0.0.0", port=5001, threaded=True)
