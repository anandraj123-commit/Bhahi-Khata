/** Language is a device presentation preference, not a versioned shop setting. */
export function shouldSyncShopSettings(before: {
  shop: unknown;
  defaultMethod: unknown;
  reminders: unknown;
}, after: {
  shop: unknown;
  defaultMethod: unknown;
  reminders: unknown;
}) {
  const serverSettings = (settings: typeof before) => ({
    shop: settings.shop,
    defaultMethod: settings.defaultMethod,
    reminders: settings.reminders,
  });
  return JSON.stringify(serverSettings(before)) !== JSON.stringify(serverSettings(after));
}
