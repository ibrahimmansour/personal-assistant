"use client";

import { WidgetWrapper } from "@/components/widget-wrapper";
import {
  Bot,
  Plus,
  Trash2,
  Send,
  Loader2,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Check,
  X,
  Copy,
  ChevronDown,
  ChevronRight,
  Wifi,
  WifiOff,
  Settings,
  FolderOpen,
  FolderPlus,
  GitBranch,
  GitFork,
  Terminal,
  Square,
  FileCode,
  Play,
  AlertCircle,
  Activity,
  MessageSquare,
  Zap,
  RefreshCw,
  Shield,
} from "lucide-react";
import { TerminalPanel } from "@/components/terminal-panel";
import { cn } from "@/lib/utils";
import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// ─── Types ───────────────────────────────────────────────────────────────────

interface ToolCallBlock {
  type: "tool_call";
  id: string;
  name: string;
  input: Record<string, unknown>;
  status?: "running" | "done" | "error";
}

interface TextBlock {
  type: "text";
  text: string;
}

type ContentBlock = TextBlock | ToolCallBlock;

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  blocks?: ContentBlock[];
  timestamp: string;
  tokenCount?: number;
}

interface SessionInfo {
  sessionId: string;
  summary: string;
  lastModified: number;
  firstPrompt?: string;
  cwd?: string;
  isolated?: boolean;
  isolatedHome?: string;
}

interface RelayConfig {
  url: string;
  token?: string;
  defaultCwd?: string;
  label: string;
}

interface Worktree {
  path: string;
  branch?: string;
  head?: string;
  bare?: boolean;
  detached?: boolean;
}

const MODELS = [
  { id: "claude-sonnet-4-6", label: "Sonnet 4.6" },
  { id: "claude-opus-4-7", label: "Opus 4.7" },
  { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5" },
];

const MAX_CONTEXT_TOKENS = 1000000; // Claude Sonnet 4.6 / Opus 4.7 context window

// ─── Claude Icon ─────────────────────────────────────────────────────────────

function ClaudeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M4.709 15.955l4.397-2.463.072-.216-.072-.12h-.217l-.737-.045-2.515-.067-2.173-.09-2.115-.112-.531-.112L.3 11.57l.048-.325.447-.302.64.056 1.412.1 2.126.146 1.534.09 2.284.235h.362l.048-.146-.12-.09-.097-.09-2.198-1.493-2.38-1.57-1.245-.907-.664-.46-.338-.425-.145-.94.604-.671.82.056.205.056.833.639 1.776 1.377 2.318 1.703.338.28.136-.092.02-.065-.157-.258-1.255-2.274-1.34-2.32-.604-.963-.157-.572.688-.94.48-.118.932.336.386.383.58 1.322.93 2.072 1.448 2.826.423.84.23.774.084.235h.145v-.134.121-.255l.12-1.591.218-1.95.257-2.513.073-.706.35-.851.7-.46.543.258.447.639-.06.415-.266 1.724-.528 2.703-.338 1.815h.193l.23-.235.919-1.21 1.535-1.927.676-.775.797-.84.507-.403.967-.045.72 1.054-.314 1.088-.999 1.254-.82 1.065-1.182 1.577-.725 1.268.065.105.176-.015 2.657-.572 1.437-.258 1.714-.291.773.358.085.37-.302.751-1.835.448-2.152.547-.578 1.483-.132.085-.597-.036-1.541-1.29-.277-3.047-.075h-.17v.1l1.015.998 1.873 1.681 2.33 2.175.12.538-.302.425-.314-.045-2.058-1.546-.796-.695-1.835-1.513h-.12v.1l.41.606 2.186 3.28.109 1.008-.157.325-.567.202-.617-.112-1.292-1.827-1.316-2.017-1.063-1.815-.128.081-.632 6.754-.29.358-.597.09-.277-.045 .12-.64.446-3.476.434-3.054z"/>
    </svg>
  );
}

// ─── Collapsible Tool Call Block ─────────────────────────────────────────────

function ToolCallPill({ block }: { block: ToolCallBlock }) {
  const [expanded, setExpanded] = useState(false);

  const getToolIcon = (name: string) => {
    if (name.includes("file") || name.includes("write") || name.includes("read") || name.includes("edit")) return <FileCode className="h-3 w-3" />;
    if (name.includes("bash") || name.includes("exec") || name.includes("run")) return <Terminal className="h-3 w-3" />;
    return <Zap className="h-3 w-3" />;
  };

  const getStatusColor = (status?: string) => {
    if (status === "running") return "border-blue-500/50 bg-blue-500/5";
    if (status === "error") return "border-destructive/50 bg-destructive/5";
    return "border-border bg-muted/30";
  };

  // Extract relevant info from input
  const getSummary = () => {
    const input = block.input;
    if (input.command) return String(input.command).slice(0, 80);
    if (input.filePath || input.path) return String(input.filePath || input.path).split("/").pop();
    if (input.pattern) return `pattern: ${input.pattern}`;
    return block.name;
  };

  return (
    <div className={cn("rounded-md border my-1.5 transition-colors", getStatusColor(block.status))}>
      <div
        className="flex items-center gap-2 px-2.5 py-1.5 cursor-pointer select-none"
        onClick={() => setExpanded(!expanded)}
      >
        <ChevronRight className={cn("h-3 w-3 transition-transform shrink-0", expanded && "rotate-90")} />
        {getToolIcon(block.name)}
        <span className="text-xs font-medium">{block.name}</span>
        <span className="text-[11px] text-muted-foreground truncate flex-1">{getSummary()}</span>
        {block.status === "running" && <Loader2 className="h-3 w-3 animate-spin text-blue-500 shrink-0" />}
        {block.status === "error" && <AlertCircle className="h-3 w-3 text-destructive shrink-0" />}
        {block.status === "done" && <Check className="h-3 w-3 text-green-500 shrink-0" />}
      </div>
      {expanded && (
        <div className="border-t border-border px-2.5 py-2">
          <pre className="text-[11px] font-mono overflow-x-auto whitespace-pre-wrap text-muted-foreground max-h-48 overflow-y-auto">
            {JSON.stringify(block.input, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

// ─── Inline Diff Renderer ────────────────────────────────────────────────────

function DiffBlock({ content }: { content: string }) {
  const lines = content.split("\n");
  return (
    <div className="rounded-md border border-border my-2 overflow-hidden text-[11px] font-mono">
      {lines.map((line, i) => {
        let bg = "";
        let textColor = "";
        if (line.startsWith("+") && !line.startsWith("+++")) {
          bg = "bg-green-500/10";
          textColor = "text-green-700 dark:text-green-400";
        } else if (line.startsWith("-") && !line.startsWith("---")) {
          bg = "bg-red-500/10";
          textColor = "text-red-700 dark:text-red-400";
        } else if (line.startsWith("@@")) {
          bg = "bg-blue-500/10";
          textColor = "text-blue-700 dark:text-blue-400";
        }
        return (
          <div key={i} className={cn("px-2 py-0.5 leading-tight", bg, textColor)}>
            {line || "\u00A0"}
          </div>
        );
      })}
    </div>
  );
}

// ─── Token Usage Bar ─────────────────────────────────────────────────────────

function TokenBar({ used, max }: { used: number; max: number }) {
  const pct = Math.min((used / max) * 100, 100);
  const color = pct > 80 ? "bg-destructive" : pct > 60 ? "bg-yellow-500" : "bg-green-500";
  return (
    <div className="flex items-center gap-2 px-3 py-1 border-b border-border bg-muted/20">
      <span className="text-[10px] text-muted-foreground shrink-0">Context</span>
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
        <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] text-muted-foreground shrink-0">
        {Math.round(used / 1000)}k / {Math.round(max / 1000)}k
      </span>
    </div>
  );
}

// ─── Activity Feed Item ──────────────────────────────────────────────────────

function ActivityItem({ block }: { block: ToolCallBlock }) {
  const getIcon = (name: string) => {
    if (name.includes("file") || name.includes("write") || name.includes("edit")) return <FileCode className="h-3 w-3 text-blue-500" />;
    if (name.includes("bash") || name.includes("exec")) return <Terminal className="h-3 w-3 text-purple-500" />;
    if (name.includes("read") || name.includes("glob") || name.includes("grep")) return <FileCode className="h-3 w-3 text-muted-foreground" />;
    return <Zap className="h-3 w-3 text-yellow-500" />;
  };

  const getSummary = () => {
    const input = block.input;
    if (input.command) return String(input.command).slice(0, 60);
    if (input.filePath || input.path) return String(input.filePath || input.path);
    if (input.pattern) return String(input.pattern);
    return "";
  };

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 text-xs border-b border-border/50 last:border-0">
      {getIcon(block.name)}
      <span className="font-medium shrink-0">{block.name}</span>
      <span className="text-muted-foreground truncate flex-1">{getSummary()}</span>
      {block.status === "error" && <AlertCircle className="h-3 w-3 text-destructive shrink-0" />}
      {block.status === "done" && <Check className="h-3 w-3 text-green-500/70 shrink-0" />}
    </div>
  );
}

// ─── Simple markdown renderer ────────────────────────────────────────────────

function renderContent(content: string) {
  const lines = content.split("\n");
  const elements: React.ReactNode[] = [];
  let inCodeBlock = false;
  let codeBuffer: string[] = [];
  let inDiff = false;
  let diffBuffer: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith("```diff") || line.startsWith("```patch")) {
      inDiff = true;
      inCodeBlock = true;
      diffBuffer = [];
      continue;
    }

    if (line.startsWith("```")) {
      if (inCodeBlock) {
        if (inDiff) {
          elements.push(<DiffBlock key={i} content={diffBuffer.join("\n")} />);
          diffBuffer = [];
          inDiff = false;
        } else {
          elements.push(
            <pre key={i} className="bg-muted rounded-md p-3 my-2 overflow-x-auto text-xs font-mono">
              <code>{codeBuffer.join("\n")}</code>
            </pre>
          );
        }
        codeBuffer = [];
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
        codeBuffer = [];
      }
      continue;
    }

    if (inCodeBlock) {
      if (inDiff) {
        diffBuffer.push(line);
      } else {
        codeBuffer.push(line);
      }
      continue;
    }

    if (line.startsWith("### ")) {
      elements.push(<h4 key={i} className="font-semibold text-sm mt-3 mb-1">{line.slice(4)}</h4>);
    } else if (line.startsWith("## ")) {
      elements.push(<h3 key={i} className="font-semibold text-sm mt-3 mb-1">{line.slice(3)}</h3>);
    } else if (line.startsWith("# ")) {
      elements.push(<h2 key={i} className="font-bold text-base mt-3 mb-1">{line.slice(2)}</h2>);
    } else if (line.startsWith("- ") || line.startsWith("* ")) {
      elements.push(
        <div key={i} className="flex gap-1.5 ml-2">
          <span className="text-muted-foreground">-</span>
          <span>{renderInline(line.slice(2))}</span>
        </div>
      );
    } else if (line.trim() === "") {
      elements.push(<div key={i} className="h-2" />);
    } else {
      elements.push(<p key={i} className="text-sm leading-relaxed">{renderInline(line)}</p>);
    }
  }

  if (inCodeBlock && codeBuffer.length > 0) {
    if (inDiff) {
      elements.push(<DiffBlock key="unclosed-diff" content={diffBuffer.join("\n")} />);
    } else {
      elements.push(
        <pre key="unclosed" className="bg-muted rounded-md p-3 my-2 overflow-x-auto text-xs font-mono">
          <code>{codeBuffer.join("\n")}</code>
        </pre>
      );
    }
  }

  return <>{elements}</>;
}

function renderInline(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  const regex = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g;
  let lastIdx = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIdx) parts.push(text.slice(lastIdx, match.index));
    const m = match[0];
    if (m.startsWith("`")) {
      parts.push(<code key={match.index} className="bg-muted px-1 py-0.5 rounded text-xs font-mono">{m.slice(1, -1)}</code>);
    } else if (m.startsWith("**")) {
      parts.push(<strong key={match.index}>{m.slice(2, -2)}</strong>);
    } else if (m.startsWith("*")) {
      parts.push(<em key={match.index}>{m.slice(1, -1)}</em>);
    }
    lastIdx = match.index + m.length;
  }
  if (lastIdx < text.length) parts.push(text.slice(lastIdx));
  return parts.length === 1 ? parts[0] : <>{parts}</>;
}

