import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  isAuthoritativeSessionRejection,
  isTemporaryBackendFailure,
} from "../src/startupRecovery.ts";

test("temporary refresh and backend failures can restore an unexpired cached account", () => {
  for (const status of [429, 500, 502, 503]) assert.equal(isTemporaryBackendFailure(status), true);
  for (const status of [400, 401, 403, 404, 409]) assert.equal(isTemporaryBackendFailure(status), false);
  const api = readFileSync("src/api.ts", "utf8");
  const app = readFileSync("App.tsx", "utf8");
  assert.match(api, /refreshed\.kind === "unavailable"\)\s*throw new ApiError\("Could not restore the online session"/);
  assert.match(app, /error instanceof api\.ApiError && isTemporaryBackendFailure\(error\.status\)/);
});

test("only explicit 401 and 403 refresh responses invalidate the session", () => {
  for (const status of [401, 403]) assert.equal(isAuthoritativeSessionRejection(status), true);
  for (const status of [400, 404, 409, 429, 500, 503]) assert.equal(isAuthoritativeSessionRejection(status), false);
});

test("session restoration requests are distinguished from background queue synchronization", () => {
  const api = readFileSync("src/api.ts", "utf8");
  const app = readFileSync("App.tsx", "utf8");
  assert.match(api, /refresh\("session_restore"\)/);
  assert.match(api, /loadAccount\("session_restore"\)/);
  assert.match(api, /type RequestOrigin = "foreground" \| "session_restore" \| "offline_sync"/);
  assert.match(app, /location: failureLocation/);
  assert.match(app, /errorName: error instanceof Error \? error\.name/);
});
