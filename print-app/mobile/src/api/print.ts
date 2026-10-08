// שרת המדבקות (webhook_receiver.py): GET /items, POST /webhook.
// מבנה הבקשות והתשובות זהה ל-print.html ול-webhook_receiver.py.

import { ApiError, joinUrl, request, serverErrorMessage } from "./http";

/** פריט כפי שמוחזר מ-GET /items (search_items ב-webhook_receiver.py). */
export type Item = {
  sku: string;
  product: string;
  barcode: string;
  kosher: string;
  passover: string; // "פסח" או ""
  cartonsOnly: boolean;
  expiryDate: string;
  weight: string;
  packagesInfo: string;
};

/** סוג מדבקה כפי שמוחזר מ-GET /label-types (label_types.json בשרת). */
export type LabelType = {
  key: string; // למשל "bags"
  name: string; // שם לכפתור, למשל "שקיות"
  templateKey: string; // למשל "standalone_bags"
  labelType: string; // package / carton / kosher
  fields: (keyof Item)[]; // אילו שדות של הפריט נשלחים לתבנית
  dates: boolean; // האם יש בתבנית תאריכים (ואז מציגים "הדפס ללא תאריכים")
  group?: string; // כותרת קבוצה (למשל "מדבקות לפסח"); ריק = בלי כותרת
};

/** מחלק את הסוגים לקבוצות לפי סדר הופעתן ברשימה. */
export function groupLabelTypes(types: LabelType[]): { group: string; types: LabelType[] }[] {
  const groups: { group: string; types: LabelType[] }[] = [];
  for (const t of types) {
    const g = t.group ?? "";
    let entry = groups.find((x) => x.group === g);
    if (!entry) {
      entry = { group: g, types: [] };
      groups.push(entry);
    }
    entry.types.push(t);
  }
  return groups;
}

/** משמש רק אם השרת עדיין לא תומך ב-/label-types (גרסה ישנה) - זהה ל-print.html הישן. */
export const FALLBACK_LABEL_TYPES: LabelType[] = [
  { key: "bags", name: "שקיות", templateKey: "standalone_bags", labelType: "package",
    fields: ["sku", "product", "barcode", "kosher", "passover", "weight"], dates: true },
  { key: "cartons", name: "קרטונים", templateKey: "standalone_cartons", labelType: "carton",
    fields: ["sku", "product", "barcode", "kosher", "passover", "packagesInfo"], dates: true },
  { key: "kosher_landa", name: "כשרות לנדא", templateKey: "standalone_kosher_landa", labelType: "kosher",
    fields: ["sku", "product"], dates: false, group: "תוויות כשרות" },
  { key: "kosher_badatz", name: 'כשרות בד"ץ', templateKey: "standalone_kosher_badatz", labelType: "kosher",
    fields: ["sku", "product"], dates: false, group: "תוויות כשרות" },
];

/** הסוג שאליו קופצים אוטומטית בפריט "קרטונים בלבד". */
export const CARTONS_ONLY_KEY = "cartons";

export type PrintJob = {
  id: string;
  labelType: string;
  templateKey: string;
  quantity: number;
  requestedBy: string;
  skipDates: boolean;
  data: Record<string, string>;
};

/** תשובת /webhook (make_response ב-webhook_receiver.py). */
export type PrintResponse = {
  status: "printed" | "already_handled" | "error" | string;
  id: string;
  processedAt: string;
  message: string;
  errorCode?: string;
};

/** הנתונים שנשלחים לתבנית - רק השדות שהסוג מבקש (fields ב-label_types.json). */
export function buildLabelData(item: Item, type: LabelType): Record<string, string> {
  const data: Record<string, string> = {};
  for (const f of type.fields) {
    const v = item[f];
    data[f] = typeof v === "string" ? v : v == null ? "" : String(v);
  }
  return data;
}

export function buildPrintJob(item: Item, type: LabelType, quantity: number, requestedBy: string, skipDates: boolean): PrintJob {
  return {
    id: `${item.sku}-${Date.now()}`,
    labelType: type.labelType,
    templateKey: type.templateKey,
    quantity,
    requestedBy,
    // לתבנית בלי תאריכים אין את התיבה הזו
    skipDates: type.dates ? skipDates : false,
    data: buildLabelData(item, type),
  };
}

export async function fetchLabelTypes(baseUrl: string, apiKey: string): Promise<LabelType[]> {
  const { status, body } = await request<LabelType[]>(joinUrl(baseUrl, "/label-types"), { apiKey });
  if (status === 404) return FALLBACK_LABEL_TYPES; // שרת ישן
  if (status !== 200 || !Array.isArray(body) || body.length === 0) {
    throw new ApiError("server", serverErrorMessage(body, status), status);
  }
  return body;
}

export async function searchItems(baseUrl: string, apiKey: string, q: string): Promise<Item[]> {
  const url = joinUrl(baseUrl, `/items?q=${encodeURIComponent(q)}`);
  const { status, body } = await request<Item[] | { error: string }>(url, { apiKey });
  if (status !== 200 || !Array.isArray(body)) {
    throw new ApiError("server", serverErrorMessage(body, status), status);
  }
  return body;
}

export async function sendPrintJob(baseUrl: string, apiKey: string, job: PrintJob): Promise<PrintResponse> {
  const { status, body } = await request<PrintResponse>(joinUrl(baseUrl, "/webhook"), {
    method: "POST",
    apiKey,
    json: job,
  });
  if (!body || typeof body !== "object" || !("status" in body)) {
    throw new ApiError("server", serverErrorMessage(body, status), status);
  }
  return body;
}
