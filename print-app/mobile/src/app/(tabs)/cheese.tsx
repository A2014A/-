// לשונית "גבינות" - מקבילה ל-cheese-labels.html.

import * as DocumentPicker from "expo-document-picker";
import { useFocusEffect } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";

import {
  addCheeseItem,
  fetchLabelImage,
  listCheeseItems,
  previewFromExcel,
  previewFromText,
  printCheeseBatch,
  rowsToWeightsText,
  type CheeseItem,
  type NewCheeseItem,
  type PickedFile,
  type PreviewResponse,
} from "../../api/cheese";
import { ApiError, NO_CONNECTION_MSG, userMessage } from "../../api/http";
import { Banner, Button, Card, Field, Hint, Label, START, colors, font, styles, type BannerKind } from "../../components/ui";
import { useHistory } from "../../lib/history";
import { useSettings } from "../../lib/settings";

const EXCEL_TYPES = [
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
];
const EMPTY_PRODUCT: NewCheeseItem = { sku: "", productEn: "", productHe: "", itemCode: "", kosher: "", passover: "" };
const MAYBE_PRINTED_NOTE = " ייתכן שחלק מהתוויות כבר הודפסו – בדוק במדפסת לפני שליחה חוזרת.";

type Msg = { kind: BannerKind; text: string } | null;

