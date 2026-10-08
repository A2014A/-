// לשונית "מדבקות" - מקבילה ל-print.html.

import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from "react-native";

import { ApiError, NO_CONNECTION_MSG, userMessage } from "../../api/http";
import {
  STICKER_TYPES,
  TYPE_DISPLAY_NAME,
  buildPrintJob,
  isKosherType,
  searchItems,
  sendPrintJob,
  type Item,
  type StickerType,
} from "../../api/print";
import { Banner, Button, Card, Checkbox, Field, Hint, Label, START, colors, font, styles, type BannerKind } from "../../components/ui";
import { useHistory, type StickerRefill } from "../../lib/history";
import { useSettings } from "../../lib/settings";

const SEARCH_DEBOUNCE_MS = 300;
const MAYBE_PRINTED_NOTE = " ייתכן שההדפסה בכל זאת יצאה – בדוק במדפסת לפני שליחה חוזרת.";

export default function StickersScreen() {
  const { settings } = useSettings();
  const history = useHistory();
  const { takeRefill } = history;

  const [query, setQuery] = useState("");
  const [searchNonce, setSearchNonce] = useState(0); // מאלץ חיפוש חוזר גם כשהטקסט לא השתנה
  const [results, setResults] = useState<Item[]>([]);
  const [searchState, setSearchState] = useState<{ kind: "idle" | "loading" | "hint" | "error"; text?: string }>({
    kind: "idle",
  });
  const [selected, setSelected] = useState<Item | null>(null);
  const [type, setType] = useState<StickerType | null>(null);
  const [quantity, setQuantity] = useState("1");
  const [skipDates, setSkipDates] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [result, setResult] = useState<{ kind: BannerKind; text: string } | null>(null);

  const printingRef = useRef(false); // נעילה מיידית מול לחיצה כפולה, עוד לפני רינדור מחדש
  const searchSeq = useRef(0);
  const pendingAutoSelect = useRef<StickerRefill | null>(null);

  const resetSelection = () => {
    setSelected(null);
    setType(null);
    setSkipDates(false);
    setResult(null);
  };

  const selectItem = useCallback((item: Item) => {
    setSelected(item);
    setResult(null);
    setSkipDates(false);
    // פריט "קרטונים בלבד" מדלג על בחירת הסוג
    setType(item.cartonsOnly ? "cartons" : null);
  }, []);

  // חיפוש אוטומטי מ-2 תווים, debounce של 300ms
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setSearchState(q.length === 0 ? { kind: "idle" } : { kind: "hint", text: "הקלד לפחות 2 תווים לחיפוש" });
      return;
    }
    const seq = ++searchSeq.current;
    setSearchState({ kind: "loading", text: "מחפש..." });
    const t = setTimeout(async () => {
      try {
        const items = await searchItems(settings.printUrl, settings.apiKey, q);
        if (seq !== searchSeq.current) return; // תשובה ישנה - מתעלמים
        setResults(items);
        setSearchState(items.length ? { kind: "idle" } : { kind: "hint", text: "לא נמצאו תוצאות" });

        // מילוי מחדש מההיסטוריה: בוחרים את הפריט העדכני מהשרת לפי מק"ט
        const refill = pendingAutoSelect.current;
        if (refill) {
          pendingAutoSelect.current = null;
          const match = items.find((i) => i.sku === refill.sku);
          if (match) {
            setSelected(match);
            setType(match.cartonsOnly ? "cartons" : refill.type);
            setQuantity(String(refill.quantity));
            setSkipDates(refill.skipDates);
            setResult({ kind: "info", text: "הטופס מולא מההיסטוריה. בדוק ולחץ \"הדפס\"." });
          } else {
            setResult({ kind: "error", text: "הפריט מההיסטוריה לא נמצא בחיפוש." });
          }
        }
      } catch (e) {
        if (seq !== searchSeq.current) return;
        setResults([]);
        setSearchState({ kind: "error", text: userMessage(e) });
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query, searchNonce, settings.printUrl, settings.apiKey]);

  // "הדפס שוב" מההיסטוריה
  useFocusEffect(
    useCallback(() => {
      const refill = takeRefill("sticker");
      if (!refill) return;
      resetSelection();
      pendingAutoSelect.current = refill;
      setQuery(refill.sku);
      setSearchNonce((n) => n + 1);
    }, [takeRefill]),
  );

  const qtyNum = Number.parseInt(quantity, 10);
  const qtyValid = Number.isFinite(qtyNum) && qtyNum >= 1 && String(qtyNum) === quantity.trim();

  const doPrint = async () => {
    if (printingRef.current) return;
    if (!settings.requesterName) {
      setResult({ kind: "error", text: "נא למלא שם מזמין במסך ההגדרות." });
      return;
    }
    if (!selected || !type || !qtyValid) {
      setResult({ kind: "error", text: "חסרים נתונים – בחר פריט, סוג מדבקה וכמות תקינה." });
      return;
    }
    printingRef.current = true;
    setPrinting(true);
    setResult({ kind: "info", text: "שולח להדפסה..." });

    const job = buildPrintJob(selected, type, qtyNum, settings.requesterName, skipDates);
    const typeName = TYPE_DISPLAY_NAME[type];
    const refill: StickerRefill = { kind: "sticker", sku: selected.sku, type, quantity: qtyNum, skipDates };
    const base = { typeLabel: typeName, product: selected.product, quantity: qtyNum, refill };

    try {
      const res = await sendPrintJob(settings.printUrl, settings.apiKey, job);
      if (res.status === "printed") {
        const text = `נשלח בהצלחה: ${qtyNum} מדבקות (${typeName}) – ${selected.product}`;
        setResult({ kind: "ok", text });
        history.add({ ...base, status: "ok", message: text });
      } else if (res.status === "already_handled") {
        const text = "עבודה זו כבר טופלה";
        setResult({ kind: "info", text });
        history.add({ ...base, status: "already", message: text });
      } else {
        const text = `שגיאה: ${res.message || res.errorCode || "ההדפסה נכשלה"}`;
        setResult({ kind: "error", text });
        history.add({ ...base, status: "error", message: text });
      }
    } catch (e) {
      let text = userMessage(e);
      if (e instanceof ApiError && e.kind === "timeout") text = NO_CONNECTION_MSG + "." + MAYBE_PRINTED_NOTE;
      setResult({ kind: "error", text });
      history.add({ ...base, status: "error", message: text });
    } finally {
      printingRef.current = false;
      setPrinting(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Card>
          <Field
            label="חיפוש פריט"
            value={query}
            onChangeText={(t) => {
              setQuery(t);
              resetSelection();
            }}
            placeholder='מק"ט, ברקוד או שם מוצר'
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
          />
          {searchState.kind === "error" ? <Banner kind="error" text={searchState.text ?? ""} /> : null}
          {searchState.kind === "hint" || searchState.kind === "loading" ? <Hint>{searchState.text}</Hint> : null}

          {results.map((item, idx) => {
            const isSel = selected?.sku === item.sku;
            return (
              <Pressable
                key={`${item.sku}-${idx}`}
                onPress={() => selectItem(item)}
                accessibilityRole="button"
                style={{
                  borderWidth: isSel ? 2 : 1,
                  borderColor: isSel ? colors.accent : colors.line,
                  backgroundColor: isSel ? colors.accentSoft : "#fff",
                  borderRadius: 10,
                  padding: 12,
                  gap: 4,
                }}
              >
                <Text style={{ fontSize: font.big, fontWeight: "700", color: colors.ink, textAlign: START }}>
                  {item.product}
                </Text>
                <Text style={styles.hint}>
                  מק"ט: {item.sku} · ברקוד: {item.barcode || "-"} · כשרות: {item.kosher || "-"}
                  {item.passover ? ` · ${item.passover}` : ""}
                </Text>
              </Pressable>
            );
          })}
        </Card>

        {selected ? (
          <Card>
            <Label>סוג מדבקה</Label>
            {selected.cartonsOnly ? (
              <Hint>פריט זה מודפס בקרטונים בלבד.</Hint>
            ) : (
              <View style={styles.row}>
                {STICKER_TYPES.map((t) => (
                  <Button
                    key={t}
                    title={TYPE_DISPLAY_NAME[t]}
                    variant="ghost"
                    selected={type === t}
                    onPress={() => {
                      setType(t);
                      setResult(null);
                    }}
                    style={{ flexBasis: "47%", flexGrow: 1 }}
                  />
                ))}
              </View>
            )}

            {type ? (
              <>
                <Field
                  label="כמות מדבקות"
                  value={quantity}
                  onChangeText={(t) => setQuantity(t.replace(/[^0-9]/g, ""))}
                  keyboardType="number-pad"
                  selectTextOnFocus
                  style={{ fontSize: 24, fontWeight: "700" }}
                />
                {!isKosherType(type) ? (
                  <Checkbox label="הדפס ללא תאריכים" value={skipDates} onChange={setSkipDates} />
                ) : null}
                <Button
                  title={`הדפס ${qtyValid ? qtyNum : ""} מדבקות ${TYPE_DISPLAY_NAME[type]}`}
                  onPress={doPrint}
                  busy={printing}
                  disabled={!qtyValid}
                />
              </>
            ) : null}
          </Card>
        ) : null}

        {result ? <Banner kind={result.kind} text={result.text} /> : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