// ─── Widget Component ────────────────────────────────────────────────────────

export function ClaudeCodeWidget() {
  // Connection state
  const [configs, setConfigs] = useState<RelayConfig[]>([]);
  const [activeConfigIdx, setActiveConfigIdx] = useState(0);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  // Session state
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [tokenUsage, setTokenUsage] = useState(0);

  // UI state
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [streamingToolCalls, setStreamingToolCalls] = useState<ToolCallBlock[]>([]);
  const [streamingBlocks, setStreamingBlocks] = useState<ContentBlock[]>([]);
  // Per-session streaming state (for parallel sessions)
  // Key: sessionId (or pending requestId before sessionId is known)
  const sessionStreamsRef = useRef<Map<string, {
    blocks: ContentBlock[];
    requestId: string;
    streaming: boolean;
    appendedMessages: Message[]; // messages appended to this session while it was streaming in background
  }>>(new Map());
  // Map requestId -> sessionKey (sessionId once known, otherwise pending requestId)
  const requestIdToSessionRef = useRef<Map<string, string>>(new Map());
  // Active backgrounded session keys (visual indicator in sidebar)
  const [backgroundSessions, setBackgroundSessions] = useState<Set<string>>(new Set());
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [selectedModel, setSelectedModel] = useState(MODELS[0].id);
  const [isolatedMode, setIsolatedMode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showConfig, setShowConfig] = useState(false);
  const [mode, setMode] = useState<"chat" | "terminal">("chat");
  const [viewMode, setViewMode] = useState<"chat" | "activity">("chat");
  const terminalPasteRef = useRef<((text: string) => void) | null>(null);
  const [terminalSessionId, setTerminalSessionId] = useState<string | null>(null);
  const [configUrl, setConfigUrl] = useState("");
  const [configToken, setConfigToken] = useState("");
  const [configLabel, setConfigLabel] = useState("");
  const [configCwd, setConfigCwd] = useState("");

  // Folder state
  const [folders, setFolders] = useState<string[]>([]);
  const [activeFolder, setActiveFolder] = useState<string>("");
  const [showFolderInput, setShowFolderInput] = useState(false);
  const [newFolderPath, setNewFolderPath] = useState("");
  const [browsingPath, setBrowsingPath] = useState<string>("");
  const [browseDirs, setBrowseDirs] = useState<{ name: string; path: string }[]>([]);
  const [browseLoading, setBrowseLoading] = useState(false);
  
  // Worktree state
  const [worktrees, setWorktrees] = useState<Worktree[]>([]);
  const [showWorktreePanel, setShowWorktreePanel] = useState(false);
  const [newWorktreeBranch, setNewWorktreeBranch] = useState("");
  const [newWorktreePath, setNewWorktreePath] = useState("");
  const [newWorktreeLabel, setNewWorktreeLabel] = useState("");
  const [branches, setBranches] = useState<string[]>([]);
  
  // Slash command state
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [slashFilter, setSlashFilter] = useState("");
  const [slashSelectedIdx, setSlashSelectedIdx] = useState(0);

  // Bulk delete state
  const [selectMode, setSelectMode] = useState(false);
  const [selectedSessions, setSelectedSessions] = useState<Set<string>>(new Set());

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const streamingTextRef = useRef("");
  const streamingBlocksRef = useRef<ContentBlock[]>([]);
  const streamingToolCallsRef = useRef<ToolCallBlock[]>([]);
  const activeFolderRef = useRef(activeFolder);
  const configsRef = useRef(configs);
  const activeConfigIdxRef = useRef(activeConfigIdx);
  const activeSessionIdRef = useRef(activeSessionId);

  // Keep refs in sync
  activeFolderRef.current = activeFolder;
  configsRef.current = configs;
  activeConfigIdxRef.current = activeConfigIdx;
  activeSessionIdRef.current = activeSessionId;

  // Load relay configs — default to local relay server
  useEffect(() => {
    // Load saved folders from localStorage
    try {
      const saved = localStorage.getItem("claude-code-folders");
      if (saved) {
        const parsed = JSON.parse(saved) as string[];
        setFolders(parsed);
        if (parsed.length > 0) setActiveFolder(parsed[0]);
      }
      // Load isolated mode preference
      const isoMode = localStorage.getItem("claude-code-isolated-mode");
      if (isoMode === "true") setIsolatedMode(true);
    } catch {}

    fetch("/api/claude-code")
      .then((r) => r.json())
      .then((d) => {
        const cfgs = d.configs || [];
        setConfigs(cfgs);
        if (cfgs.length > 0) {
          connectToRelay(cfgs[0]);
          // If folders empty, initialize with defaultCwd from config
          if (!folders.length && cfgs[0].defaultCwd) {
            const initialFolder = cfgs[0].defaultCwd;
            setFolders([initialFolder]);
            setActiveFolder(initialFolder);
            localStorage.setItem("claude-code-folders", JSON.stringify([initialFolder]));
          }
        } else {
          // Auto-connect to local relay server (started alongside dev server)
          const localConfig: RelayConfig = { url: `ws://${window.location.hostname}:4446`, label: "Local" };
          connectToRelay(localConfig);
        }
      })
      .catch(() => {
        // Fallback: try local relay
        const localConfig: RelayConfig = { url: `ws://${window.location.hostname}:4446`, label: "Local" };
        connectToRelay(localConfig);
      });
  }, []);

  // Refresh sessions and worktrees when active folder changes
  useEffect(() => {
    if (!connected || !activeFolder) return;
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: "list-sessions", dir: activeFolder }));
    ws.send(JSON.stringify({ type: "list-worktrees", dir: activeFolder }));
    ws.send(JSON.stringify({ type: "list-branches", dir: activeFolder }));
    setActiveSessionId(null);
    setMessages([]);
  }, [activeFolder, connected]);

  // Smart auto-scroll: only scroll if user is at (or near) the bottom
  useEffect(() => {
    const container = chatScrollRef.current;
    if (!container) return;
    // Threshold: within 100px of bottom counts as "at the bottom"
    const isAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100;
    if (isAtBottom) {
      container.scrollTop = container.scrollHeight;
    }
  }, [messages, streamingBlocks, streamingText, streamingToolCalls]);

  // ─── WebSocket connection ──────────────────────────────────────────────────

  const connectToRelay = useCallback((config: RelayConfig) => {
    if (wsRef.current) {
      wsRef.current.close();
    }

    const url = config.token
      ? `${config.url}?token=${encodeURIComponent(config.token)}`
      : config.url;

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      setError(null);
      // Request sessions list using active folder or config default
      const dir = activeFolder || config.defaultCwd;
      if (dir) ws.send(JSON.stringify({ type: "list-sessions", dir }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        handleRelayMessage(msg);
      } catch {}
    };

    ws.onclose = () => {
      setConnected(false);
      wsRef.current = null;
    };

    ws.onerror = () => {
      setConnected(false);
      setError("WebSocket connection failed");
    };
  }, []);

  const handleRelayMessage = useCallback((msg: Record<string, unknown>) => {
    switch (msg.type) {
      case "sessions":
        setSessions((msg.sessions as SessionInfo[]) || []);
        break;

      case "query-started": {
        // Relay tells us a query is starting with a specific requestId
        const reqId = msg.requestId as string;
        const sessId = (msg.sessionId as string) || `pending:${reqId}`;
        requestIdToSessionRef.current.set(reqId, sessId);
        sessionStreamsRef.current.set(sessId, {
          blocks: [],
          requestId: reqId,
          streaming: true,
          appendedMessages: [],
        });
        setBackgroundSessions(new Set(sessionStreamsRef.current.keys()));
        break;
      }

      case "session-resolved": {
        // The relay learned the real sessionId for a previously-pending query
        const reqId = msg.requestId as string;
        const realSessId = msg.sessionId as string;
        const oldKey = requestIdToSessionRef.current.get(reqId);
        if (oldKey && oldKey !== realSessId) {
          const stream = sessionStreamsRef.current.get(oldKey);
          if (stream) {
            sessionStreamsRef.current.set(realSessId, stream);
            sessionStreamsRef.current.delete(oldKey);
          }
          requestIdToSessionRef.current.set(reqId, realSessId);
          // If the user was viewing this pending session, switch to the real ID
          if (activeSessionIdRef.current === oldKey || activeSessionIdRef.current === null) {
            setActiveSessionId(realSessId);
          }
        }
        setBackgroundSessions(new Set(sessionStreamsRef.current.keys()));
        break;
      }

      case "messages": {
        const sessionMessages = (msg.messages as Array<Record<string, unknown>>)|| [];
        // Convert SDK messages to our format with tool call blocks
        const converted: Message[] = [];
        for (const m of sessionMessages) {
          const mType = m.type as string;
          if (mType !== "user" && mType !== "assistant") continue;
          
          let textContent = "";
          let hasToolResult = false;
          let hasUserText = false;
          const blocks: ContentBlock[] = [];
            
            // Try message.content[] blocks (standard format)
            const rawMsg = m.message as { content?: unknown; role?: string } | undefined;
            if (rawMsg?.content && Array.isArray(rawMsg.content)) {
              for (const block of rawMsg.content) {
                const b = block as Record<string, unknown>;
                if (b.type === "text" && b.text) {
                  textContent += b.text;
                  blocks.push({ type: "text", text: b.text as string });
                  if (mType === "user") hasUserText = true;
                } else if (b.type === "tool_use") {
                  blocks.push({
                    type: "tool_call",
                    id: (b.id as string) || Math.random().toString(36).slice(2),
                    name: b.name as string,
                    input: (b.input as Record<string, unknown>) || {},
                    status: "done",
                  });
                } else if (b.type === "tool_result") {
                  hasToolResult = true;
                }
              }
            } else if (rawMsg?.content && typeof rawMsg.content === "string") {
              textContent = rawMsg.content;
              blocks.push({ type: "text", text: rawMsg.content });
              if (mType === "user") hasUserText = true;
            }
            // Try message as array of content blocks directly (CLI user messages)
            if (!textContent && Array.isArray(m.message)) {
              for (const block of m.message as Array<Record<string, unknown>>) {
                if (block.type === "text" && block.text) {
                  textContent += block.text;
                  blocks.push({ type: "text", text: block.text as string });
                  if (mType === "user") hasUserText = true;
                } else if (block.type === "tool_result") {
                  hasToolResult = true;
                }
              }
            }
            
            // For user messages that only contain tool_result blocks, skip them
            if (mType === "user" && hasToolResult && !hasUserText) {
              continue;
            }
            
            // Try direct prompt field (user messages from CLI)
            if (!textContent && m.prompt) {
              textContent = m.prompt as string;
              blocks.push({ type: "text", text: textContent });
            }
            
            // Try message as string directly
            if (!textContent && typeof m.message === "string") {
              textContent = m.message;
              blocks.push({ type: "text", text: textContent });
            }

            if (textContent || blocks.some(b => b.type === "tool_call")) {
              converted.push({
                id: (m.uuid as string) || Math.random().toString(36).slice(2) + Date.now().toString(36),
                role: mType as "user" | "assistant",
                content: textContent,
                blocks,
                timestamp: (m.timestamp as string) || new Date().toISOString(),
              });
            }
        }
        // Append any backgrounded messages from a still-streaming session
        const sessId = activeSessionIdRef.current;
        const stream = sessId ? sessionStreamsRef.current.get(sessId) : null;
        const final = stream?.appendedMessages.length
          ? [...converted, ...stream.appendedMessages]
          : converted;
        if (stream) stream.appendedMessages = [];
        setMessages(final);
        // Estimate token usage from message count (rough heuristic)
        const totalChars = final.reduce((sum, m) => sum + m.content.length, 0);
        setTokenUsage(Math.round(totalChars / 4)); // ~4 chars per token
        break;
      }

      case "message": {
        // Streaming message from the SDK - routed by requestId/sessionId
        const data = msg.data as Record<string, unknown>;
        const reqId = msg.requestId as string | undefined;
        const sessKey = (msg.sessionId as string) || (reqId ? requestIdToSessionRef.current.get(reqId) : null);
        const isViewingThisSession = sessKey && (sessKey === activeSessionIdRef.current || (activeSessionIdRef.current === null && sessKey.startsWith("pending:")));

        // Get or create per-session stream
        let stream = sessKey ? sessionStreamsRef.current.get(sessKey) : null;
        if (!stream && sessKey) {
          stream = { blocks: [], requestId: reqId || "", streaming: true, appendedMessages: [] };
          sessionStreamsRef.current.set(sessKey, stream);
        }
        // Fallback: use main streaming refs if no session key (legacy path)
        const blocksRef = stream ? stream.blocks : streamingBlocksRef.current;

        // Helper to update blocks both in stream and (if viewing) in main state
        const updateBlocks = (newBlocks: ContentBlock[]) => {
          if (stream) stream.blocks = newBlocks;
          if (!sessKey) streamingBlocksRef.current = newBlocks;
          if (isViewingThisSession || !sessKey) {
            streamingBlocksRef.current = newBlocks;
            setStreamingBlocks(newBlocks);
            const text = newBlocks.filter((b): b is TextBlock => b.type === "text").map(b => b.text).join("\n");
            streamingTextRef.current = text;
            setStreamingText(text);
          }
        };

        // Handle partial/streaming events (SDKPartialAssistantMessage)
        if (data?.type === "stream_event") {
          const event = data.event as Record<string, unknown>;
          const idx = typeof event?.index === "number" ? event.index : blocksRef.length;

          if (event?.type === "content_block_start") {
            const contentBlock = event.content_block as Record<string, unknown>;
            const blocks = [...blocksRef];
            while (blocks.length <= idx) {
              blocks.push({ type: "text", text: "" });
            }
            if (contentBlock?.type === "tool_use") {
              blocks[idx] = {
                type: "tool_call",
                id: (contentBlock.id as string) || Math.random().toString(36).slice(2),
                name: contentBlock.name as string,
                input: {},
                status: "running",
              };
            } else if (contentBlock?.type === "text") {
              blocks[idx] = { type: "text", text: (contentBlock.text as string) || "" };
            }
            updateBlocks(blocks);
          } else if (event?.type === "content_block_delta") {
            const delta = event.delta as Record<string, unknown>;
            const blocks = [...blocksRef];
            while (blocks.length <= idx) {
              blocks.push({ type: "text", text: "" });
            }
            if (delta?.type === "text_delta" && delta.text) {
              const current = blocks[idx];
              if (current.type === "text") {
                blocks[idx] = { type: "text", text: current.text + (delta.text as string) };
              } else {
                blocks[idx] = { type: "text", text: delta.text as string };
              }
              updateBlocks(blocks);
            }
          } else if (event?.type === "content_block_stop") {
            const blocks = [...blocksRef];
            if (blocks[idx]?.type === "tool_call") {
              (blocks[idx] as ToolCallBlock).status = "done";
              updateBlocks(blocks);
            }
          }
          // Capture session ID
          if (data.session_id && !activeSessionIdRef.current) {
            setActiveSessionId(data.session_id as string);
          }
          // Update token usage from usage data if present (only if viewing)
          if (isViewingThisSession && data.usage) {
            const usage = data.usage as { input_tokens?: number; output_tokens?: number };
            if (usage.input_tokens) setTokenUsage(usage.input_tokens + (usage.output_tokens || 0));
          }
          break;
        }

        if (data?.type === "assistant") {
          const assistantMsg = data.message as { content?: Array<{ type: string; text?: string; name?: string; input?: unknown; id?: string }> } | undefined;
          // Only use this as a fallback if we have NO streaming blocks yet
          if (assistantMsg?.content && blocksRef.length === 0) {
            const blocks: ContentBlock[] = [];
            for (const block of assistantMsg.content) {
              if (block.type === "text" && block.text) {
                blocks.push({ type: "text", text: block.text });
              } else if (block.type === "tool_use") {
                blocks.push({
                  type: "tool_call",
                  id: block.id || Math.random().toString(36).slice(2),
                  name: block.name || "tool",
                  input: (block.input as Record<string, unknown>) || {},
                  status: "done",
                });
              }
            }
            updateBlocks(blocks);
          } else if (assistantMsg?.content && blocksRef.length > 0) {
            // Update tool_use inputs (which arrive complete in assistant msg)
            const blocks = [...blocksRef];
            for (const block of assistantMsg.content) {
              if (block.type === "tool_use" && block.id) {
                const idx = blocks.findIndex(b => b.type === "tool_call" && b.id === block.id);
                if (idx >= 0) {
                  blocks[idx] = {
                    type: "tool_call",
                    id: block.id,
                    name: block.name || "tool",
                    input: (block.input as Record<string, unknown>) || {},
                    status: "done",
                  };
                }
              }
            }
            updateBlocks(blocks);
          }
          if ((data as { session_id?: string }).session_id && !activeSessionIdRef.current) {
            setActiveSessionId((data as { session_id: string }).session_id);
          }
          if (isViewingThisSession && (data as { usage?: { input_tokens?: number; output_tokens?: number } }).usage) {
            const usage = (data as { usage: { input_tokens?: number; output_tokens?: number } }).usage;
            if (usage.input_tokens) setTokenUsage(usage.input_tokens + (usage.output_tokens || 0));
          }
        }
        break;
      }

      case "done": {
        const reqId = msg.requestId as string | undefined;
        const sessKey = (msg.sessionId as string) || (reqId ? requestIdToSessionRef.current.get(reqId) : null);
        const stream = sessKey ? sessionStreamsRef.current.get(sessKey) : null;
        const isViewingThisSession = sessKey && (sessKey === activeSessionIdRef.current);

        // Use blocks from per-session stream if available
        const finalBlocks = stream?.blocks.length
          ? stream.blocks
          : streamingBlocksRef.current.length > 0
            ? streamingBlocksRef.current
            : (() => {
                const fb: ContentBlock[] = [];
                if (streamingTextRef.current) fb.push({ type: "text", text: streamingTextRef.current });
                fb.push(...streamingToolCallsRef.current);
                return fb;
              })();

        const finalText = finalBlocks
          .filter((b): b is TextBlock => b.type === "text")
          .map(b => b.text)
          .join("\n");

        const newMessage: Message = {
          id: Math.random().toString(36).slice(2) + Date.now().toString(36),
          role: "assistant",
          content: finalText,
          blocks: finalBlocks,
          timestamp: new Date().toISOString(),
        };

        if (finalBlocks.length > 0) {
          if (isViewingThisSession) {
            // Append directly to visible messages
            setMessages((prev) => [...prev, newMessage]);
          } else if (stream) {
            // Stash for later when user views this session
            stream.appendedMessages.push(newMessage);
          } else {
            // No session key — fallback (legacy)
            setMessages((prev) => [...prev, newMessage]);
          }
        }

        // Clean up the per-session stream
        if (sessKey) {
          sessionStreamsRef.current.delete(sessKey);
          if (reqId) requestIdToSessionRef.current.delete(reqId);
          setBackgroundSessions(new Set(sessionStreamsRef.current.keys()));
        }

        // Only clear main streaming state if we were viewing this session
        if (isViewingThisSession || !sessKey) {
          setStreamingText("");
          setStreamingToolCalls([]);
          setStreamingBlocks([]);
          streamingTextRef.current = "";
          streamingToolCallsRef.current = [];
          streamingBlocksRef.current = [];
          setStreaming(false);
        }

        if (msg.sessionId && !activeSessionIdRef.current) setActiveSessionId(msg.sessionId as string);
        // Refresh session list
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: "list-sessions", dir: activeFolderRef.current || configsRef.current[activeConfigIdxRef.current]?.defaultCwd }));
        }
        break;
      }

      case "error": {
        const reqId = msg.requestId as string | undefined;
        const sessKey = reqId ? requestIdToSessionRef.current.get(reqId) : null;
        const isViewingThisSession = sessKey && sessKey === activeSessionIdRef.current;
        // Clean up the per-session stream
        if (sessKey) {
          sessionStreamsRef.current.delete(sessKey);
          if (reqId) requestIdToSessionRef.current.delete(reqId);
          setBackgroundSessions(new Set(sessionStreamsRef.current.keys()));
        }
        // Only show error if user is viewing this session OR it's a generic error
        if (isViewingThisSession || !sessKey) {
          setError(msg.error as string);
          setStreaming(false);
        } else {
          // Background session errored — show a less intrusive notification
          console.warn(`[claude-code] Background session ${sessKey} errored:`, msg.error);
        }
        break;
      }

      case "aborted": {
        const reqId = msg.requestId as string | undefined;
        const sessKey = (msg.sessionId as string) || (reqId ? requestIdToSessionRef.current.get(reqId) : null);
        const isViewingThisSession = sessKey && sessKey === activeSessionIdRef.current;
        // Clean up the per-session stream
        if (sessKey) {
          sessionStreamsRef.current.delete(sessKey);
          if (reqId) requestIdToSessionRef.current.delete(reqId);
          setBackgroundSessions(new Set(sessionStreamsRef.current.keys()));
        }
        // Only clear UI state if viewing the aborted session
        if (isViewingThisSession || !sessKey) {
          setStreaming(false);
          setStreamingText("");
          setStreamingToolCalls([]);
          setStreamingBlocks([]);
          streamingTextRef.current = "";
          streamingToolCallsRef.current = [];
          streamingBlocksRef.current = [];
        }
        break;
      }

      case "renamed":
        setSessions((prev) =>
          prev.map((s) =>
            s.sessionId === msg.sessionId ? { ...s, summary: msg.title as string } : s
          )
        );
        break;

      case "worktrees":
        setWorktrees((msg.worktrees as Worktree[]) || []);
        break;

      case "worktree-added":
        setWorktrees((msg.worktrees as Worktree[]) || []);
        if (msg.path) {
          const wtPath = msg.path as string;
          setActiveFolder(wtPath);
          setFolders((prev) => {
            const updated = prev.includes(wtPath) ? prev : [...prev, wtPath];
            localStorage.setItem("claude-code-folders", JSON.stringify(updated));
            return updated;
          });
        }
        setShowWorktreePanel(false);
        break;

      case "worktree-removed":
        setWorktrees((msg.worktrees as Worktree[]) || []);
        break;

      case "branches":
        setBranches((msg.branches as string[]) || []);
        break;

      case "sessions-deleted":
        setSessions((msg.sessions as SessionInfo[]) || []);
        setSelectedSessions(new Set());
        setSelectMode(false);
        // If active session was deleted, clear it
        if (activeSessionId && (msg.sessionIds as string[] || []).includes(activeSessionId)) {
          setActiveSessionId(null);
          setMessages([]);
        }
        break;
    }
  }, [configs, activeConfigIdx, activeSessionId]);

  // ─── Actions ───────────────────────────────────────────────────────────────

  const sendMessage = () => {
    if (!input.trim() || !connected || streaming) return;
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    const content = input.trim();
    const targetCwd = activeFolder || configs[activeConfigIdx]?.defaultCwd;

    // Warn if there's already a session running in this cwd (Claude CLI doesn't
    // handle two parallel sessions in the same working directory well — they
    // can abort each other or corrupt session state). Skip warning if isolated
    // mode is on (each session gets its own HOME = its own session storage).
    let hasConflict = false;
    if (!isolatedMode) {
      for (const [sid, stream] of sessionStreamsRef.current.entries()) {
        if (stream.streaming && sid !== activeSessionId) {
          const s = sessions.find(x => x.sessionId === sid);
          if (s?.cwd === targetCwd || (!s?.cwd && targetCwd === activeFolder)) {
            hasConflict = true;
            break;
          }
        }
      }
    }
    if (hasConflict) {
      const ok = window.confirm(
        "Another session is already running in this folder. Running parallel sessions in the same folder can cause them to abort each other or corrupt session state.\n\nEnable Isolated Mode (in the toolbar) for safe parallel sessions in the same folder.\n\nContinue anyway?"
      );
      if (!ok) return;
    }

    setInput("");
    setError(null);

    // Add user message locally
    setMessages((prev) => [
      ...prev,
      { id: Math.random().toString(36).slice(2) + Date.now().toString(36), role: "user", content, blocks: [{ type: "text", text: content }], timestamp: new Date().toISOString() },
    ]);

    setStreaming(true);
    setStreamingText("");
    setStreamingToolCalls([]);
    setStreamingBlocks([]);
    streamingTextRef.current = "";
    streamingToolCallsRef.current = [];
    streamingBlocksRef.current = [];

    const requestId = `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    // If resuming an isolated session, force isolated=true so the relay finds the right HOME
    const activeSessInfo = activeSessionId ? sessions.find(s => s.sessionId === activeSessionId) : null;
    const useIsolated = isolatedMode || activeSessInfo?.isolated === true;
    ws.send(JSON.stringify({
      type: "query",
      requestId,
      prompt: content,
      sessionId: activeSessionId || undefined,
      cwd: targetCwd,
      model: selectedModel,
      isolated: useIsolated,
    }));
  };

  const abortQuery = () => {
    // Abort only the current session, not all of them
    const sid = activeSessionIdRef.current;
    wsRef.current?.send(JSON.stringify({ type: "abort", sessionId: sid || undefined }));
  };

  const browseFolders = async (dir: string) => {
    setBrowseLoading(true);
    try {
      const res = await fetch(`/api/files?path=${encodeURIComponent(dir)}`);
      if (res.ok) {
        const data = await res.json();
        const entries = data.entries || [];
        const dirs = entries
          .filter((f: { isDirectory: boolean }) => f.isDirectory)
          .map((f: { name: string; path: string }) => ({ name: f.name, path: f.path }))
          .sort((a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name));
        setBrowseDirs(dirs);
        setBrowsingPath(data.path || dir);
      }
    } catch { /* ignore */ }
    setBrowseLoading(false);
  };

  const fetchWorktrees = () => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ type: "list-worktrees", dir: activeFolder || configs[activeConfigIdx]?.defaultCwd }));
    wsRef.current.send(JSON.stringify({ type: "list-branches", dir: activeFolder || configs[activeConfigIdx]?.defaultCwd }));
  };

  const addWorktree = () => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    if (!newWorktreePath) return;
    wsRef.current.send(JSON.stringify({
      type: "add-worktree",
      dir: activeFolder || configs[activeConfigIdx]?.defaultCwd,
      path: newWorktreePath,
      newBranch: newWorktreeBranch || undefined,
    }));
    if (newWorktreeLabel.trim()) {
      const labels = JSON.parse(localStorage.getItem("claude-code-worktree-labels") || "{}");
      labels[newWorktreePath] = newWorktreeLabel.trim();
      localStorage.setItem("claude-code-worktree-labels", JSON.stringify(labels));
    }
    setNewWorktreePath("");
    setNewWorktreeBranch("");
    setNewWorktreeLabel("");
  };

  const removeWorktree = (path: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({
      type: "remove-worktree",
      dir: activeFolder || configs[activeConfigIdx]?.defaultCwd,
      path,
      force: true,
    }));
  };

  const switchToWorktree = (wt: Worktree) => {
    setActiveFolder(wt.path);
    setShowWorktreePanel(false);
    // In terminal mode, navigate to the new worktree path
    if (mode === "terminal" && terminalPasteRef.current) {
      terminalPasteRef.current("\x03\x03"); // Kill current claude session
      setTimeout(() => { terminalPasteRef.current?.("\x03\n"); }, 300); // Extra Ctrl+C + newline to ensure prompt
      setTimeout(() => { terminalPasteRef.current?.(`cd ${wt.path}\n`); }, 1200);
      setTimeout(() => { terminalPasteRef.current?.("clear\n"); }, 1600);
    }
  };

  const loadSession = (sessionId: string) => {
    // DON'T abort - let other sessions continue streaming in background
    setActiveSessionId(sessionId);

    // Restore the streaming state for this session if it has one running
    const stream = sessionStreamsRef.current.get(sessionId);
    if (stream && stream.streaming) {
      setStreamingBlocks(stream.blocks);
      streamingBlocksRef.current = stream.blocks;
      const text = stream.blocks.filter((b): b is TextBlock => b.type === "text").map(b => b.text).join("\n");
      streamingTextRef.current = text;
      setStreamingText(text);
      setStreaming(true);
    } else {
      setStreamingText("");
      setStreamingToolCalls([]);
      setStreamingBlocks([]);
      streamingTextRef.current = "";
      streamingToolCallsRef.current = [];
      streamingBlocksRef.current = [];
      setStreaming(false);
    }

    if (mode === "terminal") {
      if (terminalPasteRef.current) {
        const dir = activeFolder || configs[activeConfigIdx]?.defaultCwd || "";
        terminalPasteRef.current("\x03\x03\x03");
        setTimeout(() => { terminalPasteRef.current?.("\n"); }, 600);
        setTimeout(() => { terminalPasteRef.current?.(`cd ${dir}\n`); }, 1200);
        setTimeout(() => { terminalPasteRef.current?.("clear\n"); }, 1800);
        setTimeout(() => { terminalPasteRef.current?.(`claude --resume ${sessionId}\n`); }, 2200);
      }
      setTerminalSessionId(sessionId);
      return;
    }
    setMessages([]);
    // Look up isolated home if this session was created in isolated mode
    const sessInfo = sessions.find(s => s.sessionId === sessionId);
    wsRef.current?.send(JSON.stringify({
      type: "get-messages",
      sessionId,
      dir: activeFolder || configs[activeConfigIdx]?.defaultCwd,
      isolatedHome: sessInfo?.isolatedHome,
    }));
  };

  const newSession = () => {
    // Don't abort - let other sessions continue streaming in background
    setActiveSessionId(null);
    setMessages([]);
    setStreamingText("");
    setStreamingToolCalls([]);
    setStreamingBlocks([]);
    streamingTextRef.current = "";
    streamingToolCallsRef.current = [];
    streamingBlocksRef.current = [];
    setStreaming(false);
    setTokenUsage(0);
    inputRef.current?.focus();
  };

  const renameSession = (sessionId: string, title: string) => {
    wsRef.current?.send(JSON.stringify({
      type: "rename-session",
      sessionId,
      title,
      dir: activeFolder || configs[activeConfigIdx]?.defaultCwd,
    }));
  };

  const addConfig = async () => {
    if (!configUrl) return;
    await fetch("/api/claude-code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "add",
        url: configUrl,
        token: configToken || undefined,
        label: configLabel || "VPS",
        defaultCwd: configCwd || undefined,
      }),
    });
    const res = await fetch("/api/claude-code");
    const data = await res.json();
    setConfigs(data.configs || []);
    setConfigUrl("");
    setConfigToken("");
    setConfigLabel("");
    setConfigCwd("");
    setShowConfig(false);
    if (data.configs?.length > 0) connectToRelay(data.configs[0]);
  };

  const copyMessage = (content: string) => {
    navigator.clipboard.writeText(content);
  };

  // ─── Cross-widget integration ─────────────────────────────────────────────
  // Dispatch custom events that other widgets can listen for
  const openFileInWidget = (filePath: string) => {
    window.dispatchEvent(new CustomEvent("widget:open-file", { detail: { path: filePath } }));
  };

  const runInTerminalWidget = (command: string) => {
    window.dispatchEvent(new CustomEvent("widget:run-command", { detail: { command } }));
  };

  // Slash commands
  const SLASH_COMMANDS = [
    { cmd: "/clear", desc: "Clear current conversation", local: true },
    { cmd: "/new", desc: "Start a new session", local: true },
    { cmd: "/model", desc: "Switch model (sonnet, opus, haiku)", local: true },
    { cmd: "/help", desc: "Show available commands", local: true },
    { cmd: "/compact", desc: "Compact conversation context", local: false },
    { cmd: "/cost", desc: "Show token usage and cost", local: false },
    { cmd: "/doctor", desc: "Check Claude Code setup", local: false },
    { cmd: "/init", desc: "Initialize project with CLAUDE.md", local: false },
    { cmd: "/login", desc: "Switch account or re-authenticate", local: false },
    { cmd: "/logout", desc: "Sign out of current account", local: false },
    { cmd: "/memory", desc: "Edit CLAUDE.md memory files", local: false },
    { cmd: "/permissions", desc: "View or update permissions", local: false },
    { cmd: "/review", desc: "Review a PR or diff", local: false },
    { cmd: "/status", desc: "Show session and project status", local: false },
    { cmd: "/terminal-setup", desc: "Install shell integration", local: false },
    { cmd: "/vim", desc: "Toggle vim mode", local: false },
  ];

  const filteredSlashCommands = SLASH_COMMANDS.filter((c) => c.cmd.includes("/" + slashFilter));

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInput(val);
    if (val.startsWith("/") && !val.includes(" ")) {
      setShowSlashMenu(true);
      setSlashFilter(val.slice(1));
      setSlashSelectedIdx(0);
    } else {
      setShowSlashMenu(false);
    }
  };

  const executeSlashCommand = (cmd: string) => {
    setShowSlashMenu(false);
    setInput("");
    
    const command = SLASH_COMMANDS.find((c) => c.cmd === cmd);
    
    // Non-local commands: send to relay as a prompt (CLI handles them)
    if (command && !command.local) {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        setMessages((prev) => [...prev, {
          id: Math.random().toString(36).slice(2) + Date.now().toString(36),
          role: "user",
          content: cmd,
          blocks: [{ type: "text", text: cmd }],
          timestamp: new Date().toISOString(),
        }]);
        setStreaming(true);
        setStreamingText("");
        setStreamingToolCalls([]);
        setStreamingBlocks([]);
        streamingTextRef.current = "";
        streamingToolCallsRef.current = [];
        streamingBlocksRef.current = [];
        wsRef.current.send(JSON.stringify({
          type: "query",
          requestId: `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          prompt: cmd,
          sessionId: activeSessionId || undefined,
          cwd: activeFolder || configs[activeConfigIdx]?.defaultCwd,
          model: selectedModel,
          isolated: isolatedMode || sessions.find(s => s.sessionId === activeSessionId)?.isolated === true,
        }));
      }
      return;
    }

    // Local commands
    switch (cmd) {
      case "/clear":
        setMessages([]);
        setStreamingText("");
        setStreamingToolCalls([]);
        setStreamingBlocks([]);
        streamingBlocksRef.current = [];
        setTokenUsage(0);
        break;
      case "/new":
        newSession();
        break;
      case "/model": {
        const idx = MODELS.findIndex((m) => m.id === selectedModel);
        const next = MODELS[(idx + 1) % MODELS.length];
        setSelectedModel(next.id);
        setMessages((prev) => [...prev, {
          id: Math.random().toString(36).slice(2) + Date.now().toString(36),
          role: "assistant",
          content: `Switched to ${next.label}`,
          blocks: [{ type: "text", text: `Switched to ${next.label}` }],
          timestamp: new Date().toISOString(),
        }]);
        break;
      }
      case "/help":
        setMessages((prev) => [...prev, {
          id: Math.random().toString(36).slice(2) + Date.now().toString(36),
          role: "assistant",
          content: SLASH_COMMANDS.map((c) => `\`${c.cmd}\` — ${c.desc}`).join("\n"),
          blocks: [{ type: "text", text: SLASH_COMMANDS.map((c) => `\`${c.cmd}\` — ${c.desc}`).join("\n") }],
          timestamp: new Date().toISOString(),
        }]);
        break;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showSlashMenu) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSlashSelectedIdx((prev) => Math.min(prev + 1, filteredSlashCommands.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSlashSelectedIdx((prev) => Math.max(prev - 1, 0));
        return;
      }
      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
        e.preventDefault();
        if (filteredSlashCommands.length > 0) {
          executeSlashCommand(filteredSlashCommands[slashSelectedIdx]?.cmd || filteredSlashCommands[0].cmd);
        }
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setShowSlashMenu(false);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const formatTime = (ts: number | string) => {
    const d = typeof ts === "number" ? new Date(ts) : new Date(ts);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    if (diff < 60000) return "now";
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  };

  // Get display name for a folder path - prefers worktree label if available
  const getFolderDisplayName = (path: string) => {
    if (typeof window === "undefined") return path.split("/").pop() || path;
    try {
      const labels = JSON.parse(localStorage.getItem("claude-code-worktree-labels") || "{}");
      if (labels[path]) return labels[path];
    } catch {}
    // Check if it's a known worktree branch
    const wt = worktrees.find(w => w.path === path);
    if (wt?.branch) return wt.branch;
    return path.split("/").pop() || path;
  };

  // Collect all tool calls for activity feed
  const allToolCalls: ToolCallBlock[] = [
    ...messages.flatMap(m => (m.blocks || []).filter((b): b is ToolCallBlock => b.type === "tool_call")),
    ...streamingToolCalls,
  ];

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <WidgetWrapper
      title="Claude Code"
      icon={<ClaudeIcon className="h-4 w-4" />}
      widgetType="claude-code"
    >
      <div className="flex h-full min-h-[400px] overflow-hidden">
        {/* ─── Session Sidebar ─────────────────────────────────── */}
        {sidebarOpen && (
          <div className="w-56 border-r border-border flex flex-col shrink-0 min-h-0 overflow-hidden">
            {/* Folder switcher */}
            <div className="p-2 border-b border-border">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Folder</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5"
                  onClick={() => setShowFolderInput(!showFolderInput)}
                  title="Add folder"
                >
                  <FolderPlus className="h-3 w-3" />
                </Button>
              </div>
              {folders.length > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger className="w-full flex items-center gap-1.5 rounded-md border border-input bg-background px-2 h-7 text-xs hover:bg-accent hover:text-accent-foreground">
                    <FolderOpen className="h-3 w-3 shrink-0 text-muted-foreground" />
                    <span className="flex-1 truncate text-left">{getFolderDisplayName(activeFolder)}</span>
                    <ChevronDown className="h-3 w-3 shrink-0" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-52">
                    {folders.map((f) => (
                      <DropdownMenuItem
                        key={f}
                        onClick={() => setActiveFolder(f)}
                        className={cn(activeFolder === f && "bg-accent")}
                      >
                        <FolderOpen className="h-3 w-3 mr-1.5" />
                        <span className="truncate">{getFolderDisplayName(f)}</span>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              {showFolderInput && (
                <div className="mt-1.5 space-y-1">
                  <div className="flex gap-1">
                    <Input
                      className="h-6 text-xs flex-1"
                      placeholder="/path/to/project"
                      value={newFolderPath}
                      onChange={(e) => setNewFolderPath(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && newFolderPath.trim()) {
                          const path = newFolderPath.trim();
                          const updated = [...folders.filter((f) => f !== path), path];
                          setFolders(updated);
                          setActiveFolder(path);
                          localStorage.setItem("claude-code-folders", JSON.stringify(updated));
                          setNewFolderPath("");
                          setShowFolderInput(false);
                          setBrowseDirs([]);
                        }
                      }}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 shrink-0"
                      onClick={() => {
                        if (newFolderPath.trim()) {
                          const path = newFolderPath.trim();
                          const updated = [...folders.filter((f) => f !== path), path];
                          setFolders(updated);
                          setActiveFolder(path);
                          localStorage.setItem("claude-code-folders", JSON.stringify(updated));
                          setNewFolderPath("");
                          setShowFolderInput(false);
                          setBrowseDirs([]);
                        }
                      }}
                    >
                      <Check className="h-3 w-3" />
                    </Button>
                  </div>
                  {/* Browse button */}
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 text-[10px] w-full"
                    onClick={() => browseFolders(newFolderPath || "/home")}
                  >
                    <FolderOpen className="h-3 w-3 mr-1" />
                    Browse
                  </Button>
                  {/* Directory browser */}
                  {browseDirs.length > 0 && (
                    <div className="border border-border rounded max-h-40 overflow-y-auto">
                      {browsingPath !== "/" && (
                        <div
                          className="flex items-center gap-1 text-[11px] px-1.5 py-1 hover:bg-muted cursor-pointer border-b border-border"
                          onClick={() => browseFolders(browsingPath.split("/").slice(0, -1).join("/") || "/")}
                        >
                          <span className="text-muted-foreground">..</span>
                          <span className="text-[10px] text-muted-foreground ml-auto truncate">{browsingPath}</span>
                        </div>
                      )}
                      {browseDirs.map((d) => (
                        <div
                          key={d.path}
                          className="flex items-center gap-1 text-[11px] px-1.5 py-1 hover:bg-muted cursor-pointer"
                          onClick={() => { setNewFolderPath(d.path); browseFolders(d.path); }}
                        >
                          <FolderOpen className="h-3 w-3 shrink-0 text-muted-foreground" />
                          <span className="truncate">{d.name}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {browseLoading && <p className="text-[10px] text-muted-foreground">Loading...</p>}
                </div>
              )}
            </div>
            {/* Worktree section */}
            <div className="p-2 border-b border-border">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Worktrees</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5"
                  onClick={() => {
                    fetchWorktrees();
                    setShowWorktreePanel(!showWorktreePanel);
                  }}
                  title="Add new worktree"
                >
                  <Plus className="h-3 w-3" />
                </Button>
              </div>
              {/* Always-visible worktree list */}
              {worktrees.length > 0 && (
                <div className="space-y-0.5 max-h-32 overflow-y-auto">
                  {worktrees.map((wt) => {
                    const labels = JSON.parse(localStorage.getItem("claude-code-worktree-labels") || "{}");
                    const label = labels[wt.path];
                    return (
                    <div
                      key={wt.path}
                      className={cn(
                        "flex items-center gap-1.5 text-[11px] px-1.5 py-1 rounded cursor-pointer group",
                        activeFolder === wt.path ? "bg-accent text-accent-foreground" : "hover:bg-muted"
                      )}
                      onClick={() => switchToWorktree(wt)}
                    >
                      <GitBranch className="h-3 w-3 shrink-0 text-muted-foreground" />
                      <span className="flex-1 truncate">{label || wt.branch || wt.path.split("/").pop()}</span>
                      {!wt.bare && worktrees.length > 1 && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-4 w-4 opacity-0 group-hover:opacity-100 shrink-0"
                          onClick={(e) => { e.stopPropagation(); removeWorktree(wt.path); }}
                        >
                          <Trash2 className="h-2.5 w-2.5 text-destructive" />
                        </Button>
                      )}
                    </div>
                    );
                  })}
                </div>
              )}
              {/* Toggleable add form */}
              {showWorktreePanel && (
                <div className="space-y-1 pt-1.5 mt-1.5 border-t border-border">
                  {/* Branch picker with create-new option */}
                  <DropdownMenu>
                    <DropdownMenuTrigger className="w-full flex items-center gap-1.5 rounded-md border border-input bg-background px-2 h-6 text-xs hover:bg-accent hover:text-accent-foreground">
                      <GitBranch className="h-3 w-3 shrink-0 text-muted-foreground" />
                      <span className="flex-1 truncate text-left">{newWorktreeBranch || "Select or create branch..."}</span>
                      <ChevronDown className="h-3 w-3 shrink-0" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-48 max-h-40 overflow-y-auto">
                      {branches.map((b) => (
                        <DropdownMenuItem
                          key={b}
                          onClick={() => {
                            setNewWorktreeBranch(b);
                            if (activeFolder) {
                              const parent = activeFolder.split("/").slice(0, -1).join("/");
                              setNewWorktreePath(`${parent}/${b.replace(/\//g, "-")}`);
                            }
                          }}
                        >
                          <GitBranch className="h-3 w-3 mr-1.5" />
                          <span className="truncate">{b}</span>
                        </DropdownMenuItem>
                      ))}
                      {branches.length > 0 && <div className="border-t border-border my-1" />}
                      <DropdownMenuItem onClick={() => inputRef.current?.focus()} className="text-muted-foreground">
                        <Plus className="h-3 w-3 mr-1.5" />
                        Create new branch...
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <Input
                    className="h-6 text-xs"
                      placeholder="New branch name (or picked above)"
                      value={newWorktreeBranch}
                      onChange={(e) => {
                        setNewWorktreeBranch(e.target.value);
                        if (e.target.value && activeFolder) {
                          const parent = activeFolder.split("/").slice(0, -1).join("/");
                          setNewWorktreePath(`${parent}/${e.target.value.replace(/\//g, "-")}`);
                        }
                      }}
                    />
                    <Input
                      className="h-6 text-xs"
                      placeholder="Path (auto-filled from branch)"
                      value={newWorktreePath}
                      onChange={(e) => setNewWorktreePath(e.target.value)}
                    />
                    <Input
                      className="h-6 text-xs"
                      placeholder="Label (optional)"
                      value={newWorktreeLabel}
                      onChange={(e) => setNewWorktreeLabel(e.target.value)}
                    />
                    <Button
                      size="sm"
                      className="h-6 text-[10px] w-full"
                      onClick={addWorktree}
                      disabled={!newWorktreePath}
                    >
                      <Plus className="h-3 w-3 mr-1" />
                      Add Worktree
                    </Button>
                </div>
              )}
            </div>
            {/* Sessions header */}
            <div className="p-2 border-b border-border flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Sessions</span>
              <div className="flex gap-1">
                {selectMode ? (
                  <>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-destructive"
                      onClick={() => {
                        if (selectedSessions.size > 0 && wsRef.current?.readyState === WebSocket.OPEN) {
                          wsRef.current.send(JSON.stringify({
                            type: "delete-sessions",
                            sessionIds: Array.from(selectedSessions),
                            dir: activeFolder || configs[activeConfigIdx]?.defaultCwd,
                          }));
                        }
                      }}
                      disabled={selectedSessions.size === 0}
                      title={`Delete ${selectedSessions.size} session(s)`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => {
                        // Select all / deselect all
                        if (selectedSessions.size === sessions.length) {
                          setSelectedSessions(new Set());
                        } else {
                          setSelectedSessions(new Set(sessions.map(s => s.sessionId)));
                        }
                      }}
                      title="Select all"
                    >
                      <Check className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => { setSelectMode(false); setSelectedSessions(new Set()); }} title="Cancel">
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </>
                ) : (
                  <>
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={newSession} title="New session">
                      <Plus className="h-3.5 w-3.5" />
                    </Button>
                    {sessions.length > 0 && (
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setSelectMode(true)} title="Select sessions to delete">
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setSidebarOpen(false)}>
                      <PanelLeftClose className="h-3.5 w-3.5" />
                    </Button>
                  </>
                )}
              </div>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto">
              <div className="p-1.5 space-y-0.5">
                {sessions.map((s) => (
                  <div
                    key={s.sessionId}
                    className={cn(
                      "group relative rounded-md px-2.5 py-2 cursor-pointer text-xs transition-colors",
                      selectMode && selectedSessions.has(s.sessionId)
                        ? "bg-destructive/10 border border-destructive/30"
                        : activeSessionId === s.sessionId
                          ? "bg-accent text-accent-foreground"
                          : "hover:bg-muted"
                    )}
                    onClick={() => {
                      if (selectMode) {
                        setSelectedSessions(prev => {
                          const next = new Set(prev);
                          if (next.has(s.sessionId)) next.delete(s.sessionId);
                          else next.add(s.sessionId);
                          return next;
                        });
                      } else {
                        loadSession(s.sessionId);
                      }
                    }}
                  >
                    <div className="flex items-center gap-2">
                      {selectMode && (
                        <div className={cn(
                          "w-3.5 h-3.5 rounded border shrink-0 flex items-center justify-center",
                          selectedSessions.has(s.sessionId) ? "bg-destructive border-destructive" : "border-muted-foreground/40"
                        )}>
                          {selectedSessions.has(s.sessionId) && <Check className="h-2.5 w-2.5 text-destructive-foreground" />}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate flex items-center gap-1">
                          {s.isolated && <Shield className="h-3 w-3 shrink-0 text-blue-500" />}
                          <span className="truncate">{s.summary || s.firstPrompt?.slice(0, 40) || "Untitled"}</span>
                          {backgroundSessions.has(s.sessionId) && (
                            <Loader2 className="h-3 w-3 animate-spin text-blue-500 shrink-0" />
                          )}
                        </div>
                        <div className="text-muted-foreground mt-0.5">
                          {formatTime(s.lastModified)}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
                {sessions.length === 0 && connected && (
                  <p className="text-xs text-muted-foreground text-center py-4">No sessions yet</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ─── Main Chat Area ──────────────────────────────────── */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
          {/* Header */}
          <div className="flex items-center gap-2 p-2 border-b border-border shrink-0">
            {!sidebarOpen && (
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setSidebarOpen(true)}>
                <PanelLeftOpen className="h-4 w-4" />
              </Button>
            )}
            <div className="flex items-center gap-1.5 flex-1 min-w-0">
              {connected ? (
                <Wifi className="h-3.5 w-3.5 text-green-500 shrink-0" />
              ) : (
                <WifiOff className="h-3.5 w-3.5 text-destructive shrink-0" />
              )}
              <span className="text-xs text-muted-foreground truncate">
                {connected
                  ? configs[activeConfigIdx]?.label || "Connected"
                  : "Disconnected"}
              </span>
            </div>
            {/* Refresh session button */}
            {activeSessionId && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => {
                  wsRef.current?.send(JSON.stringify({
                    type: "get-messages",
                    sessionId: activeSessionId,
                    dir: activeFolder || configs[activeConfigIdx]?.defaultCwd,
                  }));
                }}
                title="Refresh session messages"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
            )}
            {/* Isolated mode toggle */}
            <Button
              variant="ghost"
              size="icon"
              className={cn("h-7 w-7", isolatedMode && "bg-accent text-accent-foreground")}
              onClick={() => {
                const next = !isolatedMode;
                setIsolatedMode(next);
                localStorage.setItem("claude-code-isolated-mode", String(next));
              }}
              title={isolatedMode ? "Isolated mode ON: parallel sessions safe in same folder" : "Isolated mode OFF: only one session per folder"}
            >
              <Shield className="h-3.5 w-3.5" />
            </Button>
            {/* View mode toggle (Chat vs Activity Feed) */}
            <div className="flex items-center rounded-md border border-input bg-background overflow-hidden">
              <button
                className={cn("px-2 h-7 text-xs flex items-center gap-1 transition-colors", viewMode === "chat" ? "bg-accent text-accent-foreground" : "hover:bg-muted")}
                onClick={() => setViewMode("chat")}
                title="Chat view"
              >
                <MessageSquare className="h-3 w-3" />
              </button>
              <button
                className={cn("px-2 h-7 text-xs flex items-center gap-1 transition-colors border-l border-input", viewMode === "activity" ? "bg-accent text-accent-foreground" : "hover:bg-muted")}
                onClick={() => setViewMode("activity")}
                title="Activity feed"
              >
                <Activity className="h-3 w-3" />
              </button>
            </div>
            {/* Model selector */}
            <DropdownMenu>
              <DropdownMenuTrigger className="inline-flex shrink-0 items-center justify-center rounded-md border border-input bg-background px-2 h-7 text-xs gap-1 hover:bg-accent hover:text-accent-foreground">
                  {MODELS.find((m) => m.id === selectedModel)?.label || "Model"}
                  <ChevronDown className="h-3 w-3" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {MODELS.map((m) => (
                  <DropdownMenuItem key={m.id} onClick={() => setSelectedModel(m.id)}>
                    {m.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button variant="ghost" size="icon" className={cn("h-7 w-7", mode === "terminal" && "bg-accent")} onClick={() => {
              if (mode === "chat") {
                setMode("terminal");
                setTerminalSessionId(activeSessionId);
              } else {
                setMode("chat");
              }
            }} title={mode === "chat" ? "Switch to CLI mode" : "Switch to Chat mode"}>
              <Terminal className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setShowConfig(!showConfig)}>
              <Settings className="h-3.5 w-3.5" />
            </Button>
          </div>

          {/* Token usage bar */}
          {tokenUsage > 0 && <TokenBar used={tokenUsage} max={MAX_CONTEXT_TOKENS} />}

          {/* Config panel */}
          {showConfig && (
            <div className="p-3 border-b border-border bg-muted/30 space-y-2">
              <p className="text-xs font-medium">Relay Server Connection</p>
              {configs.map((c, i) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <span className={cn("w-2 h-2 rounded-full", connected && i === activeConfigIdx ? "bg-green-500" : "bg-muted-foreground/30")} />
                  <span className="flex-1 truncate">{c.label} ({c.url})</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5"
                    onClick={() => {
                      setActiveConfigIdx(i);
                      connectToRelay(c);
                    }}
                  >
                    <Wifi className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5 text-destructive"
                    onClick={async () => {
                      await fetch("/api/claude-code", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ action: "delete", index: i }),
                      });
                      const res = await fetch("/api/claude-code");
                      setConfigs((await res.json()).configs || []);
                    }}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              ))}
              <div className="space-y-1.5 pt-2 border-t border-border">
                <Input className="h-7 text-xs" placeholder="ws://your-vps:4446" value={configUrl} onChange={(e) => setConfigUrl(e.target.value)} />
                <div className="flex gap-1.5">
                  <Input className="h-7 text-xs flex-1" placeholder="Label" value={configLabel} onChange={(e) => setConfigLabel(e.target.value)} />
                  <Input className="h-7 text-xs flex-1" placeholder="Auth token (optional)" value={configToken} onChange={(e) => setConfigToken(e.target.value)} />
                </div>
                <Input className="h-7 text-xs" placeholder="Default CWD (optional)" value={configCwd} onChange={(e) => setConfigCwd(e.target.value)} />
                <Button size="sm" className="h-7 text-xs w-full" onClick={addConfig} disabled={!configUrl}>
                  Add Connection
                </Button>
              </div>
            </div>
          )}

          {/* Terminal mode */}
          {mode === "terminal" ? (
            <div className="flex-1 min-h-0">
              <TerminalPanel
                cwd={activeFolder}
                command={terminalSessionId ? `claude --resume ${terminalSessionId}` : "claude"}
                label="Claude CLI"
                onClose={() => setMode("chat")}
                className="h-full"
                pasteRef={terminalPasteRef}
              />
            </div>
          ) : (
          <>
          {/* Activity Feed View */}
          {viewMode === "activity" ? (
            <ScrollArea className="flex-1">
              {allToolCalls.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full py-12">
                  <Activity className="h-8 w-8 text-muted-foreground/50 mb-3" />
                  <p className="text-xs text-muted-foreground">No activity yet</p>
                </div>
              ) : (
                <div>
                  {allToolCalls.map((tc, i) => (
                    <ActivityItem key={tc.id + i} block={tc} />
                  ))}
                </div>
              )}
            </ScrollArea>
          ) : (
          <>
          {/* Messages (Chat View) */}
          <div ref={chatScrollRef} className="flex-1 px-4 py-3 overflow-y-auto">
            {!connected ? (
              <div className="flex flex-col items-center justify-center h-full text-center py-12">
                <WifiOff className="h-10 w-10 text-muted-foreground/50 mb-4" />
                <h3 className="text-sm font-medium mb-1">Not Connected</h3>
                <p className="text-xs text-muted-foreground mb-4">
                  Configure a relay server connection to start using Claude Code.
                </p>
                <div className="flex gap-2">
                  <Button size="sm" onClick={async () => {
                    await fetch("/api/claude-code", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "start-relay" }) });
                    setTimeout(() => {
                      const cfgs = configsRef.current;
                      if (cfgs.length > 0) connectToRelay(cfgs[0]);
                    }, 1500);
                  }} className="gap-1.5" variant="default">
                    <Wifi className="h-3.5 w-3.5" />
                    Start Relay
                  </Button>
                  <Button size="sm" onClick={() => setShowConfig(true)} className="gap-1.5" variant="outline">
                    <Settings className="h-3.5 w-3.5" />
                    Configure
                  </Button>
                </div>
              </div>
            ) : messages.length === 0 && !streaming ? (
              <div className="flex flex-col items-center justify-center h-full text-center py-12">
                <ClaudeIcon className="h-8 w-8 text-muted-foreground/50 mb-3" />
                <p className="text-xs text-muted-foreground">
                  {activeSessionId ? "Session loaded. Continue the conversation..." : "Start a new conversation..."}
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {messages.map((msg) => (
                  <div key={msg.id} className={cn("group flex gap-3", msg.role === "user" && "flex-row-reverse")}>
                    <div
                      className={cn(
                        "shrink-0 h-7 w-7 rounded-full flex items-center justify-center text-xs",
                        msg.role === "user"
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted"
                      )}
                    >
                      {msg.role === "user" ? "U" : <ClaudeIcon className="h-4 w-4" />}
                    </div>
                    <div
                      className={cn(
                        "max-w-[85%] rounded-lg px-3 py-2 text-sm",
                        msg.role === "user"
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted"
                      )}
                    >
                      {msg.role === "assistant" ? (
                        <>
                          {msg.blocks?.map((block, bi) => {
                            if (block.type === "text") {
                              return <div key={bi}>{renderContent(block.text)}</div>;
                            }
                            if (block.type === "tool_call") {
                              return (
                                <ToolCallPill key={block.id + bi} block={block} />
                              );
                            }
                            return null;
                          }) || renderContent(msg.content)}
                        </>
                      ) : (
                        <p className="whitespace-pre-wrap">{msg.content}</p>
                      )}
                      <div className="flex items-center gap-1 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => copyMessage(msg.content)}>
                          <Copy className="h-3 w-3" />
                        </Button>
                        {/* Cross-widget: open file paths in files widget */}
                        {msg.blocks?.some(b => b.type === "tool_call" && (b.input.filePath || b.input.path)) && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-5 w-5"
                            onClick={() => {
                              const toolBlock = msg.blocks?.find(b => b.type === "tool_call" && (b.input.filePath || b.input.path)) as ToolCallBlock | undefined;
                              if (toolBlock) openFileInWidget(String(toolBlock.input.filePath || toolBlock.input.path));
                            }}
                            title="Open in Files widget"
                          >
                            <FileCode className="h-3 w-3" />
                          </Button>
                        )}
                        {/* Cross-widget: run command in terminal */}
                        {msg.blocks?.some(b => b.type === "tool_call" && b.input.command) && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-5 w-5"
                            onClick={() => {
                              const toolBlock = msg.blocks?.find(b => b.type === "tool_call" && b.input.command) as ToolCallBlock | undefined;
                              if (toolBlock) runInTerminalWidget(String(toolBlock.input.command));
                            }}
                            title="Run in Terminal widget"
                          >
                            <Play className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
                {/* Streaming */}
                {streaming && streamingBlocks.length > 0 && (
                  <div className="flex gap-3">
                    <div className="shrink-0 h-7 w-7 rounded-full flex items-center justify-center bg-muted">
                      <ClaudeIcon className="h-4 w-4" />
                    </div>
                    <div className="max-w-[85%] rounded-lg px-3 py-2 text-sm bg-muted">
                      {streamingBlocks.map((block, bi) => {
                        if (block.type === "text") {
                          const isLast = bi === streamingBlocks.length - 1;
                          return (
                            <div key={bi}>
                              {renderContent(block.text)}
                              {isLast && <span className="inline-block w-1.5 h-4 bg-foreground/70 animate-pulse ml-0.5" />}
                            </div>
                          );
                        }
                        if (block.type === "tool_call") {
                          return <ToolCallPill key={block.id + bi} block={block} />;
                        }
                        return null;
                      })}
                    </div>
                  </div>
                )}
                {streaming && streamingBlocks.length === 0 && (
                  <div className="flex gap-3">
                    <div className="shrink-0 h-7 w-7 rounded-full flex items-center justify-center bg-muted">
                      <ClaudeIcon className="h-4 w-4" />
                    </div>
                    <div className="rounded-lg px-3 py-2 bg-muted">
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
            )}
          </div>
          </>
          )}

          {/* Error */}
          {error && (
            <div className="px-4 py-2 text-xs text-destructive bg-destructive/10 border-t border-destructive/20 flex items-center justify-between">
              <span>{error}</span>
              <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => setError(null)}>
                <X className="h-3 w-3" />
              </Button>
            </div>
          )}

          {/* Input */}
          {connected && (
            <div className="p-3 border-t border-border shrink-0 relative">
              {/* Slash command autocomplete menu */}
              {showSlashMenu && filteredSlashCommands.length > 0 && (
                <div className="absolute bottom-full left-3 right-3 mb-1 rounded-md border border-border bg-popover shadow-lg z-10 max-h-52 overflow-y-auto">
                  {filteredSlashCommands.map((c, i) => (
                    <div
                      key={c.cmd}
                      className={cn(
                        "px-3 py-2 text-xs cursor-pointer flex justify-between items-center gap-3",
                        i === slashSelectedIdx ? "bg-accent text-accent-foreground" : "hover:bg-muted"
                      )}
                      onClick={() => executeSlashCommand(c.cmd)}
                      onMouseEnter={() => setSlashSelectedIdx(i)}
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-semibold text-foreground">{c.cmd}</span>
                        {c.local && <span className="text-[9px] bg-muted px-1 rounded text-muted-foreground">local</span>}
                      </div>
                      <span className="text-muted-foreground text-[11px]">{c.desc}</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex gap-2 items-end">
                <textarea
                  ref={inputRef}
                  className="flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[38px] max-h-[120px]"
                  placeholder={activeFolder ? "Ask Claude... (/ for commands, Shift+Enter for newline)" : "Select a folder first..."}
                  value={input}
                  onChange={(e) => {
                    handleInputChange(e);
                    e.target.style.height = "auto";
                    e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
                  }}
                  onKeyDown={handleKeyDown}
                  rows={1}
                  disabled={streaming}
                />
                {streaming ? (
                  <Button size="icon" variant="destructive" className="h-9 w-9 shrink-0" onClick={abortQuery} title="Stop generation (Esc)">
                    <Square className="h-4 w-4" />
                  </Button>
                ) : (
                  <Button size="icon" className="h-9 w-9 shrink-0" onClick={sendMessage} disabled={!input.trim()}>
                    <Send className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          )}
          </>
          )}
        </div>
      </div>
    </WidgetWrapper>
  );
}
