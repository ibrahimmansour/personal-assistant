/**
 * OpenCode session store reader.
 *
 * OpenCode (≥1.x) keeps sessions, messages and message parts in a SQLite
 * database at `~/.local/share/opencode/opencode.db` (WAL mode). The Claude
 * Code widget tails Claude's per-session JSONL logs; for OpenCode there is
 * no log file, so this module reads the database read-only and maps rows
 * onto the same `ChatMessage` shape the widget already renders.
 *
 * The SQLite driver is resolved at runtime through `process.getBuiltinModule`
 * (`node:sqlite` on Node ≥ 22.13, `bun:sqlite` inside the compiled binary) so
 * neither bundler has to resolve the builtin. When no driver is available the
 * store degrades to the `opencode` CLI (`session list --format json`,
 * `export <id>`), which is slower but keeps the widget functional.
 *
 * Nothing here writes to the database — deletions go through the CLI.
 */

import { execFile } from "child_process";
import { promisify } from "util";
import { homedir } from "os";
import { join, delimiter } from "path";
import { access } from "fs/promises";

const execFileAsync = promisify(execFile);

export const OPENCODE_DB_PATH = join(homedir(), ".local", "share", "opencode", "opencode.db");

/** OpenCode session ids look like `ses_f5af322dcffe9YRQb6gemoh25P`. */
export const OPENCODE_SESSION_ID_RE = /^ses_[A-Za-z0-9]+$/;

export function isOpenCodeSessionId(id: string | null | undefined): boolean {
  return !!id && OPENCODE_SESSION_ID_RE.test(id);
}

/** Model ids are `provider/model`, e.g. `opencode/claude-opus-4-8`. */
export const OPENCODE_MODEL_RE = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._:\-[\]]+$/;
/** Variant names are short identifiers: `low`, `high`, `max`, `none`… */
export const OPENCODE_VARIANT_RE = /^[A-Za-z0-9._-]{1,32}$/;

/**
 * PATH with the places OpenCode installs itself (`~/.opencode/bin` for the
 * curl installer, plus the usual package-manager bin dirs) so `spawn("opencode")`
 * resolves even when the server was launched with a minimal PATH.
 */
