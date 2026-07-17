/**
 * Jira auth management API route.
 *
 * GET  /api/jira/auth         — Get auth status
 * POST /api/jira/auth         — Authenticate with cookies or trigger Chrome extraction
 * DELETE /api/jira/auth       — Clear saved auth
 */

import { NextRequest } from "next/server";
import {
  getAuthStatus,
  authenticateWithCookies,
  clearCookies,
  extractChromeCookies,
  validateCookies,
  saveCookies,
} from "@/lib/jira-auth";

export const dynamic = "force-dynamic";

/**
 * GET — Check current auth status.
 */
export async function GET() {
  const status = await getAuthStatus();
  return Response.json(status);
}

/**
 * POST — Authenticate.
 *
 * Body options:
 *   { cookies: "..." }   — Save and validate explicit cookies
 *   { action: "extract" } — Try Chrome cookie extraction
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Explicit cookie string provided
    if (body.cookies) {
      const user = await authenticateWithCookies(body.cookies);
      if (user) {
        return Response.json({
          authenticated: true,
          user: `${user.displayName} (${user.name})`,
          message: "Authentication successful",
        });
      }
      return Response.json(
        {
          authenticated: false,
          error: "Provided cookies are invalid or expired",
        },
        { status: 401 }
      );
    }

    // Chrome extraction
    if (body.action === "extract") {
      const extracted = extractChromeCookies();
      if (!extracted) {
        return Response.json(
          {
            authenticated: false,
            error:
              "Could not extract cookies from Chrome. Make sure Chrome is installed and you have visited jira.tools.sap recently.",
          },
          { status: 400 }
        );
      }

      const user = await validateCookies(extracted);
      if (user) {
        await saveCookies(extracted, user.displayName);
        return Response.json({
          authenticated: true,
          user: `${user.displayName} (${user.name})`,
          message: "Authentication successful (extracted from Chrome)",
        });
      }

      return Response.json(
        {
          authenticated: false,
          error:
            "Extracted Chrome cookies are stale. Please log into jira.tools.sap in Chrome first, then try again.",
        },
        { status: 401 }
      );
    }

    return Response.json(
      { error: 'Provide { cookies: "..." } or { action: "extract" }' },
      { status: 400 }
    );
  } catch (error: unknown) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Authentication failed" },
      { status: 500 }
    );
  }
}

/**
 * DELETE — Clear saved authentication.
 */
export async function DELETE() {
  await clearCookies();
  return Response.json({ cleared: true, message: "Jira auth cleared" });
}
