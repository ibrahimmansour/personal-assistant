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

interface ClaudeProject {
  dirName: string;
  path: string;
}

interface SessionState {
  /** Stable client-side key. For new sessions we use `pending-<n>`; for resumes we use the sessionId. */
  key: string;
  /** Real Claude session ID once known (matches the JSONL filename). Same as `key` for resumes. */
  sessionId: string | null;
  /** xterm.Terminal instance */
  terminal: any;
  /** xterm FitAddon */
  fitAddon: any;
  /** WebSocket to the PTY server */
  ws: WebSocket;
  alive: boolean;
  /** Working directory the terminal was launched in */
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
function encodeProjectDirName(absPath: string): string {
  if (!absPath || absPath === "/") return "-";
  return absPath.replace(/\//g, "-");
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

interface CreateSessionOpts {
  cwd: string;
  /** When set, run `claude --resume <id>` instead of a fresh session. */
  resumeId?: string;
  label?: string;
}

async function createSession(opts: CreateSessionOpts): Promise<SessionState | null> {
  try {
    const { Terminal } = await import("@xterm/xterm");
    const { FitAddon } = await import("@xterm/addon-fit");
    const { WebLinksAddon } = await import("@xterm/addon-web-links");
    await import("@xterm/xterm/css/xterm.css");

    const cmd = opts.resumeId
      ? `claude --dangerously-skip-permissions --resume ${opts.resumeId}`
      : "claude --dangerously-skip-permissions";

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
    wsUrl.searchParams.set("cwd", opts.cwd);
    wsUrl.searchParams.set("cmd", cmd);

    const ws = new WebSocket(wsUrl.toString());

    const key = opts.resumeId || `pending-${pendingCounter++}`;

    const state: SessionState = {
      key,
      sessionId: opts.resumeId || null,
      terminal,
      fitAddon,
      ws,
      alive: true,
      cwd: opts.cwd,
      label: opts.label || (opts.resumeId ? `Resumed ${opts.resumeId.slice(0, 8)}` : "New session"),
      isResume: !!opts.resumeId,
      projectDirName: encodeProjectDirName(opts.cwd),
      messages: [],
      sse: null,
      subscribers: new Set(),
    };

    ws.onopen = () => {
      try {
        fitAddon.fit();
        const dims = fitAddon.proposeDimensions();
        if (dims) ws.send(JSON.stringify({ type: "resize", cols: dims.cols, rows: dims.rows }));
      } catch {}
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

    sessionStore.set(state.key, state);

    // For resume sessions we know the sessionId immediately — start tailing now.
    if (state.sessionId) {
      attachSse(state);
    } else {
      // For new sessions we need to wait until the JSONL appears. Poll the project dir.
      pollForNewSessionId(state);
    }

    return state;
  } catch (err) {
    console.error("[claude-code-widget] createSession failed:", err);
    return null;
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
    if (!state.alive || state.sessionId || attempts > 120) {
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
        state.sessionId = found.sessionId;
        // Re-key the store so future lookups find it.
        sessionStore.delete(state.key);
        state.key = found.sessionId;
        sessionStore.set(state.key, state);
        attachSse(state);
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
      notifySubscribers(state);
    } catch {}
  });

  es.onerror = () => {
    // Browser auto-reconnects; nothing to do here unless we want explicit handling.
  };
}

function pasteIntoTerminal(state: SessionState, text: string) {
  if (!state.alive || state.ws.readyState !== WebSocket.OPEN) return false;
  state.ws.send(JSON.stringify({ type: "input", data: text }));
  return true;
}

function destroySession(key: string) {
  const state = sessionStore.get(key);
  if (!state) return;
  try { state.sse?.close(); } catch {}
  try { state.ws.close(); } catch {}
  try { state.terminal.dispose(); } catch {}
  state.subscribers.clear();
  sessionStore.delete(key);
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

function ToolUsePill({ name }: { name: string }) {
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded bg-muted/60 text-muted-foreground border border-border/60 mr-1 mt-1">
      <Wrench className="h-2.5 w-2.5" />
      {name}
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

  // Sessions list (from disk)
  const [sessions, setSessions] = useState<ClaudeSessionInfo[]>([]);
  const [projects, setProjects] = useState<ClaudeProject[]>([]);
  const [projectFilter, setProjectFilter] = useState<string | null>(null);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // Folder picker state
  const [folderInput, setFolderInput] = useState("");
  const [recentFolders, setRecentFolders] = useState<string[]>([]);

  // Subscribe to active session
  const active = useSessionSubscription(activeKey);

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
  const fetchSessions = useCallback(async () => {
    setSessionsLoading(true);
    try {
      const url = projectFilter
        ? `/api/claude-sessions?project=${encodeURIComponent(projectFilter)}`
        : "/api/claude-sessions";
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setSessions(data.sessions || []);
        setProjects(data.projects || []);
      }
    } catch {}
    setSessionsLoading(false);
  }, [projectFilter]);

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
        try { s.terminal.options.theme = theme; } catch {}
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
      const state = await createSession({ cwd, label: "New session" });
      if (state) {
        setActiveKey(state.key);
        setView("chat");
        setShowFolderPicker(false);
      }
    } finally {
      setCreating(false);
    }
  }, [persistRecentFolder]);

