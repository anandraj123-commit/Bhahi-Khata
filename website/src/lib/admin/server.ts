import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import type { AdminSession, Envelope } from "../../types/admin";
export function serverConfig() {
  const base = process.env.EXPRESS_ADMIN_API_URL;
  const origin = process.env.ADMIN_FRONTEND_ORIGIN;
  const secret = process.env.ADMIN_PROXY_SECRET;
  if (!base || !origin || !secret || secret.length < 32)
    throw new Error("Admin server configuration unavailable");
  const url = new URL(base);
  const site = new URL(origin);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname.replace(/\/$/, "") !== "/api/v1/admin" ||
    site.origin !== origin ||
    !["http:", "https:"].includes(url.protocol) ||
    (process.env.NODE_ENV === "production" &&
      (url.protocol !== "https:" || site.protocol !== "https:"))
  )
    throw new Error("Invalid admin server configuration");
  return { base: base.replace(/\/$/, ""), origin, secret };
}
export const getAdminSession = cache(async (): Promise<AdminSession | null> => {
  const cookie = (await cookies()).get("dk_admin_session")?.value;
  if (!cookie) return null;
  const config = serverConfig();
  const result = await fetch(`${config.base}/auth/me`, {
    headers: {
      Cookie: `dk_admin_session=${cookie}`,
      "x-admin-proxy-key": config.secret,
      "x-admin-origin": config.origin,
    },
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  if (result.status === 401) return null;
  if (!result.ok) throw new Error("Admin service unavailable");
  return ((await result.json()) as Envelope<AdminSession>).data;
});
export async function requireAdmin(permission?: string) {
  const session = await getAdminSession();
  if (!session) redirect("/admin/login");
  if (permission && !session.permissions.includes(permission))
    redirect("/admin/settings?access=denied");
  return session;
}
