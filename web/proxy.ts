import { NextResponse, type NextRequest } from "next/server";
import { proxyEvents } from "@/lib/event-proxy";

/** Preserve the real browser host through the API rewrite; overwrite client-supplied forwarding headers. */
export async function proxy(request: NextRequest) {
  if (request.nextUrl.pathname === "/api/events") {
    return proxyEvents(request, process.env.BOTTEAM_API ?? "http://127.0.0.1:8899");
  }
  const headers = new Headers(request.headers);
  headers.set("x-forwarded-host", request.headers.get("host") ?? "");
  return NextResponse.next({ request: { headers } });
}

export const config = { matcher: "/api/:path*" };
