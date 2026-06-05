"use client";

/**
 * Claude Code Widget — Terminal-driven, JSONL-tailed chat interface.
 *
 * Architecture:
 * - Each Claude session = one PTY terminal running `claude --dangerously-skip-permissions`
 *   (or `claude --resume <id> ...` when resuming). Terminals are stored in a module-level
 *   Map so they survive React remounts.
 * - The chat UI is a clean view of the session JSONL file, tailed via SSE
 *   (/api/claude-sessions/messages?sessionId=...). Tool uses are summarized as compact pills.
 * - Submitting from chat pastes the prompt + ENTER into the live terminal.
 * - Default view is the chat. A toggle reveals the raw terminal. Both views target the
 *   same underlying session.
 */

import { WidgetWrapper } from "@/components/widget-wrapper";
import {
  Bot,
  Plus,
  Send,
  Loader2,
  PanelLeftClose,
  PanelLeftOpen,
  X,
  Copy,
  Wrench,
  FolderOpen,
  Terminal as TerminalIcon,
  MessageSquare,
  RefreshCw,
  Trash2,
  Search,
  GitBranch,
  ChevronDown,
  ChevronRight,
  Sparkles,
  Palette,
  Star,
  Pencil,
  Paperclip,
  Clock,
  Calendar as CalendarIcon,
  RotateCw,
  HelpCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";

// ─── Types ───────────────────────────────────────────────────────────────────

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  toolUses?: { name: string; input?: unknown }[];
  /** end_turn | tool_use | max_tokens | stop_sequence | null */
  stopReason?: string | null;
  timestamp: string;
}

// Schedule recurrence rule + entry shape returned by /api/claude-sessions/schedules.
type ScheduleRecurrence =
  | { type: "once" }
  | { type: "every"; intervalMinutes: number }
  | { type: "daily"; hour: number; minute: number }
  | { type: "weekly"; weekdays: number[]; hour: number; minute: number };

interface ScheduleEntry {
  id: string;
  sessionId: string;
  cwd: string;
  prompt: string;
  nextRunAt: string;
  lastRunAt?: string;
  lastStatus?: "ok" | "error";
  lastError?: string;
  recurrence: ScheduleRecurrence;
  enabled: boolean;
  createdAt: string;
  label?: string;
  model?: string;
}

interface ClaudeSessionInfo {
  sessionId: string;
  summary: string;
  firstPrompt: string;
  messageCount: number;
  created: string;
  modified: string;
  gitBranch: string;
  projectPath: string;
  projectDirName: string;
  /** Whether the underlying JSONL log still exists on disk. False for
   *  index-only entries whose log has been cleaned up — those can still be
   *  resumed (CLI re-creates the log) but the chat view will be empty until
   *  the next prompt. */
  hasLog?: boolean;
}

interface SessionState {
  /** Stable client-side key. For new sessions we use `pending-<n>`; for resumes we use the sessionId. */
  key: string;
  /** Real Claude session ID once known (matches the JSONL filename). Same as `key` for resumes. */
  sessionId: string | null;
  /** xterm.Terminal instance — created lazily when user submits or opens terminal view. */
  terminal: any | null;
  /** xterm FitAddon — created with the terminal. */
  fitAddon: any | null;
  /** WebSocket to the PTY server — exists only while a terminal is alive. */
  ws: WebSocket | null;
  /** Whether the underlying CLI process is currently running. False before terminal is spawned and after exit. */
  alive: boolean;
  /** Working directory the terminal would be launched in. */
  cwd: string;
  /** Display label */
  label: string;
  /** Was this started via --resume? */
  isResume: boolean;
  /** True if the original JSONL log existed on disk when we opened this
   *  session. Index-only (phantom) sessions have hasLog=false; resuming them
   *  is fine — the CLI starts a fresh log — but the chat view should show a
   *  graceful empty state rather than "Waiting for first message…". */
  hasLog: boolean;
  /** Encoded project dir name in ~/.claude/projects/ (e.g. "-Users-foo-bar"). */
  projectDirName: string;
  /** Current chat messages (parsed from JSONL via SSE). */
  messages: ChatMessage[];
  /** SSE EventSource currently tailing the JSONL file. */
  sse: EventSource | null;
  /** Pending prompts queued while the terminal is being spawned. Sent in order on PTY ready. */
  pendingPrompts: string[];
  /** True while a terminal is being created (avoid double-spawn). */
  spawningTerminal: boolean;
  /** Model alias to pass via `--model` when spawning a fresh CLI (ignored for resumes). */
  model: string | null;
  /** True while we're waiting for an assistant response after the user submitted. */
  waitingForReply: boolean;
  /** ID of the most recent assistant message we've seen — used to detect "new reply arrived". */
  lastAssistantMessageId: string | null;
  /** True when the terminal output has been idle for a few seconds AND the
   *  tail of the buffer matches a question/confirmation pattern — Claude is
   *  sitting at a TUI prompt waiting for our input (e.g. permission dialogs
   *  or interactive selections). Surfaces as a "needs input" banner in chat. */
  terminalAwaitingInput: boolean;
  /** Snippet of the recent terminal text used to derive terminalAwaitingInput;
   *  shown to the user as a hint of what Claude is asking. */
  terminalAwaitingHint: string;
  /** Rolling buffer of the most recent terminal output (last ~4 KB) used to
   *  detect TUI prompts. Stripped of ANSI escape sequences. */
  terminalRecentText: string;
  /** Timer handle for the idle-detection callback. */
  terminalIdleTimer: ReturnType<typeof setTimeout> | null;
  /** Subscribers that re-render when this session updates. */
  subscribers: Set<() => void>;
}

// ─── Module-level session store (survives React remounts) ────────────────────

const sessionStore = new Map<string, SessionState>();
let pendingCounter = 1;

// ─── Per-session metadata: custom name + starred ─────────────────────────────
// Persisted server-side (~/.personal-assistant/claude-session-meta.json) so
// renames and stars sync across browsers / devices for the same dashboard
// install. localStorage is used as an offline cache so the UI is responsive
// before the server fetch finishes and across reloads when the server is
// briefly unavailable.

interface SessionMeta {
  customName?: string;
  starred?: boolean;
}

const META_STORAGE_KEY = "claude-code-session-meta";
const META_API_URL = "/api/claude-sessions/meta";

// In-memory cache: the source of truth at runtime. Hydrated first from
// localStorage (instant) and then from the server (authoritative). Updates
// write here first, then to localStorage, then queue a server PATCH.
let metaCache: Record<string, SessionMeta> | null = null;
let serverHydrationPromise: Promise<void> | null = null;

function readLocalStorageMeta(): Record<string, SessionMeta> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(META_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeLocalStorageMeta(map: Record<string, SessionMeta>) {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(META_STORAGE_KEY, JSON.stringify(map)); } catch {}
}

function ensureCache(): Record<string, SessionMeta> {
  if (metaCache === null) metaCache = readLocalStorageMeta();
  return metaCache;
}

const metaSubscribers = new Set<() => void>();
function notifyMetaSubscribers() {
  for (const fn of Array.from(metaSubscribers)) {
    try { fn(); } catch {}
  }
}

/**
 * Hydrate the cache from the server on first call. If the server has data,
 * it wins (across-device persistence). If the server is empty but
 * localStorage has entries, push them up so old local-only data isn't lost.
 * Subsequent calls return the same in-flight promise.
 */
function hydrateFromServer(): Promise<void> {
  if (serverHydrationPromise) return serverHydrationPromise;
  if (typeof window === "undefined") return Promise.resolve();

  serverHydrationPromise = (async () => {
    try {
      const res = await fetch(META_API_URL, { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { meta?: Record<string, SessionMeta> };
      const serverMap = data.meta || {};
      const localMap = readLocalStorageMeta();

      if (Object.keys(serverMap).length > 0) {
        // Server is the source of truth.
        metaCache = serverMap;
        writeLocalStorageMeta(serverMap);
      } else if (Object.keys(localMap).length > 0) {
        // First time on a server with no meta — push localStorage data up so
        // existing renames migrate to the shared store.
        metaCache = localMap;
        try {
          await fetch(META_API_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "replace", meta: localMap }),
          });
        } catch {}
      } else {
        metaCache = {};
      }
      notifyMetaSubscribers();
    } catch {
      // Server unavailable — keep using whatever localStorage gave us.
    }
  })();

  return serverHydrationPromise;
}

function getSessionMeta(sessionId: string): SessionMeta {
  return ensureCache()[sessionId] || {};
}

function setSessionMeta(sessionId: string, patch: Partial<SessionMeta>) {
  const map = { ...ensureCache() };
  const merged = { ...(map[sessionId] || {}), ...patch };
  // Drop empty strings so they don't override the natural title.
  if (merged.customName !== undefined && !merged.customName.trim()) {
    delete merged.customName;
  }
  if (Object.keys(merged).length === 0) {
    delete map[sessionId];
  } else {
    map[sessionId] = merged;
  }
  metaCache = map;
  writeLocalStorageMeta(map);
  notifyMetaSubscribers();

  // Persist to server (fire-and-forget). Failure leaves the cache + local
  // copy intact so the user still sees the change locally; next change
  // attempt will retry.
  if (typeof window !== "undefined") {
    const newEntry = map[sessionId];
    fetch(META_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        newEntry
          ? { action: "set", sessionId, meta: newEntry }
          : { action: "delete", sessionId },
      ),
    }).catch(() => {});
  }
}

/** Drop a session's meta entry both locally and on the server (used when the
 *  underlying session is deleted). */
function deleteSessionMeta(sessionId: string) {
  const map = { ...ensureCache() };
  if (map[sessionId]) {
    delete map[sessionId];
    metaCache = map;
    writeLocalStorageMeta(map);
    notifyMetaSubscribers();
  }
  if (typeof window !== "undefined") {
    fetch(META_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete", sessionId }),
    }).catch(() => {});
  }
}

function useSessionMetaMap(): Record<string, SessionMeta> {
  const [, setTick] = useState(0);
  useEffect(() => {
    const onChange = () => setTick((t) => t + 1);
    metaSubscribers.add(onChange);
    // Kick off server hydration on first mount; updates re-render via
    // notifyMetaSubscribers when the fetch resolves.
    hydrateFromServer();
    return () => { metaSubscribers.delete(onChange); };
  }, []);
  return ensureCache();
}

const PTY_WS_URL = typeof window !== "undefined"
  ? `ws://${window.location.hostname}:4445`
  : "ws://localhost:4445";

