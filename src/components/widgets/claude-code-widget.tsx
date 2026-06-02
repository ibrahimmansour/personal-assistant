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
  timestamp: string;
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
  /** True while we're waiting for an assistant response after the user submitted. */
  waitingForReply: boolean;
  /** ID of the most recent assistant message we've seen — used to detect "new reply arrived". */
  lastAssistantMessageId: string | null;
  /** Subscribers that re-render when this session updates. */
  subscribers: Set<() => void>;
}

// ─── Module-level session store (survives React remounts) ────────────────────

const sessionStore = new Map<string, SessionState>();
let pendingCounter = 1;

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

interface OpenSessionOpts {
  cwd: string;
  /** When set, run `claude --resume <id>` instead of a fresh session. */
  resumeId?: string;
  label?: string;
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
    projectDirName: encodeProjectDirName(opts.cwd),
    messages: [],
    sse: null,
    pendingPrompts: [],
    spawningTerminal: false,
    waitingForReply: false,
    lastAssistantMessageId: null,
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

    const claudeCmd = state.sessionId
      ? `claude --dangerously-skip-permissions --resume ${state.sessionId}`
      : "claude --dangerously-skip-permissions";
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
      // The CLI needs a few hundred ms before it accepts input on the prompt line.
      const flushQueue = () => {
        if (!state.pendingPrompts.length) return;
        for (const p of state.pendingPrompts) {
          try { ws.send(JSON.stringify({ type: "input", data: p })); } catch {}
        }
        state.pendingPrompts = [];
        notifySubscribers(state);
      };
      setTimeout(flushQueue, 1500);
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "output") {
          terminal.write(msg.data);
        } else if (msg.type === "exit") {
          terminal.writeln("\r\n\x1b[90m[Process exited]\x1b[0m");
          state.alive = false;
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
      // Track the latest assistant message — clears the "thinking" indicator
      // for this session as soon as a new reply lands.
      const lastA = [...state.messages].reverse().find((m) => m.role === "assistant");
      const lastAId = lastA?.id || null;
      if (state.waitingForReply && lastAId && lastAId !== state.lastAssistantMessageId) {
        state.waitingForReply = false;
      }
      state.lastAssistantMessageId = lastAId;
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
 * Submit a prompt to the session. If the terminal is alive, paste directly.
 * Otherwise, queue the prompt and lazily spawn the terminal — pending prompts
 * are flushed once the PTY is ready.
 */
async function submitPrompt(state: SessionState, text: string): Promise<boolean> {
  const payload = text.endsWith("\r") ? text : text + "\r";

  // Mark this session as waiting for an assistant reply. Cleared by the
  // SSE handler when the next assistant message lands. Per-session, so
  // other sessions' chat views don't show the indicator.
  state.waitingForReply = true;

  if (state.alive && state.ws && state.ws.readyState === WebSocket.OPEN) {
    state.ws.send(JSON.stringify({ type: "input", data: payload }));
    notifySubscribers(state);
    return true;
  }

  // Queue the prompt and ensure a terminal is being spawned.
  state.pendingPrompts.push(payload);
  notifySubscribers(state);
  if (!state.spawningTerminal && !state.alive) {
    spawnTerminal(state);
  }
  return true;
}

function destroySession(key: string) {
  const state = sessionStore.get(key);
  if (!state) return;
  try { state.sse?.close(); } catch {}
  try { state.ws?.close(); } catch {}
  try { state.terminal?.dispose(); } catch {}
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
  state.terminal = null;
  state.fitAddon = null;
  state.ws = null;
  state.alive = false;
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
      !/^\d+\.\s+/.test(lines[i])
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

  // Folder picker state
  const [folderInput, setFolderInput] = useState("");
  const [recentFolders, setRecentFolders] = useState<string[]>([]);

  // Subscribe to active session
  const active = useSessionSubscription(activeKey);

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

  // ── Start a new session in a chosen folder ─────────────────────────────
  const startNewSession = useCallback(async (cwd: string) => {
    setCreating(true);
    try {
      persistRecentFolder(cwd);
      // Make this the active folder for the worktrees panel
      setActiveFolder(cwd);
      try { localStorage.setItem("claude-code-active-folder", cwd); } catch {}
      const state = openSession({ cwd, label: "New session" });
      // For brand-new sessions we spawn the terminal eagerly so the CLI is up
      // and the JSONL gets created.
      spawnTerminal(state);
      setActiveKey(state.key);
      setView("chat");
      setShowFolderPicker(false);
    } finally {
      setCreating(false);
    }
  }, [persistRecentFolder]);

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

    const label = s.summary || s.firstPrompt?.slice(0, 30) || s.sessionId.slice(0, 8);
    const state = openSession({ cwd, resumeId: s.sessionId, label });
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
    if (!confirm(`Delete session "${sess.summary || sess.firstPrompt?.slice(0, 40) || sess.sessionId}"?`)) return;
    try {
      await fetch("/api/claude-sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete-session", sessionId: sess.sessionId, projectDir: sess.projectDirName }),
      });
      // If currently open, close it
      if (sessionStore.has(sess.sessionId)) destroySession(sess.sessionId);
      if (activeKey === sess.sessionId) setActiveKey(null);
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
    return (
      s.summary?.toLowerCase().includes(q) ||
      s.firstPrompt?.toLowerCase().includes(q) ||
      s.projectPath?.toLowerCase().includes(q) ||
      s.sessionId.toLowerCase().includes(q)
    );
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
                {filteredSessions.map((s) => {
                  const isActive = activeKey === s.sessionId;
                  const isRunning = sessionStore.has(s.sessionId);
                  const title = s.summary || s.firstPrompt || s.sessionId.slice(0, 8);
                  return (
                    <div
                      key={s.sessionId}
                      className={cn(
                        "group rounded-md px-2 py-1.5 cursor-pointer text-xs transition-colors flex items-start gap-1.5",
                        isActive ? "bg-primary/15 text-foreground" : "hover:bg-muted",
                      )}
                      onClick={() => resumeSession(s)}
                      title={title}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1">
                          {isRunning && (
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" title="Running" />
                          )}
                          <span className="truncate font-medium">{title.slice(0, 60)}</span>
                        </div>
                        <div className="text-[10px] text-muted-foreground truncate mt-0.5">
                          {s.projectPath || s.projectDirName}
                        </div>
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); deleteSessionFromDisk(s); }}
                        className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
                        title="Delete session"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>

            <div className="p-2 border-t border-border shrink-0">
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
                {active ? active.label : "No session"}
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
              <ChatView state={active} showToolCalls={showToolCalls} />
            ) : (
              <TerminalView state={active} />
            )}
          </div>
        </div>
      </div>
    </WidgetWrapper>
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

