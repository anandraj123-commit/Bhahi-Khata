import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
const fixture = JSON.parse(
  await readFile("/tmp/dk-admin-browser-fixture.json", "utf8"),
);
const backendPort = Number(process.env.ADMIN_TEST_PORT || 4100);
const nextCommand = process.env.ADMIN_TEST_NEXT_COMMAND === "start" ? "start" : "dev";
const child = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    nextCommand,
    "--hostname",
    "127.0.0.1",
    "--port",
    "3100",
  ],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      EXPRESS_ADMIN_API_URL: `http://127.0.0.1:${backendPort}/api/v1/admin`,
      ADMIN_FRONTEND_ORIGIN: "http://127.0.0.1:3100",
      ADMIN_PROXY_SECRET: fixture.proxySecret,
    },
  },
);
process.on("SIGINT", () => child.kill("SIGINT"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
child.on("exit", (code) => process.exit(code || 0));
