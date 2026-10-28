import React, { useContext } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import type { Customer } from "./model";
import { Icon, s } from "./ui";
import { LanguageContext, Text, t } from "./i18n";
import { customerContactUrls, openCustomerContact } from "./customerContactActions";

type Props = {
  customer: Pick<Customer, "phone" | "whatsappNumber" | "address">;
  compact?: boolean;
  /** Full profile layout that pairs each action with its saved contact value. */
  detailRows?: boolean;
  /** Hide unavailable actions for compact contexts that should show only usable contacts. */
  hideUnavailable?: boolean;
  /** Contrast for selected customer rows. */
  inverse?: boolean;
};

const contactThemes = {
  phone: { backgroundColor: "#EFF6FF", borderColor: "#BFDBFE", icon: "#2563EB", text: "#1E40AF" },
  whatsapp: { backgroundColor: "#ECFDF5", borderColor: "#A7F3D0", icon: "#16A34A", text: "#166534" },
  address: { backgroundColor: "#FFF7ED", borderColor: "#FED7AA", icon: "#EA580C", text: "#9A3412" },
};

export function CustomerContactInfo({ customer, compact = false, hideUnavailable = false, inverse = false, detailRows = false }: Props) {
  const language = useContext(LanguageContext);
  const fields = [
    { kind: "phone", label: "Mobile Number", shortLabel: "Phone", icon: "call-outline", value: customer.phone },
    { kind: "whatsapp", label: "WhatsApp Number", shortLabel: "WhatsApp", icon: "logo-whatsapp", value: customer.whatsappNumber },
    { kind: "address", label: "Address", shortLabel: "Address", icon: "location-outline", value: customer.address },
  ] as const;
  const visibleFields = hideUnavailable
    ? fields.filter(({ kind, value }) => customerContactUrls(kind, value).length > 0)
    : fields;
  return <View style={styles.container}>
    <View style={detailRows ? styles.detailRows : styles.actions}>
    {visibleFields.map(({ kind, label, shortLabel, icon, value }) => {
      const display = typeof value === "string" ? value.trim() : "";
      const enabled = customerContactUrls(kind, value).length > 0;
      const theme = contactThemes[kind];
      const index = fields.findIndex((field) => field.kind === kind);
      const hint = kind === "phone" ? "Open phone dialer" : kind === "whatsapp"
        ? "Open WhatsApp chat. Sending messages requires connectivity."
        : "Open Google Maps. Address search may require internet.";
      return <Pressable
        key={kind}
        accessibilityRole={enabled ? "link" : "text"}
        accessibilityLabel={`${t(label, language)}: ${display || t("Not added", language)}`}
        accessibilityHint={enabled ? t(hint, language) : undefined}
        accessibilityState={{ disabled: !enabled }}
        onPress={(event) => {
          event.stopPropagation();
          if (enabled) void openCustomerContact(kind, value);
        }}
        style={({ pressed }) => [
          detailRows ? styles.detailRow : styles.row,
          detailRows
            ? { borderBottomWidth: index < visibleFields.length - 1 ? StyleSheet.hairlineWidth : 0, borderBottomColor: "#E2E8F0" }
            : { backgroundColor: theme.backgroundColor, borderColor: theme.borderColor },
          !enabled && { opacity: 0.55 },
          inverse && { borderWidth: 2 },
          pressed && enabled && { opacity: 0.6 },
        ]}
      >
        {detailRows ? <View style={[styles.detailIcon, { backgroundColor: theme.backgroundColor, borderColor: theme.borderColor }]}>
          <Icon name={icon} size={20} color={theme.icon} />
        </View> : <Icon name={icon} size={18} color={theme.icon} />}
        {detailRows ? <View style={styles.detailCopy}>
            <Text style={styles.detailLabel}>{t(label, language)}</Text>
            <Text style={styles.profileValue}>{display || t("Not added", language)}</Text>
          </View> :
          <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}
            style={[styles.buttonLabel, { color: theme.text }]}>{shortLabel}</Text>
        }
      </Pressable>;
    })}
    </View>
    {!compact && !detailRows && <View style={styles.details}>
      {fields.map(({ kind, label, value }) => <View key={kind} style={styles.detail}>
        <Text style={s.small}>{label}</Text>
        <Text style={[s.rowTitle, styles.detailValue]}>{typeof value === "string" && value.trim() ? value.trim() : "Not added"}</Text>
      </View>)}
    </View>}
  </View>;
}

const styles = StyleSheet.create({
  container: { width: "100%", minWidth: 0 },
  actions: { flexDirection: "row", flexWrap: "nowrap", gap: 4, width: "100%", minWidth: 0 },
  row: { flex: 1, minWidth: 0, alignItems: "center", justifyContent: "center", gap: 3, minHeight: 48, paddingVertical: 5, paddingHorizontal: 2, borderRadius: 10, borderWidth: 1 },
  buttonLabel: { fontSize: 10, fontWeight: "600", textAlign: "center", width: "100%" },
  detailRows: { width: "100%", minWidth: 0, paddingHorizontal: 12, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#E2E8F0", borderRadius: 12 },
  detailRow: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 68, paddingVertical: 10, paddingHorizontal: 2 },
  detailIcon: { width: 40, height: 40, flexShrink: 0, alignItems: "center", justifyContent: "center", borderRadius: 12, borderWidth: 1 },
  detailCopy: { flex: 1, minWidth: 0, gap: 3 },
  detailLabel: { color: "#64748B", fontSize: 12, lineHeight: 17, fontWeight: "600" },
  profileValue: { color: "#1E293B", fontSize: 15, lineHeight: 21, fontWeight: "600", flexShrink: 1 },
  details: { gap: 8, marginTop: 10 },
  detail: { minWidth: 0 },
  detailValue: { flexShrink: 1 },
});
