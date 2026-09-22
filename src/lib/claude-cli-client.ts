/**
 * Claude via the Claude Code CLI (`claude -p`).
 *
 * Runs on the user's Claude subscription — the same login the Claude Code
 * widget uses — so no API key is needed. Every call is a one-shot print-mode
 * session with tools, MCP servers, skills and settings stripped, which keeps
 * the request down to the system prompt plus the conversation (~400 input
 * tokens of overhead instead of ~24k).
 *
 * Two entry points:
 *  - `streamClaudeCli()`  — NDJSON `{token}` / `{done}` / `{error}` stream,
 *    the same wire format the Ollama client emits, so the chat UI is
 *    provider-agnostic.
 *  - `completeClaudeCli()` — buffered text, for one-shot extraction/summary.
 */

import { spawn, execFile } from "child_process";
import { promisify } from "util";
import { existsSync } from "fs";
import { mkdtempSync, writeFileSync } from "fs";
import { homedir, tmpdir } from "os";
import { join } from "path";
import { buildAgentPath } from "@/lib/opencode-store";

const execFileAsync = promisify(execFile);

/** Claude Code model aliases accepted by `claude --model`. */
export const CLAUDE_MODELS = [
  { value: "default", label: "Default", description: "The CLI's saved default model" },
  { value: "fable", label: "Fable", description: "Fable 5.1 — Mythos-class, the most capable Claude" },
  { value: "opus", label: "Opus", description: "Opus — most capable of the standard tier" },
  { value: "opus[1m]", label: "Opus (1M)", description: "Opus with 1M context — uses credits" },
  { value: "sonnet", label: "Sonnet", description: "Sonnet — best for everyday tasks" },
  { value: "sonnet[1m]", label: "Sonnet (1M)", description: "Sonnet with 1M context — uses credits" },
  { value: "haiku", label: "Haiku", description: "Haiku 4.5 — fastest for quick answers" },
] as const;

/** Claude Code `--effort` levels. */
export const CLAUDE_EFFORTS = [
  { value: "default", label: "Default", description: "The CLI's own effort setting" },
  { value: "low", label: "Low", description: "Quick, minimal reasoning — best for chat" },
  { value: "medium", label: "Medium", description: "Balanced" },
  { value: "high", label: "High", description: "Deeper reasoning" },
  { value: "xhigh", label: "X-High", description: "Extended reasoning" },
  { value: "max", label: "Max", description: "Maximum reasoning — slowest, most thorough" },
] as const;

const MODEL_VALUES = new Set<string>(CLAUDE_MODELS.map((m) => m.value));
const EFFORT_VALUES = new Set<string>(CLAUDE_EFFORTS.map((e) => e.value));

export function isClaudeModel(v: unknown): v is string {
  return typeof v === "string" && MODEL_VALUES.has(v);
}
export function isClaudeEffort(v: unknown): v is string {
  return typeof v === "string" && EFFORT_VALUES.has(v);
}

export interface ClaudeCliOptions {
  system: string;
  prompt: string;
  /** Alias for `--model`; "default" or undefined leaves the CLI's default. */
  model?: string;
  /** `--effort` level; "default" or undefined leaves the CLI's default. */
  effort?: string;
  signal?: AbortSignal;
  /** Wall-clock cap for the whole run. Default 5 minutes. */
  timeoutMs?: number;
}

// ─── Environment ─────────────────────────────────────────────────────────────

/**
 * A nested `claude` inherits CLAUDECODE from an interactive parent session and
 * refuses to start ("cannot be run inside Claude Code"). This app is often
 * launched from such a session, so strip the markers.
 */
function cliEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, PATH: buildAgentPath() };
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;
  delete env.CLAUDE_CODE_EXECPATH;
  return env;
}

let emptyMcpConfigPath: string | null = null;
/** `--strict-mcp-config` needs a file to point at; an empty one drops every MCP server. */
function emptyMcpConfig(): string {
  if (!emptyMcpConfigPath) {
    const dir = mkdtempSync(join(tmpdir(), "pa-claude-"));
    emptyMcpConfigPath = join(dir, "empty-mcp.json");
    writeFileSync(emptyMcpConfigPath, '{"mcpServers":{}}');
  }
  return emptyMcpConfigPath;
}

function buildArgs(opts: ClaudeCliOptions, outputFormat: "json" | "stream-json"): string[] {
  const args: string[] = ["-p"];
  if (opts.model && opts.model !== "default") args.push("--model", opts.model);
  if (opts.effort && opts.effort !== "default") args.push("--effort", opts.effort);
  args.push(
    "--output-format", outputFormat,
    "--no-session-persistence",
    "--tools", "",
    "--strict-mcp-config", "--mcp-config", emptyMcpConfig(),
    "--disable-slash-commands",
    "--setting-sources", "",
    "--system-prompt", opts.system,
  );
  if (outputFormat === "stream-json") args.push("--verbose", "--include-partial-messages");
  args.push(opts.prompt);
  return args;
}

// ─── Availability ────────────────────────────────────────────────────────────

let availabilityCache: { at: number; value: ClaudeCliStatus } | null = null;

export interface ClaudeCliStatus {
  available: boolean;
  /** Why not, when unavailable. */
  reason?: string;
  version?: string;
}

