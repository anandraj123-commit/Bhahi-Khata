import React, { useMemo, useState } from "react";
import { Modal, Pressable, StyleSheet, View } from "react-native";
import { Text, t } from "./i18n";
import { Button, colors, Icon } from "./ui";
import { localeTag } from "./locales";

type Props = { visible: boolean; value: string; language: string; title: string; onClose: () => void; onSelect: (date: string) => void };

export function ReportDatePicker({ visible, value, language, title, onClose, onSelect }: Props) {
  const initial = useMemo(() => {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return match ? new Date(Number(match[1]), Number(match[2]) - 1, 1) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  }, [value]);
  const [month, setMonth] = useState(initial);
  React.useEffect(() => { if (visible) setMonth(initial); }, [visible, initial]);
  const firstWeekday = new Date(month.getFullYear(), month.getMonth(), 1).getDay();
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const chosen = (day: number) => `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
    <View style={styles.overlay}><View style={styles.dialog}>
      <View style={styles.header}><Text style={styles.title}>{t(title, language)}</Text><Pressable accessibilityRole="button" accessibilityLabel={t("Close", language)} onPress={onClose} hitSlop={8}><Icon name="close" color={colors.dark} /></Pressable></View>
      <View style={styles.month}><Pressable accessibilityRole="button" accessibilityLabel={t("Previous month", language)} onPress={() => setMonth((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))} hitSlop={8}><Icon name="chevron-back" color={colors.dark} /></Pressable><Text style={styles.monthText}>{month.toLocaleDateString(localeTag(language), { month: "long", year: "numeric" })}</Text><Pressable accessibilityRole="button" accessibilityLabel={t("Next month", language)} onPress={() => setMonth((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))} hitSlop={8}><Icon name="chevron-forward" color={colors.dark} /></Pressable></View>
      <View style={styles.grid}>{Array.from({ length: 7 }, (_, index) => {
        const weekday = new Date(2024, 0, 7 + index).toLocaleDateString(localeTag(language), { weekday: "short" });
        return <Text key={`weekday-${index}`} style={styles.weekday}>{weekday}</Text>;
      })}{Array.from({ length: firstWeekday }, (_, index) => <View key={`blank-${index}`} style={styles.dayCell} />)}{Array.from({ length: days }, (_, index) => {
        const day = index + 1;
        const date = chosen(day);
        const selected = date === value;
        return <Pressable key={date} accessibilityRole="button" accessibilityLabel={date} accessibilityState={{ selected }} onPress={() => onSelect(date)} style={[styles.dayCell, selected && styles.selectedDay]}><Text style={[styles.dayText, selected && styles.selectedText]}>{day}</Text></Pressable>;
      })}</View>
      <Button title={t("Cancel", language)} secondary onPress={onClose} />
    </View></View>
  </Modal>;
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(15,23,42,0.4)", justifyContent: "center", padding: 20 },
  dialog: { backgroundColor: "white", borderRadius: 16, padding: 16, gap: 14 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { color: colors.dark, fontWeight: "800", fontSize: 17 },
  month: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 10 },
  monthText: { color: colors.dark, fontWeight: "700" },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  weekday: { width: "14.2857%", height: 34, textAlign: "center", textAlignVertical: "center", color: colors.muted, fontSize: 11, fontWeight: "700" },
  dayCell: { width: "14.2857%", height: 42, alignItems: "center", justifyContent: "center", borderRadius: 21 },
  dayText: { color: colors.dark },
  selectedDay: { backgroundColor: colors.green },
  selectedText: { color: "white", fontWeight: "800" },
});
