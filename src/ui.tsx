import { Text } from "./i18n";
import React from "react";
import {
  View,
  Pressable,
  TextInput,
  StyleSheet,
  Switch,
  TextInputProps,
} from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
export const colors = {
  green: "#0B9E59",
  dark: "#203044",
  muted: "#76818C",
  orange: "#FF8A00",
  bg: "#F7FAF8",
  pale: "#EAF6EF",
  border: "#E1E8E4",
  red: "#DC4545",
};
export const Icon = ({
  name,
  color = colors.green,
  size = 22,
}: {
  name: React.ComponentProps<typeof Ionicons>["name"];
  color?: string;
  size?: number;
}) => <Ionicons name={name} size={size} color={color} />;
export function Button({
  title,
  onPress,
  secondary = false,
  orange = false,
  danger = false,
  disabled = false,
}: {
  title: string;
  onPress: () => void;
  secondary?: boolean;
  orange?: boolean;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        s.button,
        secondary && s.secondary,
        orange && { backgroundColor: colors.orange },
        danger && { backgroundColor: colors.red },
        (pressed || disabled) && { opacity: 0.55 },
      ]}
    >
      <Text style={[s.buttonText, secondary && { color: colors.green }]}>
        {title}
      </Text>
    </Pressable>
  );
}
export function Field({ label, ...props }: TextInputProps & { label: string }) {
  return (
    <View style={s.field}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor="#9AA49F"
        style={[
          s.input,
          props.multiline && { height: 120, textAlignVertical: "top" },
        ]}
        {...props}
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
export const Hint = ({ children }: { children: React.ReactNode }) => (
  <Text style={s.hint}>{children}</Text>
);
export function Chips({
  items,
  value,
  onChange,
}: {
  items: string[];
  value: string;
  onChange: (s: string) => void;
}) {
  return (
    <View style={s.chips}>
      {items.map((item) => (
        <Pressable
          key={item}
          accessibilityRole="button"
          accessibilityState={{ selected: value === item }}
          onPress={() => onChange(item)}
          style={[s.chip, value === item && s.chipActive]}
        >
          <Text
            style={{
              color: value === item ? "white" : colors.muted,
              fontWeight: "600",
            }}
          >
            {item}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}
export function Row({
  title,
  subtitle,
  value,
  onPress,
  icon = "chevron-forward",
  color = colors.dark,
}: {
  title: string;
  subtitle?: string;
  value?: string;
  onPress?: () => void;
  icon?: React.ComponentProps<typeof Ionicons>["name"];
  color?: string;
}) {
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
      {onPress && <Icon name={icon} color={colors.muted} size={18} />}
    </Pressable>
  );
}
export function Toggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <View style={s.row}>
      <Text style={[s.rowTitle, { flex: 1 }]}>{label}</Text>
      <Switch
        accessibilityLabel={label}
        value={value}
        onValueChange={onChange}
        trackColor={{ false: "#D6DFD9", true: "#9CDEBB" }}
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
  content: { padding: 22, paddingBottom: 36, gap: 16 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 17,
    gap: 14,
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
    marginTop: 7,
    marginBottom: 3,
  },
  hint: { fontSize: 13, color: colors.muted, lineHeight: 21 },
  small: { fontSize: 12, color: colors.muted, marginTop: 5 },
  card: {
    backgroundColor: "white",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 17,
    gap: 9,
  },
  button: {
    backgroundColor: colors.green,
    borderRadius: 9,
    minHeight: 51,
    alignItems: "center",
    justifyContent: "center",
    padding: 13,
  },
  secondary: {
    backgroundColor: "white",
    borderWidth: 1,
    borderColor: colors.green,
  },
  buttonText: { color: "white", fontWeight: "700", fontSize: 15 },
  field: { gap: 8 },
  label: { color: colors.dark, fontSize: 13, fontWeight: "600" },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "white",
    borderRadius: 9,
    padding: 14,
    minHeight: 50,
    color: colors.dark,
    fontSize: 16,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 15,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowTitle: { fontSize: 15, color: colors.dark, fontWeight: "600" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    backgroundColor: "#EDF1EF",
    borderRadius: 8,
    paddingHorizontal: 15,
    paddingVertical: 11,
  },
  chipActive: { backgroundColor: colors.green },
  empty: { padding: 28, alignItems: "center", gap: 10 },
  split: { flexDirection: "row", gap: 12 },
  amount: { fontSize: 32, fontWeight: "800", color: colors.green },
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
    paddingTop: 10,
    paddingBottom: 8,
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
  stat: { fontSize: 22, fontWeight: "800", color: colors.green },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: 8 },
});
