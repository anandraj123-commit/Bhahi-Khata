import { LanguageContext, Text, localeDirection, t, translate } from "./i18n";
import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  View,
  Pressable,
  TextInput,
  StyleSheet,
  Switch,
  StyleProp,
  TextStyle,
  TextInputProps,
  ViewStyle,
} from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { LOCALE_BY_ID, LOCALES, localeId } from "./locales";
import { translationCoverage } from "./i18n";
export const colors = {
  green: "#15803D",
  greenBg: "#F0FDF4",
  greenBorder: "#BBF7D0",
  dark: "#203044",
  muted: "#475569",
  orange: "#C2410C",
  amberBg: "#FFF7ED",
  amberBorder: "#FED7AA",
  blue: "#1D4ED8",
  blueBg: "#EFF6FF",
  blueBorder: "#BFDBFE",
  neutral: "#475569",
  neutralBg: "#F1F5F9",
  neutralBorder: "#CBD5E1",
  bg: "#F1F5F9",
  pale: "#F1F5F9",
  border: "#CBD5E1",
  red: "#B91C1C",
  redBg: "#FEE2E2",
  redBorder: "#FECACA",
};
export const spacing = Object.freeze({
  xsmall: 4,
  small: 8,
  medium: 12,
  large: 16,
  xlarge: 20,
  section: 24,
  page: 32,
});
export const Icon = ({
  name,
  color = colors.green,
  size = 22,
  style,
}: {
  name: React.ComponentProps<typeof Ionicons>["name"];
  color?: string;
  size?: number;
  style?: StyleProp<TextStyle>;
}) => <Ionicons accessible={false} name={name} size={size} color={color} style={[{ flexShrink: 0 }, style]} />;
export function Button({
  title,
  icon,
  onPress,
  secondary = false,
  orange = false,
  danger = false,
  disabled = false,
  loading = false,
  style,
}: {
  title: string;
  icon?: React.ComponentProps<typeof Ionicons>["name"];
  onPress: () => void;
  secondary?: boolean;
  orange?: boolean;
  danger?: boolean;
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        s.button,
        secondary && s.secondary,
        orange && { backgroundColor: colors.orange, borderColor: colors.orange },
        danger && { backgroundColor: colors.red },
        loading && { flexDirection: "row", gap: 8 },
        style,
        (pressed || disabled || loading) && { opacity: 0.55 },
      ]}
    >
      {loading && <ActivityIndicator size="small" color={secondary && !orange && !danger ? colors.green : "white"} />}
      {icon ? (
        <View style={s.buttonContent}>
          <Icon name={icon} size={18} color={secondary && !orange && !danger ? colors.green : "white"} />
          <Text style={[s.buttonText, s.buttonLabel, secondary && !orange && !danger && { color: colors.green }]}>
            {title}
          </Text>
        </View>
      ) : (
        <Text style={[s.buttonText, { flexShrink: 1 }, secondary && !orange && !danger && { color: colors.green }]}>
          {title}
        </Text>
      )}
    </Pressable>
  );
}
export function Field({ label, icon, ...props }: TextInputProps & { label: string; icon?: React.ComponentProps<typeof Icon>["name"] }) {
  const language = React.useContext(LanguageContext);
  const numericInput = ["phone-pad", "numeric", "decimal-pad"].includes(String(props.keyboardType || ""));
  return (
    <View style={s.field}>
      {icon ? <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Icon name={icon} size={18} color={colors.muted} />
        <Text style={s.label}>{label}</Text>
      </View> : <Text style={s.label}>{label}</Text>}
      <TextInput
        accessibilityLabel={translate(label, language)}
        placeholderTextColor="#9AA49F"
        style={[
          s.input,
          props.multiline && { height: 120, textAlignVertical: "top" },
          localeDirection(language) === "rtl" && !numericInput ? { writingDirection: "rtl", textAlign: "right" } : null,
        ]}
        {...props}
        placeholder={props.placeholder ? translate(props.placeholder, language) : undefined}
      />
    </View>
  );
}
export const Card = ({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: any;
}) => <View style={[s.card, style]}>{children}</View>;
export const Title = ({ children }: { children: React.ReactNode }) => (
  <Text style={s.section}>{children}</Text>
);
export const Hint = ({ children, style }: { children: React.ReactNode; style?: any }) => (
  <Text style={[s.hint, style]}>{children}</Text>
);
export function Chips({
  items,
  value,
  onChange,
  equalWidth = false,
  style,
}: {
  items: string[];
  value: string;
  onChange: (s: string) => void;
  equalWidth?: boolean;
  style?: any;
}) {
  const filterIcons: Partial<Record<string, { name: React.ComponentProps<typeof Icon>["name"]; color: string }>> = {
    All: { name: "grid-outline", color: colors.neutral },
    "Outstanding Dues": { name: "arrow-up-circle-outline", color: colors.red },
    "No Dues": { name: "checkmark-circle-outline", color: colors.green },
    "Total Udhari": { name: "receipt-outline", color: colors.blue },
    "Total Money Received": { name: "cash-outline", color: colors.green },
    "Udhari Recovered": { name: "checkmark-circle-outline", color: colors.green },
    "Available Advances": { name: "wallet-outline", color: colors.green },
    "Advance Deposited": { name: "download-outline", color: colors.blue },
    "Advance Refunded": { name: "push-outline", color: colors.orange },
    Udhari: { name: "arrow-up-circle-outline", color: colors.red },
    Payment: { name: "wallet-outline", color: colors.green },
    Due: { name: "time-outline", color: colors.orange },
    Paid: { name: "checkmark-circle-outline", color: colors.green },
  };
  return (
    <View style={[s.chips, style, equalWidth && { flexWrap: "nowrap", width: "100%" }]}>
      {items.map((item) => (
        <Pressable
          key={item}
          accessibilityRole="button"
          accessibilityLabel={item}
          accessibilityState={{ selected: value === item }}
          onPress={() => onChange(item)}
          style={[s.chip, equalWidth && { flex: 1, minWidth: 0, paddingHorizontal: 6 }, value === item && s.chipActive]}
        >
          <View style={s.chipContent}>
            {filterIcons[item] ? (
              <Icon
                name={filterIcons[item]!.name}
                size={17}
                color={value === item ? "white" : filterIcons[item]!.color}
                style={s.chipIcon}
              />
            ) : null}
            <Text
              style={{
                color: value === item ? "white" : colors.muted,
                fontWeight: "600",
                textAlign: "center",
                flexShrink: equalWidth ? 1 : 0,
              }}
            >
              {item}
            </Text>
          </View>
        </Pressable>
      ))}
  </View>
);
}