export function buildAgentPath(): string {
  const home = homedir();
  const extra = [
    join(home, ".opencode", "bin"),
    join(home, ".local", "bin"),
    join(home, ".claude", "local"),
    join(home, ".bun", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
  ];
  const current = process.env.PATH ? process.env.PATH.split(delimiter) : [];
  const merged = [...current, ...extra.filter((p) => !current.includes(p))];
  return merged.join(delimiter);
}

function cliEnv(): NodeJS.ProcessEnv {
  return { ...process.env, PATH: buildAgentPath() };
}

// ─── SQLite driver adapter ───────────────────────────────────────────────────

interface Db {
  all<T = Record<string, unknown>>(sql: string, ...params: (string | number)[]): T[];
  get<T = Record<string, unknown>>(sql: string, ...params: (string | number)[]): T | undefined;
}

let dbHandle: Db | null = null;
let dbProbeFailed = false;

function getBuiltin(name: string): unknown {
  const proc = process as unknown as { getBuiltinModule?: (id: string) => unknown };
  if (typeof proc.getBuiltinModule !== "function") return undefined;
  try {
    return proc.getBuiltinModule(name);
  } catch {
    return undefined;
  }
}

async function openDb(): Promise<Db | null> {
  if (dbHandle) return dbHandle;
  if (dbProbeFailed) return null;
  try {
    await access(OPENCODE_DB_PATH);
  } catch {
    // No database yet — OpenCode has never run on this machine. Not a
    // permanent failure: it may appear later, so don't latch dbProbeFailed.
    return null;
  }

  // Node ≥ 22.13: node:sqlite (DatabaseSync).
  const nodeSqlite = getBuiltin("node:sqlite") as
    | { DatabaseSync?: new (path: string, opts: { readOnly: boolean }) => { prepare(sql: string): { all(...p: unknown[]): unknown[]; get(...p: unknown[]): unknown } } }
    | undefined;
  if (nodeSqlite?.DatabaseSync) {
    try {
      const raw = new nodeSqlite.DatabaseSync(OPENCODE_DB_PATH, { readOnly: true });
      dbHandle = {
        all: (sql, ...params) => raw.prepare(sql).all(...params) as never,
        get: (sql, ...params) => raw.prepare(sql).get(...params) as never,
      };
      return dbHandle;
    } catch (err) {
      console.warn("[opencode-store] node:sqlite open failed:", err instanceof Error ? err.message : err);
    }
  }

  // Bun runtime (standalone binary): bun:sqlite (Database).
  const bunSqlite = getBuiltin("bun:sqlite") as
    | { Database?: new (path: string, opts: { readonly: boolean }) => { query(sql: string): { all(...p: unknown[]): unknown[]; get(...p: unknown[]): unknown } } }
    | undefined;
  if (bunSqlite?.Database) {
    try {
      const raw = new bunSqlite.Database(OPENCODE_DB_PATH, { readonly: true });
      dbHandle = {
        all: (sql, ...params) => raw.query(sql).all(...params) as never,
        get: (sql, ...params) => raw.query(sql).get(...params) as never,
      };
      return dbHandle;
    } catch (err) {
      console.warn("[opencode-store] bun:sqlite open failed:", err instanceof Error ? err.message : err);
    }
  }

  dbProbeFailed = true;
  console.warn("[opencode-store] no SQLite driver available; falling back to the opencode CLI");
  return null;
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface OpenCodeSessionInfo {
  sessionId: string;
  title: string;
  firstPrompt: string;
  messageCount: number;
  created: string;
  modified: string;
  directory: string;
  /** `provider/model` of the session's current model, when recorded. */
  model?: string;
  /** Model variant (reasoning effort) recorded on the session, when any. */
  variant?: string;
}

/** Same shape as the Claude messages route's ChatMessage. */
export interface OpenCodeChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  toolUses?: { name: string; id?: string; input?: unknown }[];
  toolResults?: { toolUseId: string; content: string; isError?: boolean }[];
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cacheReadInputTokens: number;
    cacheCreationInputTokens: number;
  };
  stopReason?: string | null;
  /** USD cost OpenCode recorded for this assistant turn. */
  cost?: number;
  timestamp: string;
}

// ─── Sessions ────────────────────────────────────────────────────────────────

function iso(ms: unknown): string {
  const n = typeof ms === "number" ? ms : Number(ms);
  return Number.isFinite(n) && n > 0 ? new Date(n).toISOString() : "";
}

function parseSessionModel(raw: unknown): { model?: string; variant?: string } {
  if (typeof raw !== "string" || !raw) return {};
  try {
    const m = JSON.parse(raw) as { id?: string; providerID?: string; variant?: string };
    const model = m.providerID && m.id ? `${m.providerID}/${m.id}` : undefined;
    const variant = m.variant && m.variant !== "default" ? m.variant : undefined;
    return { model, variant };
  } catch {
    return {};
  }
}

