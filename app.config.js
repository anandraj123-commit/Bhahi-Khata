const config = require("./app.json");
const production =
  process.env.NODE_ENV === "production" ||
  process.env.EAS_BUILD_PROFILE === "production";

module.exports = {
  ...config,
  expo: {
    ...config.expo,
    android: {
      ...config.expo.android,
      usesCleartextTraffic: !production,
    },
  },
};
