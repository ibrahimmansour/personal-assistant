/**
 * Standalone Jira authentication module.
 *
 * Provides cookie-based auth for SAP Jira (jira.tools.sap):
 *  - Chrome cookie extraction (macOS, Linux, Windows) via node:sqlite
 *  - Cookie persistence to ~/.personal-assistant/jira/auth.json
 *  - Cookie validation against Jira REST API
 *  - Manual cookie save via API
 *
 * Ported from prompt-kit/sap-auth to remove external dependency.
 */

import { readFile, writeFile } from "fs/promises";
import { existsSync, mkdirSync, readFileSync, copyFileSync, unlinkSync } from "fs";
import { join } from "path";
import { homedir, tmpdir, platform } from "os";
import { pbkdf2Sync, createDecipheriv } from "crypto";
import { execSync } from "child_process";

// ============================================================================
// CONFIG
// ============================================================================

const JIRA_BASE = "https://jira.tools.sap";
const JIRA_DOMAIN = "jira.tools.sap";
const TEST_ENDPOINT = "/rest/api/2/myself";

const DATA_DIR = join(homedir(), ".personal-assistant", "jira");
const AUTH_FILE = join(DATA_DIR, "auth.json");

/** Also check the legacy prompt-kit location as fallback */
const LEGACY_AUTH_FILE = join(
  homedir(),
  ".config",
  "prompt-kit",
  "jira-query",
  "auth.json"
);

// ============================================================================
// TYPES
// ============================================================================

interface AuthData {
  cookies: string;
  timestamp: number;
  user?: string;
}

export interface JiraUser {
  name: string;
  displayName: string;
  emailAddress: string;
}

// ============================================================================
// PERSISTENCE
// ============================================================================

function ensureDataDir(): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

/**
 * Load saved cookies. Checks our own auth file first, then falls back to
 * the legacy prompt-kit location for seamless migration.
 */
export async function loadCookies(): Promise<string | null> {
  // Check env var override
  if (process.env.JIRA_COOKIES) {
    return process.env.JIRA_COOKIES;
  }

  // Check our own auth file
  if (existsSync(AUTH_FILE)) {
    try {
      const raw = await readFile(AUTH_FILE, "utf-8");
      const data: AuthData = JSON.parse(raw);
      return data.cookies || null;
    } catch {
      // Corrupted file
    }
  }

  // Fall back to legacy prompt-kit auth file
  if (existsSync(LEGACY_AUTH_FILE)) {
    try {
      const raw = await readFile(LEGACY_AUTH_FILE, "utf-8");
      const data: AuthData = JSON.parse(raw);
      if (data.cookies) {
        // Migrate: save to our own location
        await saveCookies(data.cookies);
        return data.cookies;
      }
    } catch {
      // Corrupted file
    }
  }

  return null;
}

/**
 * Save cookies to our auth file.
 */
export async function saveCookies(
  cookies: string,
  user?: string
): Promise<void> {
  ensureDataDir();
  const data: AuthData = {
    cookies,
    timestamp: Date.now(),
    ...(user ? { user } : {}),
  };
  await writeFile(AUTH_FILE, JSON.stringify(data, null, 2));
}

/**
 * Clear saved auth data.
 */
export async function clearCookies(): Promise<void> {
  if (existsSync(AUTH_FILE)) {
    unlinkSync(AUTH_FILE);
  }
}

// ============================================================================
// VALIDATION
// ============================================================================

/**
 * Validate cookies against the Jira API. Returns user info on success, null on failure.
 */
export async function validateCookies(
  cookies: string
): Promise<JiraUser | null> {
  try {
    const url = `${JIRA_BASE}${TEST_ENDPOINT}`;
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Cookie: cookies,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    });

    if (!response.ok) return null;

    const text = await response.text();
    let data: { name?: string; displayName?: string; emailAddress?: string };
    try {
      data = JSON.parse(text);
    } catch {
      return null; // HTML login page redirect
    }

    if (!data?.name) return null;

    return {
      name: data.name,
      displayName: data.displayName ?? data.name,
      emailAddress: data.emailAddress ?? "N/A",
    };
  } catch {
    return null;
  }
}

// ============================================================================
// CHROME COOKIE EXTRACTION
// ============================================================================

/**
 * Get the path to Chrome's cookie database for the current platform.
 */
