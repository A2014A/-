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

export type StickerType = "bags" | "cartons" | "kosher_landa" | "kosher_badatz";

export const STICKER_TYPES: StickerType[] = ["bags", "cartons", "kosher_landa", "kosher_badatz"];

export const TEMPLATE_KEY_MAP: Record<StickerType, string> = {
  bags: "standalone_bags",
  cartons: "standalone_cartons",
  kosher_landa: "standalone_kosher_landa",
  kosher_badatz: "standalone_kosher_badatz",
};

export const LABEL_TYPE_MAP: Record<StickerType, "package" | "carton" | "kosher"> = {
  bags: "package",
  cartons: "carton",
  kosher_landa: "kosher",
  kosher_badatz: "kosher",
};

export const TYPE_DISPLAY_NAME: Record<StickerType, string> = {
  bags: "שקיות",
  cartons: "קרטונים",
  kosher_landa: "כשרות לנדא",
  kosher_badatz: 'כשרות בד"ץ',
};

export function isKosherType(t: StickerType): boolean {
  return t === "kosher_landa" || t === "kosher_badatz";
}

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

/** זהה ל-buildLabelData ב-print.html. */
export function buildLabelData(item: Item, type: StickerType): Record<string, string> {
  if (isKosherType(type)) {
    return { sku: item.sku, product: item.product };
  }
  const base = {
    sku: item.sku,
    product: item.product,
    barcode: item.barcode,
    kosher: item.kosher,
    passover: item.passover,
  };
  return type === "bags" ? { ...base, weight: item.weight } : { ...base, packagesInfo: item.packagesInfo };
}

export function buildPrintJob(item: Item, type: StickerType, quantity: number, requestedBy: string, skipDates: boolean): PrintJob {
  return {
    id: `${item.sku}-${Date.now()}`,
    labelType: LABEL_TYPE_MAP[type],
    templateKey: TEMPLATE_KEY_MAP[type],
    quantity,
    requestedBy,
    // לתוויות כשרות אין תאריכים, ולכן אין להן את התיבה הזו
    skipDates: isKosherType(type) ? false : skipDates,
    data: buildLabelData(item, type),
  };
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