function ChatView({ state, showToolCalls }: { state: SessionState; showToolCalls: boolean }) {
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Read waiting state directly from the session — it's per-session, so
  // switching to another session shows that session's own waiting state
  // (clean here, busy elsewhere, etc.).
  const waiting = state.waitingForReply;

  // Auto-scroll on new messages and when waiting flag toggles
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [state.messages.length, waiting]);

  const send = useCallback(() => {
    const text = input.trim();
    if (!text) return;
    setSending(true);
    // Submit prompt: pastes into a live terminal, or queues + lazily spawns one.
    // submitPrompt also sets state.waitingForReply on the session.
    submitPrompt(state, text + "\r");
    setInput("");
    setSending(false);
  }, [input, state]);

  return (
    <div className="h-full flex flex-col">
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-3 py-2">
        {state.messages.length === 0 ? (
          <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
            {state.sessionId
              ? "Waiting for first message…"
              : "Starting Claude — first message will appear here once Claude responds…"}
          </div>
        ) : (
          <div className="space-y-3">
            {state.messages.map((m) => (
              <ChatBubble key={m.id} message={m} showToolCalls={showToolCalls} />
            ))}
            {waiting && (
              <ThinkingIndicator
                label={state.spawningTerminal || (!state.alive && state.pendingPrompts.length > 0)
                  ? "Starting Claude…"
                  : undefined}
              />
            )}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-border p-2">
        <div className="flex gap-1.5">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder={
              state.alive
                ? "Send a message to Claude…"
                : state.spawningTerminal
                ? "Starting Claude…"
                : state.ws
                ? "Session ended"
                : "Send a message — the CLI will start when you submit"
            }
            disabled={sending || (state.ws !== null && !state.alive)}
            rows={1}
            className="flex-1 resize-none px-2 py-1.5 text-sm rounded-md border border-border bg-background min-h-[36px] max-h-[120px] focus:outline-none focus:ring-1 focus:ring-primary/40"
          />
          <Button size="sm" onClick={send} disabled={!input.trim() || (state.ws !== null && !state.alive)}>
            <Send className="h-3.5 w-3.5" />
          </Button>
        </div>
        {state.ws !== null && !state.alive && !state.spawningTerminal && (
          <div className="text-[10px] text-muted-foreground mt-1">
            The Claude process exited. Close and start a new session.
          </div>
        )}
      </div>
    </div>
  );
}

function ThinkingIndicator({ label }: { label?: string }) {
  return (
    <div className="flex gap-2">
      <div className="h-6 w-6 shrink-0 rounded-full flex items-center justify-center bg-muted">
        <Bot className="h-3.5 w-3.5" />
      </div>
      <div className="rounded-lg px-3 py-2 bg-muted text-sm text-muted-foreground inline-flex items-center gap-1.5">
        <Loader2 className="h-3 w-3 animate-spin" />
        <span className="text-xs">{label || "Claude is thinking…"}</span>
      </div>
    </div>
  );
}

function ChatBubble({ message, showToolCalls }: { message: ChatMessage; showToolCalls: boolean }) {
  const [copied, setCopied] = useState(false);
  const isUser = message.role === "user";
  const hasContent = (message.text && message.text.trim().length > 0) || (showToolCalls && message.toolUses && message.toolUses.length > 0);
  if (!hasContent) return null;
  return (
    <div className={cn("flex gap-2", isUser && "flex-row-reverse")}>
      <div className={cn("h-6 w-6 shrink-0 rounded-full flex items-center justify-center text-[10px] font-semibold",
        isUser ? "bg-primary text-primary-foreground" : "bg-muted")}>
        {isUser ? "U" : <Bot className="h-3.5 w-3.5" />}
      </div>
      <div className={cn("group max-w-[85%] rounded-lg px-3 py-2 text-sm relative",
        isUser ? "bg-primary text-primary-foreground" : "bg-muted")}>
        {isUser ? (
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
        )}
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
