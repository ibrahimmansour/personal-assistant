"use client";

import { WidgetWrapper } from "@/components/widget-wrapper";
import {
  TerminalSquare,
  Plus,
  X,
  Loader2,
  AlertCircle,
  Server,
  History,
  RefreshCw,
  Search,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useEffect, useRef, useState, useCallback } from "react";
import { useTerminal } from "@/components/terminal-context";
import { useWidgetNavFor } from "@/components/widget-nav-context";

const WS_URL = typeof window !== "undefined" ? `ws://${window.location.hostname}:4445` : "ws://localhost:4445";

// ─── Claude Icon ─────────────────────────────────────────────────────────────

function ClaudeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 248 248" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M52.4285 162.873L98.7844 136.879L99.5485 134.602L98.7844 133.334H96.4921L88.7237 132.862L62.2346 132.153L39.3113 131.207L17.0249 130.026L11.4214 128.844L6.2 121.873L6.7094 118.447L11.4214 115.257L18.171 115.847L33.0711 116.911L55.485 118.447L71.6586 119.392L95.728 121.873H99.5485L100.058 120.337L98.7844 119.392L97.7656 118.447L74.5877 102.732L49.4995 86.1905L36.3823 76.62L29.3779 71.7757L25.8121 67.2858L24.2839 57.3608L30.6515 50.2716L39.3113 50.8623L41.4763 51.4531L50.2636 58.1879L68.9842 72.7209L93.4357 90.6804L97.0015 93.6343L98.4374 92.6652L98.6571 91.9801L97.0015 89.2625L83.757 65.2772L69.621 40.8192L63.2534 30.6579L61.5978 24.632C60.9565 22.1032 60.579 20.0111 60.579 17.4246L67.8381 7.49965L71.9133 6.19995L81.7193 7.49965L85.7946 11.0443L91.9074 24.9865L101.714 46.8451L116.996 76.62L121.453 85.4816L123.873 93.6343L124.764 96.1155H126.292V94.6976L127.566 77.9197L129.858 57.3608L132.15 30.8942L132.915 23.4505L136.608 14.4708L143.994 9.62643L149.725 12.344L154.437 19.0788L153.8 23.4505L150.998 41.6463L145.522 70.1215L141.957 89.2625H143.994L146.414 86.7813L156.093 74.0206L172.266 53.698L179.398 45.6635L187.803 36.802L193.152 32.5484H203.34L210.726 43.6549L207.415 55.1159L196.972 68.3492L188.312 79.5739L175.896 96.2095L168.191 109.585L168.882 110.689L170.738 110.53L198.755 104.504L213.91 101.787L231.994 98.7149L240.144 102.496L241.036 106.395L237.852 114.311L218.495 119.037L195.826 123.645L162.07 131.592L161.696 131.893L162.137 132.547L177.36 133.925L183.855 134.279H199.774L229.447 136.524L237.215 141.605L241.8 147.867L241.036 152.711L229.065 158.737L213.019 154.956L175.45 145.977L162.587 142.787H160.805V143.85L171.502 154.366L191.242 172.089L215.82 195.011L217.094 200.682L213.91 205.172L210.599 204.699L188.949 188.394L180.544 181.069L161.696 165.118H160.422V166.772L164.752 173.152L187.803 207.771L188.949 218.405L187.294 221.832L181.308 223.959L174.813 222.777L161.187 203.754L147.305 182.486L136.098 163.345L134.745 164.2L128.075 235.42L125.019 239.201L119.543 241.8L114.703 237.783L113.939 230.812L116.487 206.236L119.543 185.322L121.453 168.18L122.218 160.973L121.071 159.201L119.543 162.155L109.228 182.604L89.3605 212.852L74.2056 233.766L67.4561 240.264L60.579 241.8L54.5935 237.31L54.2107 231.994L56.6304 227.386L73.6963 202.81L93.0536 174.689L107.7 155.076L118.652 141.133L119.543 139.125V137.47L117.505 136.052L52.4285 162.873Z" />
    </svg>
  );
}

