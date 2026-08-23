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

  // Keep local development simple if no access code is configured.
  if (!configuredCode) {
    return NextResponse.next();
  }

  const pathname = request.nextUrl.pathname;
  const currentCookie = request.cookies.get(ACCESS_COOKIE_NAME)?.value;
  const isAuthorized = currentCookie === configuredCode;

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
