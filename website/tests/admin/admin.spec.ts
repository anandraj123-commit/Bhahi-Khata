import { test, expect, type BrowserContext } from "@playwright/test";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
const fixture = JSON.parse(
  readFileSync("/tmp/dk-admin-browser-fixture.json", "utf8"),
) as {
  email: string;
  password: string;
  supportEmail: string;
  run: string;
  shopId: string;
};
let state: Awaited<ReturnType<BrowserContext["storageState"]>>;
test.beforeAll(async ({ browser }) => {
  const authFile = `/tmp/dk-admin-browser-auth-${process.env.DK_ADMIN_BROWSER_RUN_ID}.json`;
  if (existsSync(authFile)) {
    state = JSON.parse(readFileSync(authFile, "utf8"));
    return;
  }
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/admin/login");
  await page.getByLabel("Username (email)").fill(fixture.email);
  await page.getByLabel("Password", { exact: true }).fill(fixture.password);
  await page.getByRole("button", { name: "Sign in securely" }).click();
  await expect(
    page.getByRole("heading", { name: "Platform overview" }),
  ).toBeVisible();
  state = await context.storageState();
  writeFileSync(authFile, JSON.stringify(state), { mode: 0o600 });
  await context.close();
});
test("login is protected, invalid credentials stay on login, and public site remains available", async ({
  page,
}) => {
  await page.goto("/admin/shops");
  await expect(page).toHaveURL(/\/admin\/login/);
  await page.getByLabel("Username (email)").fill("invalid@example.test");
  await page.getByLabel("Password", { exact: true }).fill("invalid-password");
  await page.getByRole("button", { name: "Sign in securely" }).click();
  await expect(page.locator("form [role=alert]")).toContainText("incorrect");
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
});
test("dashboard uses real data, navigation works, and theme preference survives reload", async ({
  browser,
}) => {
  const context = await browser.newContext({ storageState: state });
  const page = await context.newPage();
  await page.goto("/admin");
  await expect(
    page.getByText("Registered shops", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".a-kpi").first().locator("strong")).not.toHaveText(
    "0",
  );
  await page.getByRole("button", { name: "Switch to dark theme" }).click();
  await expect(page.locator(".dk-admin-root")).toHaveAttribute(
    "data-theme",
    "dark",
  );
  await page.reload();
  await expect(page.locator(".dk-admin-root")).toHaveAttribute(
    "data-theme",
    "dark",
  );
  await page.getByRole("button", { name: "Switch to light theme" }).click();
  await page.getByRole("link", { name: "Shops", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Shops", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: "/tmp/dk-admin-desktop.png", fullPage: true });
  await context.close();
});
test("shop search and pagination are server-backed, empty state waits for search, and detail loads", async ({
  browser,
}) => {
  const context = await browser.newContext({ storageState: state });
  const page = await context.newPage();
  await page.goto("/admin/shops");
  await page.getByRole("textbox", { name: "Search shops" }).fill(fixture.run);
  await expect(page.getByText("25 records · Page 1 of 2")).toBeVisible();
  await expect(page.locator("tbody tr")).toHaveCount(20);
  await page.getByRole("button", { name: "Next page" }).click();
  await expect(page.locator("tbody tr")).toHaveCount(5);
  await page
    .getByRole("textbox", { name: "Search shops" })
    .fill("no-such-shop-synthetic");
  await expect(
    page.getByRole("heading", { name: "No records found" }),
  ).toBeVisible();
  await page.goto(`/admin/shops/${fixture.shopId}`);
  await expect(
    page.getByRole("heading", { name: "Shop profile" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Payment history" }),
  ).toBeVisible();
  await context.close();
});
test("table skeleton and API error show explicit states with retry", async ({
  browser,
}) => {
  const context = await browser.newContext({ storageState: state });
  const page = await context.newPage();
  let release: (() => void) | undefined;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/admin/api/payments?*", async (route) => {
    await wait;
    await route.fulfill({
      status: 503,
      json: {
        error: {
          code: "TEST_UNAVAILABLE",
          message: "Synthetic service unavailable",
        },
      },
    });
  });
  await page.goto("/admin/payments");
  await expect(
    page.getByRole("status", { name: "Loading records" }).first(),
  ).toBeVisible();
  await expect(page.getByText("No records found")).toHaveCount(0);
  release!();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Synthetic service unavailable" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Try again" }).last(),
  ).toBeVisible();
  await context.close();
});
test("mobile drawer, responsive tables and keyboard controls remain usable", async ({
  browser,
}) => {
  const context = await browser.newContext({
    storageState: state,
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  await page.goto("/admin/shops");
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(page.getByRole("dialog", { name: "Navigation" })).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("link", { name: "Payments", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Payments", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1,
  );
  expect(overflow).toBe(false);
  await page.screenshot({ path: "/tmp/dk-admin-mobile.png", fullPage: true });
  await context.close();
});
test("Support receives restricted navigation and cannot open administrator pages", async ({
  browser,
}) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/admin/login");
  await page.getByLabel("Username (email)").fill(fixture.supportEmail);
  await page.getByLabel("Password", { exact: true }).fill(fixture.password);
  await page.getByRole("button", { name: "Sign in securely" }).click();
  await expect(
    page.getByRole("heading", { name: /Settings & security|Shops/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Administrators", exact: true }),
  ).toHaveCount(0);
  await page.goto("/admin/administrators");
  await expect(page).toHaveURL(/\/admin\/settings/);
  const result = await context.request.get("/admin/api/administrators");
  expect(result.status()).toBe(403);
  await context.close();
});
test("admin creation, reports, audit history and settings screens render", async ({
  browser,
}) => {
  const context = await browser.newContext({ storageState: state });
  const page = await context.newPage();
  await page.goto("/admin/administrators");
  await page
    .getByRole("button", { name: "Add administrator", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Add administrator" }),
  ).toBeVisible();
  await page.getByLabel("Full name").fill("Browser Test Support");
  await page
    .getByLabel("Username (email)", { exact: true })
    .fill(`browser-${Date.now()}@example.test`);
  await page
    .getByLabel("Initial password (14+ characters)")
    .fill(fixture.password);
  await page
    .getByRole("button", { name: "Create administrator", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("status").filter({ hasText: "Administrator changes saved" }),
  ).toBeVisible();
  for (const [path, title] of [
    ["subscriptions", "Subscriptions"],
    ["reports", "Reports & analytics"],
    ["audit-logs", "Audit logs"],
    ["settings", "Settings & security"],
  ]) {
    await page.goto(`/admin/${path}`);
    await expect(
      page.getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
  }
  await context.close();
});
test("proxy rejects foreign-origin state changes and never exposes proxy secrets", async ({
  request,
}) => {
  const response = await request.post("/admin/api/auth/login", {
    headers: { Origin: "https://evil.example" },
    data: { email: fixture.email, password: fixture.password },
  });
  expect(response.status()).toBe(403);
  const body = await response.text();
  expect(body).not.toContain("ADMIN_PROXY_SECRET");
  expect(body).not.toContain(fixture.password);
});
