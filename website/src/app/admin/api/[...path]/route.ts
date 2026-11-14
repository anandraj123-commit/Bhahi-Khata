import imagePolicy from "../../../../../../shared/notificationImagePolicy.json";
import { NextRequest, NextResponse } from "next/server";
import { serverConfig } from "../../../../lib/admin/server";
const allowed =
  /^(auth\/(login|logout|me|reauth|forgot-password|reset-password)|dashboard|shops(?:\/[a-f\d]{24}(?:\/(customers|financial-overview|financial-records))?)?|customers(?:\/[a-f\d]{24}(?:\/(financial-summary|transactions|statement))?)?|transactions(?:\/[a-f\d]{24})?|customer-shops|plans|plans\/[a-f\d]{24}(?:\/customer-limit)?|subscriptions|payments(?:\/[a-f\d]{24})?|payment-orders(?:\/[a-f\d]{24}(?:\/(reconcile|records))?)?|payment-recovery-events|payment-recovery-snapshots|payment-refunds|notifications(?:\/(recipients|[a-f\d]{24}(?:\/soft-delete)?))?|notification-media(?:\/[a-f\d]{24})?|payment-health|payment-monitoring\/(attempts|webhooks|recoveries|refunds)|administrators(?:\/[a-f\d]{24})?|reports(?:\/export)?|audit-logs|referrals\/settings|settings(?:\/(profile|password|sessions\/[a-f\d]{24}))?)$/i;
function failure(status: number, code: string, message: string) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}
async function proxy(
  req: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  const { path } = await context.params;
  const route = path.join("/");
  if (!allowed.test(route))
    return failure(404, "ADMIN_ROUTE_NOT_FOUND", "Endpoint not found");
  const mediaUpload = route === "notification-media" && req.method === "POST";
  if(route.startsWith("notification-media") && !((route === "notification-media" && req.method === "POST") || (req.method === "GET")))
    return failure(405,"ADMIN_METHOD_NOT_ALLOWED","Unsupported media operation");
  if (route.startsWith("notifications")) {
    const methods = route === "notifications" ? ["GET", "POST"] : route.endsWith("/soft-delete") ? ["POST"] : route.endsWith("/recipients") ? ["GET"] : ["GET", "PATCH"];
    if (!methods.includes(req.method)) return failure(405, "ADMIN_METHOD_NOT_ALLOWED", "Unsupported notification operation");
  }
  if (route.startsWith("transactions") && req.method !== "GET")
    return failure(405, "ADMIN_METHOD_NOT_ALLOWED", "This endpoint requires GET");
  if (/^payments\/[a-f\d]{24}$/i.test(route) && req.method !== "GET")
    return failure(405, "ADMIN_METHOD_NOT_ALLOWED", "This endpoint requires GET");
  if (route.startsWith("payment-")) {
    const method = /^payment-orders\/[a-f\d]{24}\/reconcile$/i.test(route)
      ? "POST"
      : "GET";
    if (req.method !== method)
      return failure(
        405,
        "ADMIN_METHOD_NOT_ALLOWED",
        `This endpoint requires ${method}`,
      );
  }
  try {
    const config = serverConfig();
    const origin = req.headers.get("origin");
    if (
      (origin && origin !== config.origin) ||
      (!["GET", "HEAD"].includes(req.method) && origin !== config.origin)
    )
      return failure(403, "ADMIN_ORIGIN_DENIED", "Request origin denied");
    if (req.headers.get("sec-fetch-site") === "cross-site")
      return failure(403, "ADMIN_ORIGIN_DENIED", "Request origin denied");
    const headers: Record<string, string> = {
      "x-admin-proxy-key": config.secret,
      "x-admin-origin": config.origin,
      Accept: "application/json",
    };
    const token = req.cookies.get("dk_admin_session")?.value;
    if (token && /^[a-f0-9]{64}$/.test(token))
      headers.Cookie = `dk_admin_session=${token}`;
    const csrf = req.headers.get("x-admin-csrf");
    if (csrf && /^[a-f0-9]{64}$/.test(csrf)) headers["x-admin-csrf"] = csrf;
    let body: string | Uint8Array<ArrayBuffer> | undefined;
    if (!["GET", "HEAD"].includes(req.method)) {
      if (mediaUpload ? !["image/jpeg","image/png","image/webp"].includes(req.headers.get("content-type")?.split(";")[0] || "") : req.headers.get("content-type")?.split(";")[0] !== "application/json")
        return failure(415, "ADMIN_CONTENT_TYPE", "JSON is required");
      const reader = req.body?.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      if (reader)
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.length;
          if (size > (mediaUpload ? 2097152 : /^notifications(?:\/[a-f\d]{24})?$/.test(route) && ["POST", "PATCH"].includes(req.method) ? imagePolicy.documentBytes : 32768)) {
            await reader.cancel();
            return failure(413, "ADMIN_BODY_TOO_LARGE", "Request is too large");
          }
          chunks.push(part.value);
        }
      body = mediaUpload ? new Uint8Array(Buffer.concat(chunks)) : Buffer.concat(chunks).toString("utf8") || "{}";
      if(mediaUpload && req.headers.has("x-notification-filename")) headers["x-notification-filename"] = req.headers.get("x-notification-filename")!.slice(0,1080);
      headers["Content-Type"] = mediaUpload ? req.headers.get("content-type")! : "application/json";
    }
    const upstream = await fetch(
      `${config.base}/${route}${req.nextUrl.search}`,
      {
        method: req.method,
        headers,
        body,
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(15000),
      },
    );
    const response = new NextResponse(await upstream.arrayBuffer(), {
      status: upstream.status,
      headers: {
        "Content-Type":
          upstream.headers.get("content-type") || "application/json",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
    for (const cookie of upstream.headers.getSetCookie())
      if (cookie.startsWith("dk_admin_session="))
        response.headers.append("Set-Cookie", cookie);
    for (const name of ["retry-after", "content-disposition", "x-request-id"]) {
      const value = upstream.headers.get(name);
      if (value) response.headers.set(name, value);
    }
    return response;
  } catch {
    return failure(
      503,
      "ADMIN_BACKEND_UNREACHABLE",
      "The administration service could not be reached. Try again shortly.",
    );
  }
}
export const GET = proxy;
export const POST = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
