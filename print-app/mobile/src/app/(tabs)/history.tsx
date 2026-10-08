// היסטוריה - שתי תצוגות:
//   "בטלפון הזה": 50 ההדפסות האחרונות מהטלפון, עם "הדפס שוב" שממלא את הטופס.
//   "כל ההדפסות": מהשרת (GET /print-history). מנהל (HISTORY_ADMINS בשרת) רואה את
//   כל המשתמשים, כולל JP Quality; כל השאר רואים רק את ההדפסות שלהם.

import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, FlatList, RefreshControl, Text, View } from "react-native";

import { userMessage } from "../../api/http";
import { fetchPrintHistory, type ServerJob } from "../../api/print";
import { Banner, Button, Card, Hint, START, colors, font, styles } from "../../components/ui";
import { useHistory, type HistoryEntry, type HistoryStatus } from "../../lib/history";
import { useSettings } from "../../lib/settings";

const STATUS_TEXT: Record<HistoryStatus, string> = { ok: "הודפס", already: "כבר טופל", error: "נכשל" };
const STATUS_COLOR: Record<HistoryStatus, string> = { ok: colors.accent, already: colors.muted, error: colors.danger };

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

type View_ = "local" | "server";

export default function HistoryScreen() {
  const [view, setView] = useState<View_>("local");

  return (
    <View style={styles.screen}>
      <View style={[styles.row, { padding: 16, paddingBottom: 0, flexWrap: "nowrap" }]}>
        <Button title="בטלפון הזה" variant="ghost" selected={view === "local"} onPress={() => setView("local")} style={{ flex: 1 }} />
        <Button title="כל ההדפסות" variant="ghost" selected={view === "server"} onPress={() => setView("server")} style={{ flex: 1 }} />
      </View>
      {view === "local" ? <LocalHistory /> : <ServerHistory />}
    </View>
  );
}

function LocalHistory() {
  const { entries, clear, requestRefill } = useHistory();

  const reprint = (e: HistoryEntry) => {
    requestRefill(e.refill);
    router.navigate(e.refill.kind === "sticker" ? "/" : "/cheese");
  };

  const confirmClear = () =>
    Alert.alert("ניקוי היסטוריה", "למחוק את כל ההיסטוריה מהטלפון?", [
      { text: "ביטול", style: "cancel" },
      { text: "מחק", style: "destructive", onPress: clear },
    ]);

  return (
    <FlatList
      style={styles.screen}
      contentContainerStyle={styles.scroll}
      data={entries}
      keyExtractor={(e) => e.id}
      ListEmptyComponent={<Hint>עוד לא בוצעו הדפסות מהטלפון הזה.</Hint>}
      ListFooterComponent={entries.length ? <Button title="ניקוי היסטוריה" variant="ghost" onPress={confirmClear} /> : null}
      renderItem={({ item: e }) => (
        <Card style={{ gap: 8 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <Text style={{ fontSize: font.small, color: colors.muted }}>{formatDate(e.at)}</Text>
            <Text style={{ fontSize: font.small, fontWeight: "800", color: STATUS_COLOR[e.status] }}>{STATUS_TEXT[e.status]}</Text>
          </View>
          <Text style={{ fontSize: font.big, fontWeight: "700", color: colors.ink, textAlign: START }}>{e.product}</Text>
          <Text style={styles.body}>
            {e.typeLabel} · {e.quantity} {e.refill.kind === "cheese" ? "תוויות" : "מדבקות"}
          </Text>
          {e.status === "error" ? <Text style={{ fontSize: font.small, color: colors.danger, textAlign: START }}>{e.message}</Text> : null}
          <Button title="הדפס שוב" variant="ghost" onPress={() => reprint(e)} />
        </Card>
      )}
    />
  );
}

function ServerHistory() {
  const { settings } = useSettings();
  const [jobs, setJobs] = useState<ServerJob[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchPrintHistory(settings.printUrl, settings.apiKey);
      setJobs(res.jobs);
      setIsAdmin(res.isAdmin);
    } catch (e) {
      setError(userMessage(e));
    } finally {
      setLoading(false);
    }
  }, [settings.printUrl, settings.apiKey]);

  // תמיד מהשרת, בכל כניסה ללשונית
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  return (
    <FlatList
      style={styles.screen}
      contentContainerStyle={styles.scroll}
      data={jobs}
      keyExtractor={(j) => j.id}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} colors={[colors.accent]} />}
      ListHeaderComponent={
        <View style={{ gap: 10 }}>
          <Hint>
            {isAdmin ? "כל ההדפסות של כל המשתמשים (100 אחרונות)." : "ההדפסות שנשלחו עם מפתח הגישה שלך (100 אחרונות)."} משיכה למטה
            לרענון.
          </Hint>
          {error ? <Banner kind="error" text={error} /> : null}
        </View>
      }
      ListEmptyComponent={!loading && !error ? <Hint>אין הדפסות להצגה.</Hint> : null}
      renderItem={({ item: j }) => {
        const ok = j.status === "printed";
        const who = j.source === "other" ? "JP Quality / מערכת אחרת" : j.requestedBy || j.keyOwner;
        return (
          <Card style={{ gap: 6 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <Text style={{ fontSize: font.small, color: colors.muted }}>{formatDate(j.processedAt)}</Text>
              <Text style={{ fontSize: font.small, fontWeight: "800", color: ok ? colors.accent : colors.danger }}>
                {ok ? "הודפס" : "נכשל"}
              </Text>
            </View>
            <Text style={{ fontSize: font.big, fontWeight: "700", color: colors.ink, textAlign: START }}>
              {j.product || j.sku || "-"}
            </Text>
            <Text style={styles.body}>
              {j.typeName} · {j.quantity} {j.typeName === "גבינות" ? "תוויות" : "מדבקות"}
            </Text>
            <Text style={styles.hint}>
              {who}
              {j.keyOwner && j.requestedBy && j.keyOwner !== j.requestedBy ? ` (מפתח: ${j.keyOwner})` : ""}
              {j.sku ? ` · מק"ט ${j.sku}` : ""}
            </Text>
          </Card>
        );
      }}
    />
  );
}
