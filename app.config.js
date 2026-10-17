const config = require("./app.json");

// EAS profiles are authoritative when present: preview APKs need cleartext
// access to a developer's local HTTP API, while production remains HTTPS-only.
const production = process.env.EAS_BUILD_PROFILE
  ? process.env.EAS_BUILD_PROFILE === "production"
  : process.env.NODE_ENV === "production";

module.exports = {
  ...config,
  expo: {
    ...config.expo,
    plugins: [
      ...(config.expo.plugins || []),
      ["./plugins/withAndroidCleartextTraffic", { enabled: !production }],
    ],

    extra: {
      ...config.expo.extra,
      eas: {
        ...config.expo.extra?.eas,
        projectId: "b6481fb5-2718-4072-b12f-c958a4d7f019",
      },
      appMode: process.env.APP_MODE || (production ? "production" : "development"),
      buildProfile: process.env.EAS_BUILD_PROFILE || "not exposed",
      cleartextHttpPermitted: !production,
      connectivityDiagnosticsEnabled: !production,
    },

    android: {
      ...config.expo.android,
      usesCleartextTraffic: !production,
    },
  },
};
