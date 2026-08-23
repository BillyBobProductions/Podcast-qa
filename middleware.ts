import { NextRequest, NextResponse } from "next/server";

import { ACCESS_CODE_ENV, ACCESS_COOKIE_NAME } from "@/lib/access";

function isPublicPath(pathname: string): boolean {
  return (
    pathname === "/access" ||
    pathname === "/favicon.ico" ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api/access")
  );
}

export function middleware(request: NextRequest) {
  const configuredCode = process.env[ACCESS_CODE_ENV]?.trim();
  const pathname = request.nextUrl.pathname;

  // Fail closed when ACCESS_CODE is missing so the app is never accidentally public.
  if (!configuredCode) {
    if (isPublicPath(pathname)) {
      return NextResponse.next();
    }

    if (pathname.startsWith("/api")) {
      return NextResponse.json(
        { error: "Access gate is not configured on the server." },
        { status: 503 },
      );
    }

    const redirectUrl = new URL("/access", request.url);
    redirectUrl.searchParams.set("error", "misconfigured");
    return NextResponse.redirect(redirectUrl);
  }

  const currentCookie = request.cookies.get(ACCESS_COOKIE_NAME)?.value;
  const isAuthorized = currentCookie === `ok:${configuredCode}`;

  if (isPublicPath(pathname)) {
    if (pathname === "/access" && isAuthorized) {
      return NextResponse.redirect(new URL("/", request.url));
    }

    return NextResponse.next();
  }

  if (isAuthorized) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api")) {
    return NextResponse.json({ error: "Access code required." }, { status: 401 });
  }

  const redirectUrl = new URL("/access", request.url);
  redirectUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(redirectUrl);
}

export const config = {
  matcher: ["/:path*"],
};
