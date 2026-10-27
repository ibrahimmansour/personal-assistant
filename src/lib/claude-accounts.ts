import { readdir, readFile, access } from "fs/promises";
import { join } from "path";
import { homedir } from "os";

/**
 * Logged-in Claude Code accounts on this machine.
 *
 * The CLI keeps one login per config dir: `~/.claude` by default, anything
 * else when `CLAUDE_CONFIG_DIR` points elsewhere. An extra account is a
 * sibling `~/.claude-<name>` dir that holds its own `.credentials.json`
 * (create one with `CLAUDE_CONFIG_DIR=~/.claude-<name> claude` then `/login`).
 * Each dir carries its own `projects/` session logs, so sessions are
 * per-account too.
 */
export interface ClaudeAccount {
  /** `"default"` for `~/.claude`, otherwise the dir name minus `.claude-`. */
  id: string;
  /** Email of the logged-in account, falling back to the id. */
  label: string;
  email: string | null;
  configDir: string;
  isDefault: boolean;
}

export const DEFAULT_ACCOUNT_ID = "default";

const ACCOUNT_ID_RE = /^[A-Za-z0-9_.-]{1,64}$/;

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function readEmail(configDir: string, isDefault: boolean): Promise<string | null> {
  // The default dir's global state sits beside it (`~/.claude.json`); a custom
  // CLAUDE_CONFIG_DIR keeps its `.claude.json` inside.
  const candidates = isDefault
    ? [join(homedir(), ".claude.json"), join(configDir, ".claude.json")]
    : [join(configDir, ".claude.json")];
  for (const file of candidates) {
    try {
      const data = JSON.parse(await readFile(file, "utf-8"));
      const email = data?.oauthAccount?.emailAddress;
      if (typeof email === "string" && email) return email;
    } catch {}
  }
  return null;
}

/** True when `s` is safe to use as a single path segment under a projects dir
 *  (no separators, no traversal). Guards ids that arrive in request params. */
export function isSafePathSegment(s: string): boolean {
  return !!s && s !== "." && s !== ".." && !/[\/\\\0]/.test(s);
}

const ACCOUNTS_TTL_MS = 5000;
let accountsCache: { at: number; value: Promise<ClaudeAccount[]> } | null = null;

export function listClaudeAccounts(): Promise<ClaudeAccount[]> {
  // The messages route re-locates a session log every second or so while it
  // waits for the CLI to create it; don't re-scan $HOME each time.
  if (accountsCache && Date.now() - accountsCache.at < ACCOUNTS_TTL_MS) return accountsCache.value;
  const value = scanClaudeAccounts();
  accountsCache = { at: Date.now(), value };
  value.catch(() => { if (accountsCache?.value === value) accountsCache = null; });
  return value;
}

async function scanClaudeAccounts(): Promise<ClaudeAccount[]> {
  const home = homedir();
  const accounts: ClaudeAccount[] = [];

  const defaultDir = join(home, ".claude");
  const defaultEmail = await readEmail(defaultDir, true);
  accounts.push({
    id: DEFAULT_ACCOUNT_ID,
    label: defaultEmail || "Default",
    email: defaultEmail,
    configDir: defaultDir,
    isDefault: true,
  });

  let entries: string[] = [];
  try {
    entries = await readdir(home);
  } catch {}
  for (const name of entries.sort()) {
    if (!name.startsWith(".claude-")) continue;
    const id = name.slice(".claude-".length);
    if (!ACCOUNT_ID_RE.test(id) || id === DEFAULT_ACCOUNT_ID) continue;
    const dir = join(home, name);
    if (!(await exists(join(dir, ".credentials.json")))) continue;
    const email = await readEmail(dir, false);
    accounts.push({ id, label: email || id, email, configDir: dir, isDefault: false });
  }
  return accounts;
}

/** Resolve an account id to its config dir. Unknown ids fall back to the
 *  default account rather than letting a client name an arbitrary path. */
export async function resolveClaudeAccount(id: string | null | undefined): Promise<ClaudeAccount> {
  const accounts = await listClaudeAccounts();
  return accounts.find((a) => a.id === id) || accounts[0];
}

export function projectsDirOf(account: ClaudeAccount): string {
  return join(account.configDir, "projects");
}

/** Env for spawning `claude` as a given account. The default account must run
 *  with CLAUDE_CONFIG_DIR unset so a stray value in the server's environment
 *  can't redirect it. */
export function applyAccountEnv(env: NodeJS.ProcessEnv, account: ClaudeAccount): NodeJS.ProcessEnv {
  const out = { ...env };
  if (account.isDefault) delete out.CLAUDE_CONFIG_DIR;
  else out.CLAUDE_CONFIG_DIR = account.configDir;
  return out;
}