function getChromeCookieDbPath(): string | null {
  const plat = platform();
  let cookiePath: string;

  if (plat === "darwin") {
    const newer = join(
      homedir(),
      "Library",
      "Application Support",
      "Google",
      "Chrome",
      "Default",
      "Network",
      "Cookies"
    );
    const legacy = join(
      homedir(),
      "Library",
      "Application Support",
      "Google",
      "Chrome",
      "Default",
      "Cookies"
    );
    cookiePath = existsSync(newer) ? newer : legacy;
  } else if (plat === "win32") {
    const localAppData =
      process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
    cookiePath = join(
      localAppData,
      "Google",
      "Chrome",
      "User Data",
      "Default",
      "Network",
      "Cookies"
    );
  } else {
    cookiePath = join(
      homedir(),
      ".config",
      "google-chrome",
      "Default",
      "Cookies"
    );
  }

  return existsSync(cookiePath) ? cookiePath : null;
}

/**
 * Get the Chrome encryption key for the current platform.
 */
function getChromeEncryptionKey(): Buffer {
  const plat = platform();

  if (plat === "darwin") {
    let password: string;
    try {
      password = execSync(
        'security find-generic-password -s "Chrome Safe Storage" -w',
        { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }
      ).trim();
    } catch {
      throw new Error(
        "Could not read Chrome Safe Storage password from macOS Keychain."
      );
    }
    return pbkdf2Sync(password, "saltysalt", 1003, 16, "sha1");
  }

  if (plat === "linux") {
    let password = "peanuts";
    try {
      password = execSync("secret-tool lookup application chrome", {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch {
      // Use default 'peanuts'
    }
    return pbkdf2Sync(password, "saltysalt", 1, 16, "sha1");
  }

  if (plat === "win32") {
    const localAppData =
      process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
    const localStatePath = join(
      localAppData,
      "Google",
      "Chrome",
      "User Data",
      "Local State"
    );

    if (!existsSync(localStatePath)) {
      throw new Error("Chrome Local State not found");
    }

    const localState = JSON.parse(readFileSync(localStatePath, "utf-8"));
    const encryptedKeyB64: string | undefined =
      localState?.os_crypt?.encrypted_key;

    if (!encryptedKeyB64) {
      throw new Error("Could not find encrypted key in Chrome Local State");
    }

    const encryptedKeyFull = Buffer.from(encryptedKeyB64, "base64");
    const dpapiPrefix = encryptedKeyFull.subarray(0, 5).toString("ascii");
    if (dpapiPrefix !== "DPAPI") {
      throw new Error(`Unexpected key prefix: ${dpapiPrefix}`);
    }
    const encryptedKey = encryptedKeyFull.subarray(5);
    const encKeyB64 = encryptedKey.toString("base64");

    const psScript = `
      Add-Type -AssemblyName System.Security
      $encrypted = [Convert]::FromBase64String("${encKeyB64}")
      $decrypted = [System.Security.Cryptography.ProtectedData]::Unprotect($encrypted, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
      [Convert]::ToBase64String($decrypted)
    `.trim();

    let decryptedB64: string;
    try {
      decryptedB64 = execSync(
        `powershell -NoProfile -Command "${psScript.replace(/\n/g, "; ")}"`,
        { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }
      ).trim();
    } catch {
      throw new Error("Failed to decrypt Chrome key via DPAPI");
    }

    return Buffer.from(decryptedB64, "base64");
  }

  throw new Error(`Unsupported platform: ${plat}`);
}

/**
 * Decrypt a single Chrome cookie value.
 * macOS/Linux: v10 prefix → AES-128-CBC
 * Windows: v10 prefix → AES-256-GCM
 */
function decryptCookieValue(encrypted: Buffer, key: Buffer): string {
  if (encrypted.length === 0) return "";

  const prefix = encrypted.subarray(0, 3).toString("ascii");
  if (prefix !== "v10" && prefix !== "v11") {
    return encrypted.toString("utf-8");
  }

  const payload = encrypted.subarray(3);

  if (platform() === "win32") {
    if (payload.length < 28) return "";
    const nonce = payload.subarray(0, 12);
    const tag = payload.subarray(payload.length - 16);
    const ciphertext = payload.subarray(12, payload.length - 16);
    try {
      const decipher = createDecipheriv("aes-256-gcm", key, nonce);
      decipher.setAuthTag(tag);
      return Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]).toString("utf-8");
    } catch {
      return "";
    }
  }

  // macOS / Linux: AES-128-CBC
  const iv = Buffer.alloc(16, 0x20);
  const PREAMBLE_LEN = 32;
  try {
    const decipher = createDecipheriv("aes-128-cbc", key, iv);
    const decrypted = Buffer.concat([
      decipher.update(payload),
      decipher.final(),
    ]);
    return decrypted.length > PREAMBLE_LEN
      ? decrypted.subarray(PREAMBLE_LEN).toString("utf-8")
      : decrypted.toString("utf-8");
  } catch {
    return "";
  }
}

/**
 * Extract cookies for jira.tools.sap from Chrome's cookie database.
 * Requires Node.js 22+ for node:sqlite.
 */
export function extractChromeCookies(): string | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let DatabaseSync: any;
  try {
    const moduleName = /* turbopackIgnore: true */ "node:sqlite";
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ({ DatabaseSync } = require(moduleName));
  } catch {
    return null; // node:sqlite not available
  }

  const dbPath = getChromeCookieDbPath();
  if (!dbPath) return null;

  const tmpDb = join(tmpdir(), `chrome-cookies-${Date.now()}.db`);
  try {
    copyFileSync(dbPath, tmpDb);
  } catch {
    return null;
  }

  try {
    let key: Buffer;
    try {
      key = getChromeEncryptionKey();
    } catch {
      return null;
    }

    const db = new DatabaseSync(tmpDb, { readOnly: true });

    let rows: { name: string; encrypted_value: Buffer | null; value?: string }[];
    try {
      rows = db
        .prepare(
          "SELECT name, encrypted_value, value FROM cookies WHERE host_key LIKE ?"
        )
        .all(`%${JIRA_DOMAIN}%`);
    } catch {
      try {
        rows = db
          .prepare(
            "SELECT name, encrypted_value, value FROM cookies WHERE host LIKE ?"
          )
          .all(`%${JIRA_DOMAIN}%`);
      } catch {
        db.close();
        return null;
      }
    }

    db.close();

    if (!rows || rows.length === 0) return null;

    const cookies: Record<string, string> = {};
    for (const row of rows) {
      const name: string = row.name;
      const encryptedValue: Buffer | null = row.encrypted_value
        ? Buffer.from(row.encrypted_value)
        : null;
      const plainValue: string = row.value ?? "";

      const value =
        encryptedValue && encryptedValue.length > 0
          ? decryptCookieValue(encryptedValue, key)
          : plainValue;

      if (value) cookies[name] = value;
    }

    const cookieCount = Object.keys(cookies).length;
    if (cookieCount === 0) return null;

    return Object.entries(cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
  } finally {
    try {
      unlinkSync(tmpDb);
    } catch {
      /* ignore */
    }
  }
}

// ============================================================================
// MAIN AUTH FLOW
// ============================================================================

/**
 * Get valid Jira cookies. Tries in order:
 *  1. Saved cookies (our file or legacy prompt-kit file)
 *  2. Chrome cookie extraction
 *
 * Returns cookies string on success, null if auth is needed.
 */
export async function ensureCookies(): Promise<string | null> {
  // 1. Try saved cookies
  const saved = await loadCookies();
  if (saved) {
    // Quick-validate: don't validate every time, only if older than 1 hour
    const authData = await getAuthData();
    if (authData && Date.now() - authData.timestamp < 3600000) {
      return saved;
    }
    // Validate
    const user = await validateCookies(saved);
    if (user) {
      // Re-save to update timestamp
      await saveCookies(saved, user.displayName);
      return saved;
    }
  }

  // 2. Try Chrome cookie extraction
  const extracted = extractChromeCookies();
  if (extracted) {
    const user = await validateCookies(extracted);
    if (user) {
      await saveCookies(extracted, user.displayName);
      return extracted;
    }
  }

  return null;
}

/**
 * Authenticate with explicit cookies (manual paste or from browser extension).
 * Validates and saves if valid.
 */
export async function authenticateWithCookies(
  cookies: string
): Promise<JiraUser | null> {
  const user = await validateCookies(cookies);
  if (user) {
    await saveCookies(cookies, user.displayName);
    return user;
  }
  return null;
}

/**
 * Get raw auth data (for checking timestamp, etc.)
 */
async function getAuthData(): Promise<AuthData | null> {
  if (existsSync(AUTH_FILE)) {
    try {
      const raw = await readFile(AUTH_FILE, "utf-8");
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Get auth status info (for displaying in UI).
 */
export async function getAuthStatus(): Promise<{
  authenticated: boolean;
  user?: string;
  cookieAge?: number;
}> {
  const data = await getAuthData();
  if (!data?.cookies) {
    return { authenticated: false };
  }

  const age = Date.now() - data.timestamp;
  return {
    authenticated: true,
    user: data.user,
    cookieAge: age,
  };
}
