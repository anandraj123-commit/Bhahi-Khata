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
test("customer lifecycle list, search, detail and shop-scoped customer list render real records", async ({ browser }) => {
  const context = await browser.newContext({ storageState: state });
  const page = await context.newPage();
  await page.goto("/admin/customers");
  await expect(page.getByRole("heading", { name: "Customers", exact: true })).toBeVisible();
  await page.getByLabel("Find shop").fill(`Admin Test ${fixture.run} 00`);
  await page.getByLabel("Shop", { exact: true }).selectOption({ label: `Admin Test ${fixture.run} 00` });
  await expect(page.getByText("4 records · Page 1 of 1")).toBeVisible();
  await expect(page.locator("tbody tr")).toHaveCount(4);
  await expect(page.getByText("Total customers")).toBeVisible();
  await page.getByLabel("Lifecycle").selectOption("removed");
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await page.getByLabel("Lifecycle").selectOption("");
  await page.getByRole("textbox", { name: "Search customers" }).fill("Customer Active");
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await page.getByRole("link", { name: "View", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Customer Active", exact: false })).toBeVisible();
  await page.goto(`/admin/shops/${fixture.shopId}`);
  await expect(page.getByRole("heading", { name: "Customers", exact: true })).toBeVisible();
  await expect(page.getByText("4 customers · Page 1 of 1")).toBeVisible();
  const customerSection = page.locator("section.a-card").filter({
    has: page.getByRole("heading", { name: "Customers", exact: true }),
  });
  await expect(customerSection.locator("tbody tr")).toHaveCount(4);
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
test("customer API errors stay errors instead of becoming an empty state", async ({ browser }) => {
  const context = await browser.newContext({ storageState: state });
  const page = await context.newPage();
  await page.route("**/admin/api/customers?*", (route) => route.fulfill({
    status: 503,
    json: { error: { code: "TEST_UNAVAILABLE", message: "Customer service unavailable" } },
  }));
  await page.goto("/admin/customers");
  await expect(page.getByRole("alert").filter({ hasText: "Customer service unavailable" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "No customers found" })).toHaveCount(0);
  await context.close();
});
test("subscription page stays stable, prices recalculate, and unsaved edits survive refresh", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const runtimeErrors: string[] = [];
  let planRequests = 0;
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  page.on("request", (request) => {
    if (request.method() === "GET" && /\/admin\/api\/plans(?:\?|$)/.test(request.url())) planRequests += 1;
  });
  await page.goto("/admin/login");
  await page.getByLabel("Username (email)").fill(fixture.email);
  await page.getByLabel("Password", { exact: true }).fill(fixture.password);
  await page.getByRole("button", { name: "Sign in securely" }).click();
  await expect(page.getByRole("heading", { name: "Platform overview" })).toBeVisible();
  await page.getByRole("link", { name: "Subscriptions", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Subscriptions", exact: true })).toBeVisible();
  const initialPro = page.locator(".a-card").filter({ has: page.getByRole("heading", { name: "Pro", exact: true }) });
  await expect(initialPro.getByRole("button", { name: "Edit plan and pricing" })).toBeDisabled();
  await expect(initialPro.getByRole("status")).toContainText("Confirm your identity in Settings");
  await page.locator(".a-sidebar").getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByLabel("Current password").fill(fixture.password);
  await page.getByRole("button", { name: "Verify identity" }).click();
  await expect(page.getByRole("button", { name: /Verified/ })).toBeVisible();
  await page.locator(".a-sidebar").getByRole("link", { name: "Subscriptions", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Subscriptions", exact: true })).toBeVisible();
  const freePlan = page.locator(".a-card").filter({
    has: page.getByRole("heading", { name: "Free", exact: true }),
  });
  await expect(freePlan).toContainText("50 customers");
  const proPlan = page.locator(".a-card").filter({
    has: page.getByRole("heading", { name: "Pro", exact: true }),
  });
  await expect(proPlan.getByRole("row")).toHaveCount(5);
  await expect(proPlan.getByRole("button", { name: "Edit plan and pricing" })).toBeEnabled();
  await page.reload();
  await expect(page.locator(".a-card").filter({ has: page.getByRole("heading", { name: "Pro", exact: true }) }).getByRole("button", { name: "Edit plan and pricing" })).toBeEnabled();
  await proPlan.getByRole("button", { name: "Edit plan and pricing" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit Pro plan" });
  const monthlyPrice = dialog.getByLabel("Monthly base price in rupees");
  const monthlyDiscount = dialog.getByLabel("Monthly discount percentage");
  const monthlyTax = dialog.getByLabel("Monthly tax percentage");
  const originalPrice = await monthlyPrice.inputValue();
  const originalDiscount = await monthlyDiscount.inputValue();
  const originalTax = await monthlyTax.inputValue();
  const monthlyRow = dialog.locator("tbody tr").filter({ hasText: "Monthly" });
  await monthlyDiscount.fill("0");
  await monthlyTax.fill("0");
  await monthlyPrice.fill("249.00");
  await expect(monthlyRow.locator("td").nth(6)).toHaveText("₹249.00");
  await monthlyDiscount.fill("10");
  await expect(monthlyRow.locator("td").nth(6)).toHaveText("₹224.10");
  await monthlyTax.fill("5");
  await expect(monthlyRow.locator("td").nth(6)).toHaveText("₹235.31");
  await page.getByRole("button", { name: "Save Changes" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(proPlan).toContainText("₹235.31");
  await page.waitForTimeout(2500);
  expect(runtimeErrors.filter((message) => message.includes("Maximum update depth exceeded"))).toEqual([]);
  expect(planRequests).toBeLessThan(5);

  await page.reload();
  const reloadedProPlan = page.locator(".a-card").filter({
    has: page.getByRole("heading", { name: "Pro", exact: true }),
  });
  await expect(reloadedProPlan).toContainText("₹235.31");

  await reloadedProPlan.getByRole("button", { name: "Edit plan and pricing" }).click();
  const refreshedDialog = page.getByRole("dialog", { name: "Edit Pro plan" });
  const unsavedPrice = refreshedDialog.getByLabel("Monthly base price in rupees");
  await unsavedPrice.fill("300.00");
  await expect(refreshedDialog.locator("tbody tr").filter({ hasText: "Monthly" }).locator("td").nth(6)).toHaveText("₹283.50");
  await page.waitForTimeout(16000);
  const beforeRefresh = planRequests;
  const otherPage = await context.newPage();
  await otherPage.goto("/admin");
  await page.bringToFront();
  await page.evaluate(() => window.dispatchEvent(new Event("visibilitychange")));
  await expect.poll(() => planRequests, { timeout: 20000 }).toBeGreaterThan(beforeRefresh);
  await expect(unsavedPrice).toHaveValue("300.00");
  await expect(refreshedDialog.locator("tbody tr").filter({ hasText: "Monthly" }).locator("td").nth(6)).toHaveText("₹283.50");
  await page.getByRole("button", { name: "Cancel" }).click();
  await otherPage.close();

  await reloadedProPlan.getByRole("button", { name: "Edit plan and pricing" }).click();
  const restoreDialog = page.getByRole("dialog", { name: "Edit Pro plan" });
  await restoreDialog.getByLabel("Monthly base price in rupees").fill(originalPrice);
  await restoreDialog.getByLabel("Monthly discount percentage").fill(originalDiscount);
  await restoreDialog.getByLabel("Monthly tax percentage").fill(originalTax);
  await page.getByRole("button", { name: "Save Changes" }).click();
  await expect(restoreDialog).toHaveCount(0);
  await page.clock.install();
  await page.clock.fastForward(5 * 60_000 + 1000);
  await expect(reloadedProPlan.getByRole("button", { name: "Edit plan and pricing" })).toBeDisabled();
  await expect(reloadedProPlan.getByRole("status")).toContainText("identity verification has expired");
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
    .getByLabel("Work email", { exact: true })
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