// ─── Color helpers ───────────────────────────────────────────────────────────

function resolveColor(cssValue: string, fallback: string): string {
  if (!cssValue) return fallback;
  try {
    const el = document.createElement("div");
    el.style.color = cssValue;
    document.body.appendChild(el);
    const computed = getComputedStyle(el).color;
    document.body.removeChild(el);
    if (!computed || computed === "") return fallback;
    const match = computed.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (!match) return fallback;
    const r = parseInt(match[1]);
    const g = parseInt(match[2]);
    const b = parseInt(match[3]);
    return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
  } catch {
    return fallback;
  }
}

function getCssVarHex(varName: string, fallback: string): string {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  if (!raw) return fallback;
  return resolveColor(raw, fallback);
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
    selectionForeground: undefined,
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

// ─── Tab / Session types ─────────────────────────────────────────────────────

interface TermTab {
  id: string;
  label: string;
  terminal: any;
  fitAddon: any;
  ws: WebSocket;
  alive: boolean;
}

interface ClaudeSession {
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

interface VpsConnection {
  id: string;
  label: string;
  host: string;
  port: number;
  username: string;
  keyPath: string;
  defaultPath: string;
  createdAt: string;
}

let nextTabId = 1;

// Module-level map so sessions survive React remounts (expand/collapse)
const tabStore = new Map<string, TermTab>();

// ─── Widget ──────────────────────────────────────────────────────────────────

export function TerminalWidget() {
  const containerRef = useRef<HTMLDivElement>(null);
  const roRef = useRef<ResizeObserver | null>(null);
  const [tabs, setTabs] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Claude sessions state
  const [showClaudePanel, setShowClaudePanel] = useState(false);
  const [claudeSessions, setClaudeSessions] = useState<ClaudeSession[]>([]);
  const [claudeProjects, setClaudeProjects] = useState<{ dirName: string; path: string }[]>([]);
  const [claudeProjectFilter, setClaudeProjectFilter] = useState<string | null>(null);
  const [claudeLoading, setClaudeLoading] = useState(false);
  const [claudeSearch, setClaudeSearch] = useState("");
  const [claudeSource, setClaudeSource] = useState<"local" | string>("local"); // "local" or VPS connection id

  // VPS state
  const [vpsConnections, setVpsConnections] = useState<VpsConnection[]>([]);
  const [showVpsMenu, setShowVpsMenu] = useState(false);

  // Tmux state
  const [tmuxSessions, setTmuxSessions] = useState<{ name: string; created: string; windows: number; attached: boolean }[]>([]);

  const { request: termRequest, clearRequest: clearTermRequest } = useTerminal();
  const lastTermSeqRef = useRef(0);
  const { expandRequested, onExpandHandled } = useWidgetNavFor("terminal");

  // Sync React state from the module-level store
  const syncTabs = useCallback(() => {
    const ids = Array.from(tabStore.keys());
    setTabs(ids);
  }, []);

  // ── Fetch VPS connections ──────────────────────────────────────────────
  const fetchVpsConnections = useCallback(async () => {
    try {
      const res = await fetch("/api/vps?action=connections");
      if (res.ok) {
        const data = await res.json();
        setVpsConnections(data.connections || data || []);
      }
    } catch {}
  }, []);

  useEffect(() => {
    fetchVpsConnections();
  }, [fetchVpsConnections]);

  // ── Fetch Claude sessions (local or remote) ─────────────────────────────
  const fetchClaudeSessions = useCallback(async () => {
    setClaudeLoading(true);
    try {
      if (claudeSource === "local") {
        const url = claudeProjectFilter
          ? `/api/claude-sessions?project=${encodeURIComponent(claudeProjectFilter)}`
          : "/api/claude-sessions";
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          setClaudeSessions(data.sessions || []);
          setClaudeProjects(data.projects || []);
        }
      } else {
        // Fetch from VPS
        const res = await fetch("/api/claude-sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "remote-sessions", connectionId: claudeSource }),
        });
        if (res.ok) {
          const data = await res.json();
          setClaudeSessions(data.sessions || []);
          // Build project list from remote sessions
          const projSet = new Map<string, string>();
          for (const s of data.sessions || []) {
            if (s.projectPath) projSet.set(s.projectPath, s.projectPath);
          }
          setClaudeProjects([...projSet.entries()].map(([p]) => ({ dirName: p, path: p })));
        }
      }
    } catch {}
    setClaudeLoading(false);
  }, [claudeProjectFilter, claudeSource]);

  // ── Fetch tmux sessions ────────────────────────────────────────────────
  const fetchTmuxSessions = useCallback(async () => {
    try {
      if (claudeSource === "local") {
        const res = await fetch("/api/claude-sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "local-tmux-sessions" }),
        });
        if (res.ok) {
          const data = await res.json();
          setTmuxSessions(data.sessions || []);
        }
      } else {
        const res = await fetch("/api/claude-sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "remote-tmux-sessions", connectionId: claudeSource }),
        });
        if (res.ok) {
          const data = await res.json();
          setTmuxSessions(data.sessions || []);
        }
      }
    } catch {}
  }, [claudeSource]);

  useEffect(() => {
    if (showClaudePanel) {
      fetchClaudeSessions();
      fetchTmuxSessions();
    }
  }, [showClaudePanel, fetchClaudeSessions, fetchTmuxSessions]);

  // ── Attach the active tab's terminal to the container ──────────────────
  const attachActive = useCallback((tabId: string | null) => {
    const container = containerRef.current;
    if (!container) return;

    // Detach previous
    container.innerHTML = "";

    if (!tabId) return;
    const tab = tabStore.get(tabId);
    if (!tab) return;

    const xtermEl = tab.terminal.element;
    if (xtermEl) {
      container.appendChild(xtermEl);
    }

    // Re-fit after layout settles
    requestAnimationFrame(() => {
      setTimeout(() => {
        try {
          tab.fitAddon.fit();
          const dims = tab.fitAddon.proposeDimensions();
          if (dims && dims.cols >= 2 && dims.rows >= 2 && tab.ws.readyState === WebSocket.OPEN) {
            tab.ws.send(JSON.stringify({ type: "resize", cols: dims.cols, rows: dims.rows }));
          }
        } catch {}
        tab.terminal.focus();
      }, 30);
    });
  }, []);

  // ── Create a new tab ───────────────────────────────────────────────────
  const createTab = useCallback(async (opts?: { cwd?: string; cmd?: string; label?: string }) => {
    const container = containerRef.current;
    if (!container) return;

    setLoading(true);
    setError(null);

    try {
      const { Terminal } = await import("@xterm/xterm");
      const { FitAddon } = await import("@xterm/addon-fit");
      const { WebLinksAddon } = await import("@xterm/addon-web-links");
      await import("@xterm/xterm/css/xterm.css");

      const id = `term-${nextTabId++}`;
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

      // Open into a temporary off-screen div so xterm creates its DOM.
      const tmpDiv = document.createElement("div");
      tmpDiv.style.cssText = "position:absolute;left:-9999px;width:600px;height:300px";
      document.body.appendChild(tmpDiv);
      terminal.open(tmpDiv);
      document.body.removeChild(tmpDiv);

      // Build WebSocket URL with optional cwd and cmd query params
      const wsUrl = new URL(WS_URL);
      if (opts?.cwd) wsUrl.searchParams.set("cwd", opts.cwd);
      if (opts?.cmd) wsUrl.searchParams.set("cmd", opts.cmd);

      const ws = new WebSocket(wsUrl.toString());

      const tabLabel = opts?.label || `${tabStore.size + 1}`;
      const tab: TermTab = { id, label: tabLabel, terminal, fitAddon, ws, alive: true };

      ws.onopen = () => {
        setLoading(false);
        try {
          fitAddon.fit();
          const dims = fitAddon.proposeDimensions();
          if (dims && dims.cols >= 2 && dims.rows >= 2) ws.send(JSON.stringify({ type: "resize", cols: dims.cols, rows: dims.rows }));
        } catch {}
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "output") {
            terminal.write(msg.data);
          } else if (msg.type === "exit") {
            terminal.writeln("\r\n\x1b[90m[Process exited]\x1b[0m");
            tab.alive = false;
            syncTabs();
          }
        } catch {
          terminal.write(event.data);
        }
      };

      ws.onclose = () => {
        tab.alive = false;
        syncTabs();
      };

      ws.onerror = () => {
        setError("Cannot connect to terminal server. Start it with: npm run dev:pty");
        setLoading(false);
        tab.alive = false;
        syncTabs();
      };

      terminal.onData((data: string) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "input", data }));
        }
      });

      tabStore.set(id, tab);
      syncTabs();
      setActiveTab(id);
      setShowClaudePanel(false);
      setTimeout(() => attachActive(id), 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create terminal");
      setLoading(false);
    }
  }, [attachActive, syncTabs]);

  // ── Open Claude (new session) ──────────────────────────────────────────
  const openClaude = useCallback((cwd?: string, inTmux?: boolean) => {
    if (claudeSource !== "local") {
      const conn = vpsConnections.find((c) => c.id === claudeSource);
      if (!conn) return;
      const target = conn.username ? `${conn.username}@${conn.host}` : conn.host;
      const portArg = conn.port && conn.port !== 22 ? `-p ${conn.port}` : "";
      const keyArg = conn.keyPath ? `-i ${conn.keyPath}` : "";
      const remoteCmd = inTmux
        ? `tmux new-session -s claude-$(date +%s) 'claude'`
        : "claude";
      const remoteCwd = cwd || conn.defaultPath;
      const sshCmd = `ssh ${portArg} ${keyArg} -t ${target} "cd ${remoteCwd} && ${remoteCmd}"`.replace(/  +/g, " ");
      createTab({ cwd: "~", cmd: sshCmd, label: `Claude (${conn.label})` });
    } else {
      const cmd = inTmux ? `tmux new-session -s claude-$(date +%s) 'claude'` : "claude";
      createTab({ cwd: cwd || "~", cmd, label: "Claude" });
    }
  }, [createTab, claudeSource, vpsConnections]);

  // ── Resume Claude session ──────────────────────────────────────────────
  const resumeClaudeSession = useCallback((session: ClaudeSession, inTmux?: boolean) => {
    const cwd = session.projectPath || "~";
    const resumeCmd = `claude --resume ${session.sessionId}`;
    const label = session.summary
      ? `Claude: ${session.summary.slice(0, 30)}`
      : `Claude: ${session.sessionId.slice(0, 8)}`;

    if (claudeSource !== "local") {
      const conn = vpsConnections.find((c) => c.id === claudeSource);
      if (!conn) return;
      const target = conn.username ? `${conn.username}@${conn.host}` : conn.host;
      const portArg = conn.port && conn.port !== 22 ? `-p ${conn.port}` : "";
      const keyArg = conn.keyPath ? `-i ${conn.keyPath}` : "";
      const remoteCmd = inTmux
        ? `tmux new-session -s claude-${session.sessionId.slice(0, 8)} '${resumeCmd}'`
        : resumeCmd;
      const sshCmd = `ssh ${portArg} ${keyArg} -t ${target} "cd ${cwd} && ${remoteCmd}"`.replace(/  +/g, " ");
      createTab({ cwd: "~", cmd: sshCmd, label });
    } else {
      const cmd = inTmux
        ? `tmux new-session -s claude-${session.sessionId.slice(0, 8)} '${resumeCmd}'`
        : resumeCmd;
      createTab({ cwd, cmd, label });
    }
  }, [createTab, claudeSource, vpsConnections]);

  // ── Attach to tmux session ─────────────────────────────────────────────
  const attachTmuxSession = useCallback((sessionName: string) => {
    if (claudeSource !== "local") {
      const conn = vpsConnections.find((c) => c.id === claudeSource);
      if (!conn) return;
      const target = conn.username ? `${conn.username}@${conn.host}` : conn.host;
      const portArg = conn.port && conn.port !== 22 ? `-p ${conn.port}` : "";
      const keyArg = conn.keyPath ? `-i ${conn.keyPath}` : "";
      const sshCmd = `ssh ${portArg} ${keyArg} -t ${target} "tmux attach-session -t ${sessionName}"`.replace(/  +/g, " ");
      createTab({ cwd: "~", cmd: sshCmd, label: `tmux: ${sessionName}` });
    } else {
      createTab({ cwd: "~", cmd: `tmux attach-session -t ${sessionName}`, label: `tmux: ${sessionName}` });
    }
  }, [createTab, claudeSource, vpsConnections]);

  // ── Open VPS terminal ──────────────────────────────────────────────────
  const openVpsTerminal = useCallback((conn: VpsConnection) => {
    const target = conn.username ? `${conn.username}@${conn.host}` : conn.host;
    const portArg = conn.port && conn.port !== 22 ? `-p ${conn.port}` : "";
    const keyArg = conn.keyPath ? `-i ${conn.keyPath.startsWith("~") ? conn.keyPath : conn.keyPath}` : "";
    const sshCmd = `ssh ${portArg} ${keyArg} -t ${target} "cd ${conn.defaultPath} && exec \\$SHELL -l"`.replace(/  +/g, " ");
    createTab({ cwd: "~", cmd: sshCmd, label: conn.label });
    setShowVpsMenu(false);
  }, [createTab]);

  // ── Open Claude on VPS ─────────────────────────────────────────────────
  const openClaudeOnVps = useCallback((conn: VpsConnection) => {
    const target = conn.username ? `${conn.username}@${conn.host}` : conn.host;
    const portArg = conn.port && conn.port !== 22 ? `-p ${conn.port}` : "";
    const keyArg = conn.keyPath ? `-i ${conn.keyPath}` : "";
    const sshCmd = `ssh ${portArg} ${keyArg} -t ${target} "cd ${conn.defaultPath} && claude"`.replace(/  +/g, " ");
    createTab({ cwd: "~", cmd: sshCmd, label: `Claude (${conn.label})` });
    setShowVpsMenu(false);
  }, [createTab]);

  // ── Close a tab ────────────────────────────────────────────────────────
  const closeTab = useCallback((id: string) => {
    const tab = tabStore.get(id);
    if (tab) {
      try { tab.ws.close(); } catch {}
      try { tab.terminal.dispose(); } catch {}
      tabStore.delete(id);
    }
    syncTabs();
    setActiveTab((prev) => {
      if (prev !== id) return prev;
      const remaining = Array.from(tabStore.keys());
      return remaining.length > 0 ? remaining[remaining.length - 1] : null;
    });
  }, [syncTabs]);

  // ── Switch tab ─────────────────────────────────────────────────────────
  const switchTab = useCallback((id: string) => {
    setActiveTab(id);
    setShowClaudePanel(false);
    attachActive(id);
  }, [attachActive]);

  // ── Bootstrap: restore existing tabs or create the first one ───────────
  useEffect(() => {
    if (tabStore.size > 0) {
      syncTabs();
      const ids = Array.from(tabStore.keys());
      setActiveTab((prev) => {
        const restored = prev && tabStore.has(prev) ? prev : ids[ids.length - 1];
        setTimeout(() => attachActive(restored), 0);
        return restored;
      });
    } else {
      createTab();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Re-attach active tab when activeTab changes ────────────────────────
  useEffect(() => {
    if (activeTab && !showClaudePanel) attachActive(activeTab);
  }, [activeTab, attachActive, showClaudePanel]);

  // ── ResizeObserver: watch the container and re-fit ─────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    roRef.current?.disconnect();

    const ro = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        if (!activeTab) return;
        const tab = tabStore.get(activeTab);
        if (!tab) return;
        try {
          tab.fitAddon.fit();
          const dims = tab.fitAddon.proposeDimensions();
          if (dims && dims.cols >= 2 && dims.rows >= 2 && tab.ws.readyState === WebSocket.OPEN) {
            tab.ws.send(JSON.stringify({ type: "resize", cols: dims.cols, rows: dims.rows }));
          }
        } catch {}
      });
    });
    ro.observe(container);
    roRef.current = ro;

    return () => ro.disconnect();
  }, [activeTab]);

  // ── Dark/light theme sync ──────────────────────────────────────────────
  useEffect(() => {
    const observer = new MutationObserver(() => {
      const theme = getTermTheme();
      for (const tab of tabStore.values()) {
        tab.terminal.options.theme = theme;
      }
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  // ── Handle expand/collapse ─────────────────────────────────────────────
  const handleExpandChange = useCallback(() => {
    setTimeout(() => {
      if (activeTab) attachActive(activeTab);
    }, 100);
  }, [activeTab, attachActive]);

  // ── Listen for external terminal tab requests (from files widget etc.) ──
  useEffect(() => {
    if (
      termRequest &&
      termRequest.seq !== lastTermSeqRef.current
    ) {
      lastTermSeqRef.current = termRequest.seq;
      createTab({
        cwd: termRequest.cwd,
        cmd: termRequest.command,
        label: termRequest.label,
      });
      clearTermRequest();
    }
  }, [termRequest, clearTermRequest, createTab]);

  // ── Filtered claude sessions ───────────────────────────────────────────
  const filteredSessions = claudeSessions.filter((s) => {
    if (!claudeSearch) return true;
    const q = claudeSearch.toLowerCase();
    return (
      (s.summary || "").toLowerCase().includes(q) ||
      (s.firstPrompt || "").toLowerCase().includes(q) ||
      (s.projectPath || "").toLowerCase().includes(q)
    );
  });

  // ── Render ─────────────────────────────────────────────────────────────

  const activeTabObj = activeTab ? tabStore.get(activeTab) : null;
  const hasLiveTab = activeTabObj?.alive && activeTabObj.ws.readyState === WebSocket.OPEN;
  const showContent = hasLiveTab || (activeTabObj && activeTabObj.terminal.element);

  return (
    <WidgetWrapper
      title="Terminal"
      icon={<TerminalSquare className="h-4 w-4" />}
      widgetType="terminal"
      expandRequested={expandRequested}
      onExpandHandled={onExpandHandled}
      onExpandChange={handleExpandChange}
      headerAction={
        <div className="flex items-center gap-1">
          {/* Claude button */}
          <button
            onClick={() => setShowClaudePanel(!showClaudePanel)}
            className={cn(
              "p-1 rounded-md transition-colors",
              showClaudePanel
                ? "text-primary bg-primary/10"
                : "text-muted-foreground hover:text-foreground hover:bg-muted"
            )}
            title="Claude Sessions"
          >
            <ClaudeIcon className="h-3.5 w-3.5" />
          </button>
          {/* VPS button */}
          <div className="relative">
            <button
              onClick={() => setShowVpsMenu(!showVpsMenu)}
              className={cn(
                "p-1 rounded-md transition-colors",
                vpsConnections.length > 0
                  ? "text-green-500 hover:text-green-400 hover:bg-muted"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              )}
              title={`VPS (${vpsConnections.length} connections)`}
            >
              <Server className="h-3.5 w-3.5" />
            </button>
            {showVpsMenu && vpsConnections.length > 0 && (
              <div className="absolute right-0 top-full mt-1 z-50 bg-popover border border-border rounded-md shadow-lg py-1 min-w-[180px]">
                {vpsConnections.map((conn) => (
                  <div key={conn.id} className="px-2 py-1">
                    <div className="text-[10px] text-muted-foreground font-medium mb-0.5">{conn.label}</div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => openVpsTerminal(conn)}
                        className="text-[10px] px-1.5 py-0.5 rounded bg-muted hover:bg-muted/80 text-foreground transition-colors"
                        title="Open SSH terminal"
                      >
                        <TerminalSquare className="h-3 w-3 inline mr-0.5" />
                        SSH
                      </button>
                      <button
                        onClick={() => openClaudeOnVps(conn)}
                        className="text-[10px] px-1.5 py-0.5 rounded bg-muted hover:bg-muted/80 text-foreground transition-colors"
                        title="Open Claude on VPS"
                      >
                        <ClaudeIcon className="h-3 w-3 inline mr-0.5" />
                        Claude
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          {/* New tab button */}
          <button
            onClick={() => createTab()}
            disabled={loading}
            className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded-md hover:bg-muted disabled:opacity-50"
            title="New tab"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
      }
    >
      <div className="flex flex-col h-full">
        {/* Tab bar */}
        {tabs.length > 1 && !showClaudePanel && (
          <div className="flex items-center gap-0.5 pb-1.5 mb-1.5 border-b border-border overflow-x-auto shrink-0">
            {tabs.map((id) => {
              const tab = tabStore.get(id);
              const isActive = id === activeTab;
              return (
                <div
                  key={id}
                  className={cn(
                    "flex items-center gap-1 px-2 py-0.5 rounded text-[11px] cursor-pointer transition-colors shrink-0",
                    isActive
                      ? "bg-primary/15 text-primary"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                  )}
                  onClick={() => switchTab(id)}
                >
                  <TerminalSquare className="h-3 w-3" />
                  <span>
                    {tab?.label || id}
                    {tab && !tab.alive && " (exited)"}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      closeTab(id);
                    }}
                    className="ml-0.5 p-0.5 rounded hover:bg-muted transition-colors opacity-50 hover:opacity-100"
                    title="Close tab"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* Claude Sessions Panel */}
        {showClaudePanel && (
          <div className="flex flex-col h-full overflow-hidden">
            {/* Header */}
            <div className="flex items-center gap-2 pb-2 mb-2 border-b border-border shrink-0">
              <ClaudeIcon className="h-4 w-4 text-primary" />
              <span className="text-xs font-medium">Claude Sessions</span>
              <div className="flex-1" />
              <button
                onClick={() => openClaude(undefined, false)}
                className="text-[10px] px-2 py-0.5 rounded-md bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                title="New Claude session"
              >
                New
              </button>
              <button
                onClick={() => openClaude(undefined, true)}
                className="text-[10px] px-2 py-0.5 rounded-md bg-green-500/10 text-green-600 dark:text-green-400 hover:bg-green-500/20 transition-colors"
                title="New Claude session in tmux"
              >
                + tmux
              </button>
              <button
                onClick={() => { fetchClaudeSessions(); fetchTmuxSessions(); }}
                className="p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                title="Refresh"
              >
                <RefreshCw className={cn("h-3 w-3", claudeLoading && "animate-spin")} />
              </button>
            </div>

            {/* Source selector + Search + Filter */}
            <div className="flex items-center gap-2 pb-2 shrink-0">
              {/* Source: local or VPS */}
              <select
                value={claudeSource}
                onChange={(e) => { setClaudeSource(e.target.value); setClaudeProjectFilter(null); }}
                className="text-[10px] bg-muted/40 border border-border rounded px-1.5 py-1 outline-none max-w-[110px] truncate"
              >
                <option value="local">Local</option>
                {vpsConnections.map((c) => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
              <div className="flex-1 relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                <input
                  type="text"
                  value={claudeSearch}
                  onChange={(e) => setClaudeSearch(e.target.value)}
                  placeholder="Search sessions..."
                  className="w-full text-xs bg-muted/40 border border-border rounded pl-7 pr-2 py-1 outline-none focus:ring-1 focus:ring-primary/50"
                />
              </div>
              <select
                value={claudeProjectFilter || ""}
                onChange={(e) => setClaudeProjectFilter(e.target.value || null)}
                className="text-[10px] bg-muted/40 border border-border rounded px-1.5 py-1 outline-none max-w-[120px] truncate"
              >
                <option value="">All projects</option>
                {claudeProjects.map((p) => (
                  <option key={p.dirName} value={p.dirName}>
                    {p.path.split("/").pop() || p.path}
                  </option>
                ))}
              </select>
            </div>

            {/* Tmux sessions (if any) */}
            {tmuxSessions.length > 0 && (
              <div className="pb-2 mb-2 border-b border-border shrink-0">
                <div className="flex items-center gap-1 mb-1">
                  <TerminalSquare className="h-3 w-3 text-green-500" />
                  <span className="text-[10px] font-medium text-muted-foreground">tmux sessions</span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {tmuxSessions.map((s) => (
                    <button
                      key={s.name}
                      onClick={() => attachTmuxSession(s.name)}
                      className={cn(
                        "text-[10px] px-2 py-0.5 rounded-md border transition-colors",
                        s.attached
                          ? "border-green-500/50 bg-green-500/10 text-green-600 dark:text-green-400"
                          : "border-border bg-muted/40 text-foreground hover:bg-muted"
                      )}
                      title={`${s.windows} window${s.windows > 1 ? "s" : ""}${s.attached ? " (attached)" : ""}`}
                    >
                      {s.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Session list */}
            <div className="flex-1 overflow-y-auto space-y-1 min-h-0">
              {claudeLoading && filteredSessions.length === 0 ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              ) : filteredSessions.length === 0 ? (
                <div className="text-center text-xs text-muted-foreground py-8">
                  No sessions found
                </div>
              ) : (
                filteredSessions.map((session) => (
                  <div
                    key={session.sessionId}
                    className="w-full text-left px-2.5 py-2 rounded-md hover:bg-muted/60 transition-colors group border border-transparent hover:border-border"
                  >
                    <div className="flex items-start gap-2">
                      <History className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium text-foreground truncate">
                          {session.summary || session.firstPrompt.slice(0, 60) || session.sessionId.slice(0, 8)}
                        </div>
                        {session.summary && session.firstPrompt && (
                          <div className="text-[10px] text-muted-foreground truncate mt-0.5">
                            {session.firstPrompt.slice(0, 80)}
                          </div>
                        )}
                        <div className="flex items-center gap-2 mt-1 text-[9px] text-muted-foreground">
                          <span>{session.projectPath.split("/").pop()}</span>
                          {session.gitBranch && (
                            <span className="text-primary/70">{session.gitBranch}</span>
                          )}
                          <span>{session.messageCount} msgs</span>
                          <span>
                            {session.modified
                              ? new Date(session.modified).toLocaleDateString(undefined, { month: "short", day: "numeric" })
                              : ""}
                          </span>
                        </div>
                        {/* Action buttons */}
                        <div className="flex items-center gap-1 mt-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => resumeClaudeSession(session, false)}
                            className="text-[9px] px-1.5 py-0.5 rounded bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                          >
                            Resume
                          </button>
                          <button
                            onClick={() => resumeClaudeSession(session, true)}
                            className="text-[9px] px-1.5 py-0.5 rounded bg-green-500/10 text-green-600 dark:text-green-400 hover:bg-green-500/20 transition-colors"
                          >
                            Resume in tmux
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* Error state */}
        {!showClaudePanel && error && tabs.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="flex flex-col items-center gap-2 text-muted-foreground text-center px-4">
              <AlertCircle className="h-5 w-5 text-destructive" />
              <span className="text-xs">{error}</span>
              <button onClick={() => createTab()} className="text-xs text-primary hover:underline mt-1">
                Retry
              </button>
            </div>
          </div>
        ) : !showClaudePanel && loading && tabs.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="flex flex-col items-center gap-2 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-xs">Connecting...</span>
            </div>
          </div>
        ) : !showClaudePanel && tabs.length === 0 ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <button onClick={() => createTab()} className="text-xs text-primary hover:underline">
              Open a terminal
            </button>
          </div>
        ) : null}

        {/* Terminal canvas container */}
        <div
          ref={containerRef}
          className={cn(
            "flex-1 min-h-0 overflow-hidden",
            (tabs.length === 0 || showClaudePanel) && "hidden"
          )}
          onMouseDown={(e) => e.stopPropagation()}
        />
      </div>
    </WidgetWrapper>
  );
}
