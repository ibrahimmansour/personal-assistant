import { exchangeCode, isConfigured } from "@/lib/google-token";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/google/auth/callback?code=...
 * Google redirects here after user grants consent.
 */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const error = request.nextUrl.searchParams.get("error");

  if (error) {
    return new Response(
      `<html><body>
        <h2>Authentication failed</h2>
        <p>Error: ${error}</p>
        <p><a href="/">Back to dashboard</a></p>
      </body></html>`,
      { headers: { "Content-Type": "text/html" } }
    );
  }

  if (!isConfigured()) {
    return Response.json(
      { error: "Google OAuth not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env.local" },
      { status: 500 }
    );
  }

  if (!code) {
    return Response.json({ error: "Missing authorization code" }, { status: 400 });
  }

  try {
    await exchangeCode(code);
    return new Response(
      `<html><body>
        <script>
          if (window.opener) {
            window.opener.location.reload();
            window.close();
          } else {
            window.location.href = "/";
          }
        </script>
        <p>Authentication successful! Redirecting...</p>
        <p><a href="/">Back to dashboard</a></p>
      </body></html>`,
      { headers: { "Content-Type": "text/html" } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Token exchange failed";
    return new Response(
      `<html><body>
        <h2>Authentication failed</h2>
        <p>${message}</p>
        <p><a href="/">Back to dashboard</a></p>
      </body></html>`,
      { headers: { "Content-Type": "text/html" } }
    );
  }
}
