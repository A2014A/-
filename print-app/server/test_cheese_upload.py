# test_cheese_upload.py
# בדיקות להעלאת קבצים כ-base64 ב-JSON (בנוסף ל-multipart) ב-/cheese-ocr וב-/cheese-preview-upload.
# בלי BarTender ובלי קריאה ל-API של Anthropic (recognize מוחלף ב-mock).
# הרצה: python -m unittest test_cheese_upload -v

import base64, io, unittest
from unittest import mock

import openpyxl
from flask import Flask

import cheese_ocr
from cheese_labels_routes import cheese_bp, load_cheese_items
from cheese_upload import MAX_JSON_UPLOAD_BYTES, UploadError, decode_base64_upload

LANDA_PNG = r"C:\Labels\Kosher\landa.png"
FAKE_RESULT = {"cartons": [], "batchNumber": None}


def b64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


def make_xlsx(rows) -> bytes:
    wb = openpyxl.Workbook()
    for r in rows:
        wb.active.append(list(r))
    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()


class DecodeBase64UploadTest(unittest.TestCase):

    def test_valid_variants(self):
        data = b"hello cheese" * 100
        self.assertEqual(decode_base64_upload(b64(data)), data)
        self.assertEqual(decode_base64_upload("data:image/jpeg;base64," + b64(data)), data)
        wrapped = "\n".join(b64(data)[i:i + 76] for i in range(0, len(b64(data)), 76))
        self.assertEqual(decode_base64_upload(wrapped), data)

    def test_missing_or_invalid(self):
        for value in (None, "", "   ", 123):
            with self.subTest(value=value):
                with self.assertRaises(UploadError) as ctx:
                    decode_base64_upload(value)
                self.assertEqual(ctx.exception.status, 400)
        with self.assertRaises(UploadError) as ctx:
            decode_base64_upload("not base64 !!!")
        self.assertEqual(ctx.exception.status, 400)

    def test_too_large(self):
        with self.assertRaises(UploadError) as ctx:
            decode_base64_upload(b64(b"\0" * (MAX_JSON_UPLOAD_BYTES + 1)))
        self.assertEqual(ctx.exception.status, 413)
        self.assertEqual(len(decode_base64_upload(b64(b"\0" * 1000), max_bytes=1000)), 1000)


