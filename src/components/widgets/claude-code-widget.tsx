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
  Wifi,
  WifiOff,
  Settings,
  FolderOpen,
  FolderPlus,
  GitBranch,
  GitFork,
  Terminal,
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

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

interface SessionInfo {
  sessionId: string;
  summary: string;
  lastModified: number;
  firstPrompt?: string;
  cwd?: string;
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
  { id: "sonnet", label: "Sonnet 4.6" },
  { id: "opus", label: "Opus 4.7" },
  { id: "haiku", label: "Haiku 4.5" },
];

// ─── Claude Icon ─────────────────────────────────────────────────────────────

function ClaudeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M4.709 15.955l4.397-2.463.072-.216-.072-.12h-.217l-.737-.045-2.515-.067-2.173-.09-2.115-.112-.531-.112L.3 11.57l.048-.325.447-.302.64.056 1.412.1 2.126.146 1.534.09 2.284.235h.362l.048-.146-.12-.09-.097-.09-2.198-1.493-2.38-1.57-1.245-.907-.664-.46-.338-.425-.145-.94.604-.671.82.056.205.056.833.639 1.776 1.377 2.318 1.703.338.28.136-.092.02-.065-.157-.258-1.255-2.274-1.34-2.32-.604-.963-.157-.572.688-.94.48-.118.932.336.386.383.58 1.322.93 2.072 1.448 2.826.423.84.23.774.084.235h.145v-.134.121-.255l.12-1.591.218-1.95.257-2.513.073-.706.35-.851.7-.46.543.258.447.639-.06.415-.266 1.724-.528 2.703-.338 1.815h.193l.23-.235.919-1.21 1.535-1.927.676-.775.797-.84.507-.403.967-.045.72 1.054-.314 1.088-.999 1.254-.82 1.065-1.182 1.577-.725 1.268.065.105.176-.015 2.657-.572 1.437-.258 1.714-.291.773.358.085.37-.302.751-1.835.448-2.152.547-.578 1.483-.132.085-.597-.036-1.541-1.29-.277-3.047-.075h-.17v.1l1.015.998 1.873 1.681 2.33 2.175.12.538-.302.425-.314-.045-2.058-1.546-.796-.695-1.835-1.513h-.12v.1l.41.606 2.186 3.28.109 1.008-.157.325-.567.202-.617-.112-1.292-1.827-1.316-2.017-1.063-1.815-.128.081-.632 6.754-.29.358-.597.09-.277-.045 .12-.64.446-3.476.434-3.054z"/>
    </svg>
  );
}

// ─── Simple markdown renderer ────────────────────────────────────────────────

