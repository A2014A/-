// שרת הגבינות (cheese_app.py + cheese_labels_routes.py).
// מבנה הבקשות והתשובות זהה ל-cheese-labels.html ול-cheese_labels_routes.py.

import { ApiError, joinUrl, request, serverErrorMessage } from "./http";

/** GET /cheese-items מחזיר רק את שלושת השדות האלה. */
export type CheeseItem = {
  sku: string;
  productEn: string;
  productHe: string;
};

/** גוף POST /cheese-items. */
export type NewCheeseItem = {
  sku: string;
  productEn: string;
  productHe: string;
  itemCode: string; // בדיוק 4 ספרות
  kosher: string;
  passover: string;
};

export type PreviewRow = {
  index: number;
  weightKg: number;
  uniqueId: string;
  barcode: string;
  duplicate: boolean;
};

/** תשובת /cheese-preview ו-/cheese-preview-upload. */
export type PreviewResponse = {
  sku: string;
  productHe: string;
  productEn: string;
  count: number;
  rows: PreviewRow[];
};

export type PrintBatchRequest = {
  sku: string;
  batchNumber: string;
  rows: { weightKg: number; uniqueId: string }[];
};

export type PrintBatchResponse = { printed: number; sku: string };

function ensureOk<T>(status: number, body: T | null): T {
  if (status !== 200 || body === null) {
    throw new ApiError("server", serverErrorMessage(body, status), status);
  }
  return body;
}

export async function listCheeseItems(baseUrl: string, apiKey: string): Promise<CheeseItem[]> {
  const { status, body } = await request<CheeseItem[]>(joinUrl(baseUrl, "/cheese-items"), { apiKey });
  const items = ensureOk(status, body);
  if (!Array.isArray(items)) throw new ApiError("server", serverErrorMessage(items, status), status);
  // ה-sku מגיע מקובץ Excel ועלול להיות מספר (למשל 35021) - מנרמלים למחרוזת
  return items.map((i) => ({ ...i, sku: String(i.sku) }));
}

export async function addCheeseItem(baseUrl: string, apiKey: string, item: NewCheeseItem): Promise<void> {
  const { status, body } = await request<{ ok: boolean }>(joinUrl(baseUrl, "/cheese-items"), {
    method: "POST",
    apiKey,
    json: item,
  });
  ensureOk(status, body);
}

export async function previewFromText(baseUrl: string, apiKey: string, sku: string, weightsText: string): Promise<PreviewResponse> {
  const { status, body } = await request<PreviewResponse>(joinUrl(baseUrl, "/cheese-preview"), {
    method: "POST",
    apiKey,
    json: { sku, weightsText },
  });
  return ensureOk(status, body);
}

export type PickedFile = { uri: string; name: string; mimeType?: string };

export async function previewFromExcel(baseUrl: string, apiKey: string, sku: string, file: PickedFile): Promise<PreviewResponse> {
  const form = new FormData();
  form.append("sku", sku);
  // ב-React Native מצרפים קובץ לפי uri/name/type
  form.append("file", {
    uri: file.uri,
    name: file.name,
    type: file.mimeType || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  } as unknown as Blob);
  const { status, body } = await request<PreviewResponse>(joinUrl(baseUrl, "/cheese-preview-upload"), {
    method: "POST",
    apiKey,
    form,
  });
  return ensureOk(status, body);
}

/** כתובת תמונת ה-PNG של תווית. צריך לטעון אותה עם הכותרת X-Api-Key. */
export function labelImageUrl(baseUrl: string, sku: string, weightKg: number, cheeseNo: string): string {
  const q = `sku=${encodeURIComponent(sku)}&weight=${encodeURIComponent(String(weightKg))}&cheeseNo=${encodeURIComponent(cheeseNo)}`;
  return joinUrl(baseUrl, `/cheese-label-image?${q}`);
}

export async function printCheeseBatch(baseUrl: string, apiKey: string, req: PrintBatchRequest): Promise<PrintBatchResponse> {
  const { status, body } = await request<PrintBatchResponse>(joinUrl(baseUrl, "/print-cheese-batch"), {
    method: "POST",
    apiKey,
    json: req,
  });
  return ensureOk(status, body);
}

/** הופך שורות תצוגה מקדימה בחזרה לטקסט להדבקה (לשימוש "הדפס שוב"). */
export function rowsToWeightsText(rows: { weightKg: number; uniqueId: string }[]): string {
  return rows.map((r) => (r.uniqueId ? `${r.weightKg} ${r.uniqueId}` : String(r.weightKg))).join("\n");
}
