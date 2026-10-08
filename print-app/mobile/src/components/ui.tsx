// רכיבי ממשק משותפים: גדולים וקריאים, לשימוש בעמידה על רצפת הייצור.
// הערה על RTL: באנדרואיד, textAlign "left" מתהפך לימין כשהממשק ב-RTL,
// כלומר "left" = תחילת השורה. לכן משתמשים ב-START ולא ב-"right".

import type { ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from "react-native";

export const START = "left" as const;

export const colors = {
  ink: "#1c1c1c",
  muted: "#666",
  paper: "#f6f5f1",
  card: "#ffffff",
  line: "#d8d5cc",
  accent: "#2f5233",
  accentSoft: "#e7efe8",
  danger: "#b3261e",
  dangerSoft: "#fbe9e7",
  warnSoft: "#fdf3d8",
  disabled: "#b7c2b8",
};

export const font = { body: 18, small: 15, title: 22, big: 20 };

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Label({ children }: { children: ReactNode }) {
  return <Text style={styles.label}>{children}</Text>;
}

export function Field(props: TextInputProps & { label?: string }) {
  const { label, style, ...rest } = props;
  return (
    <View style={styles.fieldWrap}>
      {label ? <Label>{label}</Label> : null}
      <TextInput placeholderTextColor="#999" {...rest} style={[styles.input, style]} />
    </View>
  );
}

type ButtonProps = {
  title: string;
  onPress: () => void;
  variant?: "primary" | "ghost" | "danger";
  disabled?: boolean;
  busy?: boolean;
  style?: StyleProp<ViewStyle>;
  selected?: boolean;
};

export function Button({ title, onPress, variant = "primary", disabled, busy, style, selected }: ButtonProps) {
  const isDisabled = disabled || busy;
  const variantStyle =
    variant === "primary" ? styles.btnPrimary : variant === "danger" ? styles.btnDanger : styles.btnGhost;
  const textStyle = variant === "ghost" && !selected ? styles.btnTextGhost : styles.btnText;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.btn,
        variantStyle,
        selected && styles.btnSelected,
        isDisabled && styles.btnDisabled,
        pressed && !isDisabled && { opacity: 0.75 },
        style,
      ]}
    >
      {busy ? <ActivityIndicator color={variant === "ghost" ? colors.accent : "#fff"} /> : <Text style={textStyle}>{title}</Text>}
    </Pressable>
  );
}

export function Checkbox({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: value }}
      onPress={() => onChange(!value)}
      style={styles.checkRow}
    >
      <View style={[styles.checkBox, value && styles.checkBoxOn]}>{value ? <Text style={styles.checkMark}>✓</Text> : null}</View>
      <Text style={styles.checkLabel}>{label}</Text>
    </Pressable>
  );
}

export type BannerKind = "ok" | "error" | "info";

export function Banner({ kind, text }: { kind: BannerKind; text: string }) {
  const bg = kind === "ok" ? colors.accentSoft : kind === "error" ? colors.dangerSoft : "#eef2f7";
  const fg = kind === "ok" ? colors.accent : kind === "error" ? colors.danger : colors.ink;
  return (
    <View style={[styles.banner, { backgroundColor: bg }]} accessibilityLiveRegion="polite">
      <Text style={[styles.bannerText, { color: fg }]}>{text}</Text>
    </View>
  );
}

export function Hint({ children }: { children: ReactNode }) {
  return <Text style={styles.hint}>{children}</Text>;
}

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  scroll: { padding: 16, paddingBottom: 48, gap: 14 },
  card: {
    backgroundColor: colors.card,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: 10,
    padding: 16,
    gap: 12,
  },
  label: { fontSize: font.small, fontWeight: "700", color: colors.ink, textAlign: START },
  fieldWrap: { gap: 6 },
  input: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: font.body,
    color: colors.ink,
    backgroundColor: "#fff",
    textAlign: START,
    writingDirection: "rtl",
    minHeight: 52,
  },
  btn: {
    minHeight: 56,
    borderRadius: 10,
    paddingHorizontal: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  btnPrimary: { backgroundColor: colors.accent },
  btnDanger: { backgroundColor: colors.danger },
  btnGhost: { backgroundColor: "#fff", borderWidth: 1.5, borderColor: colors.line },
  btnSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
  btnDisabled: { backgroundColor: colors.disabled, borderColor: colors.disabled },
  btnText: { color: "#fff", fontSize: font.big, fontWeight: "700" },
  btnTextGhost: { color: colors.ink, fontSize: font.big, fontWeight: "600" },
  checkRow: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 48 },
  checkBox: {
    width: 30,
    height: 30,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  checkBoxOn: { backgroundColor: colors.accent },
  checkMark: { color: "#fff", fontSize: 18, fontWeight: "800" },
  checkLabel: { fontSize: font.body, color: colors.ink },
  banner: { borderRadius: 8, padding: 14 },
  bannerText: { fontSize: font.body, fontWeight: "600", textAlign: START },
  hint: { fontSize: font.small, color: colors.muted, textAlign: START },
  row: { flexDirection: "row", gap: 10, flexWrap: "wrap" },
  title: { fontSize: font.title, fontWeight: "800", color: colors.ink, textAlign: START },
  body: { fontSize: font.body, color: colors.ink, textAlign: START },
});