export async function listOpenCodeSessions(): Promise<OpenCodeSessionInfo[]> {
  const db = await openDb();
  if (db) {
    const rows = db.all<{
      id: string;
      title: string;
      directory: string;
      time_created: number;
      time_updated: number;
      model: string | null;
      cnt: number;
      first_prompt: string | null;
    }>(
      `select s.id, s.title, s.directory, s.time_created, s.time_updated, s.model,
         (select count(*) from message m where m.session_id = s.id) as cnt,
         (select json_extract(p.data, '$.text')
            from part p join message m on m.id = p.message_id
           where m.session_id = s.id
             and json_extract(m.data, '$.role') = 'user'
             and json_extract(p.data, '$.type') = 'text'
             and json_extract(p.data, '$.synthetic') is not 1
           order by p.time_created asc limit 1) as first_prompt
       from session s
       where s.parent_id is null and s.time_archived is null
       order by s.time_updated desc`,
    );
    return rows.map((r) => ({
      sessionId: r.id,
      title: cleanText(r.title || ""),
      firstPrompt: cleanText(stripArgvQuotes((r.first_prompt || "").trim())).slice(0, 200),
      messageCount: r.cnt || 0,
      created: iso(r.time_created),
      modified: iso(r.time_updated),
      directory: r.directory || "",
      ...parseSessionModel(r.model),
    }));
  }

  // CLI fallback. `session list` has no first prompt or message count.
  try {
    const { stdout } = await execFileAsync("opencode", ["session", "list", "--format", "json"], {
      env: cliEnv(),
      timeout: 20_000,
      maxBuffer: 16 * 1024 * 1024,
    });
    const arr = JSON.parse(stdout) as { id: string; title?: string; updated?: number; created?: number; directory?: string }[];
    return (Array.isArray(arr) ? arr : []).map((s) => ({
      sessionId: s.id,
      title: cleanText(s.title || ""),
      firstPrompt: "",
      messageCount: 0,
      created: iso(s.created),
      modified: iso(s.updated),
      directory: s.directory || "",
    }));
  } catch {
    return [];
  }
}

/**
 * `opencode run <message>` stores a multi-word message wrapped in double
 * quotes (the argv join re-quotes it). Strip exactly one wrapping pair when
 * the quotes are the only ones in the text, so the chat shows what was typed.
 */
function stripArgvQuotes(text: string): string {
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
    const inner = text.slice(1, -1);
    if (!inner.includes('"')) return inner;
  }
  return text;
}

