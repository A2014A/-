// היסטוריה מקומית: 50 ההדפסות האחרונות בטלפון הזה.
// "הדפס שוב" ממלא מחדש את הטופס בלשונית המתאימה ולא שולח הדפסה.

import { router } from "expo-router";
import { Alert, FlatList, Text, View } from "react-native";

import { Button, Card, Hint, START, colors, font, styles } from "../../components/ui";
import { useHistory, type HistoryEntry, type HistoryStatus } from "../../lib/history";

const STATUS_TEXT: Record<HistoryStatus, string> = { ok: "הודפס", already: "כבר טופל", error: "נכשל" };
const STATUS_COLOR: Record<HistoryStatus, string> = { ok: colors.accent, already: colors.muted, error: colors.danger };

function formatDate(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function HistoryScreen() {
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
