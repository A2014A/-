import Constants from "expo-constants";
import { router } from "expo-router";
import * as Updates from "expo-updates";
import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from "react-native";

import { listCheeseItems } from "../api/cheese";
import { ApiError, userMessage } from "../api/http";
import { searchItems } from "../api/print";
import { Banner, Button, Card, Field, Hint, START, colors, font, styles } from "../components/ui";
import { DEFAULT_CHEESE_URL, DEFAULT_PRINT_URL, useSettings, type Settings } from "../lib/settings";

type CheckResult = { ok: boolean; text: string } | null;

async function checkServer(fn: () => Promise<unknown>): Promise<CheckResult> {
  try {
    await fn();
    return { ok: true, text: "מחובר" };
  } catch (e) {
    if (e instanceof ApiError && e.kind === "server") {
      // השרת ענה והמפתח התקבל, אבל הייתה שגיאה פנימית (למשל קובץ Excel חסר)
      return { ok: false, text: `השרת ענה עם שגיאה: ${e.message}` };
    }
    return { ok: false, text: userMessage(e) };
  }
}

export default function SettingsScreen() {
  const { settings, loaded, save, isConfigured } = useSettings();
  const [form, setForm] = useState<Settings>(settings);
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [printCheck, setPrintCheck] = useState<CheckResult>(null);
  const [cheeseCheck, setCheeseCheck] = useState<CheckResult>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    if (loaded) setForm(settings);
  }, [loaded, settings]);

  const set = (k: keyof Settings) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const onCheck = async () => {
    setChecking(true);
    setPrintCheck(null);
    setCheeseCheck(null);
    const key = form.apiKey.trim();
    const [p, c] = await Promise.all([
      checkServer(() => searchItems(form.printUrl.trim() || DEFAULT_PRINT_URL, key, "test")),
      checkServer(() => listCheeseItems(form.cheeseUrl.trim() || DEFAULT_CHEESE_URL, key)),
    ]);
    setPrintCheck(p);
    setCheeseCheck(c);
    setChecking(false);
  };

  const onSave = async () => {
    if (!form.requesterName.trim()) {
      setMessage({ kind: "error", text: "נא למלא שם מזמין." });
      return;
    }
    if (!form.apiKey.trim()) {
      setMessage({ kind: "error", text: "נא למלא מפתח גישה." });
      return;
    }
    setSaving(true);
    try {
      const firstTime = !isConfigured;
      await save(form);
      setMessage({ kind: "ok", text: "ההגדרות נשמרו." });
      if (firstTime) {
        router.replace("/");
      } else if (router.canGoBack()) {
        router.back();
      }
    } catch {
      setMessage({ kind: "error", text: "שמירת ההגדרות נכשלה. נסה שוב." });
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {!isConfigured ? (
          <Banner kind="info" text="ברוך הבא! לפני שמתחילים, מלא את השם שלך ואת מפתח הגישה שקיבלת מהמנהל." />
        ) : null}

        <Card>
          <Field
            label="שם המזמין"
            value={form.requesterName}
            onChangeText={set("requesterName")}
            placeholder="השם שלך"
            autoCorrect={false}
          />
          <Hint>השם יודפס על תווית הכותרת של כל הדפסה.</Hint>
          <Field
            label="מפתח גישה"
            value={form.apiKey}
            onChangeText={set("apiKey")}
            placeholder="המפתח שקיבלת מהמנהל"
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Hint>המפתח נשמר בצורה מוצפנת בטלפון הזה בלבד.</Hint>
        </Card>

        <Card>
          <Field
            label="כתובת שרת המדבקות"
            value={form.printUrl}
            onChangeText={set("printUrl")}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
          <Field
            label="כתובת שרת הגבינות"
            value={form.cheeseUrl}
            onChangeText={set("cheeseUrl")}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
          <Button title="בדיקת חיבור" variant="ghost" onPress={onCheck} busy={checking} />
          {printCheck ? <CheckLine name="מדבקות" result={printCheck} /> : null}
          {cheeseCheck ? <CheckLine name="גבינות" result={cheeseCheck} /> : null}
        </Card>

        {message ? <Banner kind={message.kind} text={message.text} /> : null}
        <Button title="שמירה" onPress={onSave} busy={saving} />
        <UpdatesCard />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// עדכונים באוויר (EAS Update): האפליקציה בודקת לבד בכל פתיחה ומחילה בפתיחה הבאה.
// הכפתור כאן מאפשר להחיל עדכון מיד.
function UpdatesCard() {
  const [state, setState] = useState<{ busy: boolean; text: string | null; kind: "ok" | "error" | "info" }>({
    busy: false,
    text: null,
    kind: "info",
  });
  const version = Constants.expoConfig?.version ?? "";
  const updateLabel = Updates.isEmbeddedLaunch || !Updates.createdAt
    ? "גרסה מקורית"
    : `עדכון מ-${Updates.createdAt.toLocaleDateString("he-IL")}`;

  const onCheck = async () => {
    if (!Updates.isEnabled) {
      setState({ busy: false, kind: "info", text: "עדכונים לא זמינים בגרסה הזו." });
      return;
    }
    setState({ busy: true, kind: "info", text: "בודק..." });
    try {
      const res = await Updates.checkForUpdateAsync();
      if (!res.isAvailable) {
        setState({ busy: false, kind: "ok", text: "האפליקציה מעודכנת." });
        return;
      }
      setState({ busy: true, kind: "info", text: "מוריד עדכון..." });
      await Updates.fetchUpdateAsync();
      await Updates.reloadAsync(); // האפליקציה נפתחת מחדש עם העדכון
    } catch {
      setState({ busy: false, kind: "error", text: "לא ניתן לבדוק עדכונים כרגע. בדוק חיבור לאינטרנט." });
    }
  };

  return (
    <Card>
      <Text style={styles.body}>
        גרסה {version} · {updateLabel}
      </Text>
      <Button title="בדוק עדכונים" variant="ghost" onPress={onCheck} busy={state.busy} />
      {state.text ? <Banner kind={state.kind} text={state.text} /> : null}
    </Card>
  );
}

function CheckLine({ name, result }: { name: string; result: NonNullable<CheckResult> }) {
  return (
    <View style={{ flexDirection: "row", gap: 10, alignItems: "flex-start" }}>
      <Text style={{ fontSize: 22, color: result.ok ? colors.accent : colors.danger, fontWeight: "800" }}>
        {result.ok ? "✓" : "✗"}
      </Text>
      <Text style={{ flex: 1, fontSize: font.body, color: colors.ink, textAlign: START }}>
        {name}: {result.text}
      </Text>
    </View>
  );
}
