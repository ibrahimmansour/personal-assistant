import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export const runtime = "nodejs";

const SESSION_COOKIE_NAME = "pa_session";
const AUTH_FILE = join(homedir(), ".personal-assistant", "auth.json");

function getAuthData(): { passwordHash: string; salt: string } | null {
  try {
    const data = readFileSync(AUTH_FILE, "utf-8");
    return JSON.parse(data);
  } catch {
    return null;
  }
}

function isValidSession(cookieHeader: string | null, signingSecret: string): boolean {
  if (!cookieHeader) return false;
  const match = cookieHeader.match(new RegExp(`${SESSION_COOKIE_NAME}=([^;]+)`));
  if (!match) return false;

  const signed = match[1];
  const lastDot = signed.lastIndexOf(".");
  if (lastDot === -1) return false;

  const value = signed.substring(0, lastDot);
  const providedSig = signed.substring(lastDot + 1);
  const expectedSig = createHmac("sha256", signingSecret).update(value).digest("hex");

  try {
    const a = Buffer.from(providedSig, "hex");
    const b = Buffer.from(expectedSig, "hex");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

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

  // Always allow auth API and OAuth callbacks
  if (pathname === "/api/auth" || pathname.startsWith("/api/google/auth")) {
    return NextResponse.next();
  }

  const auth = getAuthData();

  // If no password set, redirect everything to /setup (except /setup itself)
  if (!auth) {
    if (pathname === "/setup") {
      return NextResponse.next();
    }
    return NextResponse.redirect(new URL("/setup", request.url));
  }

  // Password is configured — enforce auth
  if (pathname === "/setup") {
    return NextResponse.redirect(new URL("/", request.url));
  }

  if (pathname === "/login") {
    return NextResponse.next();
  }

  // Check session
  const cookieHeader = request.headers.get("cookie");
  if (!isValidSession(cookieHeader, auth.passwordHash)) {
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
