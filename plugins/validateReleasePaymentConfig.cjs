function validateReleasePaymentConfig(env) {
  if (env.EAS_BUILD_PROFILE !== "production" && env.APP_MODE !== "production") return;
  let url;
  try { url = new URL(env.EXPO_PUBLIC_API_URL); } catch { /* Fail with a non-secret diagnostic below. */ }
  if (!url || url.protocol !== "https:" || url.username || url.password ||
      ["localhost", "127.0.0.1", "10.0.2.2", "[::1]"].includes(url.hostname))
    throw new Error("Production builds require an explicit HTTPS EXPO_PUBLIC_API_URL for the production backend");
}
module.exports = { validateReleasePaymentConfig };