export default function CheeseScreen() {
  const { settings } = useSettings();
  const history = useHistory();
  const { takeRefill } = history;
  const base = settings.cheeseUrl;
  const key = settings.apiKey;

  // --- מוצרים ---
  const [items, setItems] = useState<CheeseItem[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [itemsError, setItemsError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [sku, setSku] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [newProduct, setNewProduct] = useState<NewCheeseItem>(EMPTY_PRODUCT);
  const [addBusy, setAddBusy] = useState(false);
  const [addMsg, setAddMsg] = useState<Msg>(null);

  // --- משקלים ---
  const [mode, setMode] = useState<"paste" | "excel">("paste");
  const [weightsText, setWeightsText] = useState("");
  const [file, setFile] = useState<PickedFile | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewMsg, setPreviewMsg] = useState<Msg>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);

  // --- הדפסה ---
  const [batchNumber, setBatchNumber] = useState("");
  const [printing, setPrinting] = useState(false);
  const printingRef = useRef(false);
  const [printMsg, setPrintMsg] = useState<Msg>(null);

  // --- תצוגת תווית ---
  const [labelOpen, setLabelOpen] = useState(false);
  const [labelData, setLabelData] = useState<string | null>(null); // data:image/png;base64,...
  const [labelLoading, setLabelLoading] = useState(false);
  const [labelError, setLabelError] = useState<string | null>(null);
  const labelSeq = useRef(0);

  const loadItems = useCallback(async () => {
    setItemsLoading(true);
    setItemsError(null);
    try {
      setItems(await listCheeseItems(base, key));
    } catch (e) {
      setItemsError(userMessage(e));
    } finally {
      setItemsLoading(false);
    }
  }, [base, key]);

  // תמיד שולפים את הרשימה מהשרת כשנכנסים ללשונית (בלי קאש קבוע),
  // ומטפלים ב"הדפס שוב" מההיסטוריה.
  useFocusEffect(
    useCallback(() => {
      loadItems();
      const refill = takeRefill("cheese");
      if (refill) {
        setSku(refill.sku);
        setFilter("");
        setMode("paste");
        setWeightsText(refill.weightsText);
        setBatchNumber(refill.batchNumber);
        setPreview(null);
        setPrintMsg(null);
        setPreviewMsg({ kind: "info", text: "הטופס מולא מההיסטוריה. לחץ \"תצוגה מקדימה\" ובדוק לפני הדפסה." });
      }
    }, [loadItems, takeRefill]),
  );

  const selectedItem = items.find((i) => i.sku === sku) ?? null;

  const filtered = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (!f) return items;
    return items.filter(
      (i) =>
        i.sku.toLowerCase().includes(f) || i.productHe.toLowerCase().includes(f) || i.productEn.toLowerCase().includes(f),
    );
  }, [items, filter]);

  // כל שינוי בקלט מבטל את התצוגה המקדימה, כדי שלא יודפס משהו שלא נבדק
  const invalidatePreview = () => {
    setPreview(null);
    setPrintMsg(null);
  };

  const onSaveProduct = async () => {
    const p = Object.fromEntries(Object.entries(newProduct).map(([k, v]) => [k, v.trim()])) as NewCheeseItem;
    if (!p.sku || !p.productEn || !p.productHe) {
      setAddMsg({ kind: "error", text: 'יש למלא מק"ט, שם באנגלית ושם בעברית.' });
      return;
    }
    if (!/^\d{4}$/.test(p.itemCode)) {
      setAddMsg({ kind: "error", text: "קוד פריט חייב להיות בדיוק 4 ספרות." });
      return;
    }
    setAddBusy(true);
    setAddMsg({ kind: "info", text: "שומר..." });
    try {
      await addCheeseItem(base, key, p);
      await loadItems();
      setSku(p.sku);
      setNewProduct(EMPTY_PRODUCT);
      setShowAdd(false);
      setAddMsg(null);
      invalidatePreview();
      setPreviewMsg({ kind: "ok", text: `המוצר "${p.productHe}" נשמר ונבחר.` });
    } catch (e) {
      setAddMsg({ kind: "error", text: userMessage(e) });
    } finally {
      setAddBusy(false);
    }
  };

  const pickFile = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: EXCEL_TYPES, copyToCacheDirectory: true, multiple: false });
      if (res.canceled || !res.assets?.length) return;
      const a = res.assets[0];
      setFile({ uri: a.uri, name: a.name, mimeType: a.mimeType });
      invalidatePreview();
      setPreviewMsg(null);
    } catch {
      setPreviewMsg({ kind: "error", text: "לא ניתן לפתוח את הקובץ." });
    }
  };

  const onPreview = async () => {
    if (!sku) {
      setPreviewMsg({ kind: "error", text: "בחר מוצר קודם." });
      return;
    }
    if (mode === "paste" && !weightsText.trim()) {
      setPreviewMsg({ kind: "error", text: "הדבק רשימת משקלים קודם." });
      return;
    }
    if (mode === "excel" && !file) {
      setPreviewMsg({ kind: "error", text: "בחר קובץ Excel קודם." });
      return;
    }
    setPreviewBusy(true);
    setPreviewMsg(null);
    invalidatePreview();
    try {
      const data =
        mode === "paste" ? await previewFromText(base, key, sku, weightsText) : await previewFromExcel(base, key, sku, file!);
      setPreview(data);
    } catch (e) {
      setPreviewMsg({ kind: "error", text: userMessage(e) });
    } finally {
      setPreviewBusy(false);
    }
  };

  const doPrint = async (p: PreviewResponse) => {
    if (printingRef.current) return;
    printingRef.current = true;
    setPrinting(true);
    setPrintMsg({ kind: "info", text: "מדפיס..." });
    const rows = p.rows.map((r) => ({ weightKg: r.weightKg, uniqueId: r.uniqueId || "" }));
    const entryBase = {
      typeLabel: "גבינות",
      product: p.productHe,
      quantity: p.count,
      refill: { kind: "cheese" as const, sku: p.sku, weightsText: rowsToWeightsText(rows), batchNumber: batchNumber.trim() },
    };
    try {
      const res = await printCheeseBatch(base, key, {
        sku: p.sku,
        batchNumber: batchNumber.trim(),
        requestedBy: settings.requesterName,
        rows,
      });
      const text = `הודפסו ${res.printed} תוויות בהצלחה`;
      setPrintMsg({ kind: "ok", text });
      history.add({ ...entryBase, status: "ok", message: text });
    } catch (e) {
      let text = userMessage(e);
      if (e instanceof ApiError && e.kind === "timeout") text = NO_CONNECTION_MSG + "." + MAYBE_PRINTED_NOTE;
      setPrintMsg({ kind: "error", text });
      history.add({ ...entryBase, status: "error", message: text });
    } finally {
      printingRef.current = false;
      setPrinting(false);
    }
  };

  const confirmPrint = () => {
    if (!preview || printingRef.current) return;
    const p = preview;
    Alert.alert("אישור הדפסה", `להדפיס ${p.count} תוויות של ${p.productHe}?`, [
      { text: "ביטול", style: "cancel" },
      { text: "הדפס", onPress: () => doPrint(p) },
    ]);
  };

  const openLabel = async (weightKg: number, uniqueId: string) => {
    if (!preview) return;
    const seq = ++labelSeq.current;
    setLabelOpen(true);
    setLabelData(null);
    setLabelError(null);
    setLabelLoading(true);
    try {
      const data = await fetchLabelImage(base, key, preview.sku, weightKg, uniqueId);
      if (seq === labelSeq.current) setLabelData(data);
    } catch (e) {
      if (seq === labelSeq.current) setLabelError(userMessage(e));
    } finally {
      if (seq === labelSeq.current) setLabelLoading(false);
    }
  };

  const closeLabel = () => {
    labelSeq.current++;
    setLabelOpen(false);
    setLabelData(null);
    setLabelError(null);
    setLabelLoading(false);
  };

  const hasDup = preview?.rows.some((r) => r.duplicate) ?? false;

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {/* ---------- בחירת מוצר ---------- */}
        <Card>
          <Label>מוצר</Label>
          {selectedItem ? (
            <View style={{ backgroundColor: colors.accentSoft, borderRadius: 8, padding: 12 }}>
              <Text style={{ fontSize: font.big, fontWeight: "700", color: colors.accent, textAlign: START }}>
                {selectedItem.productHe}
              </Text>
              <Text style={styles.hint}>
                מק"ט: {selectedItem.sku} · {selectedItem.productEn}
              </Text>
            </View>
          ) : null}
          <Field value={filter} onChangeText={setFilter} placeholder="חיפוש ברשימת המוצרים" autoCorrect={false} />
          {itemsLoading && !items.length ? <ActivityIndicator color={colors.accent} /> : null}
          {itemsError ? (
            <>
              <Banner kind="error" text={itemsError} />
              <Button title="נסה שוב" variant="ghost" onPress={loadItems} />
            </>
          ) : null}
          <View style={{ gap: 8 }}>
            {filtered.map((i) => {
              const isSel = i.sku === sku;
              return (
                <Pressable
                  key={i.sku}
                  accessibilityRole="button"
                  onPress={() => {
                    setSku(i.sku);
                    invalidatePreview();
                    setPreviewMsg(null);
                  }}
                  style={{
                    borderWidth: isSel ? 2 : 1,
                    borderColor: isSel ? colors.accent : colors.line,
                    backgroundColor: isSel ? colors.accentSoft : "#fff",
                    borderRadius: 10,
                    paddingVertical: 12,
                    paddingHorizontal: 12,
                  }}
                >
                  <Text style={{ fontSize: font.body, fontWeight: "600", color: colors.ink, textAlign: START }}>
                    {i.productHe} ({i.sku})
                  </Text>
                </Pressable>
              );
            })}
            {!itemsLoading && !itemsError && items.length > 0 && filtered.length === 0 ? <Hint>לא נמצאו מוצרים</Hint> : null}
          </View>

          <Button
            title={showAdd ? "סגור טופס מוצר חדש" : "+ הוסף מוצר חדש"}
            variant="ghost"
            onPress={() => {
              setShowAdd((s) => !s);
              setAddMsg(null);
            }}
          />
          {showAdd ? (
            <View style={{ gap: 10, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 12 }}>
              <Field label='מק"ט (ייחודי)' value={newProduct.sku} onChangeText={(v) => setNewProduct((p) => ({ ...p, sku: v }))} autoCapitalize="characters" autoCorrect={false} />
              <Field label="שם המוצר (אנגלית)" value={newProduct.productEn} onChangeText={(v) => setNewProduct((p) => ({ ...p, productEn: v }))} autoCorrect={false} />
              <Field label="שם המוצר (עברית)" value={newProduct.productHe} onChangeText={(v) => setNewProduct((p) => ({ ...p, productHe: v }))} />
              <Field
                label="קוד פריט לברקוד (4 ספרות)"
                value={newProduct.itemCode}
                onChangeText={(v) => setNewProduct((p) => ({ ...p, itemCode: v.replace(/[^0-9]/g, "").slice(0, 4) }))}
                keyboardType="number-pad"
                placeholder="8714"
                maxLength={4}
              />
              <Field label="כשרות (אופציונלי)" value={newProduct.kosher} onChangeText={(v) => setNewProduct((p) => ({ ...p, kosher: v }))} />
              <Field label="פסח (אופציונלי)" value={newProduct.passover} onChangeText={(v) => setNewProduct((p) => ({ ...p, passover: v }))} />
              {addMsg ? <Banner kind={addMsg.kind} text={addMsg.text} /> : null}
              <Button title="שמור מוצר" onPress={onSaveProduct} busy={addBusy} />
            </View>
          ) : null}
        </Card>

        {/* ---------- משקלים ---------- */}
        <Card>
          <Label>משקלים</Label>
          <View style={styles.row}>
            <Button
              title="הדבקת רשימה"
              variant="ghost"
              selected={mode === "paste"}
              onPress={() => {
                setMode("paste");
                invalidatePreview();
              }}
              style={{ flex: 1 }}
            />
            <Button
              title="קובץ Excel"
              variant="ghost"
              selected={mode === "excel"}
              onPress={() => {
                setMode("excel");
                invalidatePreview();
              }}
              style={{ flex: 1 }}
            />
          </View>

          {mode === "paste" ? (
            <>
              <Hint>שורה לכל קרטון. אפשר להוסיף מזהה ייחודי אחרי רווח, למשל: 4.34 1219</Hint>
              <Field
                value={weightsText}
                onChangeText={(t) => {
                  setWeightsText(t);
                  invalidatePreview();
                }}
                multiline
                placeholder={"4.34\n4.39 1220\n4.42"}
                keyboardType={Platform.OS === "ios" ? "default" : "visible-password"}
                autoCorrect={false}
                style={{ minHeight: 160, textAlignVertical: "top", writingDirection: "ltr", fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" }}
              />
            </>
          ) : (
            <>
              <Hint>עמודה A = משקל, עמודה B (לא חובה) = מזהה ייחודי. קובץ ‎.xlsx בלבד.</Hint>
              <Button title={file ? "בחר קובץ אחר" : "בחר קובץ Excel"} variant="ghost" onPress={pickFile} />
              {file ? <Text style={styles.body}>📄 {file.name}</Text> : null}
            </>
          )}

          <Button title="תצוגה מקדימה" onPress={onPreview} busy={previewBusy} />
          {previewMsg ? <Banner kind={previewMsg.kind} text={previewMsg.text} /> : null}
        </Card>

        {/* ---------- תצוגה מקדימה והדפסה ---------- */}
        {preview ? (
          <Card>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <Text style={styles.title}>{preview.productHe}</Text>
              <View style={{ backgroundColor: colors.accentSoft, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 4 }}>
                <Text style={{ color: colors.accent, fontWeight: "800", fontSize: font.body }}>{preview.count} תוויות</Text>
              </View>
            </View>

            {hasDup ? (
              <Banner
                kind="error"
                text="שים לב: השורות המסומנות באדום הן קרטונים עם אותו משקל בדיוק (אותו ברקוד). כל שורה תודפס כתווית נפרדת – ודא שזה נכון."
              />
            ) : null}

            <View style={{ borderWidth: 1, borderColor: colors.line, borderRadius: 8, overflow: "hidden" }}>
              <View style={[tableRow, { backgroundColor: colors.accentSoft }]}>
                <Text style={[cell, { flex: 0.5 }, bold]}>#</Text>
                <Text style={[cell, { flex: 1 }, bold]}>משקל</Text>
                <Text style={[cell, { flex: 1 }, bold]}>מזהה</Text>
                <Text style={[cell, { flex: 2.2 }, bold]}>ברקוד</Text>
              </View>
              {preview.rows.map((r) => (
                <View key={r.index} style={{ backgroundColor: r.duplicate ? colors.dangerSoft : "#fff", borderTopWidth: 1, borderTopColor: colors.line }}>
                  <View style={tableRow}>
                    <Text style={[cell, { flex: 0.5 }]}>{r.index}</Text>
                    <Text style={[cell, { flex: 1 }, bold, r.duplicate && { color: colors.danger }]}>{r.weightKg.toFixed(2)}</Text>
                    <Text style={[cell, { flex: 1 }]}>{r.uniqueId || "-"}</Text>
                    <Text style={[cell, { flex: 2.2, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" }]}>{r.barcode}</Text>
                  </View>
                  <Pressable onPress={() => openLabel(r.weightKg, r.uniqueId || "")} style={{ paddingHorizontal: 10, paddingBottom: 10 }} hitSlop={6}>
                    <Text style={{ color: colors.accent, fontSize: font.small, fontWeight: "700", textDecorationLine: "underline", textAlign: START }}>
                      הצג תווית
                    </Text>
                  </Pressable>
                </View>
              ))}
            </View>

            <Field label="מספר אצווה" value={batchNumber} onChangeText={setBatchNumber} placeholder="למשל 689098" autoCorrect={false} />
            <Button title={`הדפס ${preview.count} תוויות`} onPress={confirmPrint} busy={printing} />
            {printMsg ? <Banner kind={printMsg.kind} text={printMsg.text} /> : null}
          </Card>
        ) : null}
      </ScrollView>

      {/* ---------- תווית במסך מלא ---------- */}
      <Modal visible={labelOpen} animationType="fade" onRequestClose={closeLabel} transparent>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.85)", justifyContent: "center", padding: 16, gap: 16 }}>
          <View style={{ backgroundColor: "#fff", borderRadius: 8, aspectRatio: 900 / 400, width: "100%", justifyContent: "center" }}>
            {labelData ? (
              <Image source={{ uri: labelData }} style={{ width: "100%", height: "100%" }} resizeMode="contain" />
            ) : null}
            {labelLoading ? <ActivityIndicator style={{ position: "absolute", alignSelf: "center" }} color={colors.accent} size="large" /> : null}
          </View>
          {labelError ? <Banner kind="error" text={labelError} /> : null}
          <Button title="סגור" variant="ghost" onPress={closeLabel} />
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const tableRow = { flexDirection: "row" as const, paddingHorizontal: 10, paddingVertical: 10, gap: 6 };
const cell = { fontSize: font.small, color: colors.ink, textAlign: START };
const bold = { fontWeight: "700" as const };
