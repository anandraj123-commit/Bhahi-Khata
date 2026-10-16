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