function cleanText(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

// ─── Messages ────────────────────────────────────────────────────────────────

interface RawMessage {
  id: string;
  time_created: number;
  data: string;
}
interface RawPart {
  message_id: string;
  data: string;
}

interface MessageData {
  role?: string;
  time?: { created?: number; completed?: number };
  finish?: string;
  tokens?: { input?: number; output?: number; cache?: { read?: number; write?: number } };
  cost?: number;
  error?: { name?: string; data?: { message?: string } } | string;
}

interface PartData {
  type?: string;
  text?: string;
  synthetic?: boolean;
  tool?: string;
  callID?: string;
  state?: { status?: string; input?: unknown; output?: string; error?: string };
  filename?: string;
}

const TOOL_OUTPUT_CAP = 3000;

function mapStopReason(finish: string | undefined, hasError: boolean): string | null {
  if (hasError) return "error";
  if (!finish) return null;
  switch (finish) {
    case "stop": return "end_turn";
    case "tool-calls": return "tool_use";
    case "length": return "max_tokens";
    default: return finish;
  }
}

function buildMessages(messages: RawMessage[], parts: RawPart[]): OpenCodeChatMessage[] {
  const partsByMessage = new Map<string, PartData[]>();
  for (const p of parts) {
    let data: PartData;
    try { data = JSON.parse(p.data); } catch { continue; }
    const list = partsByMessage.get(p.message_id);
    if (list) list.push(data);
    else partsByMessage.set(p.message_id, [data]);
  }

  const out: OpenCodeChatMessage[] = [];
  for (const m of messages) {
    let data: MessageData;
    try { data = JSON.parse(m.data); } catch { continue; }
    const role = data.role === "user" ? "user" : data.role === "assistant" ? "assistant" : null;
    if (!role) continue;
    const mparts = partsByMessage.get(m.id) || [];

    const texts: string[] = [];
    const toolUses: OpenCodeChatMessage["toolUses"] = [];
    const toolResults: OpenCodeChatMessage["toolResults"] = [];
    for (const p of mparts) {
      if (p.type === "text") {
        if (role === "user" && p.synthetic) continue;
        if (typeof p.text === "string" && p.text.trim()) {
          texts.push(role === "user" ? stripArgvQuotes(p.text.trim()) : p.text.trim());
        }
      } else if (p.type === "file") {
        if (p.filename) texts.push(`📎 ${p.filename}`);
      } else if (p.type === "tool") {
        const id = p.callID || undefined;
        toolUses.push({ name: p.tool || "tool", id, input: p.state?.input });
        const status = p.state?.status;
        if (id && (status === "completed" || status === "error")) {
          let content = status === "error" ? (p.state?.error || "") : (p.state?.output || "");
          if (content.length > TOOL_OUTPUT_CAP) content = content.slice(0, TOOL_OUTPUT_CAP) + "\n… (truncated)";
          toolResults.push({ toolUseId: id, content, isError: status === "error" || undefined });
        }
      }
    }

    let text = texts.join("\n\n");
    let hasError = false;
    if (data.error) {
      hasError = true;
      const err = typeof data.error === "string"
        ? data.error
        : [data.error.name, data.error.data?.message].filter(Boolean).join(": ");
      text = text ? `${text}\n\n⚠️ ${err || "error"}` : `⚠️ ${err || "error"}`;
    }

    if (!text && toolUses.length === 0 && toolResults.length === 0) continue;

    const msg: OpenCodeChatMessage = {
      id: m.id,
      role,
      text,
      timestamp: iso(data.time?.created ?? m.time_created),
    };
    if (toolUses.length) msg.toolUses = toolUses;
    if (toolResults.length) msg.toolResults = toolResults;
    if (role === "assistant") {
      msg.stopReason = mapStopReason(data.finish, hasError);
      if (typeof data.cost === "number") msg.cost = data.cost;
      if (data.tokens) {
        msg.usage = {
          inputTokens: data.tokens.input || 0,
          outputTokens: data.tokens.output || 0,
          cacheReadInputTokens: data.tokens.cache?.read || 0,
          cacheCreationInputTokens: data.tokens.cache?.write || 0,
        };
      }
    }
    out.push(msg);
  }
  return out;
}

/**
 * Cheap change signature for a session — row counts plus the newest
 * `time_updated` across messages and parts. Streaming output updates parts
 * in place, so counts alone would miss it.
 */
export async function openCodeSessionSignature(sessionId: string): Promise<string | null> {
  const db = await openDb();
  if (!db) return null;
  const row = db.get<{ mc: number; mu: number | null; pc: number; pu: number | null }>(
    `select
       (select count(*) from message where session_id = ?) as mc,
       (select max(time_updated) from message where session_id = ?) as mu,
       (select count(*) from part where session_id = ?) as pc,
       (select max(time_updated) from part where session_id = ?) as pu`,
    sessionId, sessionId, sessionId, sessionId,
  );
  if (!row) return "0";
  return `${row.mc}:${row.mu ?? 0}:${row.pc}:${row.pu ?? 0}`;
}

export async function openCodeSessionExists(sessionId: string): Promise<boolean> {
  const db = await openDb();
  if (db) {
    return !!db.get("select 1 as x from session where id = ?", sessionId);
  }
  const list = await listOpenCodeSessions();
  return list.some((s) => s.sessionId === sessionId);
}

export async function readOpenCodeMessages(sessionId: string): Promise<OpenCodeChatMessage[]> {
  const db = await openDb();
  if (db) {
    const messages = db.all<RawMessage>(
      "select id, time_created, data from message where session_id = ? order by time_created asc",
      sessionId,
    );
    const parts = db.all<RawPart>(
      "select message_id, data from part where session_id = ? order by time_created asc",
      sessionId,
    );
    return buildMessages(messages, parts);
  }

  // CLI fallback: `opencode export` dumps { info, messages: [{ info, parts }] }.
  try {
    const { stdout } = await execFileAsync("opencode", ["export", sessionId], {
      env: cliEnv(),
      timeout: 30_000,
      maxBuffer: 64 * 1024 * 1024,
    });
    const start = stdout.indexOf("{");
    const dump = JSON.parse(stdout.slice(start)) as {
      messages?: { info?: Record<string, unknown> & { id?: string }; parts?: Record<string, unknown>[] }[];
    };
    const messages: RawMessage[] = [];
    const parts: RawPart[] = [];
    for (const m of dump.messages || []) {
      const info = m.info || {};
      const id = String(info.id || "");
      if (!id) continue;
      const created = (info.time as { created?: number } | undefined)?.created || 0;
      messages.push({ id, time_created: created, data: JSON.stringify(info) });
      for (const p of m.parts || []) parts.push({ message_id: id, data: JSON.stringify(p) });
    }
    return buildMessages(messages, parts);
  } catch {
    return [];
  }
}

export async function deleteOpenCodeSession(sessionId: string): Promise<boolean> {
  if (!isOpenCodeSessionId(sessionId)) return false;
  try {
    await execFileAsync("opencode", ["session", "delete", sessionId], { env: cliEnv(), timeout: 20_000 });
    return true;
  } catch {
    return false;
  }
}

// ─── Models ──────────────────────────────────────────────────────────────────

export interface OpenCodeModel {
  /** `provider/model` — what `--model` takes. */
  id: string;
  provider: string;
  model: string;
  name: string;
  /** Variant names (`low`, `high`, `max`…) the model accepts via `--variant`. */
  variants: string[];
  reasoning: boolean;
  /** Free to use (zero cost on both input and output). */
  free: boolean;
}

const MODELS_TTL_MS = 10 * 60_000;
let modelsCache: { at: number; models: OpenCodeModel[] } | null = null;

/**
 * Models the local OpenCode install can use, from `opencode models --verbose`
 * (one `provider/model` line followed by a JSON blob per model). Cached for
 * ten minutes — the list only changes when a provider is added or the
 * models.dev catalogue is refreshed.
 */
export async function listOpenCodeModels(force = false): Promise<OpenCodeModel[]> {
  if (!force && modelsCache && Date.now() - modelsCache.at < MODELS_TTL_MS) return modelsCache.models;
  let models: OpenCodeModel[] = [];
  try {
    const { stdout } = await execFileAsync("opencode", ["models", "--verbose"], {
      env: cliEnv(),
      timeout: 30_000,
      maxBuffer: 16 * 1024 * 1024,
    });
    models = parseVerboseModels(stdout);
  } catch (err) {
    console.warn("[opencode-store] models --verbose failed:", err instanceof Error ? err.message : err);
  }
  if (models.length === 0) {
    try {
      const { stdout } = await execFileAsync("opencode", ["models"], { env: cliEnv(), timeout: 30_000 });
      models = stdout
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => OPENCODE_MODEL_RE.test(l))
        .map((id) => {
          const [provider, ...rest] = id.split("/");
          return { id, provider, model: rest.join("/"), name: rest.join("/"), variants: [], reasoning: false, free: false };
        });
    } catch {}
  }
  if (models.length > 0) modelsCache = { at: Date.now(), models };
  return models;
}

