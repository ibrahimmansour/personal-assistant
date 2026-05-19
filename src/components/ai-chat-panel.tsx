"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import {
  Bot,
  X,
  Send,
  Loader2,
  Play,
  Trash2,
  StopCircle,
  Sparkles,
  User,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useAIChat,
  stripActionJson,
  actionLabel,
  type AIAction,
} from "@/components/ai-chat-context";
import { useDashboard } from "@/components/dashboard-context";
import {
  useProfile,
  type ProfileId,
} from "@/components/profile-context";
import { useWidgetNav } from "@/components/widget-nav-context";
import { useWorkspace } from "@/components/workspace-context";
import { useTheme } from "next-themes";

export function AIChatPanel() {
  const {
    messages,
    isOpen,
    isStreaming,
    aiAvailable,
    close,
    sendMessage,
    clearSession,
    abort,
  } = useAIChat();

  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { widgets, ensureWidgetVisible } = useDashboard();
  const { activeProfile, setActiveProfile } = useProfile();
  const { navigateTo } = useWidgetNav();
  const {
    activeWorkspace,
    setActiveWorkspace,
    focusCombos,
    activeFocusId,
    enterFocusMode,
    exitFocusMode,
  } = useWorkspace();
  const { setTheme } = useTheme();

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Focus input when panel opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  // Keyboard shortcut: Escape to close
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [isOpen, close]);

  const handleSubmit = useCallback(() => {
    if (!input.trim() || isStreaming) return;
    sendMessage(input);
    setInput("");
  }, [input, isStreaming, sendMessage]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit]
  );

  // Execute an AI action
  const executeAction = useCallback(
    (action: AIAction) => {
      switch (action.action) {
        case "navigate": {
          if (!action.widget) break;
          const widgetConfig = widgets.find((w) => w.type === action.widget);
          if (widgetConfig) {
            const wsHasWidget = activeWorkspace.widgetIds.includes(widgetConfig.id);
            if (!wsHasWidget || activeWorkspace.viewType) setActiveWorkspace("dashboard");
            if (activeFocusId) exitFocusMode();
            ensureWidgetVisible(widgetConfig.id);
            setTimeout(() => navigateTo(action.widget as Parameters<typeof navigateTo>[0]), 100);
          }
          break;
        }
        case "search": {
          if (!action.widget) break;
          const searchWidgetConfig = widgets.find((w) => w.type === action.widget);
          if (searchWidgetConfig) {
            const wsHasWidget = activeWorkspace.widgetIds.includes(searchWidgetConfig.id);
            if (!wsHasWidget || activeWorkspace.viewType) setActiveWorkspace("dashboard");
            if (activeFocusId) exitFocusMode();
            ensureWidgetVisible(searchWidgetConfig.id);
            setTimeout(
              () =>
                navigateTo(
                  action.widget as Parameters<typeof navigateTo>[0],
                  undefined,
                  action.query || undefined
                ),
              100
            );
          }
          break;
        }
        case "switch_workspace":
          if (action.workspace) setActiveWorkspace(action.workspace);
          break;
        case "switch_profile":
          if (action.profile === "work" || action.profile === "private")
            setActiveProfile(action.profile as ProfileId);
          break;
        case "set_theme":
          if (action.theme) setTheme(action.theme);
          break;
        case "focus_mode": {
          if (!action.combo) break;
          const combo = focusCombos.find((c) => c.id === action.combo);
          if (combo) enterFocusMode(combo.id);
          break;
        }
        case "open_url":
          if (action.url) window.open(action.url, "_blank", "noopener");
          break;
        case "create_task":
          if (action.title) {
            fetch(`/api/tasks?profile=${activeProfile}`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                action: "add",
                task: { title: action.title, priority: action.priority || "medium" },
              }),
            });
          }
          break;
        case "create_note":
          if (action.title) {
            fetch(`/api/notes?profile=${activeProfile}`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                action: "add",
                note: { title: action.title, content: "" },
              }),
            });
          }
          break;
      }
    },
    [
      widgets, activeWorkspace, setActiveWorkspace, activeFocusId,
      exitFocusMode, ensureWidgetVisible, navigateTo, setActiveProfile,
      setTheme, focusCombos, enterFocusMode, activeProfile,
    ]
  );

  if (!isOpen) return null;

  return (
    <div className="fixed right-0 top-0 bottom-0 z-[100] flex">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-background/40 backdrop-blur-sm"
        onClick={close}
      />

      {/* Panel */}
      <div className="relative ml-auto w-[420px] max-w-[90vw] h-full bg-card border-l border-border shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <div className="flex items-center justify-center h-7 w-7 rounded-lg bg-primary/10">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
            </div>
            <div>
              <h2 className="text-sm font-semibold leading-none">AI Assistant</h2>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                {aiAvailable === false ? "Ollama offline" : "gemma3:4b · local"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {messages.length > 0 && (
              <button
                onClick={clearSession}
                className="text-muted-foreground hover:text-foreground transition-colors p-1.5 rounded-md hover:bg-muted"
                title="Clear conversation"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
            <button
              onClick={close}
              className="text-muted-foreground hover:text-foreground transition-colors p-1.5 rounded-md hover:bg-muted"
              title="Close (Esc)"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center gap-3">
              <div className="h-12 w-12 rounded-full bg-primary/5 flex items-center justify-center">
                <Bot className="h-6 w-6 text-primary/40" />
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Start a conversation</p>
                <p className="text-[11px] text-muted-foreground/60 mt-1 max-w-[260px]">
                  Ask about your schedule, tasks, PRs, or anything about your dashboard. I remember context within the session.
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5 mt-2 max-w-[300px] justify-center">
                {[
                  "what's on my plate today",
                  "any urgent tasks",
                  "set me up for coding",
                  "show my PRs",
                ].map((q) => (
                  <button
                    key={q}
                    onClick={() => { sendMessage(q); }}
                    className="text-[11px] px-2.5 py-1 rounded-full border border-border/50 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg) => (
            <div key={msg.id} className={cn("flex gap-2.5", msg.role === "user" && "flex-row-reverse")}>
              {/* Avatar */}
              <div
                className={cn(
                  "h-6 w-6 rounded-full flex items-center justify-center shrink-0 mt-0.5",
                  msg.role === "user"
                    ? "bg-primary/10"
                    : "bg-muted"
                )}
              >
                {msg.role === "user" ? (
                  <User className="h-3 w-3 text-primary" />
                ) : (
                  <Bot className="h-3 w-3 text-muted-foreground" />
                )}
              </div>

              {/* Message bubble */}
              <div
                className={cn(
                  "max-w-[85%] rounded-xl px-3 py-2",
                  msg.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted/50"
                )}
              >
                {msg.role === "assistant" ? (
                  <div className="text-sm leading-relaxed ai-markdown">
                    <ReactMarkdown>{stripActionJson(msg.content)}</ReactMarkdown>
                    {msg.streaming && (
                      <span className="inline-block w-1.5 h-4 bg-primary/60 animate-pulse ml-0.5 align-text-bottom rounded-sm" />
                    )}
                  </div>
                ) : (
                  <p className="text-sm leading-relaxed whitespace-pre-wrap">
                    {msg.content}
                  </p>
                )}

                {/* Action button */}
                {msg.role === "assistant" && msg.action && !msg.streaming && (
                  <button
                    onClick={() => executeAction(msg.action!)}
                    className="flex items-center gap-1.5 mt-2 w-full text-left text-xs px-2.5 py-1.5 rounded-lg border border-primary/20 bg-primary/5 hover:bg-primary/10 text-primary transition-colors"
                  >
                    <Play className="h-3 w-3 shrink-0" />
                    <span className="truncate">{actionLabel(msg.action)}</span>
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Input area */}
        <div className="border-t border-border px-4 py-3 shrink-0">
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask anything..."
              rows={1}
              className="flex-1 resize-none text-sm rounded-lg border border-border/50 bg-muted/30 px-3 py-2 placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/30 max-h-24"
              style={{ minHeight: "36px" }}
              onInput={(e) => {
                const target = e.target as HTMLTextAreaElement;
                target.style.height = "36px";
                target.style.height = `${Math.min(target.scrollHeight, 96)}px`;
              }}
            />
            {isStreaming ? (
              <button
                onClick={abort}
                className="shrink-0 h-9 w-9 flex items-center justify-center rounded-lg bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors"
                title="Stop generating"
              >
                <StopCircle className="h-4 w-4" />
              </button>
            ) : (
              <button
                onClick={handleSubmit}
                disabled={!input.trim()}
                className="shrink-0 h-9 w-9 flex items-center justify-center rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                title="Send (Enter)"
              >
                <Send className="h-4 w-4" />
              </button>
            )}
          </div>
          <p className="text-[10px] text-muted-foreground/40 mt-1.5 text-center">
            gemma3:4b · running locally · Shift+Enter for newline
          </p>
        </div>
      </div>
    </div>
  );
}
