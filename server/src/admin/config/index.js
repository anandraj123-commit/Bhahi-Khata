export const permissions = Object.freeze({
  SUPER_ADMIN: [
    "dashboard:read",
    "shops:read",
    "subscriptions:read",
    "payments:read",
    "reports:read",
    "audit:read",
    "administrators:manage",
  ],
  ADMIN: [
    "dashboard:read",
    "shops:read",
    "subscriptions:read",
    "payments:read",
    "reports:read",
    "audit:read",
  ],
  SUPPORT: ["shops:read"],
});
export const COOKIE = "dk_admin_session";
export const SESSION_MS = 8 * 60 * 60 * 1000;
export const IDLE_MS = 30 * 60 * 1000;
export const REAUTH_MS = 5 * 60 * 1000;
export function adminConfig() {
  const origins = (process.env.ADMIN_TRUSTED_ORIGINS || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  const proxySecret = process.env.ADMIN_PROXY_SECRET || "";
  const production = process.env.NODE_ENV === "production";
  if (
    proxySecret.length < 32 ||
    !origins.length ||
    origins.some((origin) => {
      try {
        const u = new URL(origin);
        return (
          u.origin !== origin ||
          (production && u.protocol !== "https:") ||
          !["https:", "http:"].includes(u.protocol)
        );
      } catch {
        return true;
      }
    })
  )
    throw Object.assign(new Error("Admin configuration unavailable"), {
      status: 503,
      code: "ADMIN_NOT_CONFIGURED",
    });
  return { origins, proxySecret, production };
}
export function effectivePermissions(admin, session) {
  return permissions[admin.role] || [];
}
