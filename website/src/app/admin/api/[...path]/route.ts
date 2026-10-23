import { NextRequest, NextResponse } from "next/server";
import { serverConfig } from "../../../../lib/admin/server";
const allowed =
  /^(auth\/(login|logout|me|reauth|forgot-password|reset-password)|dashboard|shops(?:\/[a-f\d]{24}(?:\/customers)?)?|customers(?:\/[a-f\d]{24}(?:\/(financial-summary|transactions|statement))?)?|customer-shops|plans|plans\/[a-f\d]{24}(?:\/customer-limit)?|subscriptions|payments|administrators(?:\/[a-f\d]{24})?|reports(?:\/export)?|audit-logs|settings(?:\/(profile|password|sessions\/[a-f\d]{24}))?)$/i;
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
    let body: string | undefined;
    if (!["GET", "HEAD"].includes(req.method)) {
      if (req.headers.get("content-type")?.split(";")[0] !== "application/json")
        return failure(415, "ADMIN_CONTENT_TYPE", "JSON is required");
      const reader = req.body?.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      if (reader)
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.length;
          if (size > 32768) {
            await reader.cancel();
            return failure(413, "ADMIN_BODY_TOO_LARGE", "Request is too large");
          }
          chunks.push(part.value);
        }
      body = Buffer.concat(chunks).toString("utf8") || "{}";
      headers["Content-Type"] = "application/json";
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