export function LanguagePicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (locale: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const language = React.useContext(LanguageContext);
  const selectedId = localeId(value);
  const selected = LOCALE_BY_ID[selectedId];
  const options = useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    return LOCALES.filter((locale) =>
      !search || `${locale.nativeName} ${locale.englishName} ${locale.id}`.toLocaleLowerCase().includes(search),
    );
  }, [query]);
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("Language: {{name}}", language, { name: selected.nativeName })}
        onPress={() => { setQuery(""); setOpen(true); }}
        style={[s.row, { backgroundColor: "white", borderRadius: 9, borderWidth: 1, borderColor: colors.border, padding: 13 }]}
      >
        <View style={{ flex: 1 }}>
          <Text style={s.rowTitle}>{selected.nativeName}</Text>
          <Text style={s.small}>{selected.englishName} · {translationCoverage(selectedId)}</Text>
        </View>
        <Ionicons name="chevron-down" size={18} color={colors.muted} />
      </Pressable>
      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(15,23,42,0.4)" }}>
          <View style={{ maxHeight: "88%", backgroundColor: colors.bg, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 18 }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <Text style={s.heading}>Choose language</Text>
              <Pressable accessibilityRole="button" accessibilityLabel={translate("Close language picker", language)} onPress={() => setOpen(false)} style={{ padding: 8 }}>
                <Ionicons name="close" size={22} color={colors.dark} />
              </Pressable>
            </View>
            <TextInput
              accessibilityLabel={translate("Search languages", language)}
              value={query}
              onChangeText={setQuery}
              placeholder={translate("Search by language name or code", language)}
              placeholderTextColor="#9AA49F"
              style={[s.input, { marginBottom: spacing.small }]}
              autoCapitalize="none"
            />
            <FlatList
              data={options}
              keyExtractor={(locale) => locale.id}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item: locale }) => (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: locale.id === selectedId }}
                  onPress={() => { onChange(locale.id); setOpen(false); }}
                  style={{ backgroundColor: locale.id === selectedId ? colors.greenBg : "white", borderWidth: 1, borderColor: locale.id === selectedId ? colors.greenBorder : colors.border, borderRadius: 10, minHeight: 56, justifyContent: "center", padding: spacing.medium, marginBottom: spacing.xsmall }}
                >
                  <Text style={[s.rowTitle, locale.id === selectedId && { color: colors.green }]}>{locale.nativeName}</Text>
                  <Text style={s.small}>{locale.englishName} · {translationCoverage(locale.id)}</Text>
                </Pressable>
              )}
              ListEmptyComponent={<Hint>No matching languages</Hint>}
            />
          </View>
        </View>
      </Modal>
    </>
  );
}
export function Row({
  title,
  subtitle,
  value,
  onPress,
  icon,
  color = colors.dark,
}: {
  title: string;
  subtitle?: string;
  value?: string;
  onPress?: () => void;
  icon?: React.ComponentProps<typeof Ionicons>["name"];
  color?: string;
}) {
  const rowIcon = icon || (onPress ? "chevron-forward" : undefined);
  return (
    <Pressable
      accessibilityRole={onPress ? "button" : undefined}
      onPress={onPress}
      disabled={!onPress}
      style={s.row}
    >
      <View style={{ flex: 1 }}>
        <Text style={[s.rowTitle, { color }]}>{title}</Text>
        {subtitle && <Text style={s.small}>{subtitle}</Text>}
      </View>
      {value && <Text style={{ color, fontWeight: "700" }}>{value}</Text>}
      {rowIcon && <Icon name={rowIcon} color={onPress ? colors.muted : color} size={18} />}
    </Pressable>
  );
}
export function Toggle({
  label,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <View style={s.row}>
      <Text style={[s.rowTitle, { flex: 1 }]}>{label}</Text>
      <Switch
        accessibilityLabel={label}
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        trackColor={{ false: colors.neutralBorder, true: colors.greenBorder }}
        thumbColor={value ? colors.green : "#fff"}
      />
    </View>
  );
}
export function Empty({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <View style={s.empty}>
      <Icon name="book-outline" size={40} />
      <Text style={s.section}>{title}</Text>
      <Hint>{description}</Hint>
    </View>
  );
}
export const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.xlarge, paddingTop: spacing.xlarge, paddingBottom: spacing.page + 4, gap: spacing.large },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.xlarge,
    paddingVertical: spacing.large,
    gap: spacing.medium,
    backgroundColor: "white",
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  heading: { fontSize: 22, fontWeight: "700", color: colors.dark, flex: 1 },
  hero: { fontSize: 32, fontWeight: "800", color: colors.dark, lineHeight: 41 },
  section: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.dark,
    marginTop: spacing.small,
    marginBottom: spacing.xsmall,
  },
  hint: { fontSize: 13, color: colors.muted, lineHeight: 21 },
  small: { fontSize: 12, color: colors.muted, marginTop: 5 },
  card: {
    backgroundColor: "white",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 18,
    gap: spacing.medium,
  },
  button: {
    backgroundColor: colors.green,
    borderRadius: 9,
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.large,
    paddingVertical: 14,
  },
  secondary: {
    backgroundColor: "white",
    borderWidth: 1,
    borderColor: colors.green,
  },
  buttonText: { color: "white", fontWeight: "700", fontSize: 15, lineHeight: 20, textAlign: "center" },
  buttonContent: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, flexShrink: 1, width: "100%", maxWidth: "100%" },
  buttonLabel: { flexShrink: 1, textAlign: "center" },
  field: { gap: spacing.small, marginBottom: spacing.xsmall },
  label: { color: colors.dark, fontSize: 13, fontWeight: "600" },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "white",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 13,
    minHeight: 52,
    color: colors.dark,
    fontSize: 16,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.small + 2,
    paddingVertical: spacing.medium,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowTitle: { fontSize: 15, color: colors.dark, fontWeight: "600" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.small },
  chipContent: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  chipIcon: { width: 17, height: 17, flexShrink: 0 },
  chip: {
    backgroundColor: "#EDF1EF",
    borderRadius: 8,
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: spacing.small + 2,
    paddingVertical: spacing.small + 1,
  },
  chipActive: { backgroundColor: colors.green },
  empty: { padding: 28, alignItems: "center", gap: 10 },
  split: { flexDirection: "row", gap: spacing.medium, alignItems: "stretch" },
  amount: { fontSize: 32, fontWeight: "800", color: colors.neutral },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.pale,
    justifyContent: "center",
    alignItems: "center",
  },
  badge: {
    alignSelf: "flex-start",
    backgroundColor: colors.pale,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  nav: {
    flexDirection: "row",
    backgroundColor: "white",
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.small + 2,
    paddingBottom: spacing.small,
  },
  navItem: { flex: 1, alignItems: "center", justifyContent: "center", gap: 4 },
  navLabel: { fontSize: 10, color: colors.muted },
  add: {
    width: 47,
    height: 47,
    borderRadius: 25,
    backgroundColor: colors.orange,
    alignItems: "center",
    justifyContent: "center",
    marginTop: -23,
  },
  logo: {
    width: 86,
    height: 86,
    borderRadius: 25,
    backgroundColor: colors.green,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    marginVertical: 25,
  },
  link: {
    color: colors.green,
    fontWeight: "600",
    textAlign: "center",
    padding: 12,
  },
  statLabel: { fontSize: 12, color: colors.muted },
  stat: { fontSize: 22, fontWeight: "800", color: colors.neutral },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: 8 },
});
