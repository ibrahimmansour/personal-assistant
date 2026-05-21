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
} from "lucide-react";
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

const MODELS = [
  { id: "sonnet", label: "Sonnet" },
  { id: "opus", label: "Opus" },
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
  const [configUrl, setConfigUrl] = useState("");
  const [configToken, setConfigToken] = useState("");
  const [configLabel, setConfigLabel] = useState("");
  const [configCwd, setConfigCwd] = useState("");

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const streamingTextRef = useRef("");

  // Load relay configs — default to local relay server
  useEffect(() => {
    fetch("/api/claude-code")
      .then((r) => r.json())
      .then((d) => {
        const cfgs = d.configs || [];
        setConfigs(cfgs);
        if (cfgs.length > 0) {
          connectToRelay(cfgs[0]);
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
      // Request sessions list
      ws.send(JSON.stringify({ type: "list-sessions", dir: config.defaultCwd }));
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
        const sessionMessages = (msg.messages as Array<{ type: string; message?: { content?: unknown[] }; uuid?: string }>)|| [];
        // Convert SDK messages to our format
        const converted: Message[] = [];
        for (const m of sessionMessages) {
          if (m.type === "user" || m.type === "assistant") {
            let content = "";
            const rawMsg = m.message as { content?: unknown[] } | undefined;
            if (rawMsg?.content) {
              for (const block of rawMsg.content) {
                if ((block as { type?: string; text?: string }).type === "text") {
                  content += (block as { text: string }).text;
                }
              }
            }
            if (content) {
              converted.push({
                id: (m as { uuid?: string }).uuid || crypto.randomUUID(),
                role: m.type as "user" | "assistant",
                content,
                timestamp: new Date().toISOString(),
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
          if ((data as { session_id?: string }).session_id && !activeSessionId) {
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
              id: crypto.randomUUID(),
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
        const config = configs[activeConfigIdx];
        if (config && wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: "list-sessions", dir: config.defaultCwd }));
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
      { id: crypto.randomUUID(), role: "user", content, timestamp: new Date().toISOString() },
    ]);

    setStreaming(true);
    setStreamingText("");
    streamingTextRef.current = "";

    const config = configs[activeConfigIdx];
    ws.send(JSON.stringify({
      type: "query",
      prompt: content,
      sessionId: activeSessionId || undefined,
      cwd: config?.defaultCwd,
      model: selectedModel,
    }));
  };

  const abortQuery = () => {
    wsRef.current?.send(JSON.stringify({ type: "abort" }));
  };

  const loadSession = (sessionId: string) => {
    setActiveSessionId(sessionId);
    setMessages([]);
    const config = configs[activeConfigIdx];
    wsRef.current?.send(JSON.stringify({
      type: "get-messages",
      sessionId,
      dir: config?.defaultCwd,
    }));
  };

  const newSession = () => {
    setActiveSessionId(null);
    setMessages([]);
    setStreamingText("");
    inputRef.current?.focus();
  };

  const renameSession = (sessionId: string, title: string) => {
    const config = configs[activeConfigIdx];
    wsRef.current?.send(JSON.stringify({
      type: "rename-session",
      sessionId,
      title,
      dir: config?.defaultCwd,
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

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
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
              <DropdownMenuTrigger>
                <Button variant="outline" size="sm" className="h-7 text-xs gap-1">
                  {MODELS.find((m) => m.id === selectedModel)?.label || "Model"}
                  <ChevronDown className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {MODELS.map((m) => (
                  <DropdownMenuItem key={m.id} onClick={() => setSelectedModel(m.id)}>
                    {m.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
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
                <Button size="sm" onClick={() => setShowConfig(true)} className="gap-1.5">
                  <Settings className="h-3.5 w-3.5" />
                  Configure
                </Button>
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
            <div className="p-3 border-t border-border shrink-0">
              <div className="flex gap-2 items-end">
                <textarea
                  ref={inputRef}
                  className="flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[38px] max-h-[120px]"
                  placeholder="Ask Claude..."
                  value={input}
                  onChange={(e) => {
                    setInput(e.target.value);
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
      </div>
    </WidgetWrapper>
  );
}
