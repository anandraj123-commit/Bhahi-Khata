/**
 * Expo Go supports local notifications, but importing the expo-notifications
 * package entry point also initializes remote push-token registration. Load
 * only the local APIs from their implementation modules in Expo Go.
 */
export async function loadExpoGoNotifications() {
  const [permissions, scheduled, cancel, schedule, handler, emitter, channel, channelTypes, notificationTypes] =
    await Promise.all([
      import("expo-notifications/build/NotificationPermissions"),
      import("expo-notifications/build/getAllScheduledNotificationsAsync"),
      import("expo-notifications/build/cancelScheduledNotificationAsync"),
      import("expo-notifications/build/scheduleNotificationAsync"),
      import("expo-notifications/build/NotificationsHandler"),
      import("expo-notifications/build/NotificationsEmitter"),
      import("expo-notifications/build/setNotificationChannelAsync"),
      import("expo-notifications/build/NotificationChannelManager.types"),
      import("expo-notifications/build/Notifications.types"),
    ]);

  return {
    ...permissions,
    ...scheduled,
    ...cancel,
    ...schedule,
    ...handler,
    ...emitter,
    ...channel,
    AndroidImportance: channelTypes.AndroidImportance,
    SchedulableTriggerInputTypes: notificationTypes.SchedulableTriggerInputTypes,
  } as unknown as typeof import("expo-notifications");
}
