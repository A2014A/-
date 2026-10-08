// הגדרות האפליקציה: שם המזמין וכתובות השרתים נשמרים ב-AsyncStorage,
// מפתח הגישה נשמר ב-SecureStore בלבד (לא מוטמע בקוד).

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { Platform } from "react-native";

export const DEFAULT_PRINT_URL = "https://print.cohenb11print.com";
export const DEFAULT_CHEESE_URL = "https://cheese.cohenb11print.com";

const SETTINGS_KEY = "settings.v1";
const API_KEY_KEY = "apiKey";

export type Settings = {
  requesterName: string;
  printUrl: string;
  cheeseUrl: string;
  apiKey: string;
};

type SettingsContextValue = {
  settings: Settings;
  loaded: boolean;
  save: (next: Settings) => Promise<void>;
  /** האם יש מספיק פרטים כדי להתחיל לעבוד (שם + מפתח). */
  isConfigured: boolean;
};

const DEFAULTS: Settings = {
  requesterName: "",
  printUrl: DEFAULT_PRINT_URL,
  cheeseUrl: DEFAULT_CHEESE_URL,
  apiKey: "",
};

const SettingsContext = createContext<SettingsContextValue | null>(null);

// SecureStore קיים רק בטלפון. גרסת הדפדפן משמשת לבדיקות בלבד, ושם המפתח
// נשמר ב-AsyncStorage הרגיל.
const secure = {
  get: (key: string) => (Platform.OS === "web" ? AsyncStorage.getItem(key) : SecureStore.getItemAsync(key)),
  set: (key: string, value: string) =>
    Platform.OS === "web" ? AsyncStorage.setItem(key, value) : SecureStore.setItemAsync(key, value),
  remove: (key: string) => (Platform.OS === "web" ? AsyncStorage.removeItem(key) : SecureStore.deleteItemAsync(key)),
};

async function readSecure(key: string): Promise<string> {
  try {
    return (await secure.get(key)) ?? "";
  } catch {
    return "";
  }
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      let stored: Partial<Settings> = {};
      try {
        const raw = await AsyncStorage.getItem(SETTINGS_KEY);
        if (raw) stored = JSON.parse(raw);
      } catch {
        stored = {};
      }
      const apiKey = await readSecure(API_KEY_KEY);
      setSettings({
        requesterName: stored.requesterName ?? "",
        printUrl: stored.printUrl || DEFAULT_PRINT_URL,
        cheeseUrl: stored.cheeseUrl || DEFAULT_CHEESE_URL,
        apiKey,
      });
      setLoaded(true);
    })();
  }, []);

  const save = useCallback(async (next: Settings) => {
    const clean: Settings = {
      requesterName: next.requesterName.trim(),
      printUrl: next.printUrl.trim() || DEFAULT_PRINT_URL,
      cheeseUrl: next.cheeseUrl.trim() || DEFAULT_CHEESE_URL,
      apiKey: next.apiKey.trim(),
    };
    const { apiKey, ...rest } = clean;
    await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(rest));
    if (apiKey) {
      await secure.set(API_KEY_KEY, apiKey);
    } else {
      await secure.remove(API_KEY_KEY);
    }
    setSettings(clean);
  }, []);

  const isConfigured = !!settings.requesterName && !!settings.apiKey;

  return (
    <SettingsContext.Provider value={{ settings, loaded, save, isConfigured }}>{children}</SettingsContext.Provider>
  );
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used inside SettingsProvider");
  return ctx;
}
