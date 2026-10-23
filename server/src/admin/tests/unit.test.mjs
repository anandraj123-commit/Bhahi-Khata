import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "node:crypto";
import {
  hashPassword,
  verifyPassword,
  cookieToken,
  csrfToken,
  csvCell,
} from "../utils/security.js";
import { effectivePermissions } from "../config/index.js";
import { filters, createAdmin } from "../validators/index.js";
import {
  dateRange,
  activeSubscriptionMatch,
  subscriptionStatusMatch,
  literalSearch,
  verifiedRevenueMatch,
  netRevenue,
} from "../services/readModels.js";
test("scrypt verifies passwords without storing plaintext and rejects incorrect values", async () => {
  const password = randomBytes(24).toString("hex");
  const hash = await hashPassword(password);
  assert.ok(!hash.includes(password));
  assert.equal(await verifyPassword(password, hash), true);
  assert.equal(await verifyPassword("wrong", hash), false);
  assert.equal(await verifyPassword(password, undefined), false);
});
test("session cookie parser never accepts shopkeeper bearer credentials", () => {
  assert.equal(cookieToken("khata.access.v1=abc"), null);
  assert.equal(cookieToken("dk_admin_session=invalid"), null);
  const token = "a".repeat(64);
  assert.equal(cookieToken(`other=test; dk_admin_session=${token}`), token);
  assert.notEqual(csrfToken(token, "one"), csrfToken(token, "two"));
});
test("role matrix grants only the permissions assigned to each admin role", () => {
  assert.ok(
    effectivePermissions({ role: "SUPER_ADMIN" }, {}).includes(
      "administrators:manage",
    ),
  );
  assert.deepEqual(effectivePermissions({ role: "SUPPORT" }, {}), [
    "shops:read",
  ]);
  assert.ok(
    !effectivePermissions({ role: "ADMIN" }, {}).includes(
      "administrators:manage",
    ),
  );
  assert.deepEqual(effectivePermissions({ role: "SHOPKEEPER" }, {}), []);
});
test("strict validation bounds pagination, dates, passwords, and Mongo query injection", () => {
  for (const input of [
    { page: 1001 },
    { limit: 5000 },
    { q: { $ne: "" } },
    { from: "2025-02-30" },
    { from: "2026-10-02", to: "2026-10-01" },
    { unknown: "x" },
  ])
    assert.equal(filters.safeParse(input).success, false);
  assert.equal(filters.parse({}).limit, 20);
  assert.equal(
    createAdmin.safeParse({
      email: "admin@example.test",
      name: "Admin",
      role: "SUPER_ADMIN",
      password: "short",
    }).success,
    false,
  );
  assert.equal(literalSearch(".*"), "\\.\\*");
});
test("subscription and payment reporting follows effective dates and verified state only", () => {
  const now = new Date();
  assert.deepEqual(activeSubscriptionMatch(now).status.$in, [
    "active",
    "scheduled",
  ]);
  assert.equal(
    subscriptionStatusMatch("expiring", now).expiresAt.$lte.getTime(),
    now.getTime() + 30 * 86400000,
  );
  assert.throws(() => subscriptionStatusMatch("invalid"));
  assert.equal(verifiedRevenueMatch.verificationStatus, "verified");
  assert.ok(!verifiedRevenueMatch.status.$in.includes("pending"));
  assert.ok(netRevenue.$max);
});
test("date filters are UTC inclusive and CSV neutralizes formula injection", () => {
  const range = dateRange({ from: "2026-01-01", to: "2026-01-02" });
  assert.equal(range.createdAt.$lt.toISOString(), "2026-01-03T00:00:00.000Z");
  assert.equal(csvCell("=SUM(A1)"), '"\'=SUM(A1)"');
  assert.equal(csvCell('hello,"world"'), '"hello,""world"""');
});
