// בקשות HTTP משותפות לשני השרתים: מפתח גישה, טיימאאוט, והודעות שגיאה בעברית.

export const REQUEST_TIMEOUT_MS = 30_000;

export const NO_CONNECTION_MSG = "אין חיבור לשרת ההדפסה – ודא שמחשב ההדפסה דולק";
export const BAD_KEY_MSG = "מפתח הגישה חסר או שגוי – בדוק אותו במסך ההגדרות";

export type ApiErrorKind = "no_connection" | "timeout" | "bad_key" | "server";

export class ApiError extends Error {
  kind: ApiErrorKind;
  status?: number;
  constructor(kind: ApiErrorKind, message: string, status?: number) {
    super(message);
    this.kind = kind;
    this.status = status;
  }
}

// Cloudflare מחזיר את אלה כשהמנהרה למעלה אבל מחשב ההדפסה לא עונה.
const UNREACHABLE_STATUSES = new Set([502, 503, 504, 520, 521, 522, 523, 524, 530]);

export function joinUrl(base: string, path: string): string {
  return base.replace(/\/+$/, "") + path;
}

export type RequestOptions = {
  method?: "GET" | "POST";
  apiKey: string;
  json?: unknown;
  form?: FormData;
};

/** שולח בקשה ומחזיר את גוף התשובה כ-JSON (או null אם אין JSON), יחד עם הסטטוס. */
export async function request<T>(url: string, opts: RequestOptions): Promise<{ status: number; body: T | null }> {
  const headers: Record<string, string> = { "X-Api-Key": opts.apiKey, Accept: "application/json" };
  let body: string | FormData | undefined;
  if (opts.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.json);
  } else if (opts.form) {
    body = opts.form; // Content-Type (עם ה-boundary) נקבע אוטומטית
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, { method: opts.method ?? "GET", headers, body, signal: controller.signal });
  } catch {
    if (controller.signal.aborted) {
      throw new ApiError("timeout", NO_CONNECTION_MSG);
    }
    throw new ApiError("no_connection", NO_CONNECTION_MSG);
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 401) {
    throw new ApiError("bad_key", BAD_KEY_MSG, 401);
  }
  if (UNREACHABLE_STATUSES.has(res.status)) {
    throw new ApiError("no_connection", NO_CONNECTION_MSG, res.status);
  }

  let parsed: T | null = null;
  try {
    parsed = (await res.json()) as T;
  } catch {
    parsed = null;
  }
  return { status: res.status, body: parsed };
}

/** הודעת שגיאה מהשרת (השדות error / message / errorCode), אחרת הודעה כללית. */
export function serverErrorMessage(body: unknown, status: number): string {
  if (body && typeof body === "object") {
    const b = body as Record<string, unknown>;
    for (const k of ["error", "message", "errorCode"]) {
      if (typeof b[k] === "string" && b[k]) return b[k] as string;
    }
  }
  return `שגיאה מהשרת (קוד ${status})`;
}

/** הופך כל שגיאה להודעה בעברית שמתאימה להצגה למשתמש, בלי פרטים טכניים. */
export function userMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return "אירעה שגיאה לא צפויה. נסה שוב.";
}