function renderContent(content: string) {
  const lines = content.split("\n");
  const elements: React.ReactNode[] = [];
  let inCodeBlock = false;
  let codeBuffer: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith("```")) {
      if (inCodeBlock) {
        elements.push(
          <pre key={i} className="bg-muted rounded-md p-3 my-2 overflow-x-auto text-xs font-mono">
            <code>{codeBuffer.join("\n")}</code>
          </pre>
        );
        codeBuffer = [];
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
        codeBuffer = [];
      }
      continue;
    }

    if (inCodeBlock) {
      codeBuffer.push(line);
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
    elements.push(
      <pre key="unclosed" className="bg-muted rounded-md p-3 my-2 overflow-x-auto text-xs font-mono">
        <code>{codeBuffer.join("\n")}</code>
      </pre>
    );
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

  // UI state
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [selectedModel, setSelectedModel] = useState(MODELS[0].id);
  const [error, setError] = useState<string | null>(null);
  const [showConfig, setShowConfig] = useState(false);
  const [showTerminal, setShowTerminal] = useState(false);
  const [configUrl, setConfigUrl] = useState("");
  const [configToken, setConfigToken] = useState("");
  const [configLabel, setConfigLabel] = useState("");
  const [configCwd, setConfigCwd] = useState("");

  // Folder state
  const [folders, setFolders] = useState<string[]>([]);
  const [activeFolder, setActiveFolder] = useState<string>("");
  const [showFolderInput, setShowFolderInput] = useState(false);
  const [newFolderPath, setNewFolderPath] = useState("");
  
  // Worktree state
  const [worktrees, setWorktrees] = useState<Worktree[]>([]);
  const [showWorktreePanel, setShowWorktreePanel] = useState(false);
  const [newWorktreeBranch, setNewWorktreeBranch] = useState("");
  const [newWorktreePath, setNewWorktreePath] = useState("");
  const [branches, setBranches] = useState<string[]>([]);
  
  // Slash command state
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [slashFilter, setSlashFilter] = useState("");

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const streamingTextRef = useRef("");
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

  // Refresh sessions when active folder changes
  useEffect(() => {
    if (!connected || !activeFolder) return;
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: "list-sessions", dir: activeFolder }));
    setActiveSessionId(null);
    setMessages([]);
  }, [activeFolder, connected]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingText]);

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

      case "messages": {
        const sessionMessages = (msg.messages as Array<Record<string, unknown>>)|| [];
        // Convert SDK messages to our format
        const converted: Message[] = [];
        for (const m of sessionMessages) {
          const mType = m.type as string;
          if (mType === "user" || mType === "assistant") {
            let textContent = "";
            let hasToolUse = false;
            let hasToolResult = false;
            let hasUserText = false;
            
            // Try message.content[] blocks (standard format)
            const rawMsg = m.message as { content?: unknown; role?: string } | undefined;
            if (rawMsg?.content && Array.isArray(rawMsg.content)) {
              for (const block of rawMsg.content) {
                const b = block as Record<string, unknown>;
                if (b.type === "text" && b.text) {
                  textContent += b.text;
                  if (mType === "user") hasUserText = true;
                } else if (b.type === "tool_use") {
                  hasToolUse = true;
                  // Show tool calls as formatted blocks for assistant messages
                  if (mType === "assistant") {
                    textContent += `\n\`\`\`\nTool: ${b.name}\n${JSON.stringify(b.input, null, 2)}\n\`\`\`\n`;
                  }
                } else if (b.type === "tool_result") {
                  hasToolResult = true;
                }
              }
            } else if (rawMsg?.content && typeof rawMsg.content === "string") {
              // CLI user messages have content as a plain string
              textContent = rawMsg.content;
              if (mType === "user") hasUserText = true;
            }
                } else if (b.type === "tool_result") {
                  hasToolResult = true;
                  // Skip tool results entirely — they're internal API responses
                }
              }
            }
            // Try message as array of content blocks directly (CLI user messages)
            if (!textContent && Array.isArray(m.message)) {
              for (const block of m.message as Array<Record<string, unknown>>) {
                if (block.type === "text" && block.text) {
                  textContent += block.text;
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
            }
            
            // Try message as string directly
            if (!textContent && typeof m.message === "string") {
              textContent = m.message;
            }

            // Skip assistant messages that only have tool_use with no text explanation
            if (mType === "assistant" && hasToolUse && !textContent.replace(/\n```\nTool:[\s\S]*?```\n/g, "").trim()) {
              // Still show it but mark as tool call
              if (textContent) {
                converted.push({
                  id: (m.uuid as string) || Math.random().toString(36).slice(2) + Date.now().toString(36),
                  role: "assistant",
                  content: textContent,
                  timestamp: (m.timestamp as string) || new Date().toISOString(),
                });
              }
              continue;
            }

            if (textContent) {
              converted.push({
                id: (m.uuid as string) || Math.random().toString(36).slice(2) + Date.now().toString(36),
                role: mType as "user" | "assistant",
                content: textContent,
                timestamp: (m.timestamp as string) || new Date().toISOString(),
              });
            }
          }
        }
        setMessages(converted);
        break;
      }

      case "message": {
        // Streaming message from the SDK
        const data = msg.data as Record<string, unknown>;
        
        // Handle partial/streaming events (SDKPartialAssistantMessage)
        if (data?.type === "stream_event") {
          const event = data.event as Record<string, unknown>;
          if (event?.type === "content_block_delta") {
            const delta = event.delta as Record<string, unknown>;
            if (delta?.type === "text_delta" && delta.text) {
              streamingTextRef.current += delta.text as string;
              setStreamingText(streamingTextRef.current);
            }
          }
          // Capture session ID
          if (data.session_id && !activeSessionIdRef.current) {
            setActiveSessionId(data.session_id as string);
          }
          break;
        }
        
        if (data?.type === "assistant") {
          const assistantMsg = data.message as { content?: Array<{ type: string; text?: string }> } | undefined;
          if (assistantMsg?.content) {
            let text = "";
            for (const block of assistantMsg.content) {
              if (block.type === "text" && block.text) {
                text += block.text;
              }
            }
            if (text) {
              streamingTextRef.current = text;
              setStreamingText(text);
            }
          }
          // Capture session ID
          if ((data as { session_id?: string }).session_id && !activeSessionIdRef.current) {
            setActiveSessionId((data as { session_id: string }).session_id);
          }
        }
        break;
      }

      case "done": {
        const finalText = streamingTextRef.current;
        if (finalText) {
          setMessages((prev) => [
            ...prev,
            {
              id: Math.random().toString(36).slice(2) + Date.now().toString(36),
              role: "assistant",
              content: finalText,
              timestamp: new Date().toISOString(),
            },
          ]);
        }
        setStreamingText("");
        streamingTextRef.current = "";
        setStreaming(false);
        if (msg.sessionId) setActiveSessionId(msg.sessionId as string);
        // Refresh session list
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: "list-sessions", dir: activeFolderRef.current || configsRef.current[activeConfigIdxRef.current]?.defaultCwd }));
        }
        break;
      }

      case "error":
        setError(msg.error as string);
        setStreaming(false);
        break;

      case "aborted":
        setStreaming(false);
        break;

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
        // Switch to the new worktree folder and load its sessions
        if (msg.path) {
          const wtPath = msg.path as string;
          setActiveFolder(wtPath);
          // Add to folders if not already there
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
    }
  }, [configs, activeConfigIdx, activeSessionId]);

  // ─── Actions ───────────────────────────────────────────────────────────────

  const sendMessage = () => {
    if (!input.trim() || !connected || streaming) return;
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    const content = input.trim();
    setInput("");
    setError(null);

    // Add user message locally
    setMessages((prev) => [
      ...prev,
      { id: Math.random().toString(36).slice(2) + Date.now().toString(36), role: "user", content, timestamp: new Date().toISOString() },
    ]);

    setStreaming(true);
    setStreamingText("");
    streamingTextRef.current = "";

    const config = configs[activeConfigIdx];
    ws.send(JSON.stringify({
      type: "query",
      prompt: content,
      sessionId: activeSessionId || undefined,
      cwd: activeFolder || config?.defaultCwd,
      model: selectedModel,
    }));
  };

  const abortQuery = () => {
    wsRef.current?.send(JSON.stringify({ type: "abort" }));
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
    setNewWorktreePath("");
    setNewWorktreeBranch("");
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
    setFolders((prev) => {
      const updated = prev.includes(wt.path) ? prev : [...prev, wt.path];
      localStorage.setItem("claude-code-folders", JSON.stringify(updated));
      return updated;
    });
    setShowWorktreePanel(false);
  };

  const loadSession = (sessionId: string) => {
    setActiveSessionId(sessionId);
    setMessages([]);
    wsRef.current?.send(JSON.stringify({
      type: "get-messages",
      sessionId,
      dir: activeFolder || configs[activeConfigIdx]?.defaultCwd,
    }));
  };

  const newSession = () => {
    setActiveSessionId(null);
    setMessages([]);
    setStreamingText("");
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

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInput(val);
    if (val.startsWith("/") && !val.includes(" ")) {
      setShowSlashMenu(true);
      setSlashFilter(val.slice(1));
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
          timestamp: new Date().toISOString(),
        }]);
        setStreaming(true);
        setStreamingText("");
        streamingTextRef.current = "";
        wsRef.current.send(JSON.stringify({
          type: "query",
          prompt: cmd,
          sessionId: activeSessionId || undefined,
          cwd: activeFolder || configs[activeConfigIdx]?.defaultCwd,
          model: selectedModel,
        }));
      }
      return;
    }

    // Local commands
    switch (cmd) {
      case "/clear":
        setMessages([]);
        setStreamingText("");
        break;
      case "/new":
        newSession();
        break;
      case "/model": {
        // Cycle through models
        const idx = MODELS.findIndex((m) => m.id === selectedModel);
        const next = MODELS[(idx + 1) % MODELS.length];
        setSelectedModel(next.id);
        setMessages((prev) => [...prev, {
          id: Math.random().toString(36).slice(2) + Date.now().toString(36),
          role: "assistant",
          content: `Switched to ${next.label}`,
          timestamp: new Date().toISOString(),
        }]);
        break;
      }
      case "/help":
        setMessages((prev) => [...prev, {
          id: Math.random().toString(36).slice(2) + Date.now().toString(36),
          role: "assistant",
          content: SLASH_COMMANDS.map((c) => `\`${c.cmd}\` — ${c.desc}`).join("\n"),
          timestamp: new Date().toISOString(),
        }]);
        break;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showSlashMenu && e.key === "Tab") {
      e.preventDefault();
      const filtered = SLASH_COMMANDS.filter((c) => c.cmd.includes("/" + slashFilter));
      if (filtered.length === 1) {
        executeSlashCommand(filtered[0].cmd);
      }
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (showSlashMenu) {
        const filtered = SLASH_COMMANDS.filter((c) => c.cmd.includes("/" + slashFilter));
        if (filtered.length > 0 && input.startsWith("/")) {
          executeSlashCommand(filtered[0].cmd);
          return;
        }
      }
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

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <WidgetWrapper
      title="Claude Code"
      icon={<ClaudeIcon className="h-4 w-4" />}
      widgetType="claude-code"
    >
      <div className="flex h-full min-h-[400px]">
        {/* ─── Session Sidebar ─────────────────────────────────── */}
        {sidebarOpen && (
          <div className="w-56 border-r border-border flex flex-col shrink-0">
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
                    <span className="flex-1 truncate text-left">{activeFolder.split("/").pop() || activeFolder}</span>
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
                        <span className="truncate">{f.split("/").pop() || f}</span>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              {showFolderInput && (
                <div className="flex gap-1 mt-1.5">
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
                      }
                    }}
                  >
                    <Check className="h-3 w-3" />
                  </Button>
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
                  title="Manage worktrees"
                >
                  <GitFork className="h-3 w-3" />
                </Button>
              </div>
              {showWorktreePanel && (
                <div className="space-y-1.5">
                  {worktrees.length > 0 && (
                    <div className="space-y-0.5 max-h-32 overflow-y-auto">
                      {worktrees.map((wt) => (
                        <div
                          key={wt.path}
                          className={cn(
                            "flex items-center gap-1.5 text-[11px] px-1.5 py-1 rounded cursor-pointer group",
                            activeFolder === wt.path ? "bg-accent text-accent-foreground" : "hover:bg-muted"
                          )}
                          onClick={() => switchToWorktree(wt)}
                        >
                          <GitBranch className="h-3 w-3 shrink-0 text-muted-foreground" />
                          <span className="flex-1 truncate">{wt.branch || wt.path.split("/").pop()}</span>
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
                      ))}
                    </div>
                  )}
                  <div className="space-y-1 pt-1 border-t border-border">
                    <Input
                      className="h-6 text-xs"
                      placeholder="Path (e.g. ../my-feature)"
                      value={newWorktreePath}
                      onChange={(e) => setNewWorktreePath(e.target.value)}
                    />
                    <Input
                      className="h-6 text-xs"
                      placeholder="New branch name (optional)"
                      value={newWorktreeBranch}
                      onChange={(e) => setNewWorktreeBranch(e.target.value)}
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
                </div>
              )}
            </div>
            {/* Sessions header */}
            <div className="p-2 border-b border-border flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Sessions</span>
              <div className="flex gap-1">
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={newSession} title="New session">
                  <Plus className="h-3.5 w-3.5" />
                </Button>
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setSidebarOpen(false)}>
                  <PanelLeftClose className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
            <ScrollArea className="flex-1">
              <div className="p-1.5 space-y-0.5">
                {sessions.map((s) => (
                  <div
                    key={s.sessionId}
                    className={cn(
                      "group relative rounded-md px-2.5 py-2 cursor-pointer text-xs transition-colors",
                      activeSessionId === s.sessionId
                        ? "bg-accent text-accent-foreground"
                        : "hover:bg-muted"
                    )}
                    onClick={() => loadSession(s.sessionId)}
                  >
                    <div className="font-medium truncate pr-6">
                      {s.summary || s.firstPrompt?.slice(0, 40) || "Untitled"}
                    </div>
                    <div className="text-muted-foreground mt-0.5">
                      {formatTime(s.lastModified)}
                    </div>
                  </div>
                ))}
                {sessions.length === 0 && connected && (
                  <p className="text-xs text-muted-foreground text-center py-4">No sessions yet</p>
                )}
              </div>
            </ScrollArea>
          </div>
        )}

        {/* ─── Main Chat Area ──────────────────────────────────── */}
        <div className="flex-1 flex flex-col min-w-0">
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
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setShowTerminal(!showTerminal)} title="Open session in terminal">
              <Terminal className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setShowConfig(!showConfig)}>
              <Settings className="h-3.5 w-3.5" />
            </Button>
          </div>

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

          {/* Messages */}
          <ScrollArea className="flex-1 px-4 py-3">
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
                    // Wait a moment for relay to start, then retry connection
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
                      {msg.role === "assistant" ? renderContent(msg.content) : <p className="whitespace-pre-wrap">{msg.content}</p>}
                      <div className="flex items-center gap-1 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => copyMessage(msg.content)}>
                          <Copy className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
                {/* Streaming */}
                {streaming && streamingText && (
                  <div className="flex gap-3">
                    <div className="shrink-0 h-7 w-7 rounded-full flex items-center justify-center bg-muted">
                      <ClaudeIcon className="h-4 w-4" />
                    </div>
                    <div className="max-w-[85%] rounded-lg px-3 py-2 text-sm bg-muted">
                      {renderContent(streamingText)}
                      <span className="inline-block w-1.5 h-4 bg-foreground/70 animate-pulse ml-0.5" />
                    </div>
                  </div>
                )}
                {streaming && !streamingText && (
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
          </ScrollArea>

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
              {/* Slash command menu */}
              {showSlashMenu && (
                <div className="absolute bottom-full left-3 right-3 mb-1 rounded-md border border-border bg-popover shadow-md z-10 max-h-40 overflow-y-auto">
                  {SLASH_COMMANDS
                    .filter((c) => c.cmd.includes("/" + slashFilter))
                    .map((c) => (
                      <div
                        key={c.cmd}
                        className="px-3 py-1.5 text-xs cursor-pointer hover:bg-accent flex justify-between items-center"
                        onClick={() => executeSlashCommand(c.cmd)}
                      >
                        <span className="font-mono font-medium">{c.cmd}</span>
                        <span className="text-muted-foreground ml-2">{c.desc}</span>
                      </div>
                    ))}
                </div>
              )}
              <div className="flex gap-2 items-end">
                <textarea
                  ref={inputRef}
                  className="flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[38px] max-h-[120px]"
                  placeholder={activeFolder ? "Ask Claude... (/ for commands)" : "Select a folder first..."}
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
                  <Button size="icon" variant="destructive" className="h-9 w-9 shrink-0" onClick={abortQuery}>
                    <X className="h-4 w-4" />
                  </Button>
                ) : (
                  <Button size="icon" className="h-9 w-9 shrink-0" onClick={sendMessage} disabled={!input.trim()}>
                    <Send className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
        {showTerminal && (
          <div className="w-[45%] border-l border-border shrink-0">
            <TerminalPanel
              cwd={activeFolder}
              command={activeSessionId ? `claude --resume ${activeSessionId}` : "claude"}
              label="Claude CLI"
              onClose={() => setShowTerminal(false)}
              className="h-full"
            />
          </div>
        )}
      </div>
    </WidgetWrapper>
  );
}