  // ── Resume an existing session in its original cwd ────────────────────
  const resumeSession = useCallback(async (s: ClaudeSessionInfo) => {
    // If a session with this id is already running in our store, just switch to it.
    const existing = sessionStore.get(s.sessionId);
    if (existing) {
      setActiveKey(existing.key);
      setView("chat");
      return;
    }

    setCreating(true);
    try {
      const cwd = s.projectPath || "~";
      const label = s.summary || s.firstPrompt?.slice(0, 30) || s.sessionId.slice(0, 8);
      const state = await createSession({ cwd, resumeId: s.sessionId, label });
      if (state) {
        setActiveKey(state.key);
        setView("chat");
      }
    } finally {
      setCreating(false);
    }
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
  const filteredSessions = sessions.filter((s) => {
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
                onClick={() => setShowFolderPicker(true)}
                disabled={creating}
              >
                {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Plus className="h-3.5 w-3.5 mr-1.5" />}
                New Session
              </Button>

              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search sessions"
                  className="pl-7 h-7 text-xs"
                />
              </div>

              {projects.length > 0 && (
                <select
                  value={projectFilter || ""}
                  onChange={(e) => setProjectFilter(e.target.value || null)}
                  className="w-full text-xs px-2 py-1 rounded border border-border bg-background"
                >
                  <option value="">All projects</option>
                  {projects.map((p) => (
                    <option key={p.dirName} value={p.dirName}>{p.path || p.dirName}</option>
                  ))}
                </select>
              )}
            </div>

            <ScrollArea className="flex-1 min-h-0">
              <div className="px-2 pb-2 space-y-1">
                {sessionsLoading && sessions.length === 0 && (
                  <div className="text-xs text-muted-foreground py-4 text-center">
                    <Loader2 className="h-3.5 w-3.5 animate-spin inline mr-1.5" />
                    Loading…
                  </div>
                )}
                {!sessionsLoading && filteredSessions.length === 0 && (
                  <div className="text-xs text-muted-foreground py-4 text-center">
                    No sessions
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
              <ChatView state={active} />
            ) : (
              <TerminalView state={active} />
            )}
          </div>
        </div>
      </div>
    </WidgetWrapper>
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

function ChatView({ state }: { state: SessionState }) {
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll on new messages
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [state.messages.length]);

  const send = useCallback(() => {
    const text = input.trim();
    if (!text || !state.alive) return;
    setSending(true);
    // Paste prompt + ENTER. Claude CLI's TUI will receive each char and submit on \r.
    const ok = pasteIntoTerminal(state, text + "\r");
    if (ok) setInput("");
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
              <ChatBubble key={m.id} message={m} />
            ))}
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
            placeholder={state.alive ? "Send a message to Claude…" : "Session ended"}
            disabled={!state.alive || sending}
            rows={1}
            className="flex-1 resize-none px-2 py-1.5 text-sm rounded-md border border-border bg-background min-h-[36px] max-h-[120px] focus:outline-none focus:ring-1 focus:ring-primary/40"
          />
          <Button size="sm" onClick={send} disabled={!input.trim() || !state.alive}>
            <Send className="h-3.5 w-3.5" />
          </Button>
        </div>
        {!state.alive && (
          <div className="text-[10px] text-muted-foreground mt-1">
            The Claude process exited. Close and start a new session.
          </div>
        )}
      </div>
    </div>
  );
}

function ChatBubble({ message }: { message: ChatMessage }) {
  const [copied, setCopied] = useState(false);
  const isUser = message.role === "user";
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
            {message.toolUses && message.toolUses.length > 0 && (
              <div className="flex flex-wrap items-center gap-0">
                {message.toolUses.map((t, i) => <ToolUsePill key={i} name={t.name} />)}
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

  // Mount/unmount: move xterm element in/out of the visible container
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const xtermEl = state.terminal.element as HTMLElement | undefined;
    if (xtermEl) {
      container.appendChild(xtermEl);
    }

    requestAnimationFrame(() => {
      try {
        state.fitAddon.fit();
        const dims = state.fitAddon.proposeDimensions();
        if (dims && state.ws.readyState === WebSocket.OPEN) {
          state.ws.send(JSON.stringify({ type: "resize", cols: dims.cols, rows: dims.rows }));
        }
      } catch {}
      try { state.terminal.focus(); } catch {}
    });

    const ro = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        try {
          state.fitAddon.fit();
          const dims = state.fitAddon.proposeDimensions();
          if (dims && state.ws.readyState === WebSocket.OPEN) {
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
  }, [state]);

  return (
    <div
      ref={containerRef}
      className="h-full w-full px-1 py-1"
      onMouseDown={(e) => e.stopPropagation()}
    />
  );
}
