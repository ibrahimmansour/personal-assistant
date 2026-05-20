import { createHmac, randomBytes } from "crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const SESSION_COOKIE_NAME = "pa_session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days
const DATA_DIR = join(homedir(), ".personal-assistant");
const AUTH_FILE = join(DATA_DIR, "auth.json");

interface AuthData {
  passwordHash: string;
  salt: string;
}

function ensureDataDir() {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

function hashPassword(password: string, salt: string): string {
  return createHmac("sha256", salt).update(password).digest("hex");
}

function readAuthData(): AuthData | null {
  try {
    const data = readFileSync(AUTH_FILE, "utf-8");
    return JSON.parse(data) as AuthData;
  } catch {
    return null;
  }
}

export function isPasswordConfigured(): boolean {
  return readAuthData() !== null;
}

export function setPassword(password: string): void {
  ensureDataDir();
  const salt = randomBytes(32).toString("hex");
  const passwordHash = hashPassword(password, salt);
  writeFileSync(AUTH_FILE, JSON.stringify({ passwordHash, salt }), "utf-8");
}

export function verifyPassword(password: string): boolean {
  const auth = readAuthData();
  if (!auth) return false;
  const hash = hashPassword(password, auth.salt);
  return hash === auth.passwordHash;
}

function getSigningSecret(): string {
  const auth = readAuthData();
  if (!auth) throw new Error("No password configured");
  return auth.passwordHash;
}

function sign(value: string): string {
  const secret = getSigningSecret();
  const signature = createHmac("sha256", secret).update(value).digest("hex");
  return `${value}.${signature}`;
}

function verify(signed: string): string | null {
  const lastDot = signed.lastIndexOf(".");
  if (lastDot === -1) return null;
  const value = signed.substring(0, lastDot);
  try {
    const expected = sign(value);
    if (expected === signed) return value;
  } catch {
    return null;
  }
  return null;
}

export function createSessionCookie(): string {
  const token = sign(`authenticated:${Date.now()}`);
  return `${SESSION_COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE}`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function isValidSession(cookieHeader: string | null): boolean {
  if (!cookieHeader) return false;
  const match = cookieHeader.match(new RegExp(`${SESSION_COOKIE_NAME}=([^;]+)`));
  if (!match) return false;
  return verify(match[1]) !== null;
}

export function isAuthEnabled(): boolean {
  return isPasswordConfigured();
}

export { SESSION_COOKIE_NAME };