// Convert an absolute path into the encoded directory name Claude CLI uses.
// Note: caller should pass an absolute path (not "~"). The CLI expands ~ before
// computing the encoded name.
function encodeProjectDirName(absPath: string): string {
  if (!absPath || absPath === "/") return "-";
  return absPath.replace(/\//g, "-");
}

// Quote a string for safe inclusion in a POSIX shell command.
// Wraps in single quotes and escapes any embedded single quotes.
function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

// Escape a string for safe use inside a RegExp literal pattern.
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ─── Inline-question detection (for assistant chat messages) ────────────────

/**
 * Decide whether an assistant message text "ends in a question" — a soft
 * signal that Claude is waiting for the user to weigh in. We're conservative
 * about false positives: rhetorical questions in the middle of a long
 * paragraph don't count; only a real question mark within the last few
 * non-empty lines.
 */
function messageHasOpenQuestion(text: string): boolean {
  if (!text) return false;
  const trimmed = text.trim();
  if (!trimmed.endsWith("?")) {
    // Allow a trailing closing parenthesis or quote: "... do this?)"
    if (!/[?][)"'`]$/.test(trimmed)) return false;
  }
  // Some assistant turns end with a generic "let me know if you have any
  // questions?" — that's a closer, not a real question. Filter out a few.
  const tailLine = trimmed.split(/\n+/).slice(-1)[0] || "";
  if (/let me know.*questions/i.test(tailLine)) return false;
  return true;
}

// ─── Terminal-prompt detection ───────────────────────────────────────────────

/** Regexes covering common ANSI escape sequences (CSI/OSC/SS3) and a handful
 *  of control bytes the CLI uses to redraw its TUI. Stripping these gives us
 *  a reasonably clean text view of what's on screen. */
const ANSI_RE = /\x1b\][^\x07]*\x07|\x1b\[\??[\d;]*[A-Za-z]|\x1b[()][\dA-Za-z]|\x1b[=>]|\x1b[NO]|\x1b\][^\x1b]*\x1b\\|\r/g;

function stripAnsi(input: string): string {
  // eslint-disable-next-line no-control-regex
  return input.replace(ANSI_RE, "");
}

/**
 * Decide whether the trailing snippet of terminal text looks like Claude is
 * sitting at an interactive prompt waiting for user input. We sniff for:
 *  - Yes/no style questions: "(y/n)", "(yes/no)", "[y/n]"
 *  - Numbered selection menus (CLI's permission prompt: "1. Yes 2. No, ...")
 *  - "❯ " or "> " selectors (TUI list pickers like /resume)
 *  - Plain "?" at the very end with no recent assistant turn marker
 *
 * Returns a short hint of what's being asked, or "" if nothing matches.
 */
function detectTerminalPrompt(rawText: string): string {
  if (!rawText) return "";
  // Keep only the last ~800 chars — TUI prompts always live at the bottom.
  const tail = rawText.slice(-800);
  const lines = tail.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return "";

  // 1. y/n style on the last few lines.
  const lastFew = lines.slice(-6).join(" ");
  if (/\b(y\/n|yes\/no|y\s*\/\s*n)\b/i.test(lastFew)) {
    const m = lines.slice(-6).reverse().find((l) => /\?/.test(l));
    return m ? m.slice(0, 120) : "Confirmation requested";
  }

  // 2. Numbered menu: at least 2 lines starting with "1." and "2." within the tail.
  const optionLines = lines.slice(-20).filter((l) => /^[❯>]?\s*\d+\.\s+/.test(l));
  if (optionLines.length >= 2) {
    // The question is usually the line just above the first option.
    const idx = lines.findIndex((l) => /^[❯>]?\s*1\.\s+/.test(l));
    const prompt = idx > 0 ? lines[idx - 1] : "Choice required";
    return (prompt + " (" + optionLines.length + " options)").slice(0, 160);
  }

  // 3. TUI selector ("❯ option") with no other progress markers.
  if (lines.slice(-10).some((l) => l.startsWith("❯ "))) {
    const idx = lines.slice(-10).findIndex((l) => l.startsWith("❯ "));
    const offset = lines.length - 10 + idx;
    const prompt = offset > 0 ? lines[offset - 1] : "Selection required";
    return prompt.slice(0, 160);
  }

  // 4. Last non-empty line ends with a question mark — and isn't obviously a
  //    Claude reply marker (no "·" / spinner glyph). Conservative: only trigger
  //    if the line is short (<= 200 chars), which interactive prompts usually are.
  const last = lines[lines.length - 1];
  if (last && last.endsWith("?") && last.length <= 200) {
    // Avoid false positives: the input box itself is typically empty or has
    // a placeholder; the prompt question is on a separate line.
    return last.slice(0, 160);
  }

  return "";
}

function notifySubscribers(state: SessionState) {
  for (const fn of Array.from(state.subscribers)) {
    try { fn(); } catch {}
  }
}

// ─── Color / theme helpers (mirrors terminal-panel.tsx) ──────────────────────

function resolveColor(cssValue: string, fallback: string): string {
  if (!cssValue) return fallback;
  try {
    const el = document.createElement("div");
    el.style.color = cssValue;
    document.body.appendChild(el);
    const computed = getComputedStyle(el).color;
    document.body.removeChild(el);
    if (!computed) return fallback;
    const m = computed.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (!m) return fallback;
    const r = parseInt(m[1]); const g = parseInt(m[2]); const b = parseInt(m[3]);
    return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
  } catch { return fallback; }
}

function getCssVarHex(varName: string, fallback: string): string {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  return raw ? resolveColor(raw, fallback) : fallback;
}

function isDarkMode(): boolean {
  return document.documentElement.classList.contains("dark");
}

function getTermTheme() {
  const dark = isDarkMode();
  const bg = getCssVarHex("--card", dark ? "#1c1c1e" : "#ffffff");
  const fg = getCssVarHex("--foreground", dark ? "#e4e4e7" : "#18181b");
  const cursor = getCssVarHex("--primary", dark ? "#a78bfa" : "#6d28d9");
  return {
    background: bg,
    foreground: fg,
    cursor,
    cursorAccent: bg,
    selectionBackground: dark ? "rgba(167, 139, 250, 0.3)" : "rgba(109, 40, 217, 0.2)",
    selectionInactiveBackground: dark ? "rgba(167, 139, 250, 0.15)" : "rgba(109, 40, 217, 0.1)",
    black: dark ? "#18181b" : "#27272a",
    red: dark ? "#f87171" : "#dc2626",
    green: dark ? "#4ade80" : "#16a34a",
    yellow: dark ? "#facc15" : "#ca8a04",
    blue: dark ? "#60a5fa" : "#2563eb",
    magenta: dark ? "#c084fc" : "#9333ea",
    cyan: dark ? "#22d3ee" : "#0891b2",
    white: dark ? "#e4e4e7" : "#f4f4f5",
    brightBlack: dark ? "#52525b" : "#a1a1aa",
    brightRed: dark ? "#fca5a5" : "#ef4444",
    brightGreen: dark ? "#86efac" : "#22c55e",
    brightYellow: dark ? "#fde68a" : "#eab308",
    brightBlue: dark ? "#93c5fd" : "#3b82f6",
    brightMagenta: dark ? "#d8b4fe" : "#a855f7",
    brightCyan: dark ? "#67e8f9" : "#06b6d4",
    brightWhite: dark ? "#fafafa" : "#ffffff",
  };
}

// ─── Session creation / lifecycle ────────────────────────────────────────────

/** How long the terminal must stay quiet before we re-evaluate whether
 *  Claude is sitting at a prompt. Long enough that streaming output (which
 *  arrives in bursts) doesn't trigger us mid-reply, short enough that the
 *  user gets a hint quickly. */
const TERMINAL_IDLE_MS = 2500;

/** Maximum size of the rolling text buffer we keep per session for prompt
 *  detection. Trimmed from the start whenever it grows past this. */
const TERMINAL_BUFFER_MAX = 4096;

/**
 * Record a chunk of raw terminal output, append (ANSI-stripped) to the
 * rolling buffer, and reschedule the idle timer. When the timer fires
 * without further output, run detectTerminalPrompt over the buffer tail
 * and update terminalAwaitingInput accordingly.
 */
function recordTerminalChunk(state: SessionState, chunk: string) {
  if (!chunk) return;

  // Reset awaiting flag on any fresh activity — Claude is doing something
  // again. The idle timer will set it back to true if we go quiet at a
  // prompt-looking screen.
  if (state.terminalAwaitingInput) {
    state.terminalAwaitingInput = false;
    state.terminalAwaitingHint = "";
    notifySubscribers(state);
  }

  const stripped = stripAnsi(chunk);
  state.terminalRecentText = (state.terminalRecentText + stripped).slice(-TERMINAL_BUFFER_MAX);

  if (state.terminalIdleTimer) clearTimeout(state.terminalIdleTimer);
  state.terminalIdleTimer = setTimeout(() => {
    state.terminalIdleTimer = null;
    const hint = detectTerminalPrompt(state.terminalRecentText);
    if (hint) {
      // Only mark as awaiting input if the chat itself isn't currently
      // waiting on a reply (which would be the normal "Claude is working"
      // case, not a TUI prompt).
      if (!state.waitingForReply) {
        state.terminalAwaitingInput = true;
        state.terminalAwaitingHint = hint;
        notifySubscribers(state);
      }
    }
  }, TERMINAL_IDLE_MS);
}

interface OpenSessionOpts {
  cwd: string;
  /** When set, run `claude --resume <id>` instead of a fresh session. */
  resumeId?: string;
  label?: string;
  /** Model alias for the new session (`opus`, `sonnet`, `haiku`, ...). Ignored for resumes. */
  model?: string;
  /** Whether the JSONL log for this session exists on disk. False when the
   *  session is being created from an index-only entry. */
  hasLog?: boolean;
}

/**
 * Open a session — creates the SessionState shell with no terminal.
 * For RESUMED sessions, attaches the SSE tail immediately so the chat populates.
 * For NEW sessions, the SSE tail starts only after a terminal is spawned and
 * the JSONL file appears on disk (because there is no session ID yet).
 */
function openSession(opts: OpenSessionOpts): SessionState {
  const key = opts.resumeId || `pending-${pendingCounter++}`;

  const state: SessionState = {
    key,
    sessionId: opts.resumeId || null,
    terminal: null,
    fitAddon: null,
    ws: null,
    alive: false, // becomes true once the terminal is spawned
    cwd: opts.cwd,
    label: opts.label || (opts.resumeId ? `Resumed ${opts.resumeId.slice(0, 8)}` : "New session"),
    isResume: !!opts.resumeId,
    // Default to true for fresh sessions and explicit-true resumes; only
    // index-only entries pass hasLog=false.
    hasLog: opts.hasLog !== false,
    projectDirName: encodeProjectDirName(opts.cwd),
    messages: [],
    sse: null,
    pendingPrompts: [],
    spawningTerminal: false,
    model: opts.model && opts.model !== "default" ? opts.model : null,
    waitingForReply: false,
    lastAssistantMessageId: null,
    terminalAwaitingInput: false,
    terminalAwaitingHint: "",
    terminalRecentText: "",
    terminalIdleTimer: null,
    subscribers: new Set(),
  };

  sessionStore.set(state.key, state);

  // SSE is attached by the widget when the session becomes active
  // (browsers cap concurrent EventSource connections at ~6 per origin).

  return state;
}

/**
 * Lazily create the PTY terminal for a session. If already alive or being
 * spawned, this is a no-op. After the PTY is open, any queued
 * `pendingPrompts` are flushed to the terminal in order.
 */
async function spawnTerminal(state: SessionState): Promise<boolean> {
  if (state.alive || state.spawningTerminal) return state.alive;
  if (state.ws) return false; // there's already an exited terminal — ignore

  state.spawningTerminal = true;
  notifySubscribers(state);

  try {
    const { Terminal } = await import("@xterm/xterm");
    const { FitAddon } = await import("@xterm/addon-fit");
    const { WebLinksAddon } = await import("@xterm/addon-web-links");
    await import("@xterm/xterm/css/xterm.css");

    // Resolve cwd. Prefer keeping it as-is. The PTY server's cwd handling
    // requires the path to literally exist via existsSync, so we also build
    // a `cd <path> && <cmd>` chain as a defensive measure (works even when
    // pty-server falls back to $HOME because the path can't be statted, e.g.
    // if it has a tilde or escaped characters).
    const cwd = state.cwd && state.cwd.trim() ? state.cwd.trim() : "";

    // For resumed sessions, the model is dictated by the saved JSONL — don't
    // override it via --model. For fresh sessions, pass --model only when the
    // user has explicitly selected a non-default option; "default" means
    // "let the CLI use its own saved default".
    const modelArg = !state.sessionId && state.model ? ` --model ${state.model}` : "";
    const claudeCmd = state.sessionId
      ? `claude --dangerously-skip-permissions --resume ${state.sessionId}`
      : `claude --dangerously-skip-permissions${modelArg}`;
    // Build: cd "<path>" && <claudeCmd>. Skip the cd if cwd is empty.
    const cmd = cwd
      ? `cd ${shellQuote(cwd)} && ${claudeCmd}`
      : claudeCmd;

    const theme = getTermTheme();
    const terminal = new Terminal({
      cursorBlink: true,
      cursorStyle: "block",
      fontSize: 13,
      fontFamily: "Menlo, Monaco, 'Courier New', monospace",
      lineHeight: 1.2,
      theme,
      allowProposedApi: true,
      scrollback: 5000,
      convertEol: true,
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(new WebLinksAddon());

    // Open into a temporary off-screen div so xterm builds its DOM eagerly.
    const tmpDiv = document.createElement("div");
    tmpDiv.style.cssText = "position:absolute;left:-9999px;width:600px;height:300px";
    document.body.appendChild(tmpDiv);
    terminal.open(tmpDiv);
    document.body.removeChild(tmpDiv);

    const wsUrl = new URL(PTY_WS_URL);
    if (cwd) wsUrl.searchParams.set("cwd", cwd);
    wsUrl.searchParams.set("cmd", cmd);

    const ws = new WebSocket(wsUrl.toString());

    state.terminal = terminal;
    state.fitAddon = fitAddon;
    state.ws = ws;
    state.alive = true;

    ws.onopen = () => {
      try {
        fitAddon.fit();
        const dims = fitAddon.proposeDimensions();
        if (dims) ws.send(JSON.stringify({ type: "resize", cols: dims.cols, rows: dims.rows }));
      } catch {}

      // Flush queued prompts after the CLI has had a moment to start its TUI.
      // The CLI needs ~1-2 seconds before it accepts input on the prompt line.
      // Each prompt is sent as text-then-Enter so the bracketed-paste handler
      // doesn't swallow the submit (see sendPromptAndEnter).
      const flushQueue = () => {
        if (!state.pendingPrompts.length) return;
        const queued = state.pendingPrompts;
        state.pendingPrompts = [];
        notifySubscribers(state);
        // Stagger multiple queued prompts so each completes a submit cycle
        // before the next paste begins.
        let delay = 0;
        for (const p of queued) {
          setTimeout(() => sendPromptAndEnter(ws, p.replace(/\r+$/, "")), delay);
          delay += 250;
        }
      };
      setTimeout(flushQueue, 1500);
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "output") {
          terminal.write(msg.data);
          recordTerminalChunk(state, typeof msg.data === "string" ? msg.data : "");
        } else if (msg.type === "exit") {
          terminal.writeln("\r\n\x1b[90m[Process exited]\x1b[0m");
          state.alive = false;
          state.terminalAwaitingInput = false;
          if (state.terminalIdleTimer) clearTimeout(state.terminalIdleTimer);
          notifySubscribers(state);
        }
      } catch {
        terminal.write(event.data);
      }
    };

    ws.onclose = () => {
      state.alive = false;
      notifySubscribers(state);
    };

    ws.onerror = () => {
      state.alive = false;
      notifySubscribers(state);
    };

    terminal.onData((data: string) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "input", data }));
      }
      // The user typed something into the terminal — assume they're responding
      // to whatever Claude was asking. Clear the awaiting flag so the chat's
      // banner doesn't linger.
      if (state.terminalAwaitingInput) {
        state.terminalAwaitingInput = false;
        state.terminalAwaitingHint = "";
        notifySubscribers(state);
      }
    });

    // For NEW sessions, kick off polling for the new JSONL file so SSE can attach.
    if (!state.sessionId) {
      pollForNewSessionId(state);
    }

    state.spawningTerminal = false;
    notifySubscribers(state);
    return true;
  } catch (err) {
    console.error("[claude-code-widget] spawnTerminal failed:", err);
    state.spawningTerminal = false;
    notifySubscribers(state);
    return false;
  }
}

// For NEW sessions: poll ~/.claude/projects/<encoded>/ for the newest *.jsonl
// that wasn't there before, then start the SSE tail.
async function pollForNewSessionId(state: SessionState) {
  const before = new Set<string>();
  // Snapshot existing sessions in the same project dir
  try {
    const res = await fetch(`/api/claude-sessions?project=${encodeURIComponent(state.projectDirName)}`);
    if (res.ok) {
      const data = await res.json();
      for (const s of (data.sessions || []) as ClaudeSessionInfo[]) before.add(s.sessionId);
    }
  } catch {}

  let attempts = 0;
  const interval = setInterval(async () => {
    attempts++;
    // Stop if the session has been resolved already, or we've been polling for 2 minutes,
    // or the session was destroyed.
    if (state.sessionId || attempts > 120 || !sessionStore.has(state.key)) {
      clearInterval(interval);
      return;
    }
    try {
      const res = await fetch(`/api/claude-sessions?project=${encodeURIComponent(state.projectDirName)}`);
      if (!res.ok) return;
      const data = await res.json();
      const sessions = (data.sessions || []) as ClaudeSessionInfo[];
      // Find newest sessionId not in `before`
      let found: ClaudeSessionInfo | null = null;
      for (const s of sessions) {
        if (!before.has(s.sessionId)) {
          if (!found || (s.modified || "").localeCompare(found.modified || "") > 0) {
            found = s;
          }
        }
      }
      if (found) {
        clearInterval(interval);
        const oldKey = state.key;
        state.sessionId = found.sessionId;
        // Re-key the store under the real session ID so future lookups by id
        // find it. Keep the original (pending-N) key as an alias so React
        // refs that captured the old key still resolve to the same state.
        if (oldKey !== found.sessionId) {
          state.key = found.sessionId;
          sessionStore.set(found.sessionId, state);
          // Leave oldKey → state in the store too (alias).
        }
        // Don't attach SSE here — the React layer manages connections so
        // browsers don't exhaust the per-origin EventSource pool. Notifying
        // subscribers triggers the active-session useEffect, which will call
        // attachSse if this session is currently active.
        notifySubscribers(state);
      }
    } catch {}
  }, 1000);
}