/** Binary on PATH + a subscription login on disk. Cached for 60s. */
export async function claudeCliStatus(): Promise<ClaudeCliStatus> {
  if (availabilityCache && Date.now() - availabilityCache.at < 60_000) return availabilityCache.value;
  let value: ClaudeCliStatus;
  try {
    const { stdout } = await execFileAsync("claude", ["--version"], { env: cliEnv(), timeout: 10_000 });
    const version = stdout.trim().split(/\s+/)[0];
    const loggedIn = existsSync(join(homedir(), ".claude", ".credentials.json"))
      || !!process.env.ANTHROPIC_API_KEY;
    value = loggedIn
      ? { available: true, version }
      : { available: false, version, reason: "Claude Code is installed but not logged in. Run: claude /login" };
  } catch {
    value = { available: false, reason: "Claude Code CLI not found on PATH" };
  }
  availabilityCache = { at: Date.now(), value };
  return value;
}

// ─── Streaming ───────────────────────────────────────────────────────────────

interface StreamJsonLine {
  type: string;
  subtype?: string;
  event?: {
    type: string;
    delta?: { type: string; text?: string };
  };
  is_error?: boolean;
  result?: string;
  error?: string;
  message?: { content?: { type: string; text?: string }[] };
  is_api_error_message?: boolean;
}

/**
 * Streams the assistant's text as NDJSON `{token}` lines, then `{done:true}`.
 * Errors (auth, rate limit, spawn failure) arrive as `{error}` lines so the
 * client can show them in place of the reply.
 */
export function streamClaudeCli(opts: ClaudeCliOptions): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const timeoutMs = opts.timeoutMs ?? 5 * 60_000;

  return new ReadableStream({
    start(controller) {
      const emit = (obj: Record<string, unknown>) =>
        controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));

      let child;
      try {
        child = spawn("claude", buildArgs(opts, "stream-json"), {
          cwd: homedir(),
          env: cliEnv(),
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch (err) {
        emit({ error: err instanceof Error ? err.message : "Failed to start claude" });
        controller.close();
        return;
      }

      let closed = false;
      let sawText = false;
      let stderr = "";
      let buffer = "";
      let apiError: string | null = null;

      const finish = (error?: string) => {
        if (closed) return;
        closed = true;
        clearTimeout(timer);
        if (error) emit({ error });
        else emit({ done: true });
        controller.close();
      };

      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        finish("Claude took too long to answer.");
      }, timeoutMs);

      if (opts.signal) {
        opts.signal.addEventListener("abort", () => {
          child.kill("SIGTERM");
          finish();
        }, { once: true });
      }

      child.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });

      child.stdout.on("data", (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim()) continue;
          let parsed: StreamJsonLine;
          try { parsed = JSON.parse(line); } catch { continue; }

          if (parsed.type === "stream_event" && parsed.event?.type === "content_block_delta") {
            const delta = parsed.event.delta;
            if (delta?.type === "text_delta" && delta.text) {
              sawText = true;
              emit({ token: delta.text });
            }
          } else if (parsed.type === "assistant" && parsed.is_api_error_message) {
            // Auth / rate-limit failures come back as a synthetic assistant
            // message ("Not logged in · Please run /login") plus an error code.
            const text = parsed.message?.content?.find((c) => c.type === "text")?.text;
            apiError = text || parsed.error || "Claude returned an error";
          } else if (parsed.type === "result") {
            if (parsed.is_error) apiError = apiError || parsed.result || parsed.error || "Claude returned an error";
            // Non-streaming fallback: if no deltas arrived but a result did, emit it whole.
            else if (!sawText && parsed.result) emit({ token: parsed.result });
          }
        }
      });

      child.on("error", (err) => finish(err.message));
      child.on("close", (code) => {
        if (apiError) return finish(apiError);
        if (code !== 0 && !sawText) {
          const tail = stderr.trim().split("\n").slice(-3).join(" ");
          return finish(tail || `claude exited with code ${code}`);
        }
        finish();
      });
    },
  });
}

// ─── Buffered completion ─────────────────────────────────────────────────────

export class ClaudeCliError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "ClaudeCliError";
    this.status = status;
  }
}

interface JsonResult {
  type: "result";
  is_error?: boolean;
  result?: string;
  error?: string;
}

/** One-shot text completion; resolves with the assistant's full reply. */
export function completeClaudeCli(opts: ClaudeCliOptions): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? 5 * 60_000;
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn("claude", buildArgs(opts, "json"), {
        cwd: homedir(),
        env: cliEnv(),
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      reject(new ClaudeCliError(err instanceof Error ? err.message : "Failed to start claude", 500));
      return;
    }
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new ClaudeCliError("Claude took too long to answer.", 504));
    }, timeoutMs);
    if (opts.signal) {
      opts.signal.addEventListener("abort", () => child.kill("SIGTERM"), { once: true });
    }
    child.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
    child.on("error", (err) => { clearTimeout(timer); reject(new ClaudeCliError(err.message, 500)); });
    child.on("close", (code) => {
      clearTimeout(timer);
      let parsed: JsonResult | null = null;
      try { parsed = JSON.parse(stdout.trim()); } catch { /* handled below */ }
      if (parsed && parsed.type === "result") {
        if (parsed.is_error) {
          const msg = parsed.result || parsed.error || "Claude returned an error";
          reject(new ClaudeCliError(msg, /not logged in/i.test(msg) ? 401 : 502));
        } else {
          resolve(parsed.result || "");
        }
        return;
      }
      const tail = stderr.trim().split("\n").slice(-3).join(" ");
      reject(new ClaudeCliError(tail || `claude exited with code ${code}`, 502));
    });
  });
}
