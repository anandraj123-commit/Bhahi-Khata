import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "dotenv";

const modeFiles = Object.freeze({
  development: ".env.development",
  testing: ".env.testing",
  production: ".env.production",
});
const modeDatabase = Object.freeze({
  development: "digital_khata_development",
  testing: "digital_khata_testing",
  production: "digital_khata_production",
});
const modeNodeEnv = Object.freeze({
  development: "development",
  testing: "test",
  production: "production",
});
const modeCashfree = Object.freeze({
  development: "sandbox",
  testing: "sandbox",
  production: "production",
});
const requiredFileKeys = [
  "APP_MODE",
  "NODE_ENV",
  "MONGODB_URI",
  "MONGODB_DB_NAME",
  "JWT_SECRET",
  "CASHFREE_ENVIRONMENT",
];
const protectedKeys = [
  ...requiredFileKeys,
  "CASHFREE_CLIENT_ID",
  "CASHFREE_CLIENT_SECRET",
  "CASHFREE_WEBHOOK_SECRET",
];

function envFileArgument(execArgv) {
  const selected = [];
  for (let index = 0; index < execArgv.length; index += 1) {
    const arg = execArgv[index];
    if (arg === "--env-file") {
      selected.push(execArgv[index + 1] || "");
      index += 1;
    } else if (arg.startsWith("--env-file=")) {
      selected.push(arg.slice("--env-file=".length));
    } else if (arg.startsWith("--env-file-if-exists")) {
      throw new Error("Optional environment files are not permitted for backend startup");
    }
  }
  if (selected.length !== 1 || !selected[0])
    throw new Error("Start the backend with exactly one explicit environment file");
  return selected[0];
}

export function validateSelectedEnvironment({
  execArgv = process.execArgv,
  cwd = process.cwd(),
  environment = process.env,
  readFile = readFileSync,
} = {}) {
  const requested = resolve(cwd, envFileArgument(execArgv));
  const mode = Object.keys(modeFiles).find((candidate) =>
    requested === resolve(cwd, modeFiles[candidate]),
  );
  if (!mode) throw new Error("The selected environment file is not a supported backend configuration");

  let values;
  try {
    values = parse(readFile(requested));
  } catch {
    throw new Error(`Required environment file ${modeFiles[mode]} could not be read`);
  }

  for (const key of requiredFileKeys) {
    if (!Object.hasOwn(values, key))
      throw new Error(`${modeFiles[mode]} must explicitly define ${key}`);
  }
  if (values.APP_MODE !== mode)
    throw new Error(`${modeFiles[mode]} must set APP_MODE=${mode}`);
  if (values.NODE_ENV !== modeNodeEnv[mode])
    throw new Error(`${modeFiles[mode]} must set NODE_ENV=${modeNodeEnv[mode]}`);
  if (values.MONGODB_DB_NAME !== modeDatabase[mode])
    throw new Error(`${modeFiles[mode]} must set MONGODB_DB_NAME=${modeDatabase[mode]}`);
  if (values.CASHFREE_ENVIRONMENT !== modeCashfree[mode])
    throw new Error(`${modeFiles[mode]} must set CASHFREE_ENVIRONMENT=${modeCashfree[mode]}`);

  for (const key of new Set([...Object.keys(values), ...protectedKeys])) {
    const expected = values[key] ?? "";
    const effective = environment[key] ?? "";
    if (effective !== expected)
      throw new Error(`Environment variable conflict for ${key}; use values from ${modeFiles[mode]}`);
  }

  return { mode, file: modeFiles[mode], values };
}
