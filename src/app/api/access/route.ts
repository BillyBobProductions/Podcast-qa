import { NextResponse } from "next/server";

import { ACCESS_CODE_ENV, ACCESS_COOKIE_NAME } from "@/lib/access";

const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 14;

function normalizedPath(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/")) {
    return "/";
  }

  return value;
}

export async function POST(request: Request) {
  const expectedCode = process.env[ACCESS_CODE_ENV]?.trim();
  if (!expectedCode) {
    return NextResponse.json(
      { error: "ACCESS_CODE is not configured on the server." },
      { status: 500 },
    );
  }

  const contentType = request.headers.get("content-type") ?? "";
  let submittedCode = "";
  let nextPath = "/";

  if (contentType.includes("application/json")) {
    const body = (await request.json().catch(() => null)) as
      | { code?: unknown; next?: unknown }
      | null;
    submittedCode = typeof body?.code === "string" ? body.code.trim() : "";
    nextPath = normalizedPath(body?.next);
  } else {
    const form = await request.formData();
    submittedCode = String(form.get("code") ?? "").trim();
    nextPath = normalizedPath(form.get("next"));
  }

  if (submittedCode !== expectedCode) {
    const failedUrl = new URL("/access", request.url);
    failedUrl.searchParams.set("error", "1");
    if (nextPath !== "/") {
      failedUrl.searchParams.set("next", nextPath);
    }
    return NextResponse.redirect(failedUrl, { status: 303 });
  }

  const response = NextResponse.redirect(new URL(nextPath, request.url), {
    status: 303,
  });
  response.cookies.set(ACCESS_COOKIE_NAME, `ok:${expectedCode}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
    maxAge: COOKIE_MAX_AGE_SECONDS,
  });
  return response;
}

export async function DELETE(request: Request) {
  const response = NextResponse.redirect(new URL("/access", request.url), {
    status: 303,
  });
  response.cookies.delete(ACCESS_COOKIE_NAME);
  return response;
}