function attachSse(state: SessionState) {
  if (state.sse) return;
  if (!state.sessionId) return;
  const url = `/api/claude-sessions/messages?sessionId=${encodeURIComponent(state.sessionId)}&projectDir=${encodeURIComponent(state.projectDirName)}`;
  const es = new EventSource(url);
  state.sse = es;

  es.addEventListener("messages", (ev: MessageEvent) => {
    try {
      const data = JSON.parse(ev.data) as { messages: ChatMessage[]; replace?: boolean };
      if (data.replace) {
        state.messages = data.messages;
      } else if (data.messages?.length) {
        // Dedupe by id
        const existing = new Set(state.messages.map((m) => m.id));
        for (const m of data.messages) {
          if (!existing.has(m.id)) state.messages.push(m);
        }
      }
      // Derive whether Claude is still working from the JSONL itself.
      // A multi-turn response (tool_use loops) writes several assistant
      // entries before stop_reason becomes "end_turn"; only then is the
      // session truly idle. tool_use → more turns coming. user as last →
      // we're between user submit and Claude's first reply.
      //
      // Note: we never *clear* waitingForReply unless we see a terminal
      // stop_reason on the latest assistant message. This prevents a stale
      // "end_turn" message from flipping the indicator off right after the
      // user submitted but before the JSONL has flushed the new user line.
      const last = state.messages[state.messages.length - 1];
      if (last) {
        if (last.role === "user") {
          state.waitingForReply = true;
        } else if (last.role === "assistant") {
          const stop = last.stopReason || "";
          if (stop === "tool_use") {
            state.waitingForReply = true;
          } else if (stop && stop !== "tool_use") {
            // end_turn / max_tokens / stop_sequence → done.
            // Only clear if the last assistant message id has actually changed
            // since we last saw it (otherwise we may be replaying old state
            // before a fresh user submit has been flushed).
            if (last.id !== state.lastAssistantMessageId) {
              state.waitingForReply = false;
            }
          }
          state.lastAssistantMessageId = last.id;
        }
      }
      notifySubscribers(state);
    } catch {}
  });

  es.onerror = () => {
    // Browser auto-reconnects; nothing to do here unless we want explicit handling.
  };
}

/**
 * Close the SSE EventSource for a session. Browsers cap concurrent
 * EventSource connections at ~6 per origin (HTTP/1.1), so we keep an SSE
 * open only for the currently-active session and detach when the user
 * switches away. Re-attaching later will replay the JSONL from scratch
 * via the `replace: true` initial event.
 */
function detachSse(state: SessionState) {
  if (!state.sse) return;
  try { state.sse.close(); } catch {}
  state.sse = null;
}

/**
 * Submit a prompt to the session. If the terminal is alive, paste the text
 * and then send Enter as a separate keystroke (Claude's TUI uses bracketed
 * paste mode — sending text + \r in a single write makes the \r part of the
 * paste content, so the prompt sits in the input box without being
 * submitted). Otherwise, queue the prompt and lazily spawn the terminal —
 * pending prompts are flushed once the PTY is ready.
 */
async function submitPrompt(state: SessionState, text: string): Promise<boolean> {
  // Strip any trailing \r the caller might have appended; we send Enter
  // ourselves as a distinct keystroke after the text settles.
  const promptText = text.replace(/\r+$/, "");

  // Mark this session as waiting for an assistant reply. Cleared by the
  // SSE handler when the next assistant message lands. Per-session, so
  // other sessions' chat views don't show the indicator.
  state.waitingForReply = true;
  // Submitting from chat is itself a response — clear any pending TUI prompt.
  state.terminalAwaitingInput = false;
  state.terminalAwaitingHint = "";

  if (state.alive && state.ws && state.ws.readyState === WebSocket.OPEN) {
    sendPromptAndEnter(state.ws, promptText);
    notifySubscribers(state);
    return true;
  }

  // Queue the prompt and ensure a terminal is being spawned.
  state.pendingPrompts.push(promptText);
  notifySubscribers(state);
  if (!state.spawningTerminal && !state.alive) {
    spawnTerminal(state);
  }
  return true;
}

/**
 * Write a prompt to a PTY in two beats: first the text, then \r as a separate
 * input event after a short delay. Claude's TUI runs in bracketed paste
 * mode; if we send "text + \r" in one chunk it's treated as a paste with a
 * trailing newline (i.e. the \r becomes a multi-line input), not as a submit.
 * Splitting them lets the TUI flush the paste, exit bracketed-paste mode,
 * then receive Enter as a real keypress that submits.
 */
function sendPromptAndEnter(ws: WebSocket, text: string) {
  if (text) {
    try { ws.send(JSON.stringify({ type: "input", data: text })); } catch {}
  }
  // 80 ms is comfortably long enough for ink/Claude's TUI to drain the
  // paste sequence on the same event loop tick before our Enter arrives.
  setTimeout(() => {
    if (ws.readyState !== WebSocket.OPEN) return;
    try { ws.send(JSON.stringify({ type: "input", data: "\r" })); } catch {}
  }, 80);
}

function destroySession(key: string) {
  const state = sessionStore.get(key);
  if (!state) return;
  try { state.sse?.close(); } catch {}
  try { state.ws?.close(); } catch {}
  try { state.terminal?.dispose(); } catch {}
  if (state.terminalIdleTimer) clearTimeout(state.terminalIdleTimer);
  state.terminalIdleTimer = null;
  state.subscribers.clear();
  // Remove every alias pointing to this state (a pending session may have
  // been re-keyed once its real session ID resolved, leaving an alias entry).
  for (const [k, v] of Array.from(sessionStore.entries())) {
    if (v === state) sessionStore.delete(k);
  }
}

/** Stop just the terminal/PTY for this session, keeping chat & SSE alive. */
function stopTerminal(state: SessionState) {
  try { state.ws?.close(); } catch {}
  try { state.terminal?.dispose(); } catch {}
  if (state.terminalIdleTimer) clearTimeout(state.terminalIdleTimer);
  state.terminalIdleTimer = null;
  state.terminal = null;
  state.fitAddon = null;
  state.ws = null;
  state.alive = false;
  state.terminalAwaitingInput = false;
  state.terminalAwaitingHint = "";
  notifySubscribers(state);
}

// ─── Subscribe-hook for a single session ─────────────────────────────────────

function useSessionSubscription(key: string | null): SessionState | null {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!key) return;
    const state = sessionStore.get(key);
    if (!state) return;
    const onChange = () => setTick((t) => t + 1);
    state.subscribers.add(onChange);
    return () => { state.subscribers.delete(onChange); };
  }, [key]);
  return key ? sessionStore.get(key) || null : null;
}

// ─── Tool-use pill ───────────────────────────────────────────────────────────

/** Build a one-line summary of a tool_use input for the chat view. */
function summarizeToolInput(name: string, input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const i = input as Record<string, unknown>;
  const lower = name.toLowerCase();
  if (lower === "bash" && typeof i.command === "string") return i.command;
  if ((lower === "read" || lower === "edit" || lower === "write") && typeof i.file_path === "string") return i.file_path;
  if (lower === "glob" && typeof i.pattern === "string") return i.pattern;
  if (lower === "grep" && typeof i.pattern === "string") {
    const path = typeof i.path === "string" ? ` in ${i.path}` : "";
    return `${i.pattern}${path}`;
  }
  if (lower === "webfetch" && typeof i.url === "string") return i.url;
  if ((lower === "task" || lower === "agent") && typeof i.description === "string") return i.description;
  if (lower === "todowrite") {
    const todos = Array.isArray(i.todos) ? i.todos.length : 0;
    return `${todos} item${todos === 1 ? "" : "s"}`;
  }
  // Fallback: first string value of any field
  for (const key of ["query", "description", "path", "url", "filename", "name"]) {
    if (typeof i[key] === "string") return i[key] as string;
  }
  return "";
}

function ToolUsePill({ name, input }: { name: string; input?: unknown }) {
  const [open, setOpen] = useState(false);
  const summary = summarizeToolInput(name, input);
  const hasDetails = input !== undefined && input !== null;

  let pretty = "";
  if (hasDetails) {
    try {
      pretty = JSON.stringify(input, null, 2);
    } catch {
      pretty = String(input);
    }
  }

  return (
    <span className="inline-flex flex-col items-stretch mr-1 mt-1 max-w-full">
      <button
        type="button"
        onClick={() => hasDetails && setOpen((v) => !v)}
        className={cn(
          "inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded bg-muted/60 text-muted-foreground border border-border/60",
          hasDetails && "hover:bg-muted cursor-pointer",
          !hasDetails && "cursor-default",
        )}
        title={summary || name}
      >
        {hasDetails ? (
          open ? <ChevronDown className="h-2.5 w-2.5 shrink-0" /> : <ChevronRight className="h-2.5 w-2.5 shrink-0" />
        ) : (
          <Wrench className="h-2.5 w-2.5 shrink-0" />
        )}
        <span className="font-medium">{name}</span>
        {summary && (
          <span className={cn("font-mono text-[10px] opacity-80", open ? "" : "truncate max-w-[260px]")}>{summary}</span>
        )}
      </button>
      {open && hasDetails && (
        <pre className="mt-1 px-2 py-1.5 rounded bg-background/60 border border-border/60 text-[10px] font-mono overflow-x-auto whitespace-pre-wrap break-words">
          {pretty}
        </pre>
      )}
    </span>
  );
}

// ─── Chat themes ─────────────────────────────────────────────────────────────

type ChatTheme = "default" | "bubbles" | "compact" | "terminal" | "document";

const THEME_OPTIONS: { value: ChatTheme; label: string; description: string }[] = [
  { value: "default", label: "Default", description: "Rounded bubbles, classic shadcn look" },
  { value: "bubbles", label: "Bubbles", description: "Chat-app style — fuller rounding, grouped messages" },
  { value: "compact", label: "Compact", description: "Dense, no avatars, glyph-only role markers" },
  { value: "terminal", label: "Terminal", description: "Monospaced, ASCII prompts ($/>) on every line" },
  { value: "document", label: "Document", description: "Transcript style — full-width, role labels" },
];

