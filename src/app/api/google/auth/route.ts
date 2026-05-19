import { getAuthUrl, isConfigured } from "@/lib/google-token";

export const dynamic = "force-dynamic";

/**
 * GET /api/google/auth — redirects to Google OAuth consent screen
 */
export async function GET() {
  if (!(await isConfigured())) {
    return Response.json(
      { error: "Google OAuth not configured. Go to Settings to add your Google Client ID and Secret." },
      { status: 500 }
    );
  }

  const authUrl = await getAuthUrl();
  return Response.redirect(authUrl);
}
