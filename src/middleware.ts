import { NextRequest, NextResponse } from "next/server";
import { isValidSession, isAuthEnabled, isPasswordConfigured } from "@/lib/auth";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow static assets and Next.js internals always
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.endsWith(".ico") ||
    pathname.endsWith(".svg")
  ) {
    return NextResponse.next();
  }

  // Always allow auth API
  if (pathname === "/api/auth") {
    return NextResponse.next();
  }

  const passwordConfigured = isPasswordConfigured();

  // If no password set, redirect everything to /setup (except /setup itself)
  if (!passwordConfigured) {
    if (pathname === "/setup") {
      return NextResponse.next();
    }
    return NextResponse.redirect(new URL("/setup", request.url));
  }

  // Password is configured — enforce auth
  if (pathname === "/setup") {
    // Don't allow setup page if password already exists
    return NextResponse.redirect(new URL("/", request.url));
  }

  if (pathname === "/login") {
    return NextResponse.next();
  }

  // Check session
  const cookieHeader = request.headers.get("cookie");
  if (!isValidSession(cookieHeader)) {
    if (pathname.startsWith("/api/")) {
      return new NextResponse(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
