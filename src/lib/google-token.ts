/**
 * Google OAuth2 token management.
 * Tokens are persisted to ~/.personal-assistant/google-tokens.json.
 * Uses standard OAuth2 authorization code flow with refresh tokens.
 */
import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import { getConfigEnv } from "@/lib/config";

const DATA_DIR = join(homedir(), ".personal-assistant");
const TOKENS_FILE = join(DATA_DIR, "google-tokens.json");

async function getGoogleClientId() { return getConfigEnv("GOOGLE_CLIENT_ID"); }
async function getGoogleClientSecret() { return getConfigEnv("GOOGLE_CLIENT_SECRET"); }
async function getGoogleRedirectUri() { return getConfigEnv("GOOGLE_REDIRECT_URI") || "http://localhost:4444/api/google/auth/callback"; }

interface GoogleTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number; // Unix timestamp in seconds
  token_type: string;
  scope: string;
}

export async function getAuthUrl(): Promise<string> {
  const scopes = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/calendar.readonly",
    "https://www.googleapis.com/auth/drive.file",
  ];
  const params = new URLSearchParams({
    client_id: await getGoogleClientId(),
    redirect_uri: await getGoogleRedirectUri(),
    response_type: "code",
    scope: scopes.join(" "),
    access_type: "offline",
    prompt: "consent",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export async function exchangeCode(code: string): Promise<GoogleTokens> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: await getGoogleClientId(),
      client_secret: await getGoogleClientSecret(),
      redirect_uri: await getGoogleRedirectUri(),
      grant_type: "authorization_code",
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed: ${res.status} ${text}`);
  }

  const data = await res.json();
  const tokens: GoogleTokens = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Math.floor(Date.now() / 1000) + (data.expires_in || 3600),
    token_type: data.token_type,
    scope: data.scope,
  };

  await saveTokens(tokens);
  return tokens;
}

async function refreshAccessToken(refreshToken: string): Promise<GoogleTokens> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: await getGoogleClientId(),
      client_secret: await getGoogleClientSecret(),
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token refresh failed: ${res.status} ${text}`);
  }

  const data = await res.json();
  return {
    access_token: data.access_token,
    refresh_token: refreshToken, // refresh_token is not returned on refresh
    expires_at: Math.floor(Date.now() / 1000) + (data.expires_in || 3600),
    token_type: data.token_type || "Bearer",
    scope: data.scope || "",
  };
}

async function readTokens(): Promise<GoogleTokens | null> {
  try {
    const raw = await readFile(TOKENS_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function saveTokens(tokens: GoogleTokens): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(TOKENS_FILE, JSON.stringify(tokens, null, 2));
}

/**
 * Get a valid access token, refreshing if needed.
 * Throws if no tokens are saved (user needs to authenticate first).
 */
export async function getGoogleToken(): Promise<string> {
  const tokens = await readTokens();
  if (!tokens) {
    throw new Error("GOOGLE_AUTH_REQUIRED");
  }

  const now = Math.floor(Date.now() / 1000);
  // Refresh if expiring within 60 seconds
  if (tokens.expires_at < now + 60) {
    console.log("[google-token] Token expired, refreshing...");
    const refreshed = await refreshAccessToken(tokens.refresh_token);
    await saveTokens(refreshed);
    return refreshed.access_token;
  }

  return tokens.access_token;
}

/**
 * Make an authenticated fetch to Google APIs.
 * Auto-refreshes token on 401.
 */
export async function googleFetch(url: string, options?: RequestInit): Promise<unknown> {
  const makeRequest = async (token: string) => {
    return fetch(url, {
      ...options,
      headers: {
        ...options?.headers,
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
    });
  };

  let token = await getGoogleToken();
  let res = await makeRequest(token);

  if (res.status === 401) {
    console.log("[google-token] Got 401, attempting token refresh...");
    const tokens = await readTokens();
    if (tokens?.refresh_token) {
      const refreshed = await refreshAccessToken(tokens.refresh_token);
      await saveTokens(refreshed);
      token = refreshed.access_token;
      res = await makeRequest(token);
    }
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google API ${res.status}: ${text.slice(0, 300)}`);
  }

  return res.json();
}

export async function isConfigured(): Promise<boolean> {
  const clientId = await getGoogleClientId();
  const clientSecret = await getGoogleClientSecret();
  return Boolean(clientId && clientSecret);
}