function ThemePicker({
  value,
  onChange,
}: {
  value: ChatTheme;
  onChange: (v: ChatTheme) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const current = THEME_OPTIONS.find((t) => t.value === value) || THEME_OPTIONS[0];

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 px-2 h-7 text-xs rounded-md hover:bg-muted text-muted-foreground hover:text-foreground"
        title={`Theme: ${current.label}`}
      >
        <Palette className="h-3 w-3" />
        <ChevronDown className="h-3 w-3" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-20 w-64 rounded-md border border-border bg-popover shadow-md py-1">
          {THEME_OPTIONS.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => { onChange(t.value); setOpen(false); }}
              className={cn(
                "w-full text-left px-2 py-1.5 hover:bg-accent flex flex-col gap-0.5",
                t.value === value && "bg-accent",
              )}
            >
              <span className="text-xs font-medium">{t.label}</span>
              <span className="text-[10px] text-muted-foreground">{t.description}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Model picker ────────────────────────────────────────────────────────────

const MODEL_OPTIONS: { value: string; label: string; description: string }[] = [
  { value: "default", label: "Default", description: "Recommended — Opus 4.8 with 1M context" },
  { value: "opus", label: "Opus", description: "Opus 4.8 — most capable for complex work" },
  { value: "sonnet", label: "Sonnet", description: "Sonnet 4.6 — best for everyday tasks" },
  { value: "sonnet[1m]", label: "Sonnet (1M)", description: "Sonnet 4.6 with 1M context — uses credits" },
  { value: "haiku", label: "Haiku", description: "Haiku 4.5 — fastest for quick answers" },
];

function ModelPicker({
  value,
  onChange,
  sessionAlive,
}: {
  value: string;
  onChange: (v: string) => void;
  sessionAlive: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const current = MODEL_OPTIONS.find((m) => m.value === value) || MODEL_OPTIONS[0];

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 px-2 h-7 text-xs rounded-md hover:bg-muted text-muted-foreground hover:text-foreground"
        title={sessionAlive ? `Model: ${current.label}` : `Model: ${current.label} — applies on next session start`}
      >
        <Sparkles className="h-3 w-3" />
        <span>{current.label}</span>
        <ChevronDown className="h-3 w-3" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-20 w-64 rounded-md border border-border bg-popover shadow-md py-1">
          {MODEL_OPTIONS.map((m) => (
            <button
              key={m.value}
              type="button"
              onClick={() => { onChange(m.value); setOpen(false); }}
              className={cn(
                "w-full text-left px-2 py-1.5 hover:bg-accent flex flex-col gap-0.5",
                m.value === value && "bg-accent",
              )}
            >
              <span className="text-xs font-medium">{m.label}</span>
              <span className="text-[10px] text-muted-foreground">{m.description}</span>
            </button>
          ))}
          {!sessionAlive && (
            <div className="px-2 pt-1 mt-1 border-t border-border text-[10px] text-muted-foreground">
              Applies on next session start
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Markdown-lite renderer ──────────────────────────────────────────────────

function renderInlineFormatting(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g;
  let lastIndex = 0;
  let match;
  let i = 0;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const m = match[0];
    if (m.startsWith("`")) {
      parts.push(<code key={i++} className="px-1 py-0.5 rounded bg-muted/70 text-[0.85em] font-mono">{m.slice(1, -1)}</code>);
    } else if (m.startsWith("**")) {
      parts.push(<strong key={i++}>{m.slice(2, -2)}</strong>);
    } else if (m.startsWith("*")) {
      parts.push(<em key={i++}>{m.slice(1, -1)}</em>);
    } else if (m.startsWith("[")) {
      const linkMatch = m.match(/\[([^\]]+)\]\(([^)]+)\)/);
      if (linkMatch) parts.push(<a key={i++} href={linkMatch[2]} className="underline text-primary" target="_blank" rel="noreferrer">{linkMatch[1]}</a>);
    }
    lastIndex = match.index + m.length;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return <>{parts}</>;
}

// ─── Markdown table detection helpers ───────────────────────────────────────

/** Detect a markdown table-header line — the next line must be a separator
 *  composed of pipes and dashes (with optional colons for alignment). */
function isTableHeader(line: string, nextLine: string | undefined): boolean {
  if (!line || !nextLine) return false;
  if (!line.includes("|")) return false;
  // Header line must have at least one pipe between content; after splitting,
  // we need at least 2 cells.
  const cells = splitTableRow(line);
  if (cells.length < 2) return false;
  // Separator: only pipes, dashes, colons, and spaces, with at least one dash.
  const sep = nextLine.trim();
  if (!/^\|?(\s*:?-+:?\s*\|)+\s*:?-+:?\s*\|?$/.test(sep) && !/^\s*:?-+:?(\s*\|\s*:?-+:?)+\s*$/.test(sep)) return false;
  // Number of separator cells must match number of header cells.
  const sepCells = sep.replace(/^\||\|$/g, "").split("|").map((s) => s.trim()).filter(Boolean);
  return sepCells.length === cells.length;
}

/** Split a "| a | b | c |" or "a | b | c" row into its cells. */
function splitTableRow(raw: string): string[] {
  const trimmed = raw.trim();
  // Strip a leading and trailing pipe if present.
  const stripped = trimmed.replace(/^\|/, "").replace(/\|$/, "");
  return stripped.split("|").map((c) => c.trim());
}

type TableAlign = "left" | "right" | "center" | undefined;

/** Parse alignment markers from a separator line (`:---`, `---:`, `:---:`). */
function parseTableAlignments(sepLine: string, expected: number): TableAlign[] {
  const sep = sepLine.trim().replace(/^\||\|$/g, "");
  const cells = sep.split("|").map((s) => s.trim());
  return cells.slice(0, expected).map((c): TableAlign => {
    const left = c.startsWith(":");
    const right = c.endsWith(":");
    if (left && right) return "center";
    if (right) return "right";
    if (left) return "left";
    return undefined;
  });
}

function renderText(text: string): React.ReactNode {
  const lines = text.split("\n");
  const blocks: React.ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code
    if (line.startsWith("```")) {
      const lang = line.slice(3).trim();
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) { code.push(lines[i]); i++; }
      if (i < lines.length) i++;
      blocks.push(
        <pre key={key++} className="my-2 p-2 rounded bg-muted/50 text-xs font-mono overflow-x-auto">
          {lang && <div className="text-[10px] text-muted-foreground mb-1">{lang}</div>}
          <code>{code.join("\n")}</code>
        </pre>
      );
      continue;
    }

    // Heading
    const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const cls = level <= 2 ? "text-base font-semibold mt-2 mb-1" : "text-sm font-semibold mt-1 mb-1";
      blocks.push(<div key={key++} className={cls}>{renderInlineFormatting(headingMatch[2])}</div>);
      i++;
      continue;
    }

    // Bullet list
    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^[-*]\s+/, ""));
        i++;
      }
      blocks.push(
        <ul key={key++} className="list-disc pl-5 my-1 space-y-0.5">
          {items.map((it, idx) => <li key={idx}>{renderInlineFormatting(it)}</li>)}
        </ul>
      );
      continue;
    }

    // Numbered list
    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s+/, ""));
        i++;
      }
      blocks.push(
        <ol key={key++} className="list-decimal pl-5 my-1 space-y-0.5">
          {items.map((it, idx) => <li key={idx}>{renderInlineFormatting(it)}</li>)}
        </ol>
      );
      continue;
    }

    // Markdown table (header row, separator row of dashes, then body rows).
    // Recognises both "| h | h |" and "h | h" styles. Cells may contain
    // inline formatting (bold, code, etc.).
    if (isTableHeader(line, lines[i + 1])) {
      const headerCells = splitTableRow(line);
      const aligns = parseTableAlignments(lines[i + 1], headerCells.length);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
        rows.push(splitTableRow(lines[i]));
        i++;
      }
      blocks.push(
        <div key={key++} className="my-2 overflow-x-auto rounded-md border border-border">
          <table className="w-full text-xs border-collapse">
            <thead className="bg-muted/60">
              <tr>
                {headerCells.map((h, hi) => (
                  <th
                    key={hi}
                    className={cn(
                      "px-2 py-1.5 font-semibold border-b border-border whitespace-nowrap",
                      aligns[hi] === "right" && "text-right",
                      aligns[hi] === "center" && "text-center",
                      (!aligns[hi] || aligns[hi] === "left") && "text-left",
                    )}
                  >
                    {renderInlineFormatting(h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr
                  key={ri}
                  className={cn(
                    ri !== rows.length - 1 && "border-b border-border/40",
                    ri % 2 === 1 && "bg-muted/20",
                  )}
                >
                  {headerCells.map((_, ci) => (
                    <td
                      key={ci}
                      className={cn(
                        "px-2 py-1.5 align-top",
                        aligns[ci] === "right" && "text-right",
                        aligns[ci] === "center" && "text-center",
                        (!aligns[ci] || aligns[ci] === "left") && "text-left",
                      )}
                    >
                      {renderInlineFormatting(row[ci] ?? "")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    // Blank line
    if (line.trim() === "") {
      blocks.push(<div key={key++} className="h-2" />);
      i++;
      continue;
    }

    // Plain paragraph (collect contiguous non-blank, non-special lines)
    const paraLines: string[] = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !lines[i].startsWith("```") &&
      !lines[i].match(/^(#{1,6})\s+/) &&
      !/^[-*]\s+/.test(lines[i]) &&
      !/^\d+\.\s+/.test(lines[i]) &&
      !isTableHeader(lines[i], lines[i + 1])
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    blocks.push(
      <p key={key++} className="leading-relaxed whitespace-pre-wrap break-words">
        {renderInlineFormatting(paraLines.join("\n"))}
      </p>
    );
  }

  return <>{blocks}</>;
}

// ─── Claude logo ─────────────────────────────────────────────────────────────

function ClaudeIcon({ className }: { className?: string }) {
  return <Bot className={className} />;
}

// ─── Main widget ─────────────────────────────────────────────────────────────

export function ClaudeCodeWidget() {
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [view, setView] = useState<"chat" | "terminal">("chat");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [showFolderPicker, setShowFolderPicker] = useState(false);
  const [creating, setCreating] = useState(false);
  const [showToolCalls, setShowToolCalls] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    const v = localStorage.getItem("claude-code-show-tool-calls");
    return v === null ? true : v === "true";
  });

  // Selected model. The CLI persists its own default via `/model <name>`,
  // but we also remember it locally so the picker shows the user's last
  // choice immediately on open (without waiting for the CLI to respond).
  const [selectedModel, setSelectedModelState] = useState<string>(() => {
    if (typeof window === "undefined") return "default";
    return localStorage.getItem("claude-code-model") || "default";
  });

  // Chat UI theme. Pure visual preference, persisted locally.
  const [chatTheme, setChatTheme] = useState<ChatTheme>(() => {
    if (typeof window === "undefined") return "default";
    const v = localStorage.getItem("claude-code-chat-theme");
    if (v && ["default", "bubbles", "compact", "terminal", "document"].includes(v)) {
      return v as ChatTheme;
    }
    return "default";
  });
  const updateChatTheme = useCallback((t: ChatTheme) => {
    setChatTheme(t);
    try { localStorage.setItem("claude-code-chat-theme", t); } catch {}
  }, []);

  // Active folder + worktrees
  const [activeFolder, setActiveFolder] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return localStorage.getItem("claude-code-active-folder");
  });
  const [worktrees, setWorktrees] = useState<{ path: string; branch?: string; head?: string; bare?: boolean; detached?: boolean }[]>([]);
  const [branches, setBranches] = useState<string[]>([]);

  // Sessions list (from disk)
  const [sessions, setSessions] = useState<ClaudeSessionInfo[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // Scheduled prompts (server-backed). Fetched periodically; modified via
  // the schedule modal and the schedules panel.
  const [schedules, setSchedules] = useState<ScheduleEntry[]>([]);
  const [showSchedules, setShowSchedules] = useState(false);

  // Folder picker state
  const [folderInput, setFolderInput] = useState("");
  const [recentFolders, setRecentFolders] = useState<string[]>([]);

  // Subscribe to active session
  const active = useSessionSubscription(activeKey);
  const sessionMetaMap = useSessionMetaMap();

  // ── Manage SSE connections ─────────────────────────────────────────────
  // Browsers cap concurrent EventSource connections at ~6 per origin (over
  // HTTP/1.1). Without management, opening many sessions exhausts the pool
  // and new tail streams (and other fetches like the sessions refresh) get
  // queued indefinitely. So we keep an SSE open ONLY for the active session
  // and detach all others. Re-activating a session re-opens its SSE; the
  // server replays the JSONL via the initial `replace: true` event.
  useEffect(() => {
    const activeState = activeKey ? sessionStore.get(activeKey) : null;
    // Use object identity (not key) to identify the active state, since a
    // pending session may have been re-keyed once its real session ID resolved.
    const seen = new Set<SessionState>();
    for (const s of sessionStore.values()) {
      if (seen.has(s)) continue;
      seen.add(s);
      if (s === activeState) {
        if (s.sessionId) attachSse(s);
      } else {
        detachSse(s);
      }
    }
  }, [activeKey, active?.sessionId]);

  // ── Load recent folders from localStorage ──────────────────────────────
  useEffect(() => {
    try {
      const raw = localStorage.getItem("claude-code-folders");
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) setRecentFolders(arr);
      }
    } catch {}
  }, []);

  const persistRecentFolder = useCallback((folder: string) => {
    setRecentFolders((prev) => {
      const next = [folder, ...prev.filter((f) => f !== folder)].slice(0, 10);
      try { localStorage.setItem("claude-code-folders", JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  // ── Fetch session list ─────────────────────────────────────────────────
  // When `activeFolder` is set, only sessions whose project dir matches that
  // folder (or one of its worktrees) are returned.
  const fetchSessions = useCallback(async () => {
    setSessionsLoading(true);
    try {
      // Always pull the global list (the API only filters by exact project
      // dirname, but the user-facing filter is "this folder + its worktrees").
      const res = await fetch("/api/claude-sessions");
      if (res.ok) {
        const data = await res.json();
        setSessions(data.sessions || []);
      }
    } catch {}
    setSessionsLoading(false);
  }, []);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  // ── Periodic refresh of session list (when sidebar visible) ────────────
  useEffect(() => {
    if (!sidebarOpen) return;
    const id = setInterval(fetchSessions, 8000);
    return () => clearInterval(id);
  }, [sidebarOpen, fetchSessions]);

  // ── Fetch scheduled prompts ────────────────────────────────────────────
  const fetchSchedules = useCallback(async () => {
    try {
      const res = await fetch("/api/claude-sessions/schedules");
      if (res.ok) {
        const data = await res.json();
        setSchedules(data.schedules || []);
      }
    } catch {}
  }, []);

  useEffect(() => {
    fetchSchedules();
  }, [fetchSchedules]);

  // Refresh schedules whenever the panel is opened so the list reflects any
  // server-side runs that have happened since last view.
  useEffect(() => {
    if (showSchedules) fetchSchedules();
  }, [showSchedules, fetchSchedules]);

  // Listen for a custom event fired when a schedule is created elsewhere
  // (e.g. from the schedule modal inside ChatView) so the sidebar count
  // and list update without manual refresh.
  useEffect(() => {
    const onChange = () => fetchSchedules();
    window.addEventListener("claude-schedules-changed", onChange);
    return () => window.removeEventListener("claude-schedules-changed", onChange);
  }, [fetchSchedules]);

  // ── Theme sync for all open terminals ──────────────────────────────────
  useEffect(() => {
    const observer = new MutationObserver(() => {
      const theme = getTermTheme();
      for (const s of sessionStore.values()) {
        try { if (s.terminal) s.terminal.options.theme = theme; } catch {}
      }
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  // ── Set model: send `/model <name>` to the active session if it has a
  // live terminal, and persist the choice locally. The CLI itself remembers
  // the model as the default for new sessions, so a single `/model` call
  // is enough to flip every future session — we just need a running CLI to
  // deliver the command. If there's no live terminal, the local preference
  // still applies on the next session start (the CLI loads its saved
  // default automatically).
  const setSelectedModel = useCallback((model: string) => {
    setSelectedModelState(model);
    try { localStorage.setItem("claude-code-model", model); } catch {}
    const state = activeKey ? sessionStore.get(activeKey) : null;
    if (state && state.alive && state.ws && state.ws.readyState === WebSocket.OPEN) {
      // Send directly via the PTY WebSocket so we don't trigger the
      // "thinking" indicator (this isn't a user prompt, just a CLI command).
      // Split text + Enter so bracketed-paste mode doesn't swallow the submit.
      sendPromptAndEnter(state.ws, `/model ${model}`);
    }
  }, [activeKey]);

  // ── Start a new session in a chosen folder ─────────────────────────────
  const startNewSession = useCallback(async (cwd: string) => {
    setCreating(true);
    try {
      persistRecentFolder(cwd);
      // Make this the active folder for the worktrees panel
      setActiveFolder(cwd);
      try { localStorage.setItem("claude-code-active-folder", cwd); } catch {}
      const state = openSession({ cwd, label: "New session", model: selectedModel });
      // For brand-new sessions we spawn the terminal eagerly so the CLI is up
      // and the JSONL gets created.
      spawnTerminal(state);
      setActiveKey(state.key);
      setView("chat");
      setShowFolderPicker(false);
    } finally {
      setCreating(false);
    }
  }, [persistRecentFolder, selectedModel]);

  // ── Set active folder (persist to localStorage) ────────────────────────
  const selectActiveFolder = useCallback((folder: string | null) => {
    setActiveFolder(folder);
    try {
      if (folder) localStorage.setItem("claude-code-active-folder", folder);
      else localStorage.removeItem("claude-code-active-folder");
    } catch {}
  }, []);

  // ── Fetch worktrees for the active folder ──────────────────────────────
  const fetchWorktrees = useCallback(async (folder: string) => {
    try {
      const res = await fetch("/api/claude-sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "list-worktrees", dir: folder }),
      });
      if (res.ok) {
        const data = await res.json();
        setWorktrees(data.worktrees || []);
        setBranches(data.branches || []);
      } else {
        setWorktrees([]);
        setBranches([]);
      }
    } catch {
      setWorktrees([]);
      setBranches([]);
    }
  }, []);

  useEffect(() => {
    if (activeFolder) {
      fetchWorktrees(activeFolder);
    } else {
      setWorktrees([]);
      setBranches([]);
    }
  }, [activeFolder, fetchWorktrees]);

  // ── Resume an existing session: open the chat view from JSONL only.
  // Terminal is NOT spawned here — it's spawned lazily when the user submits
  // a prompt or clicks the Terminal toggle.
  const resumeSession = useCallback((s: ClaudeSessionInfo) => {
    // If a session with this id is already in our store, just switch to it.
    const existing = sessionStore.get(s.sessionId);
    if (existing) {
      setActiveKey(existing.key);
      setView("chat");
      return;
    }

    // Use the explicit projectPath the API resolves. It's guaranteed to be
    // accurate (read either from sessions-index.json's originalPath or from
    // the JSONL file's `cwd` field). Fall back to home only if it's missing.
    const cwd = (s.projectPath && s.projectPath.trim()) || "~";

    const customName = getSessionMeta(s.sessionId).customName;
    const label = customName || s.summary || s.firstPrompt?.slice(0, 30) || s.sessionId.slice(0, 8);
    const state = openSession({ cwd, resumeId: s.sessionId, label, hasLog: s.hasLog !== false });
    // The API gives us the canonical project dir name; openSession's default
    // (encoded from cwd) may not match if the path or session moved. Set it
    // before SSE attaches.
    if (s.projectDirName) {
      state.projectDirName = s.projectDirName;
    }
    setActiveKey(state.key);
    setView("chat");
  }, []);

  const closeActiveSession = useCallback(() => {
    if (!activeKey) return;
    destroySession(activeKey);
    setActiveKey(null);
  }, [activeKey]);

  const deleteSessionFromDisk = useCallback(async (sess: ClaudeSessionInfo) => {
    const display = getSessionMeta(sess.sessionId).customName
      || sess.summary
      || sess.firstPrompt?.slice(0, 40)
      || sess.sessionId;
    if (!confirm(`Delete session "${display}"?`)) return;
    try {
      await fetch("/api/claude-sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete-session", sessionId: sess.sessionId, projectDir: sess.projectDirName }),
      });
      // If currently open, close it
      if (sessionStore.has(sess.sessionId)) destroySession(sess.sessionId);
      if (activeKey === sess.sessionId) setActiveKey(null);
      // Drop any rename/star metadata for this session (server + local).
      deleteSessionMeta(sess.sessionId);
      fetchSessions();
    } catch {}
  }, [activeKey, fetchSessions]);

  // ── Filtered sessions ──────────────────────────────────────────────────
  // When a folder is active, show only sessions from that exact folder. Each
  // worktree is its own folder — to view its sessions, click it (which sets
  // it as the active folder). This guarantees worktrees are isolated from
  // each other and from the main checkout. Match on the canonical encoded
  // project-dir name (Claude CLI's on-disk format) with a fallback to exact
  // projectPath match.
  const allowedDirName = activeFolder ? encodeProjectDirName(activeFolder) : null;

  const filteredSessions = sessions.filter((s) => {
    if (allowedDirName && activeFolder) {
      const dirMatch = s.projectDirName === allowedDirName;
      const pathMatch = s.projectPath === activeFolder;
      if (!dirMatch && !pathMatch) return false;
    }
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    const meta = sessionMetaMap[s.sessionId];
    return (
      s.summary?.toLowerCase().includes(q) ||
      s.firstPrompt?.toLowerCase().includes(q) ||
      s.projectPath?.toLowerCase().includes(q) ||
      s.sessionId.toLowerCase().includes(q) ||
      meta?.customName?.toLowerCase().includes(q)
    );
  });

  // Sort: starred sessions first (preserving their relative order), then the
  // rest in API order (already sorted by mtime desc).
  const sortedSessions = [...filteredSessions].sort((a, b) => {
    const aStar = sessionMetaMap[a.sessionId]?.starred ? 1 : 0;
    const bStar = sessionMetaMap[b.sessionId]?.starred ? 1 : 0;
    return bStar - aStar;
  });

  return (
    <WidgetWrapper title="Claude Code" icon={<ClaudeIcon className="h-4 w-4" />} widgetType="claude-code">
      <div className="flex h-full">
        {/* Sidebar */}
        {sidebarOpen && (
          <aside className="w-60 shrink-0 border-r border-border flex flex-col bg-muted/20">
            <div className="p-2 space-y-2 shrink-0">
              <Button
                size="sm"
                variant="default"
                className="w-full"
                onClick={() => {
                  // If a folder is already selected, start a session there
                  // immediately. Only show the picker when there's nothing
                  // to default to.
                  if (activeFolder) startNewSession(activeFolder);
                  else setShowFolderPicker(true);
                }}
                disabled={creating}
                title={activeFolder ? `New session in ${activeFolder}` : "Pick a folder"}
              >
                {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Plus className="h-3.5 w-3.5 mr-1.5" />}
                New Session
              </Button>

              {/* Active folder picker */}
              <FolderSection
                activeFolder={activeFolder}
                recentFolders={recentFolders}
                onSelect={selectActiveFolder}
                onBrowse={() => setShowFolderPicker(true)}
              />

              {/* Worktrees for active folder */}
              {activeFolder && worktrees.length > 0 && (
                <WorktreesSection
                  folder={activeFolder}
                  worktrees={worktrees}
                  branches={branches}
                  onPick={(path) => selectActiveFolder(path)}
                  onRefresh={() => fetchWorktrees(activeFolder)}
                />
              )}

              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search sessions"
                  className="pl-7 h-7 text-xs"
                />
              </div>
            </div>

            <ScrollArea className="flex-1 min-h-0">
              <div className="px-2 pb-2 space-y-1">
                <div className="flex items-center justify-between pt-1 pb-0.5">
                  <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                    Sessions
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {activeFolder
                      ? `${filteredSessions.length} in folder`
                      : `${filteredSessions.length} total`}
                  </span>
                </div>
                {sessionsLoading && sessions.length === 0 && (
                  <div className="text-xs text-muted-foreground py-4 text-center">
                    <Loader2 className="h-3.5 w-3.5 animate-spin inline mr-1.5" />
                    Loading…
                  </div>
                )}
                {!sessionsLoading && filteredSessions.length === 0 && (
                  <div className="text-xs text-muted-foreground py-4 text-center">
                    {activeFolder ? "No sessions in this folder" : "No sessions"}
                  </div>
                )}
                {sortedSessions.map((s) => (
                  <SessionListItem
                    key={s.sessionId}
                    session={s}
                    meta={sessionMetaMap[s.sessionId] || {}}
                    isActive={activeKey === s.sessionId}
                    isRunning={sessionStore.has(s.sessionId)}
                    onClick={() => resumeSession(s)}
                    onDelete={() => deleteSessionFromDisk(s)}
                  />
                ))}
              </div>
            </ScrollArea>

            <div className="p-2 border-t border-border shrink-0 space-y-1">
              <Button
                size="sm"
                variant="ghost"
                className="w-full text-xs justify-between"
                onClick={() => setShowSchedules(true)}
                title="View scheduled prompts"
              >
                <span className="inline-flex items-center gap-1.5">
                  <Clock className="h-3 w-3" />
                  Schedules
                </span>
                {schedules.filter((x) => x.enabled).length > 0 && (
                  <span className="text-[10px] px-1 py-0 rounded bg-primary text-primary-foreground">
                    {schedules.filter((x) => x.enabled).length}
                  </span>
                )}
              </Button>
              <Button size="sm" variant="ghost" className="w-full text-xs" onClick={fetchSessions}>
                <RefreshCw className={cn("h-3 w-3 mr-1.5", sessionsLoading && "animate-spin")} />
                Refresh
              </Button>
            </div>
          </aside>
        )}

        {/* Main pane */}
        <div className="flex-1 min-w-0 flex flex-col">
          {/* Header */}
          <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-border shrink-0">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0"
              onClick={() => setSidebarOpen((v) => !v)}
              title={sidebarOpen ? "Hide sessions" : "Show sessions"}
            >
              {sidebarOpen ? <PanelLeftClose className="h-3.5 w-3.5" /> : <PanelLeftOpen className="h-3.5 w-3.5" />}
            </Button>

            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium truncate">
                {active
                  ? (active.sessionId && sessionMetaMap[active.sessionId]?.customName) || active.label
                  : "No session"}
              </div>
              {active && (
                <div className="text-[10px] text-muted-foreground truncate">
                  {active.cwd} {active.sessionId && `• ${active.sessionId.slice(0, 8)}`}
                </div>
              )}
            </div>

            {active && (
              <>
                {view === "chat" && (
                  <ThemePicker value={chatTheme} onChange={updateChatTheme} />
                )}

                {view === "chat" && (
                  <ModelPicker
                    value={selectedModel}
                    onChange={setSelectedModel}
                    sessionAlive={!!active.alive}
                  />
                )}

                {view === "chat" && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 p-0"
                    onClick={() => {
                      setShowToolCalls((v) => {
                        const next = !v;
                        try { localStorage.setItem("claude-code-show-tool-calls", String(next)); } catch {}
                        return next;
                      });
                    }}
                    title={showToolCalls ? "Hide tool calls" : "Show tool calls"}
                  >
                    <Wrench className={cn("h-3.5 w-3.5", showToolCalls ? "text-foreground" : "text-muted-foreground/50")} />
                  </Button>
                )}

                <div className="flex items-center bg-muted rounded-md p-0.5">
                  <button
                    onClick={() => setView("chat")}
                    className={cn(
                      "px-2 py-0.5 text-xs rounded transition-colors flex items-center gap-1",
                      view === "chat" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <MessageSquare className="h-3 w-3" />
                    Chat
                  </button>
                  <button
                    onClick={() => setView("terminal")}
                    className={cn(
                      "px-2 py-0.5 text-xs rounded transition-colors flex items-center gap-1",
                      view === "terminal" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <TerminalIcon className="h-3 w-3" />
                    Terminal
                  </button>
                </div>

                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0"
                  onClick={closeActiveSession}
                  title="Close session"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </>
            )}
          </div>

          {/* Body */}
          <div className="flex-1 min-h-0 relative">
            {showFolderPicker ? (
              <FolderPickerPanel
                value={folderInput}
                onChange={setFolderInput}
                recent={recentFolders}
                onPick={(p) => startNewSession(p)}
                onClose={() => setShowFolderPicker(false)}
              />
            ) : !active ? (
              <EmptyState onNew={() => setShowFolderPicker(true)} />
            ) : view === "chat" ? (
              <ChatView
                state={active}
                showToolCalls={showToolCalls}
                theme={chatTheme}
                onOpenTerminal={() => setView("terminal")}
              />
            ) : (
              <TerminalView state={active} />
            )}
          </div>
        </div>
      </div>

      {showSchedules && (
        <SchedulesPanel
          schedules={schedules}
          sessions={sessions}
          onClose={() => setShowSchedules(false)}
          onChange={fetchSchedules}
          onOpenSession={(sessionId) => {
            const s = sessions.find((x) => x.sessionId === sessionId);
            if (s) {
              setShowSchedules(false);
              resumeSession(s);
            }
          }}
        />
      )}
    </WidgetWrapper>
  );
}

// ─── Session list item ───────────────────────────────────────────────────────

function SessionListItem({
  session,
  meta,
  isActive,
  isRunning,
  onClick,
  onDelete,
}: {
  session: ClaudeSessionInfo;
  meta: SessionMeta;
  isActive: boolean;
  isRunning: boolean;
  onClick: () => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Title source: customName overrides everything; otherwise the API-cleaned
  // summary (if real); otherwise firstPrompt; finally the session id prefix.
  const naturalTitle = session.summary || session.firstPrompt || session.sessionId.slice(0, 8);
  const title = (meta.customName && meta.customName.trim()) || naturalTitle;
  const starred = !!meta.starred;

  const startEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setDraftName(meta.customName || naturalTitle);
    setEditing(true);
    setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
  };

  const commitEdit = () => {
    const next = draftName.trim();
    // Treat the natural title as the "no rename" baseline. If the user's
    // input matches it, clear customName (i.e. unset rename).
    if (!next || next === naturalTitle) {
      setSessionMeta(session.sessionId, { customName: undefined });
    } else {
      setSessionMeta(session.sessionId, { customName: next });
    }
    setEditing(false);
  };

  const cancelEdit = () => {
    setEditing(false);
    setDraftName("");
  };

  const toggleStar = (e: React.MouseEvent) => {
    e.stopPropagation();
    setSessionMeta(session.sessionId, { starred: !starred });
  };

  return (
    <div
      className={cn(
        "group rounded-md px-2 py-1.5 cursor-pointer text-xs transition-colors flex items-start gap-1.5",
        isActive ? "bg-primary/15 text-foreground" : "hover:bg-muted",
      )}
      onClick={editing ? undefined : onClick}
      title={editing ? "" : title}
    >
      {/* Star toggle */}
      <button
        onClick={toggleStar}
        className={cn(
          "shrink-0 mt-0.5 transition-opacity",
          starred
            ? "text-amber-500 opacity-100"
            : "text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-amber-500",
        )}
        title={starred ? "Unstar session" : "Star session"}
      >
        <Star className={cn("h-3 w-3", starred && "fill-amber-500")} />
      </button>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1">
          {isRunning && (
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" title="Running" />
          )}
          {editing ? (
            <input
              ref={inputRef}
              type="text"
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") { e.preventDefault(); commitEdit(); }
                else if (e.key === "Escape") { e.preventDefault(); cancelEdit(); }
              }}
              onBlur={commitEdit}
              className="flex-1 min-w-0 bg-background text-foreground border border-input rounded px-1 py-0 text-xs h-5 focus:outline-none focus:ring-1 focus:ring-primary/40"
            />
          ) : (
            <span className="truncate font-medium">
              {title.slice(0, 60)}
              {meta.customName && meta.customName.trim() && (
                <Pencil className="inline h-2 w-2 ml-1 align-middle text-muted-foreground opacity-60" />
              )}
            </span>
          )}
        </div>
        <div className="text-[10px] text-muted-foreground truncate mt-0.5">
          {session.projectPath || session.projectDirName}
        </div>
      </div>

      {!editing && (
        <div className="shrink-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={startEdit}
            className="text-muted-foreground hover:text-foreground p-0.5"
            title="Rename"
          >
            <Pencil className="h-3 w-3" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="text-muted-foreground hover:text-destructive p-0.5"
            title="Delete session"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Folder section (sidebar) ────────────────────────────────────────────────

function FolderSection({
  activeFolder,
  recentFolders,
  onSelect,
  onBrowse,
}: {
  activeFolder: string | null;
  recentFolders: string[];
  onSelect: (folder: string | null) => void;
  onBrowse: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const display = activeFolder ? shortenFolder(activeFolder) : "Pick a folder";

  return (
    <div className="space-y-1" ref={ref}>
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Folder</span>
        <button
          className="text-[10px] text-muted-foreground hover:text-foreground"
          onClick={onBrowse}
          title="Browse for folder"
        >
          Browse…
        </button>
      </div>
      <div className="relative">
        <button
          className="w-full flex items-center gap-1.5 rounded-md border border-input bg-background px-2 h-7 text-xs hover:bg-accent"
          onClick={() => setOpen((v) => !v)}
        >
          <FolderOpen className="h-3 w-3 shrink-0 text-muted-foreground" />
          <span className="flex-1 truncate text-left">{display}</span>
        </button>
        {open && recentFolders.length > 0 && (
          <div className="absolute z-10 left-0 right-0 mt-1 max-h-48 overflow-y-auto rounded-md border border-border bg-popover shadow-md">
            {recentFolders.map((f) => (
              <button
                key={f}
                className={cn(
                  "w-full text-left text-xs px-2 py-1.5 hover:bg-accent flex items-center gap-1.5",
                  activeFolder === f && "bg-accent"
                )}
                onClick={() => { onSelect(f); setOpen(false); }}
              >
                <FolderOpen className="h-3 w-3 text-muted-foreground shrink-0" />
                <span className="truncate">{shortenFolder(f)}</span>
              </button>
            ))}
            {activeFolder && (
              <>
                <div className="border-t border-border my-0.5" />
                <button
                  className="w-full text-left text-xs px-2 py-1.5 hover:bg-accent text-muted-foreground"
                  onClick={() => { onSelect(null); setOpen(false); }}
                >
                  Clear
                </button>
              </>
            )}
          </div>
        )}
        {open && recentFolders.length === 0 && (
          <div className="absolute z-10 left-0 right-0 mt-1 rounded-md border border-border bg-popover p-2 text-xs text-muted-foreground shadow-md">
            No recent folders. Click <span className="font-medium">Browse…</span> to add one.
          </div>
        )}
      </div>
    </div>
  );
}

function shortenFolder(p: string): string {
  if (typeof window === "undefined") return p;
  // Replace home dir with ~
  const home = (window as unknown as { __home?: string }).__home;
  if (home && p.startsWith(home)) return "~" + p.slice(home.length);
  // Show last two segments if path is long
  const parts = p.split("/").filter(Boolean);
  if (parts.length >= 2 && p.length > 28) return ".../" + parts.slice(-2).join("/");
  return p;
}

// ─── Worktrees section (sidebar) ─────────────────────────────────────────────

function WorktreesSection({
  folder,
  worktrees,
  branches,
  onPick,
  onRefresh,
}: {
  folder: string;
  worktrees: { path: string; branch?: string; head?: string; bare?: boolean; detached?: boolean }[];
  branches: string[];
  onPick: (path: string) => void;
  onRefresh: () => void;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [newBranch, setNewBranch] = useState("");
  const [newPath, setNewPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addWorktree = async () => {
    if (!newPath.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const isExisting = branches.includes(newBranch);
      const res = await fetch("/api/claude-sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "add-worktree",
          dir: folder,
          path: newPath.trim(),
          ...(newBranch.trim()
            ? (isExisting ? { branch: newBranch.trim() } : { newBranch: newBranch.trim() })
            : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "Failed to add worktree");
      setShowAdd(false);
      setNewBranch("");
      setNewPath("");
      onRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const removeWorktree = async (path: string) => {
    if (!confirm(`Remove worktree at ${path}?`)) return;
    setBusy(true);
    try {
      const res = await fetch("/api/claude-sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "remove-worktree", dir: folder, path }),
      });
      if (!res.ok) {
        // Retry with --force on failure
        await fetch("/api/claude-sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "remove-worktree", dir: folder, path, force: true }),
        });
      }
      onRefresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
          Worktrees
        </span>
        <button
          className="text-[10px] text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5"
          onClick={() => setShowAdd((v) => !v)}
          title="Add worktree"
        >
          <Plus className="h-2.5 w-2.5" />
          Add
        </button>
      </div>
      <div className="space-y-0.5 max-h-32 overflow-y-auto">
        {worktrees.map((wt) => {
          const isActive = wt.path === folder;
          return (
            <div
              key={wt.path}
              className={cn(
                "group flex items-center gap-1.5 text-[11px] px-1.5 py-1 rounded cursor-pointer",
                isActive ? "bg-accent text-accent-foreground" : "hover:bg-muted",
              )}
              onClick={() => onPick(wt.path)}
              title={`${wt.path} — click to filter sessions to this worktree`}
            >
              <GitBranch className="h-3 w-3 shrink-0 text-muted-foreground" />
              <span className="flex-1 truncate">{wt.branch || (wt.path.split("/").pop() || wt.path)}</span>
              {!wt.bare && worktrees.length > 1 && (
                <button
                  onClick={(e) => { e.stopPropagation(); removeWorktree(wt.path); }}
                  className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
                  title="Remove worktree"
                >
                  <Trash2 className="h-2.5 w-2.5" />
                </button>
              )}
            </div>
          );
        })}
      </div>

      {showAdd && (
        <div className="space-y-1 pt-1.5 mt-1.5 border-t border-border">
          <Input
            value={newBranch}
            onChange={(e) => {
              setNewBranch(e.target.value);
              if (e.target.value && !newPath.trim()) {
                const parent = folder.split("/").slice(0, -1).join("/");
                setNewPath(`${parent}/${e.target.value.replace(/\//g, "-")}`);
              }
            }}
            placeholder="Branch (existing or new)"
            className="h-6 text-xs"
            list="claude-code-branches"
          />
          <datalist id="claude-code-branches">
            {branches.map((b) => <option key={b} value={b} />)}
          </datalist>
          <Input
            value={newPath}
            onChange={(e) => setNewPath(e.target.value)}
            placeholder="Worktree path"
            className="h-6 text-xs"
          />
          {error && <div className="text-[10px] text-destructive">{error}</div>}
          <Button size="sm" className="h-6 text-[10px] w-full" onClick={addWorktree} disabled={busy || !newPath.trim()}>
            {busy ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Plus className="h-3 w-3 mr-1" />}
            Add Worktree
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── Empty state ─────────────────────────────────────────────────────────────

function EmptyState({ onNew }: { onNew: () => void }) {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center px-6 gap-3">
      <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
        <Bot className="h-6 w-6 text-primary" />
      </div>
      <div>
        <div className="text-sm font-medium">No active session</div>
        <div className="text-xs text-muted-foreground mt-1">
          Start a new session or pick one from the sidebar.
        </div>
      </div>
      <Button size="sm" onClick={onNew}>
        <Plus className="h-3.5 w-3.5 mr-1.5" />
        New Session
      </Button>
    </div>
  );
}

// ─── Folder picker ───────────────────────────────────────────────────────────

interface FolderPickerProps {
  value: string;
  onChange: (v: string) => void;
  recent: string[];
  onPick: (p: string) => void;
  onClose: () => void;
}

function FolderPickerPanel({ value, onChange, recent, onPick, onClose }: FolderPickerProps) {
  const [browsing, setBrowsing] = useState(false);
  const [browsePath, setBrowsePath] = useState<string>("");
  const [entries, setEntries] = useState<{ name: string; isDir: boolean }[]>([]);
  const initialLoadRef = useRef(false);

  const loadDir = useCallback(async (path: string) => {
    setBrowsing(true);
    try {
      const res = await fetch(`/api/files?path=${encodeURIComponent(path)}`);
      if (res.ok) {
        const data = await res.json();
        setBrowsePath(data.path || path);
        const items = (data.entries || data.items || []) as { name: string; type?: string; isDirectory?: boolean }[];
        setEntries(
          items
            .filter((e) => e.isDirectory || e.type === "directory" || e.type === "dir")
            .map((e) => ({ name: e.name, isDir: true }))
        );
      }
    } catch {}
    setBrowsing(false);
  }, []);

  useEffect(() => {
    if (initialLoadRef.current) return;
    initialLoadRef.current = true;
    // Defer to next tick so we don't trigger setState within the effect body synchronously.
    const t = setTimeout(() => loadDir("~"), 0);
    return () => clearTimeout(t);
  }, [loadDir]);

  const goUp = () => {
    if (!browsePath || browsePath === "/") return;
    const parts = browsePath.split("/");
    parts.pop();
    loadDir(parts.join("/") || "/");
  };

  return (
    <div className="absolute inset-0 bg-background flex flex-col">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
        <FolderOpen className="h-4 w-4 text-muted-foreground" />
        <div className="text-sm font-medium">Choose project folder</div>
        <div className="flex-1" />
        <Button size="sm" variant="ghost" onClick={onClose}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="p-3 space-y-3 flex-1 min-h-0 flex flex-col">
        <div className="flex gap-2">
          <Input
            placeholder="/path/to/project"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && value.trim()) onPick(value.trim());
            }}
            className="flex-1"
          />
          <Button size="sm" disabled={!value.trim()} onClick={() => onPick(value.trim())}>
            Start
          </Button>
        </div>

        {recent.length > 0 && (
          <div>
            <div className="text-[10px] uppercase font-semibold text-muted-foreground mb-1">Recent</div>
            <div className="space-y-0.5">
              {recent.map((p) => (
                <button
                  key={p}
                  className="w-full text-left text-xs px-2 py-1 rounded hover:bg-muted truncate"
                  onClick={() => onPick(p)}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex-1 min-h-0 flex flex-col border border-border rounded-md">
          <div className="flex items-center gap-2 px-2 py-1.5 border-b border-border bg-muted/30">
            <Button size="sm" variant="ghost" className="h-6 px-1.5 text-xs" onClick={goUp}>
              ..
            </Button>
            <div className="flex-1 text-xs font-mono truncate text-muted-foreground">{browsePath || "~"}</div>
            <Button size="sm" disabled={!browsePath} onClick={() => onPick(browsePath)}>
              Use this folder
            </Button>
          </div>
          <ScrollArea className="flex-1 min-h-0">
            <div className="p-1">
              {browsing && entries.length === 0 ? (
                <div className="text-xs text-muted-foreground p-2">Loading…</div>
              ) : (
                entries.map((e) => (
                  <button
                    key={e.name}
                    className="w-full text-left text-xs px-2 py-1 rounded hover:bg-muted flex items-center gap-1.5"
                    onClick={() => loadDir(`${browsePath}/${e.name}`.replace(/\/+/g, "/"))}
                  >
                    <FolderOpen className="h-3 w-3 text-muted-foreground" />
                    {e.name}
                  </button>
                ))
              )}
            </div>
          </ScrollArea>
        </div>
      </div>
    </div>
  );
}

// ─── Chat view ───────────────────────────────────────────────────────────────

function ChatView({
  state,
  showToolCalls,
  theme,
  onOpenTerminal,
}: {
  state: SessionState;
  showToolCalls: boolean;
  theme: ChatTheme;
  /** Called when the user clicks "Open terminal" on the TUI-prompt banner. */
  onOpenTerminal: () => void;
}) {
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Manually-resizable textarea height. Auto-grows with content up to a
  // soft cap; the user can drag a handle above the textarea to set a
  // preferred minimum height.
  const [textareaMinHeight, setTextareaMinHeight] = useState<number>(() => {
    if (typeof window === "undefined") return 56;
    const v = parseInt(localStorage.getItem("claude-code-textarea-height") || "", 10);
    return Number.isFinite(v) && v > 0 ? Math.min(v, 600) : 56;
  });
  const persistTextareaHeight = useCallback((h: number) => {
    setTextareaMinHeight(h);
    try { localStorage.setItem("claude-code-textarea-height", String(Math.round(h))); } catch {}
  }, []);

  // Auto-resize the textarea to fit content (within its min/max bounds).
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    const next = Math.max(textareaMinHeight, Math.min(ta.scrollHeight, 600));
    ta.style.height = `${next}px`;
  }, [input, textareaMinHeight]);

  // Pasted/dropped image attachments. Each becomes an @<path> reference in
  // the prompt; previews are shown above the textarea until the prompt is
  // sent. Path is the absolute path the CLI will read; previewUrl is the
  // local blob URL for the thumbnail.
  const [attachments, setAttachments] = useState<{
    id: string;
    path: string;
    filename: string;
    previewUrl: string;
  }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Schedule modal: when set, the prompt staged for scheduling is shown
  // along with the date/time/recurrence picker. Cleared on save or cancel.
  const [schedulingPrompt, setSchedulingPrompt] = useState<string | null>(null);

  // Read waiting state directly from the session — it's per-session, so
  // switching to another session shows that session's own waiting state
  // (clean here, busy elsewhere, etc.).
  const waiting = state.waitingForReply;

  // Inline question detection: when Claude's most recent assistant message
  // ends with a question and we're not still waiting on more turns, show a
  // subtle "Claude is asking…" banner above the input.
  const lastVisibleAssistant = (() => {
    for (let i = state.messages.length - 1; i >= 0; i--) {
      const m = state.messages[i];
      if (m.role === "assistant" && m.text && m.text.trim()) return m;
      if (m.role === "user") return null;
    }
    return null;
  })();
  const inlineQuestionPending =
    !waiting &&
    !!lastVisibleAssistant &&
    messageHasOpenQuestion(lastVisibleAssistant.text);

  // Terminal-only TUI prompt detection: Claude is sitting at a y/n confirm
  // or selection menu that doesn't appear in the JSONL.
  const terminalQuestionPending = state.terminalAwaitingInput && !!state.terminalAwaitingHint;

  // Auto-scroll on new messages and when waiting flag toggles
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [state.messages.length, waiting]);

  // Clean up blob URLs on unmount.
  useEffect(() => {
    return () => {
      for (const a of attachments) {
        try { URL.revokeObjectURL(a.previewUrl); } catch {}
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Upload a single image file and append it to the attachments list,
  // inserting an @<path> reference into the textarea at the caret.
  const uploadFile = useCallback(async (file: File) => {
    if (!file.type.startsWith("image/")) {
      setUploadError("Only image files are supported");
      return;
    }
    setUploadError(null);
    setUploading(true);
    try {
      const res = await fetch("/api/claude-sessions/upload", {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || `Upload failed (${res.status})`);
      }
      const data = (await res.json()) as { path: string; filename: string };
      const previewUrl = URL.createObjectURL(file);
      const att = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, path: data.path, filename: data.filename, previewUrl };
      setAttachments((prev) => [...prev, att]);

      // Insert "@<path> " into the textarea at the caret position. Use the
      // ref to compute the new selection so the caret lands after the
      // inserted reference.
      const ref = `@${data.path} `;
      const ta = textareaRef.current;
      if (ta) {
        const start = ta.selectionStart ?? ta.value.length;
        const end = ta.selectionEnd ?? ta.value.length;
        const next = ta.value.slice(0, start) + ref + ta.value.slice(end);
        setInput(next);
        // Defer caret positioning to after React commits the new value.
        requestAnimationFrame(() => {
          if (textareaRef.current) {
            const pos = start + ref.length;
            textareaRef.current.setSelectionRange(pos, pos);
            textareaRef.current.focus();
          }
        });
      } else {
        setInput((v) => (v ? v + " " + ref : ref));
      }
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }, []);

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => {
      const att = prev.find((a) => a.id === id);
      if (att) {
        try { URL.revokeObjectURL(att.previewUrl); } catch {}
        // Strip the corresponding @<path> reference from the textarea.
        setInput((v) => v.replace(new RegExp(`\\s*@${escapeRegExp(att.path)}\\s*`), " ").replace(/\s+/g, " ").trim());
      }
      return prev.filter((a) => a.id !== id);
    });
  }, []);

  const onPaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(e.clipboardData?.items || []);
    const imageItems = items.filter((it) => it.kind === "file" && it.type.startsWith("image/"));
    if (imageItems.length === 0) return; // let the default text paste happen
    e.preventDefault();
    for (const it of imageItems) {
      const file = it.getAsFile();
      if (file) uploadFile(file);
    }
  }, [uploadFile]);

  const onDrop = useCallback((e: React.DragEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.dataTransfer?.files || []).filter((f) => f.type.startsWith("image/"));
    if (files.length === 0) return;
    e.preventDefault();
    for (const f of files) uploadFile(f);
  }, [uploadFile]);

  const onPickFiles = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []).filter((f) => f.type.startsWith("image/"));
    for (const f of files) uploadFile(f);
    // Reset so picking the same file twice still triggers change.
    e.target.value = "";
  }, [uploadFile]);

  const send = useCallback(() => {
    const text = input.trim();
    if (!text) return;
    setSending(true);
    submitPrompt(state, text + "\r");
    setInput("");
    // Clear attachments — their @<path> references are already in the text
    // we just sent, the CLI will read them. The temp files stay on disk so
    // the CLI can still read them; we don't try to clean them up.
    for (const a of attachments) {
      try { URL.revokeObjectURL(a.previewUrl); } catch {}
    }
    setAttachments([]);
    setUploadError(null);
    setSending(false);
  }, [input, state, attachments]);

  // Spacing between messages depends on theme.
  const listSpacing = theme === "compact"
    ? "space-y-1"
    : theme === "terminal"
    ? "space-y-1.5"
    : theme === "document"
    ? "space-y-4"
    : "space-y-3";

  // Visible (non-empty) messages — used to drive avatar-grouping.
  const visibleMessages = state.messages.filter((m) => {
    return (m.text && m.text.trim().length > 0) || (showToolCalls && m.toolUses && m.toolUses.length > 0);
  });

  return (
    <div className="relative h-full flex flex-col">
      <div ref={scrollRef} className={cn(
        "flex-1 min-h-0 overflow-y-auto",
        theme === "terminal" ? "px-3 py-2 bg-card/40 font-mono" : "px-3 py-2",
        theme === "document" && "px-6 py-4 max-w-3xl mx-auto w-full",
      )}>
        {visibleMessages.length === 0 ? (
          <div className="h-full flex items-center justify-center text-xs text-muted-foreground text-center px-4">
            {!state.hasLog && state.isResume
              ? "This session's log was cleaned up by the CLI. Send a new prompt to continue — Claude will re-create the log."
              : state.sessionId
              ? "Waiting for first message…"
              : "Starting Claude — first message will appear here once Claude responds…"}
          </div>
        ) : (
          <div className={listSpacing}>
            {visibleMessages.map((m, idx) => {
              // Hide avatar for consecutive same-role messages in themes that
              // benefit from grouping (bubbles, document). Other themes ignore
              // the prop.
              const prev = idx > 0 ? visibleMessages[idx - 1] : null;
              const showAvatar = !prev || prev.role !== m.role;
              return (
                <ChatBubble
                  key={m.id}
                  message={m}
                  showToolCalls={showToolCalls}
                  theme={theme}
                  showAvatar={showAvatar}
                />
              );
            })}
            {waiting && (
              <ThinkingIndicator
                theme={theme}
                label={state.spawningTerminal || (!state.alive && state.pendingPrompts.length > 0)
                  ? "Starting Claude…"
                  : undefined}
              />
            )}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-border p-2 space-y-1.5">
        {/* Attachment thumbnails */}
        {(attachments.length > 0 || uploading || uploadError) && (
          <div className="flex flex-wrap items-center gap-1.5">
            {attachments.map((a) => (
              <div
                key={a.id}
                className="group relative h-12 w-12 rounded border border-border overflow-hidden bg-muted"
                title={a.path}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={a.previewUrl} alt={a.filename} className="h-full w-full object-cover" />
                <button
                  type="button"
                  onClick={() => removeAttachment(a.id)}
                  className="absolute top-0 right-0 bg-foreground/70 text-background rounded-bl px-0.5 py-0 opacity-0 group-hover:opacity-100 transition-opacity"
                  title="Remove"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </div>
            ))}
            {uploading && (
              <div className="h-12 w-12 rounded border border-border bg-muted flex items-center justify-center">
                <Loader2 className="h-3 w-3 animate-spin" />
              </div>
            )}
            {uploadError && (
              <div className="text-[10px] text-destructive">{uploadError}</div>
            )}
          </div>
        )}

        {/* "Claude needs your input" banners. Two flavours: an inline
            question in the latest assistant text (chat answers it), or a
            TUI-only prompt visible in the terminal (terminal answers it). */}
        {inlineQuestionPending && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 px-2.5 py-1.5 text-xs flex items-center gap-2">
            <HelpCircle className="h-3.5 w-3.5 shrink-0" />
            <span className="flex-1">Claude is asking a question — type your answer below.</span>
          </div>
        )}
        {terminalQuestionPending && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 px-2.5 py-1.5 text-xs flex items-start gap-2">
            <HelpCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="font-medium">Claude needs input in the terminal</div>
              {state.terminalAwaitingHint && (
                <div className="text-[10px] opacity-80 mt-0.5 truncate" title={state.terminalAwaitingHint}>
                  {state.terminalAwaitingHint}
                </div>
              )}
            </div>
            <Button
              size="sm"
              variant="outline"
              className="h-6 px-2 text-[10px] shrink-0 border-amber-500/40 hover:bg-amber-500/20"
              onClick={onOpenTerminal}
            >
              <TerminalIcon className="h-3 w-3 mr-1" />
              Open terminal
            </Button>
          </div>
        )}

        {/* Drag handle to manually resize the textarea */}
        <ResizeHandle
          height={textareaMinHeight}
          onChange={persistTextareaHeight}
          minHeight={56}
          maxHeight={600}
        />

        <div className="flex gap-1.5 items-end">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={onPickFiles}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={sending || uploading || (state.ws !== null && !state.alive)}
            className="shrink-0 h-9 w-9 rounded-md border border-border bg-background hover:bg-muted text-muted-foreground hover:text-foreground flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
            title="Attach image"
          >
            <Paperclip className="h-3.5 w-3.5" />
          </button>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onPaste={onPaste}
            onDrop={onDrop}
            onDragOver={(e) => {
              if (Array.from(e.dataTransfer?.items || []).some((it) => it.kind === "file")) {
                e.preventDefault();
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder={
              state.alive
                ? "Send a message to Claude… (Shift+Enter for newline, paste an image to attach)"
                : state.spawningTerminal
                ? "Starting Claude…"
                : state.ws
                ? "Session ended"
                : "Send a message — the CLI will start when you submit"
            }
            disabled={sending || (state.ws !== null && !state.alive)}
            rows={1}
            style={{ minHeight: textareaMinHeight, maxHeight: 600 }}
            className={cn(
              "flex-1 resize-none px-2 py-1.5 text-sm rounded-md border border-border bg-background overflow-y-auto focus:outline-none focus:ring-1 focus:ring-primary/40",
              theme === "terminal" && "font-mono",
            )}
          />
          <div className="flex flex-col gap-1 shrink-0">
            <Button
              size="sm"
              onClick={send}
              disabled={!input.trim() || (state.ws !== null && !state.alive)}
              title="Send (Enter)"
            >
              <Send className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setSchedulingPrompt(input.trim())}
              disabled={!input.trim() || !state.sessionId}
              title={state.sessionId ? "Schedule this prompt" : "Save the session first by sending one prompt, then schedule the next"}
              className="h-7 px-2"
            >
              <Clock className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
        {state.ws !== null && !state.alive && !state.spawningTerminal && (
          <div className="text-[10px] text-muted-foreground">
            The Claude process exited. Close and start a new session.
          </div>
        )}
      </div>

      {schedulingPrompt !== null && state.sessionId && (
        <ScheduleModal
          sessionId={state.sessionId}
          cwd={state.cwd}
          prompt={schedulingPrompt}
          onSaved={() => {
            setSchedulingPrompt(null);
            // Clear the input — the prompt has been queued for later.
            setInput("");
            setAttachments((prev) => {
              for (const a of prev) {
                try { URL.revokeObjectURL(a.previewUrl); } catch {}
              }
              return [];
            });
          }}
          onCancel={() => setSchedulingPrompt(null)}
        />
      )}
    </div>
  );
}

function ResizeHandle({
  height,
  onChange,
  minHeight,
  maxHeight,
}: {
  height: number;
  onChange: (h: number) => void;
  minHeight: number;
  maxHeight: number;
}) {
  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = height;
    const onMove = (ev: MouseEvent) => {
      // Dragging UP makes the textarea TALLER (delta is negative).
      const next = Math.max(minHeight, Math.min(maxHeight, startH + (startY - ev.clientY)));
      onChange(next);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <div
      onMouseDown={onMouseDown}
      onDoubleClick={() => onChange(minHeight === 56 ? 56 : minHeight)}
      title="Drag to resize the input — double-click to reset"
      className="h-1.5 w-full cursor-ns-resize flex items-center justify-center group"
    >
      <div className="h-0.5 w-8 rounded-full bg-border group-hover:bg-muted-foreground/40 transition-colors" />
    </div>
  );
}

function ThinkingIndicator({ label, theme }: { label?: string; theme?: ChatTheme }) {
  const t = theme || "default";
  if (t === "terminal") {
    return (
      <div className="font-mono text-xs text-muted-foreground flex items-center gap-1.5 py-0.5">
        <Loader2 className="h-3 w-3 animate-spin" />
        <span>{label || "claude is thinking…"}</span>
      </div>
    );
  }
  if (t === "document") {
    return (
      <div className="text-xs text-muted-foreground italic flex items-center gap-1.5 py-1">
        <Loader2 className="h-3 w-3 animate-spin" />
        <span>{label || "Claude is thinking…"}</span>
      </div>
    );
  }
  if (t === "compact") {
    return (
      <div className="text-xs text-muted-foreground flex items-center gap-1.5 px-1 py-0.5">
        <Loader2 className="h-3 w-3 animate-spin" />
        <span>{label || "thinking…"}</span>
      </div>
    );
  }
  // default + bubbles
  const isBubbles = t === "bubbles";
  return (
    <div className="flex gap-2">
      <div className={cn(
        "h-6 w-6 shrink-0 rounded-full flex items-center justify-center bg-muted",
        isBubbles && "h-7 w-7"
      )}>
        <Bot className="h-3.5 w-3.5" />
      </div>
      <div className={cn(
        "px-3 py-2 bg-muted text-sm text-muted-foreground inline-flex items-center gap-1.5",
        isBubbles ? "rounded-2xl rounded-tl-sm" : "rounded-lg",
      )}>
        <Loader2 className="h-3 w-3 animate-spin" />
        <span className="text-xs">{label || "Claude is thinking…"}</span>
      </div>
    </div>
  );
}

function ChatBubble({
  message,
  showToolCalls,
  theme,
  showAvatar,
}: {
  message: ChatMessage;
  showToolCalls: boolean;
  theme: ChatTheme;
  /** When false, avatar is hidden (used by themes that group consecutive same-role messages). */
  showAvatar: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const isUser = message.role === "user";
  const hasContent = (message.text && message.text.trim().length > 0) || (showToolCalls && message.toolUses && message.toolUses.length > 0);
  if (!hasContent) return null;

  const copyBtn = (
    <button
      onClick={() => {
        try {
          navigator.clipboard.writeText(message.text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {}
      }}
      className={cn(
        "absolute -top-1.5 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded bg-background border border-border shadow-sm",
        isUser ? "-left-1.5" : "-right-1.5"
      )}
      title="Copy"
    >
      <Copy className="h-2.5 w-2.5" />
      {copied && <span className="absolute -top-5 right-0 text-[9px] bg-foreground text-background px-1 rounded">Copied</span>}
    </button>
  );

  const body = isUser ? (
    <div className="whitespace-pre-wrap break-words">{message.text}</div>
  ) : (
    <div className="space-y-1">
      {message.text && <div>{renderText(message.text)}</div>}
      {showToolCalls && message.toolUses && message.toolUses.length > 0 && (
        <div className="flex flex-wrap items-stretch gap-0">
          {message.toolUses.map((t, i) => <ToolUsePill key={i} name={t.name} input={t.input} />)}
        </div>
      )}
    </div>
  );

  // ── Terminal theme: monospaced, ASCII prompt prefix ──────────────────
  if (theme === "terminal") {
    return (
      <div
        className={cn(
          "group relative font-mono text-xs",
          isUser
            ? "border-l-2 border-emerald-500 bg-emerald-500/5 pl-2 pr-2 py-1 -mx-2 rounded-r"
            : "px-1",
        )}
      >
        <div className="flex gap-2">
          <span className={cn(
            "shrink-0 select-none",
            isUser ? "text-emerald-500 font-bold" : "text-purple-500",
          )}>
            {isUser ? ">" : "$"}
          </span>
          <div className={cn(
            "flex-1 min-w-0 break-words whitespace-pre-wrap",
            isUser ? "text-emerald-700 dark:text-emerald-300 font-semibold" : "text-foreground",
          )}>
            {body}
          </div>
        </div>
        {copyBtn}
      </div>
    );
  }

  // ── Document theme: full-width, role label, no bubble ───────────────
  if (theme === "document") {
    return (
      <div className="group relative">
        {showAvatar && (
          <div className={cn(
            "text-[10px] font-semibold uppercase tracking-wider mb-1",
            isUser ? "text-primary" : "text-muted-foreground"
          )}>
            {isUser ? "You" : "Claude"}
          </div>
        )}
        <div className={cn(
          "text-sm leading-relaxed",
          isUser && "text-foreground/95",
        )}>
          {body}
        </div>
        {copyBtn}
      </div>
    );
  }

  // ── Compact theme: dense, no avatar, role glyph in text margin ──────
  if (theme === "compact") {
    return (
      <div className="group relative flex gap-1.5 text-xs">
        <span className={cn(
          "shrink-0 select-none w-3 text-right font-semibold",
          isUser ? "text-primary" : "text-muted-foreground"
        )}>
          {isUser ? "U" : "C"}
        </span>
        <div className="flex-1 min-w-0 break-words">
          {body}
        </div>
        {copyBtn}
      </div>
    );
  }

  // ── Bubbles theme: chat-app style, larger rounding, conditional avatar ─
  if (theme === "bubbles") {
    return (
      <div className={cn("flex gap-2", isUser && "flex-row-reverse")}>
        <div className={cn(
          "shrink-0",
          showAvatar
            ? "h-7 w-7 rounded-full flex items-center justify-center text-[10px] font-semibold " + (isUser ? "bg-primary text-primary-foreground" : "bg-muted")
            : "h-7 w-7"
        )}>
          {showAvatar && (isUser ? "U" : <Bot className="h-3.5 w-3.5" />)}
        </div>
        <div className={cn(
          "group max-w-[85%] px-3.5 py-2 text-sm relative",
          isUser
            ? "bg-primary text-primary-foreground rounded-2xl rounded-tr-sm"
            : "bg-muted rounded-2xl rounded-tl-sm",
        )}>
          {body}
          {copyBtn}
        </div>
      </div>
    );
  }

  // ── Default theme: current rounded-lg bubble look ───────────────────
  return (
    <div className={cn("flex gap-2", isUser && "flex-row-reverse")}>
      <div className={cn(
        "h-6 w-6 shrink-0 rounded-full flex items-center justify-center text-[10px] font-semibold",
        isUser ? "bg-primary text-primary-foreground" : "bg-muted"
      )}>
        {isUser ? "U" : <Bot className="h-3.5 w-3.5" />}
      </div>
      <div className={cn(
        "group max-w-[85%] rounded-lg px-3 py-2 text-sm relative",
        isUser ? "bg-primary text-primary-foreground" : "bg-muted"
      )}>
        {body}
        {copyBtn}
      </div>
    </div>
  );
}

// ─── Schedules panel (read-only list with run-now / disable / delete) ───────

function SchedulesPanel({
  schedules,
  sessions,
  onClose,
  onChange,
  onOpenSession,
}: {
  schedules: ScheduleEntry[];
  sessions: ClaudeSessionInfo[];
  onClose: () => void;
  onChange: () => void;
  onOpenSession: (sessionId: string) => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sessionMap = new Map(sessions.map((s) => [s.sessionId, s]));

  const update = async (id: string, body: Record<string, unknown>) => {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch("/api/claude-sessions/schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="absolute inset-0 z-30 flex items-stretch justify-center bg-background/85" onClick={onClose}>
      <div
        className="w-full max-w-2xl m-4 rounded-md border border-border bg-popover shadow-lg flex flex-col max-h-full"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 p-3 border-b border-border shrink-0">
          <Clock className="h-4 w-4 text-primary" />
          <div className="text-sm font-semibold">Scheduled prompts</div>
          <div className="text-xs text-muted-foreground">
            {schedules.filter((s) => s.enabled).length} active · {schedules.length} total
          </div>
          <div className="flex-1" />
          <button onClick={onClose} className="p-1 rounded hover:bg-muted text-muted-foreground" title="Close">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {error && (
          <div className="px-3 py-2 text-xs text-destructive border-b border-border shrink-0">{error}</div>
        )}

        <ScrollArea className="flex-1 min-h-0">
          {schedules.length === 0 ? (
            <div className="p-6 text-center text-xs text-muted-foreground">
              No scheduled prompts yet. Click the clock icon next to a prompt to schedule it.
            </div>
          ) : (
            <div className="divide-y divide-border">
              {schedules.map((s) => {
                const session = sessionMap.get(s.sessionId);
                const sessionTitle = session?.summary || session?.firstPrompt || s.sessionId.slice(0, 8);
                const next = new Date(s.nextRunAt);
                const last = s.lastRunAt ? new Date(s.lastRunAt) : null;
                return (
                  <div key={s.id} className={cn("p-3 space-y-1.5", !s.enabled && "opacity-60")}>
                    <div className="flex items-start gap-2">
                      <div className="flex-1 min-w-0">
                        {s.label && <div className="text-xs font-semibold truncate">{s.label}</div>}
                        <button
                          onClick={() => onOpenSession(s.sessionId)}
                          className="text-[10px] text-muted-foreground hover:text-foreground hover:underline truncate text-left block max-w-full"
                          title={`Session: ${sessionTitle}`}
                        >
                          {sessionTitle}
                        </button>
                        <div className="text-xs whitespace-pre-wrap break-words mt-1 max-h-20 overflow-y-auto bg-muted/40 rounded p-1.5">
                          {s.prompt}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 text-[10px] text-muted-foreground flex-wrap">
                      <span title="Next run">
                        <CalendarIcon className="h-2.5 w-2.5 inline mr-0.5" />
                        Next: {next.toLocaleString()}
                      </span>
                      <span><RotateCw className="h-2.5 w-2.5 inline mr-0.5" />{describeRecurrence(s.recurrence)}</span>
                      {last && (
                        <span className={cn(s.lastStatus === "error" && "text-destructive")}>
                          Last: {last.toLocaleString()} {s.lastStatus === "error" && "(error)"}
                        </span>
                      )}
                    </div>

                    {s.lastError && (
                      <div className="text-[10px] text-destructive line-clamp-2" title={s.lastError}>
                        {s.lastError}
                      </div>
                    )}

                    <div className="flex items-center gap-1 pt-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 text-[10px] px-2"
                        onClick={() => update(s.id, { action: "run-now", id: s.id })}
                        disabled={busyId === s.id}
                      >
                        {busyId === s.id ? <Loader2 className="h-3 w-3 animate-spin" /> : "Run now"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 text-[10px] px-2"
                        onClick={() => update(s.id, { action: "update", id: s.id, patch: { enabled: !s.enabled } })}
                        disabled={busyId === s.id}
                      >
                        {s.enabled ? "Disable" : "Enable"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 text-[10px] px-2 text-destructive hover:text-destructive"
                        onClick={() => {
                          if (!confirm("Delete this schedule?")) return;
                          update(s.id, { action: "delete", id: s.id });
                        }}
                        disabled={busyId === s.id}
                      >
                        Delete
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </div>
    </div>
  );
}

function describeRecurrence(r: ScheduleRecurrence): string {
  switch (r.type) {
    case "once": return "Once";
    case "every": return `Every ${r.intervalMinutes} min`;
    case "daily": return `Daily at ${String(r.hour).padStart(2, "0")}:${String(r.minute).padStart(2, "0")}`;
    case "weekly": {
      const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      const which = r.weekdays.length === 7 ? "every day" : r.weekdays.map((d) => days[d]).join(", ");
      return `${which} at ${String(r.hour).padStart(2, "0")}:${String(r.minute).padStart(2, "0")}`;
    }
  }
}

// ─── Schedule modal ──────────────────────────────────────────────────────────

type RecurrenceUI =
  | { type: "once" }
  | { type: "every"; intervalMinutes: number }
  | { type: "daily"; hour: number; minute: number }
  | { type: "weekly"; weekdays: number[]; hour: number; minute: number };

function defaultRunAtIso(): string {
  // Default: tomorrow at 02:00 in the user's local timezone.
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(2, 0, 0, 0);
  return toLocalInputValue(d);
}

/** Convert a Date into the value format that <input type="datetime-local"> uses. */
function toLocalInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInputValue(v: string): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function ScheduleModal({
  sessionId,
  cwd,
  prompt,
  onSaved,
  onCancel,
}: {
  sessionId: string;
  cwd: string;
  prompt: string;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [runAt, setRunAt] = useState<string>(defaultRunAtIso());
  const [recurrence, setRecurrence] = useState<RecurrenceUI>({ type: "once" });
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const when = fromLocalInputValue(runAt);
    if (!when) { setError("Pick a valid date and time"); return; }
    if (when.getTime() <= Date.now() && recurrence.type === "once") {
      setError("Pick a future time for one-shot schedules"); return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/claude-sessions/schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          sessionId,
          cwd,
          prompt,
          nextRunAt: when.toISOString(),
          recurrence,
          label: label.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      try { window.dispatchEvent(new CustomEvent("claude-schedules-changed")); } catch {}
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create schedule");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-background/80 p-4" onClick={onCancel}>
      <div
        className="w-full max-w-md rounded-md border border-border bg-popover shadow-lg p-3 space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-primary" />
          <div className="text-sm font-semibold">Schedule prompt</div>
          <div className="flex-1" />
          <button
            onClick={onCancel}
            className="p-1 rounded hover:bg-muted text-muted-foreground"
            title="Cancel"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
          Prompt
        </div>
        <div className="rounded border border-border bg-muted/40 p-2 text-xs max-h-32 overflow-y-auto whitespace-pre-wrap break-words">
          {prompt}
        </div>

        <div className="space-y-1.5">
          <label className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
            First run
          </label>
          <Input
            type="datetime-local"
            value={runAt}
            onChange={(e) => setRunAt(e.target.value)}
            className="h-8 text-xs"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
            Recurrence
          </label>
          <select
            value={recurrence.type}
            onChange={(e) => {
              const t = e.target.value as RecurrenceUI["type"];
              if (t === "once") setRecurrence({ type: "once" });
              else if (t === "every") setRecurrence({ type: "every", intervalMinutes: 60 });
              else if (t === "daily") {
                const d = fromLocalInputValue(runAt);
                setRecurrence({ type: "daily", hour: d?.getHours() ?? 2, minute: d?.getMinutes() ?? 0 });
              } else if (t === "weekly") {
                const d = fromLocalInputValue(runAt);
                setRecurrence({ type: "weekly", weekdays: [d?.getDay() ?? 1], hour: d?.getHours() ?? 9, minute: d?.getMinutes() ?? 0 });
              }
            }}
            className="w-full h-8 text-xs rounded-md border border-border bg-background px-2"
          >
            <option value="once">Run once</option>
            <option value="every">Repeat every N minutes</option>
            <option value="daily">Daily at HH:MM</option>
            <option value="weekly">Weekly on chosen days</option>
          </select>
        </div>

        {recurrence.type === "every" && (
          <Input
            type="number"
            min={1}
            value={recurrence.intervalMinutes}
            onChange={(e) => setRecurrence({ type: "every", intervalMinutes: Math.max(1, parseInt(e.target.value || "1", 10)) })}
            className="h-8 text-xs"
            placeholder="Interval (minutes)"
          />
        )}
        {(recurrence.type === "daily" || recurrence.type === "weekly") && (
          <div className="flex gap-2">
            <Input
              type="number" min={0} max={23}
              value={recurrence.hour}
              onChange={(e) => setRecurrence({ ...recurrence, hour: Math.min(23, Math.max(0, parseInt(e.target.value || "0", 10))) })}
              className="h-8 text-xs flex-1"
              placeholder="HH"
            />
            <Input
              type="number" min={0} max={59}
              value={recurrence.minute}
              onChange={(e) => setRecurrence({ ...recurrence, minute: Math.min(59, Math.max(0, parseInt(e.target.value || "0", 10))) })}
              className="h-8 text-xs flex-1"
              placeholder="MM"
            />
          </div>
        )}
        {recurrence.type === "weekly" && (
          <div className="flex gap-1 flex-wrap">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d, idx) => {
              const on = recurrence.weekdays.includes(idx);
              return (
                <button
                  key={idx}
                  type="button"
                  onClick={() => {
                    const next = on
                      ? recurrence.weekdays.filter((w) => w !== idx)
                      : [...recurrence.weekdays, idx].sort();
                    setRecurrence({ ...recurrence, weekdays: next });
                  }}
                  className={cn(
                    "px-2 h-7 text-[10px] rounded border",
                    on ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border hover:bg-muted",
                  )}
                >
                  {d}
                </button>
              );
            })}
          </div>
        )}

        <div className="space-y-1.5">
          <label className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
            Label (optional)
          </label>
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Daily standup summary"
            className="h-8 text-xs"
          />
        </div>

        {error && <div className="text-xs text-destructive">{error}</div>}

        <div className="flex justify-end gap-1.5 pt-1">
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button size="sm" onClick={submit} disabled={busy}>
            {busy ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Clock className="h-3 w-3 mr-1" />}
            Schedule
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Terminal view ───────────────────────────────────────────────────────────

function TerminalView({ state }: { state: SessionState }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const roRef = useRef<ResizeObserver | null>(null);

  // If the terminal isn't running yet, spawn it now (lazily on first view).
  useEffect(() => {
    if (!state.terminal && !state.spawningTerminal && !state.ws) {
      spawnTerminal(state);
    }
  }, [state]);

  // Mount/unmount: move xterm element in/out of the visible container.
  // Re-runs whenever the underlying terminal instance changes (i.e. after
  // a lazy spawn completes).
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !state.terminal) return;

    const xtermEl = state.terminal.element as HTMLElement | undefined;
    if (xtermEl) container.appendChild(xtermEl);

    requestAnimationFrame(() => {
      try {
        state.fitAddon?.fit();
        const dims = state.fitAddon?.proposeDimensions();
        if (dims && state.ws && state.ws.readyState === WebSocket.OPEN) {
          state.ws.send(JSON.stringify({ type: "resize", cols: dims.cols, rows: dims.rows }));
        }
      } catch {}
      try { state.terminal?.focus(); } catch {}
    });

    const ro = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        try {
          state.fitAddon?.fit();
          const dims = state.fitAddon?.proposeDimensions();
          if (dims && state.ws && state.ws.readyState === WebSocket.OPEN) {
            state.ws.send(JSON.stringify({ type: "resize", cols: dims.cols, rows: dims.rows }));
          }
        } catch {}
      });
    });
    ro.observe(container);
    roRef.current = ro;

    return () => {
      ro.disconnect();
      // Detach but don't dispose — the terminal lives on in the module store.
      if (xtermEl && xtermEl.parentNode === container) {
        container.removeChild(xtermEl);
      }
    };
  }, [state, state.terminal]);

  if (!state.terminal) {
    return (
      <div className="h-full w-full flex items-center justify-center text-xs text-muted-foreground gap-2">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        {state.spawningTerminal ? "Starting Claude…" : "Preparing terminal…"}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="h-full w-full px-1 py-1"
      onMouseDown={(e) => e.stopPropagation()}
    />
  );
}
