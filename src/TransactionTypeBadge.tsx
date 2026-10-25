import React, { useContext } from "react";
import { StyleSheet, View } from "react-native";
import { Icon } from "./ui";
import { LanguageContext, Text, t } from "./i18n";

// Presentation labels only: callers retain the existing ledger label mapping.
const badgeThemes = {
  "Udhari Given": { background: "#FEF2F2", border: "#FECACA", text: "#B91C1C", icon: "arrow-up-circle-outline" },
  "Payment Received": { background: "#ECFDF5", border: "#A7F3D0", text: "#047857", icon: "cash-outline" },
  "Udhari Recovered": { background: "#EFF6FF", border: "#BFDBFE", text: "#1D4ED8", icon: "checkmark-circle-outline" },
  "Advance Deposited": { background: "#F0FDF4", border: "#BBF7D0", text: "#15803D", icon: "wallet-outline" },
  "Advance Refunded": { background: "#FFF7ED", border: "#FED7AA", text: "#C2410C", icon: "return-up-back-outline" },
} as const;
const fallback = { background: "#F1F5F9", border: "#CBD5E1", text: "#475569", icon: "receipt-outline" } as const;

export function TransactionTypeBadge({ label, compact = false }: { label: string; compact?: boolean }) {
  const language = useContext(LanguageContext);
  // Existing refund text is "Advance Refund"; keep it unchanged.
  const key = label === "Advance Refund" ? "Advance Refunded" : label;
  const theme = Object.hasOwn(badgeThemes, key) ? badgeThemes[key as keyof typeof badgeThemes] : fallback;
  const display = label.trim() || "Transaction";
  return <View accessible accessibilityRole="text" accessibilityLabel={t(display, language)}
    style={[styles.badge, { backgroundColor: theme.background, borderColor: theme.border }, compact && styles.compact]}>
    <Icon name={theme.icon} size={14} color={theme.text} />
    <Text style={[styles.label, { color: theme.text }]}>{display}</Text>
  </View>;
}

const styles = StyleSheet.create({
  badge: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", maxWidth: "100%", flexShrink: 1, gap: 4, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 16, borderWidth: 1 },
  compact: { paddingHorizontal: 7, paddingVertical: 4 },
  label: { fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.2, flexShrink: 1 },
});