function parseVerboseModels(stdout: string): OpenCodeModel[] {
  const out: OpenCodeModel[] = [];
  // Blocks are separated by a line that is exactly a `provider/model` id.
  const lines = stdout.split("\n");
  let currentId: string | null = null;
  let buf: string[] = [];
  const flush = () => {
    if (!currentId) return;
    const jsonText = buf.join("\n").trim();
    let meta: {
      id?: string; providerID?: string; name?: string;
      variants?: Record<string, unknown>;
      capabilities?: { reasoning?: boolean };
      cost?: { input?: number; output?: number };
    } = {};
    if (jsonText) {
      try { meta = JSON.parse(jsonText); } catch {}
    }
    const [provider, ...rest] = currentId.split("/");
    const model = rest.join("/");
    out.push({
      id: currentId,
      provider: meta.providerID || provider,
      model,
      name: meta.name || model,
      variants: meta.variants ? Object.keys(meta.variants) : [],
      reasoning: !!meta.capabilities?.reasoning,
      free: !!meta.cost && (meta.cost.input || 0) === 0 && (meta.cost.output || 0) === 0,
    });
    buf = [];
  };
  for (const line of lines) {
    if (OPENCODE_MODEL_RE.test(line.trim()) && !line.startsWith(" ") && !line.startsWith("{")) {
      flush();
      currentId = line.trim();
    } else if (currentId) {
      buf.push(line);
    }
  }
  flush();
  return out;
}