class RoutesTest(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        app = Flask(__name__)
        app.register_blueprint(cheese_bp)
        app.register_blueprint(cheese_ocr.cheese_ocr_bp)
        cls.client = app.test_client()
        with open(LANDA_PNG, "rb") as f:
            cls.png = f.read()
        items = load_cheese_items()  # קריאה בלבד
        cls.sku = str(items[0]["sku"]) if items else None
        cls.xlsx = make_xlsx([("weight", "id"), (4.34, 1219), (4.39, 1220), (5.1, None)])

    # ---------- /cheese-ocr ----------

    def ocr_json(self, body):
        with mock.patch.object(cheese_ocr, "recognize", return_value=FAKE_RESULT) as rec:
            res = self.client.post("/cheese-ocr", json=body)
        return res, rec

    def test_ocr_json_ok(self):
        res, rec = self.ocr_json({"imageBase64": b64(self.png), "mediaType": "image/png"})
        self.assertEqual(res.status_code, 200, res.get_json())
        self.assertEqual(res.get_json(), FAKE_RESULT)
        media_type, image_b64 = rec.call_args.args
        self.assertEqual(media_type, "image/jpeg")  # עבר prepare_image כמו multipart
        self.assertTrue(base64.b64decode(image_b64).startswith(b"\xff\xd8"))

    def test_ocr_json_errors(self):
        cases = [
            ({}, 400, "BAD_IMAGE_DATA"),
            ({"imageBase64": "@@@ broken"}, 400, "BAD_IMAGE_DATA"),
            ({"imageBase64": b64(b"\0" * (MAX_JSON_UPLOAD_BYTES + 1))}, 413, "IMAGE_TOO_LARGE"),
            ({"imageBase64": b64(b"this is not an image")}, 400, "BAD_IMAGE"),
        ]
        for body, status, code in cases:
            with self.subTest(code=code, status=status):
                res, rec = self.ocr_json(body)
                self.assertEqual(res.status_code, status)
                self.assertEqual(res.get_json()["errorCode"], code)
                self.assertTrue(res.get_json()["error"])
                rec.assert_not_called()

    def test_ocr_multipart_still_works(self):
        with mock.patch.object(cheese_ocr, "recognize", return_value=FAKE_RESULT) as rec:
            res = self.client.post("/cheese-ocr", data={"image": (io.BytesIO(self.png), "landa.png")},
                                   content_type="multipart/form-data")
        self.assertEqual(res.status_code, 200)
        rec.assert_called_once()
        with mock.patch.object(cheese_ocr, "recognize", return_value=FAKE_RESULT):
            res = self.client.post("/cheese-ocr", data={}, content_type="multipart/form-data")
        self.assertEqual(res.get_json()["errorCode"], "NO_IMAGE")

    # ---------- /cheese-preview-upload ----------

    def test_preview_upload_json_matches_multipart(self):
        if not self.sku:
            self.skipTest("cheese_items.xlsx ריק")
        res_json = self.client.post("/cheese-preview-upload",
                                    json={"sku": self.sku, "fileBase64": b64(self.xlsx), "fileName": "w.xlsx"})
        res_form = self.client.post("/cheese-preview-upload",
                                    data={"sku": self.sku, "file": (io.BytesIO(self.xlsx), "w.xlsx")},
                                    content_type="multipart/form-data")
        self.assertEqual(res_json.status_code, 200, res_json.get_json())
        self.assertEqual(res_form.status_code, 200, res_form.get_json())
        self.assertEqual(res_json.get_json(), res_form.get_json())
        self.assertEqual(res_json.get_json()["count"], 3)
        self.assertEqual(res_json.get_json()["rows"][0]["uniqueId"], "1219")

    def test_preview_upload_json_errors(self):
        sku = self.sku or "X"
        res = self.client.post("/cheese-preview-upload", json={"sku": sku})
        self.assertEqual(res.status_code, 400)
        res = self.client.post("/cheese-preview-upload", json={"sku": sku, "fileBase64": "%%%"})
        self.assertEqual(res.status_code, 400)
        res = self.client.post("/cheese-preview-upload", json={"sku": sku, "fileBase64": b64(b"not an xlsx")})
        self.assertEqual(res.status_code, 400)
        self.assertIn("Excel", res.get_json()["error"])
        res = self.client.post("/cheese-preview-upload",
                               json={"sku": sku, "fileBase64": b64(b"\0" * (MAX_JSON_UPLOAD_BYTES + 1))})
        self.assertEqual(res.status_code, 413)

    def test_preview_upload_json_weight_too_big(self):
        # שחזור הבאג מ-13/10 12:55: Excel עם משקל 10 ק"ג -> make_barcode זרק ValueError -> 500 בלי הודעה
        if not self.sku:
            self.skipTest("cheese_items.xlsx ריק")
        bad = make_xlsx([("weight", "id"), (4.34, 1219), (10, 1220), (4.4, None)])
        res = self.client.post("/cheese-preview-upload",
                               json={"sku": self.sku, "fileBase64": b64(bad), "fileName": "w.xlsx"})
        self.assertEqual(res.status_code, 400)
        err = res.get_json()["error"]
        self.assertIn("שורה 3", err)
        self.assertIn("10", err)
        self.assertIn("9.999", err)
        neg = make_xlsx([(-1.5,)])
        res = self.client.post("/cheese-preview-upload", json={"sku": self.sku, "fileBase64": b64(neg)})
        self.assertEqual(res.status_code, 400)
        self.assertIn("שורה 1", res.get_json()["error"])

    def test_preview_upload_multipart_weight_too_big_unchanged(self):
        # ה-multipart לא השתנה: אותו קובץ עדיין מחזיר 500 (כמו לפני התיקון)
        if not self.sku:
            self.skipTest("cheese_items.xlsx ריק")
        bad = make_xlsx([(4.34, 1219), (10, 1220)])
        with mock.patch("logging.Logger.error"):  # לא להדפיס את ה-traceback הצפוי
            res = self.client.post("/cheese-preview-upload",
                                   data={"sku": self.sku, "file": (io.BytesIO(bad), "w.xlsx")},
                                   content_type="multipart/form-data")
        self.assertEqual(res.status_code, 500)

    def test_preview_upload_multipart_errors(self):
        res = self.client.post("/cheese-preview-upload", data={"sku": "X"}, content_type="multipart/form-data")
        self.assertEqual(res.status_code, 400)
        res = self.client.post("/cheese-preview-upload",
                               data={"sku": "X", "file": (io.BytesIO(b"junk"), "w.xlsx")},
                               content_type="multipart/form-data")
        self.assertEqual(res.status_code, 400)  # היה 500 לפני התיקון


class WeightFormatTest(unittest.TestCase):
    """המשקל המודפס זהה ל-4 ספרות המשקל שבברקוד: תמיד 3 ספרות אחרי הנקודה (4.740, 3.286)."""

    CASES = {3.286: "3.286", 4.74: "4.740", 4.7: "4.700", 4: "4.000", 4.745: "4.745", 0.05: "0.050",
             9.999: "9.999", 3.2860000001: "3.286", 1.1 + 2.2: "3.300", 4.3399999: "4.340"}

    def test_format_matches_barcode_grams(self):
        from cheese_barcode import make_barcode
        from cheese_label_image import format_weight_kg
        for w, want in self.CASES.items():
            with self.subTest(weight=w):
                got = format_weight_kg(w)
                self.assertEqual(got, want)
                grams = int(make_barcode("8714", w)[8:12])
                self.assertEqual(round(float(got) * 1000), grams)

    def test_bartender_weight_field(self):
        # אובייקט COM מדומה - לא פותח BarTender ולא מדפיס
        import cheese_labels_routes as routes
        from cheese_barcode import make_barcode
        sent = []
        fmt = mock.MagicMock()
        fmt.SetNamedSubStringValue.side_effect = lambda k, v: sent.append(v) if k == "משקל" else None
        bt = mock.MagicMock()
        bt.Formats.Open.return_value = fmt
        rows = [{"weightKg": w, "uniqueId": "", "barcode": make_barcode("8714", w)} for w in (3.286, 4.74, 4.7)]
        with mock.patch.object(routes.win32com.client, "Dispatch", return_value=bt), \
             mock.patch.object(routes.pythoncom, "CoInitialize"), mock.patch.object(routes.pythoncom, "CoUninitialize"):
            routes.print_cheese_batch_via_bartender(rows, "B1", "Gouda", "גאודה")
        self.assertEqual(sent, ["3.286", "4.740", "4.700"])
        self.assertEqual(fmt.PrintOut.call_count, 3)
        fmt.Close.assert_called_once_with(routes.BT_DO_NOT_SAVE_CHANGES)

    def test_preview_image_renders(self):
        from cheese_barcode import make_barcode
        from cheese_label_image import render_label_image
        png = render_label_image(make_barcode("8714", 3.286), 3.286, "גאודה", "Gouda", "12")
        self.assertTrue(png.startswith(b"\x89PNG"))


if __name__ == "__main__":
    unittest.main()
