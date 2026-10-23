const fs = require("node:fs/promises");
const path = require("node:path");
const { withAppBuildGradle, withDangerousMod } = require("@expo/config-plugins");

const MARKER = "# Digital Khata Cashfree checkout log redaction";
const PROGUARD_RULES = `${MARKER}
-assumenosideeffects class android.util.Log {
    public static int d(java.lang.String, java.lang.String);
    public static int d(java.lang.String, java.lang.String, java.lang.Throwable);
    public static int v(java.lang.String, java.lang.String);
    public static int v(java.lang.String, java.lang.String, java.lang.Throwable);
}
`;

function enableReleaseShrinking(contents) {
  const release = contents.match(/\brelease\s*\{[\s\S]*?\bminifyEnabled\s+([^\s]+)/);
  if (!release || release.index === undefined)
    throw new Error("Unable to safely configure Android release log redaction");
  const propertyOffset = release[0].lastIndexOf(`minifyEnabled ${release[1]}`);
  const start = release.index + propertyOffset;
  const end = start + `minifyEnabled ${release[1]}`.length;
  return `${contents.slice(0, start)}minifyEnabled true${contents.slice(end)}`;
}

function withCashfreeLogRedaction(config) {
  config = withAppBuildGradle(config, (mod) => {
    if (mod.modResults.language !== "groovy")
      throw new Error("Cashfree log redaction expects an Android Groovy Gradle file");
    mod.modResults.contents = enableReleaseShrinking(mod.modResults.contents);
    return mod;
  });
  return withDangerousMod(config, ["android", async (mod) => {
    const file = path.join(mod.modRequest.platformProjectRoot, "app", "proguard-rules.pro");
    let contents = "";
    try { contents = await fs.readFile(file, "utf8"); } catch { /* Generated on first prebuild. */ }
    if (!contents.includes(MARKER))
      await fs.writeFile(file, `${contents.trimEnd()}${contents ? "\n\n" : ""}${PROGUARD_RULES}`, "utf8");
    return mod;
  }]);
}

module.exports = withCashfreeLogRedaction;
module.exports.enableReleaseShrinking = enableReleaseShrinking;
module.exports.PROGUARD_RULES = PROGUARD_RULES;
