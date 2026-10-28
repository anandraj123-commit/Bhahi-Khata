import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

const cwd = new URL("../../", import.meta.url).pathname;
const cleanEnv = () => ({
  PATH: process.env.PATH || "",
  HOME: process.env.HOME || "",
  TMPDIR: process.env.TMPDIR || "/tmp",
});

function runNode(args, env = cleanEnv()) {
  return spawnSync(process.execPath, args, { cwd, env, encoding: "utf8" });
}

function appEnv(mode, overrides = {}) {
  const nodeEnv = { development: "development", testing: "test", production: "production" }[mode];
  const database = {
    development: "digital_khata_development",
    testing: "digital_khata_testing",
    production: "digital_khata_production",
  }[mode];
  return {
    APP_MODE: mode,
    NODE_ENV: nodeEnv,
    MONGODB_URI: `mongodb://localhost/${database}`,
    MONGODB_DB_NAME: database,
    JWT_SECRET: `test-only-${mode}-jwt-secret-0123456789abcdef`,
    CASHFREE_ENVIRONMENT: mode === "production" ? "production" : "sandbox",
    CASHFREE_CHECKOUT_ENABLED: "false",
    ...overrides,
  };
}

function importConfig(environment) {
  return runNode([
    "--input-type=module",
    "-e",
    "await import('./src/config/env.js'); console.log('valid')",
  ], { ...cleanEnv(), ...environment });
}

function runSelectedFile(file, { importConfigModule = true, overrides = {} } = {}) {
  const imports = importConfigModule
    ? "await import('./src/config/env.js'); console.log(JSON.stringify({mode:process.env.APP_MODE, nodeEnv:process.env.NODE_ENV, database:process.env.MONGODB_DB_NAME, cashfree:process.env.CASHFREE_ENVIRONMENT}))"
    : "console.log(JSON.stringify({mode:process.env.APP_MODE, nodeEnv:process.env.NODE_ENV, database:process.env.MONGODB_DB_NAME, cashfree:process.env.CASHFREE_ENVIRONMENT}))";
  return runNode([
    `--env-file=${file}`,
    "--import=./src/config/startupGuard.js",
    "--input-type=module",
    "-e",
    imports,
  ], { ...cleanEnv(), ...overrides });
}

test("each explicit environment file selects its matching mode without connecting to services", () => {
  for (const [file, expected] of [
    [".env.development", { mode: "development", nodeEnv: "development", database: "digital_khata_development", cashfree: "sandbox" }],
    [".env.testing", { mode: "testing", nodeEnv: "test", database: "digital_khata_testing", cashfree: "sandbox" }],
  ]) {
    const result = runSelectedFile(file);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout.trim()), expected);
  }

  const production = runSelectedFile(".env.production", { importConfigModule: false });
  assert.equal(production.status, 0, production.stderr);
  assert.deepEqual(JSON.parse(production.stdout.trim()), {
    mode: "production",
    nodeEnv: "production",
    database: "digital_khata_production",
    cashfree: "production",
  });
});

test("npm startup commands select exactly one matching configuration file", () => {
  const { scripts } = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
  assert.match(scripts.dev, /--env-file=\.env\.development/);
  assert.match(scripts["start:testing"], /--env-file=\.env\.testing/);
  assert.match(scripts["start:production"], /--env-file=\.env\.production/);
  for (const name of ["dev", "start:testing", "start:production"])
    assert.match(scripts[name], /startupGuard\.js/);
});

test("startup requires exactly one matching environment file and fails closed on conflicts", () => {
  const missingFile = runNode([
    "--env-file=.env.does-not-exist",
    "--import=./src/config/startupGuard.js",
    "--input-type=module",
    "-e",
    "console.log('started')",
  ]);
  assert.notEqual(missingFile.status, 0);

  const noFile = runNode([
    "--import=./src/config/startupGuard.js",
    "--input-type=module",
    "-e",
    "console.log('started')",
  ]);
  assert.notEqual(noFile.status, 0);
  assert.match(noFile.stderr, /exactly one explicit environment file/);

  const conflict = runSelectedFile(".env.development", { importConfigModule: false, overrides: { APP_MODE: "production" } });
  assert.notEqual(conflict.status, 0);
  assert.match(conflict.stderr, /Environment variable conflict for APP_MODE/);

  for (const overrides of [
    { MONGODB_DB_NAME: "digital_khata_production" },
    { CASHFREE_ENVIRONMENT: "production" },
  ]) {
    const result = runSelectedFile(".env.development", { importConfigModule: false, overrides });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Environment variable conflict for/);
  }

  const mixedFiles = runNode([
    "--env-file=.env.development",
    "--env-file=.env.testing",
    "--import=./src/config/startupGuard.js",
    "--input-type=module",
    "-e",
    "console.log('started')",
  ]);
  assert.notEqual(mixedFiles.status, 0);
  assert.match(mixedFiles.stderr, /exactly one explicit environment file/);
});

