import Constants, { ExecutionEnvironment } from "expo-constants";

export const isExpoGo =
  Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

export async function loadNotifications() {
  if (isExpoGo) {
    const localNotifications = await import("./expoGoNotifications");
    return localNotifications.loadExpoGoNotifications();
  }

  // Keep the package entry point out of Expo Go: it initializes automatic
  // device push-token registration as a module side effect.
  return import("expo-notifications");
}

// EAS app configuration is authoritative when no explicit public override exists.
export function notificationProjectId() {
  return (
    process.env.EXPO_PUBLIC_EAS_PROJECT_ID ||
    Constants.easConfig?.projectId ||
    Constants.expoConfig?.extra?.eas?.projectId
  );
}
