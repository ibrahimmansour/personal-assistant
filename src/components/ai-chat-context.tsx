"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import { useProfile } from "@/components/profile-context";
import { useWorkspace } from "@/components/workspace-context";
import { useDashboard } from "@/components/dashboard-context";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AIAction {
  action: string;
  widget?: string;
  query?: string;
  workspace?: string;
  profile?: string;
  theme?: string;
  combo?: string;
  url?: string;
  title?: string;
  priority?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** Parsed action from assistant messages */
  action?: AIAction | null;
  /** Whether this message is still streaming */
  streaming?: boolean;
  timestamp: number;
}

interface AIChatContextType {
  /** All messages in the current session */
  messages: ChatMessage[];
  /** Whether the chat panel is open */
  isOpen: boolean;
  /** Whether the AI is currently generating a response */
  isStreaming: boolean;
  /** Whether Ollama is available */
  aiAvailable: boolean | null;
  /** Toggle the chat panel */
  toggle: () => void;
  /** Open the chat panel */
  open: () => void;
  /** Close the chat panel */
  close: () => void;
  /** Send a user message */
  sendMessage: (text: string) => void;
  /** Clear conversation history (start new session) */
  clearSession: () => void;
  /** Abort the current streaming response */
  abort: () => void;
}

const AIChatContext = createContext<AIChatContextType | null>(null);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Extract a JSON action block from AI response text */
function parseAIAction(text: string): AIAction | null {
  const fenceMatch = text.match(/```json\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1].trim());
    } catch {
      return null;
    }
  }
  const jsonMatch = text.match(/\{[^{}]*"action"\s*:\s*"[^"]+?"[^{}]*\}\s*$/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]);
    } catch {
      return null;
    }
  }
  return null;
}

/** Strip the JSON code fence from AI response for display */
export function stripActionJson(text: string): string {
  return text.replace(/\n*```json\s*\n?[\s\S]*?\n?\s*```\s*$/, "").trim();
}

/** Human-readable label for an AI action */
export function actionLabel(action: AIAction): string {
  switch (action.action) {
    case "navigate":
      return `Open ${action.widget}`;
    case "search":
      return `Search ${action.widget} for "${action.query}"`;
    case "switch_workspace":
      return `Switch to ${action.workspace} workspace`;
    case "switch_profile":
      return `Switch to ${action.profile} profile`;
    case "set_theme":
      return `Set ${action.theme} theme`;
    case "focus_mode":
      return `Enter focus: ${action.combo}`;
    case "open_url":
      return `Open URL`;
    case "create_task":
      return `Create task: ${action.title}`;
    case "create_note":
      return `Create note: ${action.title}`;
    default:
      return action.action;
  }
}

// ─── Provider ────────────────────────────────────────────────────────────────

export function AIChatProvider({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [aiAvailable, setAiAvailable] = useState<boolean | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const { activeProfile } = useProfile();
  const { activeWorkspace } = useWorkspace();
  const { widgets } = useDashboard();

  // Check AI availability on first open
  const checkAvailability = useCallback(() => {
    fetch("/api/ai")
      .then((r) => r.json())
      .then((d) => setAiAvailable(d.available))
      .catch(() => setAiAvailable(false));
  }, []);

  const toggle = useCallback(() => {
    setIsOpen((prev) => {
      if (!prev) checkAvailability();
      return !prev;
    });
  }, [checkAvailability]);

  const open = useCallback(() => {
    checkAvailability();
    setIsOpen(true);
  }, [checkAvailability]);

  const close = useCallback(() => setIsOpen(false), []);

  const abort = useCallback(() => {
    if (abortRef.current) abortRef.current.abort();
    setIsStreaming(false);
  }, []);

  const clearSession = useCallback(() => {
    abort();
    setMessages([]);
  }, [abort]);

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isStreaming) return;

      // Add user message
      const userMsg: ChatMessage = {
        id: generateId(),
        role: "user",
        content: trimmed,
        timestamp: Date.now(),
      };

      // Add placeholder assistant message
      const assistantMsg: ChatMessage = {
        id: generateId(),
        role: "assistant",
        content: "",
        streaming: true,
        timestamp: Date.now(),
      };

      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setIsStreaming(true);

      // Build conversation history for the API (last 20 messages to stay within context window)
      const historyForApi = [...messages, userMsg].slice(-20).map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));

      const abortController = new AbortController();
      abortRef.current = abortController;

      let accumulated = "";

      try {
        // ─── Topic detection: scan user message + recent history for relevant topics ──
        const recentText = [...messages.slice(-6), userMsg]
          .map((m) => m.content.toLowerCase())
          .join(" ");

        const topicKeywords: Record<string, string[]> = {
          calendar: ["meeting", "meetings", "calendar", "schedule", "event", "events", "today", "tomorrow", "agenda", "standup", "1:1", "sync", "review"],
          tasks: ["task", "tasks", "todo", "to-do", "priority", "overdue", "pending", "completed", "done"],
          prs: ["pr", "prs", "pull request", "pull requests", "review", "merge", "github", "code review", "ci", "pipeline"],
          email: ["email", "emails", "mail", "inbox", "unread", "sent", "message", "from", "emailed"],
          jira: ["jira", "ticket", "tickets", "issue", "issues", "sprint", "backlog", "story", "bug"],
          notes: ["note", "notes", "document", "write", "memo"],
        };

        const detectedTopics: string[] = [];
        for (const [topic, keywords] of Object.entries(topicKeywords)) {
          if (keywords.some((kw) => recentText.includes(kw))) {
            detectedTopics.push(topic);
          }
        }

        // If first message or general question, fetch calendar + tasks as baseline
        if (detectedTopics.length === 0 && messages.length <= 2) {
          detectedTopics.push("calendar", "tasks");
        }

        // Fetch live data for detected topics
        let topicSummaries: Record<string, string> = {};
        if (detectedTopics.length > 0) {
          try {
            const contextRes = await fetch(
              `/api/ai/context?topics=${detectedTopics.join(",")}&profile=${activeProfile}`,
              { signal: abortController.signal }
            );
            const contextData = await contextRes.json();
            topicSummaries = contextData.summaries || {};
          } catch {
            // Continue without live data — model will use what it has
          }
        }

        // Build context with live data
        const contextObj: Record<string, unknown> = {
          time: new Date().toLocaleString(),
          workspace: activeWorkspace.id,
          widgets: widgets.filter((w) => w.visible).map((w) => w.type),
        };

        // Inject topic summaries as named fields
        if (topicSummaries.calendar) contextObj.calendarSummary = topicSummaries.calendar;
        if (topicSummaries.tasks) contextObj.taskSummary = topicSummaries.tasks;
        if (topicSummaries.prs) contextObj.prSummary = topicSummaries.prs;
        if (topicSummaries.email) contextObj.emailSummary = topicSummaries.email;
        if (topicSummaries.jira) contextObj.jiraSummary = topicSummaries.jira;
        if (topicSummaries.notes) contextObj.notesSummary = topicSummaries.notes;

        const res = await fetch("/api/ai", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: historyForApi,
            profile: activeProfile,
            context: contextObj,
          }),
          signal: abortController.signal,
        });

        if (!res.ok || !res.body) {
          const err = await res.json().catch(() => ({ error: "Request failed" }));
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsg.id
                ? { ...m, content: err.error || "Something went wrong.", streaming: false }
                : m
            )
          );
          setIsStreaming(false);
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const parsed = JSON.parse(line);
              if (parsed.token) {
                accumulated += parsed.token;
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantMsg.id
                      ? { ...m, content: accumulated }
                      : m
                  )
                );
              }
              if (parsed.error) {
                accumulated = parsed.error;
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantMsg.id
                      ? { ...m, content: accumulated, streaming: false }
                      : m
                  )
                );
              }
            } catch {
              // skip malformed lines
            }
          }
        }

        // Finalize: parse action, mark as done
        const action = parseAIAction(accumulated);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsg.id
              ? { ...m, content: accumulated, action, streaming: false }
              : m
          )
        );
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsg.id
                ? { ...m, content: accumulated || "(cancelled)", streaming: false }
                : m
            )
          );
          return;
        }
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsg.id
              ? { ...m, content: "Failed to connect to AI. Is Ollama running?", streaming: false }
              : m
          )
        );
      } finally {
        setIsStreaming(false);
      }
    },
    [isStreaming, messages, activeProfile, activeWorkspace.id, widgets]
  );

  return (
    <AIChatContext.Provider
      value={{
        messages,
        isOpen,
        isStreaming,
        aiAvailable,
        toggle,
        open,
        close,
        sendMessage,
        clearSession,
        abort,
      }}
    >
      {children}
    </AIChatContext.Provider>
  );
}

export function useAIChat() {
  const ctx = useContext(AIChatContext);
  if (!ctx) throw new Error("useAIChat must be used within AIChatProvider");
  return ctx;
}
