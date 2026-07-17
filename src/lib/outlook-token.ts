/**
 * Reads the Outlook access token from the chrome_token cache file.
 * The token is managed by ~/sap-email-cli/chrome_token.py.
 * If the token is expired or missing, automatically calls the Python
 * get_token() function to refresh it from Chrome.
 */
import { readFile } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);
const CACHE_FILE = join(homedir(), ".sap-email-cli", "token_cache.json");
const OUTLOOK_API = "https://outlook.office.com/api/v2.0";
const SAFARI_TOKEN_DIR = join(homedir(), "sap-email-cli");

/**
 * Calls the Python chrome_token.get_token() function to refresh the Outlook token.
 * Returns the fresh token string.
 */
async function refreshTokenViaPython(): Promise<string> {
  const script = `
import sys, os
sys.path.insert(0, os.path.expanduser("~/sap-email-cli"))
from chrome_token import get_token
token = get_token()
print(token)
`.trim();

  try {
    const { stdout } = await execFileAsync("python3", ["-c", script], {
      cwd: SAFARI_TOKEN_DIR,
      timeout: 15000,
    });
    const token = stdout.trim();
    if (!token) {
      throw new Error("Python get_token() returned empty token");
    }
    return token;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Failed to auto-refresh Outlook token: ${message}`
    );
  }
}

/**
 * Try to read a valid (non-expired) token from the cache file.
 * Returns the token string, or null if expired/missing.
 */
async function readCachedToken(): Promise<string | null> {
  try {
    const raw = await readFile(CACHE_FILE, "utf-8");
    const data = JSON.parse(raw);
    const now = Math.floor(Date.now() / 1000);

    if (!data.token) return null;
    // Expired with 60s buffer
    if (data.expires_on && data.expires_on < now + 60) return null;

    return data.token;
  } catch {
    return null;
  }
}

/**
 * Check the current token status without attempting refresh.
 * Returns { valid, expiresOn, expiresIn } or { valid: false }.
 */
export async function getTokenStatus(): Promise<{
  valid: boolean;
  expiresOn?: number;
  expiresIn?: number;
}> {
  try {
    const raw = await readFile(CACHE_FILE, "utf-8");
    const data = JSON.parse(raw);
    const now = Math.floor(Date.now() / 1000);
    if (!data.token) return { valid: false };
    const expiresIn = data.expires_on - now;
    return {
      valid: expiresIn > 60,
      expiresOn: data.expires_on,
      expiresIn,
    };
  } catch {
    return { valid: false };
  }
}

/**
 * Write a fresh token + expiry to the cache file.
 */
export async function writeTokenCache(token: string, expiresOn: number) {
  const { writeFile, mkdir } = await import("fs/promises");
  const dir = join(homedir(), ".sap-email-cli");
  await mkdir(dir, { recursive: true });
  await writeFile(
    CACHE_FILE,
    JSON.stringify({ token, expires_on: expiresOn }),
  );
}

export async function getOutlookToken(): Promise<string> {
  // First try the cached token
  const cached = await readCachedToken();
  if (cached) return cached;

  // Token expired or missing — auto-refresh via Python
  console.log("[outlook-token] Token expired or missing, auto-refreshing via Python...");
  const freshToken = await refreshTokenViaPython();

  // Verify the refreshed token was written to cache
  const verified = await readCachedToken();
  if (verified) return verified;

  // If cache wasn't updated but Python returned a token, use it directly
  return freshToken;
}

export async function outlookFetch(path: string, params?: Record<string, string>) {
  const makeRequest = async (token: string) => {
    const url = new URL(`${OUTLOOK_API}${path}`);
    if (params) {
      Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    }
    return fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      cache: "no-store",
    });
  };

  let token = await getOutlookToken();
  let res = await makeRequest(token);

  // If we get a 401, try refreshing the token once and retry
  if (res.status === 401) {
    console.log("[outlook-token] Got 401, attempting token refresh...");
    const freshToken = await refreshTokenViaPython();
    // Re-read from cache (get_token() writes to it)
    token = (await readCachedToken()) || freshToken;
    res = await makeRequest(token);
  }

  if (!res.ok) {
    throw new Error(`Outlook API ${res.status}: ${res.statusText}`);
  }

  return res.json();
}

/**
 * Fetch a full Outlook API URL directly (e.g. @odata.nextLink pagination URLs).
 * Handles 401 retry with token refresh.
 */
export async function outlookFetchUrl(fullUrl: string) {
  const makeRequest = async (token: string) => {
    return fetch(fullUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      cache: "no-store",
    });
  };

  let token = await getOutlookToken();
  let res = await makeRequest(token);

  if (res.status === 401) {
    console.log("[outlook-token] Got 401 on URL fetch, attempting token refresh...");
    const freshToken = await refreshTokenViaPython();
    token = (await readCachedToken()) || freshToken;
    res = await makeRequest(token);
  }

  if (!res.ok) {
    throw new Error(`Outlook API ${res.status}: ${res.statusText}`);
  }

  return res.json();
}

/**
 * Make an authenticated POST request to the Outlook REST API.
 * Handles 401 retry with token refresh.
 */
export async function outlookPost(path: string, body: unknown) {
  const makeRequest = async (token: string) => {
    return fetch(`${OUTLOOK_API}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });
  };

  let token = await getOutlookToken();
  let res = await makeRequest(token);

  if (res.status === 401) {
    console.log("[outlook-token] Got 401 on POST, attempting token refresh...");
    const freshToken = await refreshTokenViaPython();
    token = (await readCachedToken()) || freshToken;
    res = await makeRequest(token);
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Outlook API POST ${res.status}: ${text.slice(0, 300)}`);
  }

  // Some Outlook POST endpoints return 202 with no body
  if (res.status === 202 || res.headers.get("content-length") === "0") {
    return { success: true };
  }

  return res.json();
}
