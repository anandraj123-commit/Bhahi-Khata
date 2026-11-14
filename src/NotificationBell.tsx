import React from "react";
import { Pressable, StyleSheet, View, Text } from "react-native";
import { colors, Icon } from "./ui";

export function NotificationBadge({ unread }: { unread: number }) {
  if (!Number.isSafeInteger(unread) || unread <= 0) return null;
  return <View pointerEvents="none" style={styles.badge}>
    <Text accessibilityLabel={`${unread} unread notifications`} allowFontScaling={false} style={styles.count}>{unread > 99 ? "99+" : String(unread)}</Text>
  </View>;
}
export function NotificationBell({ unread, onPress }: { unread: number; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={`Notifications${unread > 0 ? `, ${unread} unread` : ""}`}
    onPress={onPress} style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
    <View style={styles.icon}><Icon name="notifications-outline" size={24} color={colors.green} /><NotificationBadge unread={unread} /></View>
  </Pressable>;
}
const styles = StyleSheet.create({
  button: { width: 52, height: 48, alignItems: "center", justifyContent: "center", borderRadius: 12, overflow: "visible" },
  pressed: { backgroundColor: colors.pale },
  icon: { position: "relative", overflow: "visible" },
  badge: { position: "absolute", top: -9, right: -9, zIndex: 1, elevation: 2, minWidth: 20, height: 20, paddingHorizontal: 4, borderRadius: 10, backgroundColor: colors.red, alignItems: "center", justifyContent: "center" },
  count: { color: "#ffffff", fontSize: 11, lineHeight: 16, includeFontPadding: false, textAlignVertical: "center", textAlign: "center", fontWeight: "700" },
});