test("configuration requires an explicit APP_MODE and valid environment pairing", () => {
  const missing = appEnv("development");
  delete missing.APP_MODE;
  const missingResult = importConfig(missing);
  assert.notEqual(missingResult.status, 0);
  assert.match(missingResult.stderr, /APP_MODE must be development, testing, or production/);

  const invalid = importConfig(appEnv("development", { APP_MODE: "stage" }));
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /APP_MODE must be development, testing, or production/);

  const mismatchedNode = importConfig(appEnv("testing", { NODE_ENV: "development" }));
  assert.notEqual(mismatchedNode.status, 0);
  assert.match(mismatchedNode.stderr, /APP_MODE=testing requires NODE_ENV=test/);
});

test("MongoDB name and URI path are required and cannot cross environment databases", () => {
  for (const mode of ["development", "testing", "production"]) {
    const result = importConfig(appEnv(mode));
    assert.equal(result.status, 0, result.stderr);
  }

  const mismatch = importConfig(appEnv("testing", { MONGODB_DB_NAME: "digital_khata_production" }));
  assert.notEqual(mismatch.status, 0);
  assert.match(mismatch.stderr, /MONGODB_DB_NAME must be digital_khata_testing/);

  const uriMismatch = importConfig(appEnv("development", { MONGODB_URI: "mongodb://localhost/digital_khata_production" }));
  assert.notEqual(uriMismatch.status, 0);
  assert.match(uriMismatch.stderr, /MONGODB_URI database path must be digital_khata_development/);

  const missingUri = appEnv("development");
  delete missingUri.MONGODB_URI;
  const missingUriResult = importConfig(missingUri);
  assert.notEqual(missingUriResult.status, 0);
  assert.match(missingUriResult.stderr, /MONGODB_URI is required/);

  const missingName = appEnv("development");
  delete missingName.MONGODB_DB_NAME;
  const missingNameResult = importConfig(missingName);
  assert.notEqual(missingNameResult.status, 0);
  assert.match(missingNameResult.stderr, /MONGODB_DB_NAME must be digital_khata_development/);
});

test("Cashfree environment must explicitly match the selected application mode", () => {
  const missing = appEnv("development");
  delete missing.CASHFREE_ENVIRONMENT;
  const missingResult = importConfig(missing);
  assert.notEqual(missingResult.status, 0);
  assert.match(missingResult.stderr, /CASHFREE_ENVIRONMENT is required/);

  for (const [mode, cashfree] of [["development", "production"], ["testing", "production"], ["production", "sandbox"]]) {
    const result = importConfig(appEnv(mode, { CASHFREE_ENVIRONMENT: cashfree }));
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, new RegExp(`APP_MODE=${mode} requires CASHFREE_ENVIRONMENT=`));
  }
});

test("JWT remains mandatory and environment files use distinct development and testing secrets", () => {
  const missing = appEnv("development");
  delete missing.JWT_SECRET;
  const missingResult = importConfig(missing);
  assert.notEqual(missingResult.status, 0);
  assert.match(missingResult.stderr, /JWT_SECRET must contain at least 32 characters/);

  const short = importConfig(appEnv("development", { JWT_SECRET: "short" }));
  assert.notEqual(short.status, 0);
  assert.match(short.stderr, /JWT_SECRET must contain at least 32 characters/);

  const development = runSelectedFile(".env.development");
  const testing = runSelectedFile(".env.testing");
  assert.equal(development.status, 0, development.stderr);
  assert.equal(testing.status, 0, testing.stderr);
  assert.ok(existsSync(new URL("../../.env.development", import.meta.url)));
  assert.ok(existsSync(new URL("../../.env.testing", import.meta.url)));
});

test("production stays fail-closed until its database and JWT secrets are supplied", () => {
  const result = runSelectedFile(".env.production");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /MONGODB_URI is required|JWT_SECRET must contain at least 32 characters/);
});

test("the backend does not require a main .env file", () => {
  assert.equal(existsSync(new URL("../../.env", import.meta.url)), false);
  const result = runSelectedFile(".env.development");
  assert.equal(result.status, 0, result.stderr);
});
