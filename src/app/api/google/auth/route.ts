import { getAuthUrl, isConfigured } from "@/lib/google-token";

export const dynamic = "force-dynamic";

/**
 * GET /api/google/auth — redirects to Google OAuth consent screen
 */
export async function GET() {
  if (!isConfigured()) {
    return Response.json(
      { error: "Google OAuth not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env.local" },
      { status: 500 }
    );
  }

  const authUrl = getAuthUrl();
  return Response.redirect(authUrl);
}
