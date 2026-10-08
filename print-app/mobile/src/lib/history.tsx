// היסטוריית 50 ההדפסות האחרונות - נשמרת בטלפון בלבד.
// "הדפס שוב" ממלא מחדש את הטופס דרך pendingRefill, ולא שולח הדפסה.

import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

import type { StickerType } from "../api/print";

const HISTORY_KEY = "history.v1";
const MAX_ENTRIES = 50;

export type HistoryStatus = "ok" | "already" | "error";

export type StickerRefill = {
  kind: "sticker";
  sku: string;
  type: StickerType;
  quantity: number;
  skipDates: boolean;
};

export type CheeseRefill = {
  kind: "cheese";
  sku: string;
  weightsText: string;
  batchNumber: string;
};

export type Refill = StickerRefill | CheeseRefill;

export type HistoryEntry = {
  id: string;
  at: string; // ISO
  typeLabel: string; // "שקיות", "גבינות" וכו'
  product: string;
  quantity: number;
  status: HistoryStatus;
  message: string;
  refill: Refill;
};

type HistoryContextValue = {
  entries: HistoryEntry[];
  add: (e: Omit<HistoryEntry, "id" | "at">) => void;
  clear: () => void;
  pendingRefill: Refill | null;
  requestRefill: (r: Refill) => void;
  /** מחזיר את בקשת המילוי אם היא מהסוג המבוקש, ומנקה אותה. */
  takeRefill: <K extends Refill["kind"]>(kind: K) => Extract<Refill, { kind: K }> | null;
};

const HistoryContext = createContext<HistoryContextValue | null>(null);

export function HistoryProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [pendingRefill, setPendingRefill] = useState<Refill | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(HISTORY_KEY)
      .then((raw) => {
        if (raw) setEntries(JSON.parse(raw));
      })
      .catch(() => {});
  }, []);

  const persist = (next: HistoryEntry[]) => {
    AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(next)).catch(() => {});
  };

  const add = useCallback((e: Omit<HistoryEntry, "id" | "at">) => {
    setEntries((prev) => {
      const entry: HistoryEntry = {
        ...e,
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        at: new Date().toISOString(),
      };
      const next = [entry, ...prev].slice(0, MAX_ENTRIES);
      persist(next);
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    setEntries([]);
    persist([]);
  }, []);

  const requestRefill = useCallback((r: Refill) => setPendingRefill(r), []);

  const takeRefill = useCallback(
    <K extends Refill["kind"]>(kind: K) => {
      if (!pendingRefill || pendingRefill.kind !== kind) return null;
      const r = pendingRefill as Extract<Refill, { kind: K }>;
      setPendingRefill(null);
      return r;
    },
    [pendingRefill],
  );

  return (
    <HistoryContext.Provider value={{ entries, add, clear, pendingRefill, requestRefill, takeRefill }}>
      {children}
    </HistoryContext.Provider>
  );
}

export function useHistory(): HistoryContextValue {
  const ctx = useContext(HistoryContext);
  if (!ctx) throw new Error("useHistory must be used inside HistoryProvider");
  return ctx;
}
