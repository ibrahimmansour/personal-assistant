"use client";

import { WidgetWrapper } from "@/components/widget-wrapper";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ListTodo,
  Plus,
  Trash2,
  Loader2,
  AlertCircle,
  Pencil,
  Check,
  X,
  GripVertical,
  Folder,
  FolderPlus,
  Inbox,
  MoreHorizontal,
  Search,
  Sparkles,
  FolderCog,
  TerminalSquare,
  RotateCcw,
  Play,
  Square,
  CheckSquare,
  ArrowLeft,
  FileText,
  BookOpen,
  Save,
} from "lucide-react";
import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { useProfile } from "@/components/profile-context";
import { useWidgetNavFor } from "@/components/widget-nav-context";

interface Task {
  id: string;
  title: string;
  completed: boolean;
  priority: "low" | "medium" | "high";
  createdAt: string;
  completedAt?: string;
  folder?: string;
  /** Additional context / requirements for this task (markdown) */
  context?: string;
  /** Implementation summary populated by OpenCode after completion (markdown) */
  summary?: string;
}

interface TaskFolder {
  id: string;
  name: string;
  color?: string;
  /** Optional working directory for AI integrations (e.g. opencode) */
  cwd?: string;
}

const priorityColors: Record<Task["priority"], string> = {
  high: "bg-red-500/15 text-red-700 dark:text-red-400",
  medium: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400",
  low: "bg-green-500/15 text-green-700 dark:text-green-400",
};

const priorityCycle: Task["priority"][] = ["low", "medium", "high"];

// ─── Embedded OpenCode Terminal Panel ─────────────────────────────────────────

const WS_URL = typeof window !== "undefined" ? `ws://${window.location.hostname}:4445` : "ws://localhost:4445";

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
    const [, r, g, b] = match;
    return `#${((1 << 24) + (parseInt(r) << 16) + (parseInt(g) << 8) + parseInt(b)).toString(16).slice(1)}`;
  } catch {
    return fallback;
  }
}

function getCssVarHex(varName: string, fallback: string): string {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  if (!raw) return fallback;
  return resolveColor(raw, fallback);
}

function getTermTheme() {
  const dark = document.documentElement.classList.contains("dark");
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

// ─── Module-level session store (survives React remounts) ────────────────────

interface OpenCodeSession {
  taskId: string;
  taskTitle: string;
  cwd?: string;
  terminal: any;
  fitAddon: any;
  ws: WebSocket;
  alive: boolean;
  /** The off-screen wrapper div that owns the xterm DOM */
  wrapperEl: HTMLDivElement;
  themeObserver: MutationObserver;
}

const openCodeSessions = new Map<string, OpenCodeSession>();

/** Listeners notified whenever sessions are created/destroyed/die */
const sessionListeners = new Set<() => void>();
function notifySessionChange() {
  sessionListeners.forEach((fn) => fn());
}

/** Hook to re-render when sessions change */
function useSessionVersion(): number {
  const [v, setV] = useState(0);
  useEffect(() => {
    const handler = () => setV((n) => n + 1);
    sessionListeners.add(handler);
    return () => { sessionListeners.delete(handler); };
  }, []);
  return v;
}

/** Fully kill and clean up a session */
function destroySession(taskId: string) {
  const session = openCodeSessions.get(taskId);
  if (!session) return;
  session.themeObserver.disconnect();
  try { session.ws.close(); } catch {}
  try { session.terminal.dispose(); } catch {}
  // Remove the wrapper element from wherever it's attached
  if (session.wrapperEl.parentElement) {
    session.wrapperEl.parentElement.removeChild(session.wrapperEl);
  }
  openCodeSessions.delete(taskId);
  notifySessionChange();
}

/**
 * Create an OpenCode terminal session (headless — no container needed).
 * The session is stored in `openCodeSessions` and can be attached to a
 * container later by `OpenCodeTerminalPanel`.
 */
async function createSession(
  taskId: string,
  taskTitle: string,
  cwd?: string,
  context?: string,
): Promise<OpenCodeSession | null> {
  // Already exists and alive? Nothing to do.
  const existing = openCodeSessions.get(taskId);
  if (existing?.alive) return existing;
  // Dead session — clean up first
  if (existing) destroySession(taskId);

  try {
    const { Terminal } = await import("@xterm/xterm");
    const { FitAddon } = await import("@xterm/addon-fit");
    const { WebLinksAddon } = await import("@xterm/addon-web-links");
    await import("@xterm/xterm/css/xterm.css");

    // Build the full prompt inline (opencode --prompt doesn't expand /commands,
    // so we embed the PA instructions directly into the prompt text).
    // We write the prompt to a temp file and use $(cat ...) to avoid shell escaping issues.
    const taskBlock = context
      ? `${taskTitle}\n\nContext:\n${context}`
      : taskTitle;
    const fullPrompt = [
      "You have been given a task from the Personal Assistant dashboard to implement.",
      "",
      "## Task",
      "",
      taskBlock,
      "",
      "## Instructions",
      "",
      "1. Implement the task described above. Follow the project's conventions, write clean code, and test your changes.",
      "",
      "2. When you are done, write a concise implementation summary (under 500 words, plain text with line breaks) covering:",
      "   - What files were created or modified",
      "   - What the key changes do",
      "   - Any important decisions or trade-offs",
      "   - Known limitations or follow-up items",
      "",
      "3. Post the summary to the PA dashboard API. Use the Bash tool to run a curl command like:",
      "",
      `   curl -s -X POST http://localhost:4444/api/tasks -H "Content-Type: application/json" -d '<JSON>'`,
      "",
      `   Where <JSON> is: {"action":"updateSummary","profile":"work","title":"<TASK_TITLE>","summary":"<YOUR_SUMMARY>"}`,
      `   Use the exact task title: ${taskTitle}`,
      "   Replace <YOUR_SUMMARY> with your implementation summary. Escape double quotes and newlines properly for the JSON string value.",
      "",
      "4. Verify the API responded with the updated tasks array (not an error).",
    ].join("\n");
    // Write prompt to temp file — avoids all shell escaping headaches
    const promptFile = `/tmp/pa-prompt-${taskId}.txt`;
    const writePromptCmd = `cat > ${promptFile} << 'PA_PROMPT_EOF'\n${fullPrompt}\nPA_PROMPT_EOF`;
    const command = `opencode --prompt "$(cat ${promptFile})"`;

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

    const wrapperEl = document.createElement("div");
    wrapperEl.style.cssText = "width:100%;height:100%";
    terminal.open(wrapperEl);

    const ws = new WebSocket(new URL(WS_URL).toString());

    const session: OpenCodeSession = {
      taskId,
      taskTitle,
      cwd,
      terminal,
      fitAddon,
      ws,
      alive: true,
      wrapperEl,
      themeObserver: new MutationObserver(() => {
        terminal.options.theme = getTermTheme();
      }),
    };
    session.themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

    ws.onopen = () => {
      // After shell init: cd to project dir, write prompt file, then launch opencode
      setTimeout(() => {
        if (ws.readyState !== WebSocket.OPEN) return;

        // Chain of commands: cd (optional) → write prompt file → launch opencode
        const steps: string[] = [];
        if (cwd) steps.push(`cd ${cwd}`);
        steps.push(writePromptCmd);
        steps.push(command);

        // Send first step
        const sendStep = (idx: number) => {
          if (idx >= steps.length || ws.readyState !== WebSocket.OPEN) return;
          ws.send(JSON.stringify({ type: "input", data: steps[idx] + "\n" }));
          if (idx + 1 < steps.length) {
            setTimeout(() => sendStep(idx + 1), 300);
          }
        };
        sendStep(0);
      }, 400);
      notifySessionChange();
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "output") terminal.write(msg.data);
        else if (msg.type === "exit") {
          terminal.writeln("\r\n\x1b[90m[Process exited]\x1b[0m");
          session.alive = false;
          notifySessionChange();
        }
      } catch {
        terminal.write(event.data);
      }
    };

    ws.onerror = () => {
      session.alive = false;
      notifySessionChange();
    };

    ws.onclose = () => {
      session.alive = false;
      notifySessionChange();
    };

    terminal.onData((data: string) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "input", data }));
      }
    });

    openCodeSessions.set(taskId, session);
    notifySessionChange();
    return session;
  } catch {
    return null;
  }
}

interface OpenCodeTerminalPanelProps {
  taskId: string;
  taskTitle: string;
  cwd?: string;
  context?: string;
  onClose: () => void;
}

function OpenCodeTerminalPanel({ taskId, taskTitle, cwd, context, onClose }: OpenCodeTerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"connecting" | "connected" | "error" | "exited">("connecting");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [sessionVersion, setSessionVersion] = useState(0);
  useSessionVersion(); // re-render when sessions change (e.g. exit)

  // Attach an existing session's xterm DOM into the container
  const attachSession = useCallback((session: OpenCodeSession) => {
    const container = containerRef.current;
    if (!container) return;
    container.innerHTML = "";
    container.appendChild(session.wrapperEl);
    requestAnimationFrame(() => {
      setTimeout(() => {
        try {
          session.fitAddon.fit();
          const dims = session.fitAddon.proposeDimensions();
          if (dims && session.ws.readyState === WebSocket.OPEN) {
            session.ws.send(JSON.stringify({ type: "resize", cols: dims.cols, rows: dims.rows }));
          }
        } catch {}
        session.terminal.focus();
      }, 30);
    });
    setStatus(session.alive ? "connected" : "exited");
  }, []);

  // Create (if needed) and attach session
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // If a live session for this task already exists, just reattach it
    const existing = openCodeSessions.get(taskId);
    if (existing) {
      if (existing.alive) {
        attachSession(existing);
        return;
      }
      // Dead session — clean it up and fall through to create a new one
      destroySession(taskId);
    }

    // Create a new session
    let cancelled = false;
    setStatus("connecting");

    createSession(taskId, taskTitle, cwd, context).then((session) => {
      if (cancelled || !session) {
        if (!cancelled && !session) {
          setStatus("error");
          setErrorMsg("Failed to create terminal session");
        }
        return;
      }

      // Wait for WebSocket to connect then attach
      const checkAndAttach = () => {
        if (cancelled) return;
        if (session.ws.readyState === WebSocket.OPEN) {
          setStatus("connected");
          attachSession(session);
        } else if (session.ws.readyState === WebSocket.CONNECTING) {
          // Not ready yet — try again shortly
          const origOnOpen = session.ws.onopen;
          session.ws.onopen = (ev) => {
            if (typeof origOnOpen === "function") origOnOpen.call(session.ws, ev);
            if (!cancelled) {
              setStatus("connected");
              attachSession(session);
            }
          };
        } else {
          setStatus("error");
          setErrorMsg("Cannot connect to terminal server. Start it with: npm run dev:pty");
        }
      };
      checkAndAttach();
    });

    return () => {
      cancelled = true;
      // NOTE: We do NOT destroy the session here. It lives on in the store.
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- context is intentionally excluded; it's baked into the initial prompt
  }, [taskId, cwd, taskTitle, attachSession, sessionVersion]);

  // ResizeObserver on the container — re-fits whichever session is attached
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(() => {
      const session = openCodeSessions.get(taskId);
      if (!session) return;
      requestAnimationFrame(() => {
        try {
          session.fitAddon.fit();
          const dims = session.fitAddon.proposeDimensions();
          if (dims && session.ws.readyState === WebSocket.OPEN) {
            session.ws.send(JSON.stringify({ type: "resize", cols: dims.cols, rows: dims.rows }));
          }
        } catch {}
      });
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, [taskId]);

  // Detach (don't destroy) when the panel closes — move wrapper off-screen
  const handleClose = useCallback(() => {
    const session = openCodeSessions.get(taskId);
    if (session) {
      const container = containerRef.current;
      if (container && container.contains(session.wrapperEl)) {
        container.removeChild(session.wrapperEl);
      }
    }
    onClose();
  }, [taskId, onClose]);

  // Kill the session and start fresh
  const handleReset = useCallback(() => {
    destroySession(taskId);
    setStatus("connecting");
    setErrorMsg(null);
    setSessionVersion((v) => v + 1);
  }, [taskId]);

  const session = openCodeSessions.get(taskId);
  const isExited = session ? !session.alive : false;

  return (
    <div className="h-full flex flex-col bg-card border border-border rounded-lg overflow-hidden shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <TerminalSquare className="h-3.5 w-3.5 text-primary shrink-0" />
          <span className="text-xs font-medium truncate">OpenCode</span>
          {isExited && (
            <span className="text-[10px] text-muted-foreground">(exited)</span>
          )}
          {cwd && (
            <span className="text-[10px] text-muted-foreground truncate font-mono" title={cwd}>
              {cwd.split("/").pop()}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handleReset}
            className="text-muted-foreground hover:text-foreground p-0.5 transition-colors"
            title="Reset session"
          >
            <RotateCcw className="h-3 w-3" />
          </button>
          <button
            onClick={handleClose}
            className="text-muted-foreground hover:text-foreground p-0.5 transition-colors"
            title="Close panel (session stays alive)"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Terminal content */}
      <div className="flex-1 min-h-0 relative">
        {status === "connecting" && (
          <div className="absolute inset-0 flex items-center justify-center bg-card z-10">
            <div className="flex flex-col items-center gap-2 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-xs">Connecting to terminal...</span>
            </div>
          </div>
        )}
        {status === "error" && (
          <div className="absolute inset-0 flex items-center justify-center bg-card z-10">
            <div className="flex flex-col items-center gap-2 text-center px-4">
              <AlertCircle className="h-5 w-5 text-destructive" />
              <span className="text-xs text-muted-foreground">{errorMsg}</span>
            </div>
          </div>
        )}
        <div
          ref={containerRef}
          className="h-full w-full"
          onMouseDown={(e) => e.stopPropagation()}
        />
      </div>
    </div>
  );
}

// ─── Task Detail View (split: context | summary) ────────────────────────────

interface TaskDetailViewProps {
  task: Task;
  onBack: () => void;
  onUpdateTask: (id: string, updates: Partial<Pick<Task, "context" | "summary">>) => void;
}

function TaskDetailView({ task, onBack, onUpdateTask }: TaskDetailViewProps) {
  const [contextDirty, setContextDirty] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Derive context from task prop when not dirty (avoids setState-in-effect)
  const context = contextDirty ? undefined : (task.context || "");
  const [localContext, setLocalContext] = useState(task.context || "");
  const displayContext = context ?? localContext;
  const setContext = (val: string) => { setLocalContext(val); setContextDirty(true); };

  const saveContext = useCallback(() => {
    onUpdateTask(task.id, { context: displayContext || undefined });
    setContextDirty(false);
  }, [task.id, displayContext, onUpdateTask]);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [displayContext]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 pb-2 border-b border-border/50 mb-3 shrink-0">
        <button
          onClick={onBack}
          className="text-muted-foreground hover:text-foreground p-1 rounded-md hover:bg-muted transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{task.title}</p>
          <div className="flex items-center gap-2 mt-0.5">
            <Badge
              variant="secondary"
              className={cn("text-[10px]", priorityColors[task.priority])}
            >
              {task.priority}
            </Badge>
            {task.completed && (
              <span className="text-[10px] text-muted-foreground">Completed</span>
            )}
          </div>
        </div>
      </div>

      {/* Split content */}
      <div className="flex-1 min-h-0 flex gap-3 overflow-hidden">
        {/* Left: Context */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <div className="flex items-center justify-between mb-1.5 shrink-0">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <FileText className="h-3 w-3" />
              <span className="text-[11px] font-medium uppercase tracking-wide">Context</span>
            </div>
            {contextDirty && (
              <button
                onClick={saveContext}
                className="flex items-center gap-1 text-[10px] text-primary hover:text-primary/80 transition-colors"
              >
                <Save className="h-3 w-3" />
                Save
              </button>
            )}
          </div>
          <ScrollArea className="flex-1">
            <textarea
              ref={textareaRef}
              value={displayContext}
              onChange={(e) => setContext(e.target.value)}
              onBlur={() => { if (contextDirty) saveContext(); }}
              onKeyDown={(e) => {
                if (e.key === "s" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  saveContext();
                }
              }}
              placeholder="Add context, requirements, acceptance criteria, links..."
              className="w-full min-h-[80px] text-xs leading-relaxed bg-muted/30 border border-border/50 rounded-md p-2.5 resize-none placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary/30 font-mono"
              onMouseDown={(e) => e.stopPropagation()}
            />
          </ScrollArea>
        </div>

        {/* Divider */}
        <div className="w-px bg-border/50 shrink-0" />

        {/* Right: Implementation Summary */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <div className="flex items-center gap-1.5 text-muted-foreground mb-1.5 shrink-0">
            <BookOpen className="h-3 w-3" />
            <span className="text-[11px] font-medium uppercase tracking-wide">Implementation</span>
          </div>
          <ScrollArea className="flex-1">
            {task.summary ? (
              <div
                className="text-xs leading-relaxed whitespace-pre-wrap font-mono p-2.5 bg-muted/30 border border-border/50 rounded-md"
                onMouseDown={(e) => e.stopPropagation()}
              >
                {task.summary}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground/50 gap-2 py-8">
                <Sparkles className="h-5 w-5" />
                <p className="text-[11px] text-center">
                  No implementation summary yet.
                  <br />
                  Run with OpenCode and use <code className="text-[10px] bg-muted px-1 py-0.5 rounded">/PA</code> to add one.
                </p>
              </div>
            )}
          </ScrollArea>
        </div>
      </div>
    </div>
  );
}

export function TasksWidget() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [folders, setFolders] = useState<TaskFolder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [newPriority, setNewPriority] = useState<Task["priority"]>("medium");
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editPriority, setEditPriority] = useState<Task["priority"]>("medium");
  const [activeFolder, setActiveFolder] = useState<string | null>(null); // null = All
  const [addingFolder, setAddingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [editFolderName, setEditFolderName] = useState("");
  const [folderMenuId, setFolderMenuId] = useState<string | null>(null);
  const [dragTaskId, setDragTaskId] = useState<string | null>(null);
  const [dropTargetFolder, setDropTargetFolder] = useState<string | "all" | null>(null);
  const [filterQuery, setFilterQuery] = useState("");
  const [showFilter, setShowFilter] = useState(false);
  const [settingCwdFolderId, setSettingCwdFolderId] = useState<string | null>(null);
  const [cwdInputValue, setCwdInputValue] = useState("");
  const [aiTerminalTask, setAiTerminalTask] = useState<{ taskId: string; taskTitle: string; cwd?: string; context?: string } | null>(null);
  const [folderMenuPos, setFolderMenuPos] = useState<{ top: number; left: number } | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null);
  useSessionVersion(); // triggers re-render when sessions change
  const filterInputRef = useRef<HTMLInputElement>(null);
  const cwdInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const editFolderInputRef = useRef<HTMLInputElement>(null);
  const { activeProfile } = useProfile();
  const { expandRequested, onExpandHandled, pendingSearchQuery, clearPendingSearch } = useWidgetNavFor("tasks");

  // Handle search from AI actions
  useEffect(() => {
    if (pendingSearchQuery) {
      setFilterQuery(pendingSearchQuery);
      setShowFilter(true);
      clearPendingSearch();
    }
  }, [pendingSearchQuery, clearPendingSearch]);

  // Focus filter input when shown
  useEffect(() => {
    if (showFilter) setTimeout(() => filterInputRef.current?.focus(), 50);
  }, [showFilter]);

  // Focus cwd input when editing
  useEffect(() => {
    if (settingCwdFolderId) setTimeout(() => cwdInputRef.current?.focus(), 50);
  }, [settingCwdFolderId]);

  const fetchTasks = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`/api/tasks?profile=${activeProfile}`);
      const data = await res.json();
      if (data.error) {
        setError(data.error);
        return;
      }
      setTasks(data.tasks);
      setFolders(data.folders || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch tasks");
    } finally {
      setLoading(false);
    }
  }, [activeProfile]);

  useEffect(() => {
    setTasks([]);
    setFolders([]);
    setError(null);
    setActiveFolder(null);
    fetchTasks();
  }, [fetchTasks]);

  // Auto-refresh when detail view is open (picks up summaries posted by OpenCode /PA)
  useEffect(() => {
    if (!detailTaskId) return;
    const detailTask = tasks.find((t) => t.id === detailTaskId);
    // Only poll if the task exists and has no summary yet (waiting for OpenCode)
    if (!detailTask || detailTask.summary) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/tasks?profile=${activeProfile}`);
        const data = await res.json();
        if (data.tasks) setTasks(data.tasks);
        if (data.folders) setFolders(data.folders);
      } catch {}
    }, 10000);
    return () => clearInterval(interval);
  }, [detailTaskId, tasks, activeProfile]);

  useEffect(() => {
    if (showAdd && inputRef.current) inputRef.current.focus();
  }, [showAdd]);

  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingId]);

  useEffect(() => {
    if (addingFolder && folderInputRef.current) folderInputRef.current.focus();
  }, [addingFolder]);

  useEffect(() => {
    if (editingFolderId && editFolderInputRef.current) {
      editFolderInputRef.current.focus();
      editFolderInputRef.current.select();
    }
  }, [editingFolderId]);

  // Close folder menu on click outside
  useEffect(() => {
    if (!folderMenuId) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target?.closest?.("[data-folder-menu]")) return;
      setFolderMenuId(null);
      setFolderMenuPos(null);
    };
    // Defer so the opening click doesn't immediately close the menu
    const timer = setTimeout(() => document.addEventListener("click", handler), 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("click", handler);
    };
  }, [folderMenuId]);

  // ─── API helpers ──────────────────────────────────────────

  const apiPost = async (body: Record<string, unknown>) => {
    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, profile: activeProfile }),
    });
    const data = await res.json();
    if (data.tasks) setTasks(data.tasks);
    if (data.folders) setFolders(data.folders);
    return data;
  };

  const addTask = async () => {
    if (!newTitle.trim()) return;
    await apiPost({
      action: "add",
      title: newTitle.trim(),
      priority: newPriority,
      folder: activeFolder || undefined,
    });
    setNewTitle("");
    setNewPriority("medium");
    setShowAdd(false);
  };

  const toggleTask = async (id: string) => {
    setTasks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, completed: !t.completed } : t))
    );
    await apiPost({ action: "toggle", id });
  };

  const deleteTask = async (id: string) => {
    // Clean up any active OpenCode terminal session for this task
    destroySession(id);
    if (aiTerminalTask?.taskId === id) setAiTerminalTask(null);
    setTasks((prev) => prev.filter((t) => t.id !== id));
    await apiPost({ action: "delete", id });
  };

  const startEditing = (task: Task) => {
    setEditingId(task.id);
    setEditTitle(task.title);
    setEditPriority(task.priority);
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditTitle("");
  };

  const saveEdit = async () => {
    if (!editingId || !editTitle.trim()) return;
    const task = tasks.find((t) => t.id === editingId);
    if (!task) return;
    if (editTitle.trim() === task.title && editPriority === task.priority) {
      cancelEditing();
      return;
    }
    setTasks((prev) =>
      prev.map((t) =>
        t.id === editingId ? { ...t, title: editTitle.trim(), priority: editPriority } : t
      )
    );
    setEditingId(null);
    await apiPost({ action: "update", id: editingId, title: editTitle.trim(), priority: editPriority });
  };

  const cyclePriority = () => {
    const idx = priorityCycle.indexOf(editPriority);
    setEditPriority(priorityCycle[(idx + 1) % priorityCycle.length]);
  };

  // ─── Folder CRUD ──────────────────────────────────────────

  const addFolder = async () => {
    const name = newFolderName.trim();
    if (!name) return;
    await apiPost({ action: "addFolder", name });
    setNewFolderName("");
    setAddingFolder(false);
  };

  const renameFolder = async () => {
    const name = editFolderName.trim();
    if (!editingFolderId || !name) return;
    await apiPost({ action: "renameFolder", id: editingFolderId, name });
    setEditingFolderId(null);
    setEditFolderName("");
  };

  const deleteFolder = async (id: string) => {
    if (activeFolder === id) setActiveFolder(null);
    setFolders((prev) => prev.filter((f) => f.id !== id));
    setTasks((prev) => prev.map((t) => (t.folder === id ? { ...t, folder: undefined } : t)));
    await apiPost({ action: "deleteFolder", id });
    setFolderMenuId(null);
  };

  const updateFolderCwd = async (id: string, cwd: string) => {
    setFolders((prev) =>
      prev.map((f) => (f.id === id ? { ...f, cwd: cwd || undefined } : f))
    );
    await apiPost({ action: "updateFolder", id, cwd });
  };

  // ─── AI / OpenCode integration ─────────────────────────────
  const handleImplementWithOpenCode = (task: Task) => {
    const folder = task.folder ? folders.find((f) => f.id === task.folder) : null;
    setAiTerminalTask({ taskId: task.id, taskTitle: task.title, cwd: folder?.cwd, context: task.context });
  };

  const handleUpdateTask = async (id: string, updates: Partial<Pick<Task, "context" | "summary">>) => {
    // Optimistic update
    setTasks((prev) => prev.map((t) => t.id === id ? { ...t, ...updates } : t));
    await apiPost({ action: "update", id, ...updates });
  };

  const toggleTaskSelection = (taskId: string) => {
    setSelectedTaskIds((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  };

  const handleBatchLaunch = async () => {
    const toRun = tasks.filter((t) => selectedTaskIds.has(t.id) && !t.completed);
    // Launch all sessions in parallel
    await Promise.all(
      toRun.map((task) => {
        const folder = task.folder ? folders.find((f) => f.id === task.folder) : null;
        return createSession(task.id, task.title, folder?.cwd, task.context);
      })
    );
    setSelectedTaskIds(new Set());
    setSelectMode(false);
  };

  const handleExitSelectMode = () => {
    setSelectMode(false);
    setSelectedTaskIds(new Set());
  };

  // ─── Drag & drop between folders ───────────────────────────

  const handleTaskDragStart = (e: React.DragEvent, taskId: string) => {
    e.dataTransfer.setData("text/plain", taskId);
    e.dataTransfer.effectAllowed = "move";
    setDragTaskId(taskId);
  };

  const handleTaskDragEnd = () => {
    setDragTaskId(null);
    setDropTargetFolder(null);
  };

  const handleFolderDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const handleFolderDragEnter = (e: React.DragEvent, folderId: string | "all") => {
    e.preventDefault();
    setDropTargetFolder(folderId);
  };

  const handleFolderDragLeave = (e: React.DragEvent) => {
    // Only clear if we're actually leaving the element (not entering a child)
    const related = e.relatedTarget as HTMLElement | null;
    if (!related || !e.currentTarget.contains(related)) {
      setDropTargetFolder(null);
    }
  };

  const handleFolderDrop = async (e: React.DragEvent, folderId: string | "all") => {
    e.preventDefault();
    const taskId = e.dataTransfer.getData("text/plain");
    if (!taskId) return;

    const newFolder = folderId === "all" ? undefined : folderId;
    const task = tasks.find((t) => t.id === taskId);
    if (!task || task.folder === (newFolder || undefined)) {
      // No change needed
      setDragTaskId(null);
      setDropTargetFolder(null);
      return;
    }

    // Optimistic update
    setTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, folder: newFolder } : t))
    );
    setDragTaskId(null);
    setDropTargetFolder(null);

    await apiPost({ action: "update", id: taskId, folder: newFolder || "" });
  };

  // ─── Derived data ─────────────────────────────────────────

  const filteredTasks = (() => {
    let result = activeFolder
      ? tasks.filter((t) => t.folder === activeFolder)
      : tasks;
    if (filterQuery) {
      const q = filterQuery.toLowerCase();
      result = result.filter((t) =>
        t.title.toLowerCase().includes(q) ||
        t.priority.toLowerCase().includes(q)
      );
    }
    return result;
  })();
  const activeTasks = filteredTasks.filter((t) => !t.completed);
  const completedTasks = filteredTasks.filter((t) => t.completed);
  const completedCount = filteredTasks.filter((t) => t.completed).length;

  const folderCounts = new Map<string | null, number>();
  folderCounts.set(null, tasks.length);
  for (const f of folders) {
    folderCounts.set(f.id, tasks.filter((t) => t.folder === f.id).length);
  }

  // ─── Render helpers ───────────────────────────────────────

  const renderTask = (task: Task, isCompleted: boolean) => {
    const isEditing = editingId === task.id;

    if (isEditing) {
      return (
        <div
          key={task.id}
          className="flex items-start gap-2 p-2 rounded-lg bg-muted/50 border border-border"
        >
          <input
            ref={editInputRef}
            type="text"
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") saveEdit();
              if (e.key === "Escape") cancelEditing();
            }}
            className="flex-1 min-w-0 text-sm bg-transparent border-none outline-none placeholder:text-muted-foreground"
          />
          <button onClick={cyclePriority} title="Cycle priority">
            <Badge
              variant="secondary"
              className={cn("text-[10px] shrink-0 cursor-pointer hover:opacity-80", priorityColors[editPriority])}
            >
              {editPriority}
            </Badge>
          </button>
          <button
            onClick={saveEdit}
            className="text-green-600 hover:text-green-500 p-0.5 transition-colors"
            title="Save"
          >
            <Check className="h-3 w-3" />
          </button>
          <button
            onClick={cancelEditing}
            className="text-muted-foreground hover:text-foreground p-0.5 transition-colors"
            title="Cancel"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      );
    }

    const hasSession = openCodeSessions.has(task.id);
    const sessionAlive = hasSession && openCodeSessions.get(task.id)!.alive;

    return (
      <div
        key={task.id}
        draggable={!isEditing && !selectMode}
        onDragStart={(e) => handleTaskDragStart(e, task.id)}
        onDragEnd={handleTaskDragEnd}
        className={cn(
          "flex items-start gap-3 p-2 rounded-lg hover:bg-muted/50 transition-colors group",
          isCompleted && "opacity-50",
          dragTaskId === task.id && "opacity-30 scale-95",
          !isEditing && !selectMode && "cursor-grab active:cursor-grabbing",
          selectMode && !isCompleted && "cursor-pointer",
          selectMode && selectedTaskIds.has(task.id) && "bg-primary/5 ring-1 ring-primary/20"
        )}
        onClick={selectMode && !isCompleted ? () => toggleTaskSelection(task.id) : undefined}
      >
        {selectMode ? (
          !isCompleted ? (
            <button
              onClick={(e) => { e.stopPropagation(); toggleTaskSelection(task.id); }}
              className="mt-0.5 shrink-0"
            >
              {selectedTaskIds.has(task.id) ? (
                <CheckSquare className="h-4 w-4 text-primary" />
              ) : (
                <Square className="h-4 w-4 text-muted-foreground" />
              )}
            </button>
          ) : (
            <div className="w-4 shrink-0" />
          )
        ) : (
          <>
            <GripVertical className="h-3 w-3 mt-0.5 shrink-0 text-muted-foreground/40 opacity-0 group-hover:opacity-100 transition-opacity" />
            <Checkbox
              checked={task.completed}
              onCheckedChange={() => toggleTask(task.id)}
              className="mt-0.5"
            />
          </>
        )}
        {isCompleted ? (
          <p className="text-sm leading-tight flex-1 line-through text-muted-foreground">
            {task.title}
          </p>
        ) : (
          <div className="flex-1 min-w-0">
            <p
              className="text-sm leading-tight cursor-pointer hover:text-primary/80 transition-colors"
              onClick={() => !selectMode && setDetailTaskId(task.id)}
              onDoubleClick={() => !selectMode && startEditing(task)}
              title={selectMode ? "Click to select" : "Click for details, double-click to edit"}
            >
              {task.title}
            </p>
            {/* Show context/summary indicators */}
            {(task.context || task.summary) && (
              <div className="flex items-center gap-1.5 mt-0.5">
                {task.context && <FileText className="h-2.5 w-2.5 text-muted-foreground/50" />}
                {task.summary && <BookOpen className="h-2.5 w-2.5 text-green-500/60" />}
              </div>
            )}
          </div>
        )}
        {!isCompleted && (
          <Badge
            variant="secondary"
            className={cn("text-[10px] shrink-0", priorityColors[task.priority])}
          >
            {task.priority}
          </Badge>
        )}
        {/* Session indicator: green dot = alive, gray dot = exited */}
        {!selectMode && hasSession && (
          <button
            onClick={() => handleImplementWithOpenCode(task)}
            className={cn(
              "p-0.5 transition-colors",
              sessionAlive ? "text-green-500 hover:text-green-400" : "text-muted-foreground hover:text-foreground"
            )}
            title={sessionAlive ? "Attach to running OpenCode session" : "View exited session"}
          >
            <TerminalSquare className="h-3 w-3" />
          </button>
        )}
        {!selectMode && (
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-all">
            {!isCompleted && !hasSession && (
              <button
                onClick={() => handleImplementWithOpenCode(task)}
                className="text-muted-foreground hover:text-primary p-0.5 transition-colors"
                title="Implement with OpenCode"
              >
                <Sparkles className="h-3 w-3" />
              </button>
            )}
            {!isCompleted && (
              <button
                onClick={() => startEditing(task)}
                className="text-muted-foreground hover:text-foreground p-0.5 transition-colors"
                title="Edit"
              >
                <Pencil className="h-3 w-3" />
              </button>
            )}
            <button
              onClick={() => deleteTask(task.id)}
              className="text-muted-foreground hover:text-destructive p-0.5 transition-colors"
              title="Delete"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <>
    <WidgetWrapper
      title="Tasks"
      widgetType="tasks"
      icon={<ListTodo className="h-4 w-4" />}
      expandRequested={expandRequested}
      onExpandHandled={onExpandHandled}
      forceExpand={!!aiTerminalTask}
      sidePanel={
        aiTerminalTask ? (
          <OpenCodeTerminalPanel
            taskId={aiTerminalTask.taskId}
            taskTitle={aiTerminalTask.taskTitle}
            cwd={aiTerminalTask.cwd}
            context={aiTerminalTask.context}
            onClose={() => setAiTerminalTask(null)}
          />
        ) : undefined
      }
      headerAction={
        <div className="flex items-center gap-1">
          {selectMode ? (
            <>
              <button
                onClick={handleBatchLaunch}
                disabled={selectedTaskIds.size === 0}
                className={cn(
                  "transition-colors p-1 rounded-md",
                  selectedTaskIds.size > 0
                    ? "text-primary hover:bg-primary/10"
                    : "text-muted-foreground/40 cursor-not-allowed"
                )}
                title={`Run ${selectedTaskIds.size} selected with OpenCode`}
              >
                <Play className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={handleExitSelectMode}
                className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded-md hover:bg-muted"
                title="Cancel selection"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => setSelectMode(true)}
                className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded-md hover:bg-muted"
                title="Select tasks to run with OpenCode"
              >
                <Sparkles className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => { setShowFilter((v) => !v); if (showFilter) setFilterQuery(""); }}
                className={cn(
                  "text-muted-foreground hover:text-foreground transition-colors p-1 rounded-md hover:bg-muted",
                  showFilter && "text-primary bg-primary/10"
                )}
              >
                <Search className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => setShowAdd(!showAdd)}
                className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded-md hover:bg-muted"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </>
          )}
        </div>
      }
    >
      {/* Detail view for a specific task */}
      {detailTaskId && tasks.find((t) => t.id === detailTaskId) ? (
        <TaskDetailView
          task={tasks.find((t) => t.id === detailTaskId)!}
          onBack={() => setDetailTaskId(null)}
          onUpdateTask={handleUpdateTask}
        />
      ) : (
      <>
      {showFilter && (
        <div className="flex items-center gap-2 mb-2 shrink-0">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
            <input
              ref={filterInputRef}
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              placeholder="Filter tasks..."
              className="w-full h-7 text-xs rounded-md border border-border/50 bg-muted/30 pl-7 pr-7 placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
            />
            {filterQuery && (
              <button
                onClick={() => setFilterQuery("")}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>
      )}
      <div className="flex h-full overflow-hidden">
        {/* ─── Folder sidebar ─────────────────────────────── */}
        <div className="shrink-0 w-[110px] border-r border-border/50 flex flex-col overflow-hidden mr-2">
          <ScrollArea className="flex-1">
            <div className="pr-1 py-0.5 space-y-0.5">
              {/* All */}
              <button
                onClick={() => setActiveFolder(null)}
                onDragOver={handleFolderDragOver}
                onDragEnter={(e) => handleFolderDragEnter(e, "all")}
                onDragLeave={handleFolderDragLeave}
                onDrop={(e) => handleFolderDrop(e, "all")}
                className={cn(
                  "w-full flex items-center gap-1.5 px-2 py-1.5 rounded-md text-xs transition-colors text-left",
                  activeFolder === null
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
                  dropTargetFolder === "all" && dragTaskId && "ring-2 ring-primary bg-primary/15"
                )}
              >
                <Inbox className="h-3 w-3 shrink-0" />
                <span className="truncate flex-1">All</span>
                <span className="text-[10px] opacity-60">{folderCounts.get(null) || 0}</span>
              </button>

              {/* User folders */}
              {folders.map((folder) => (
                <div key={folder.id} className="relative">
                  {editingFolderId === folder.id ? (
                    <div className="flex items-center gap-0.5 px-1">
                      <input
                        ref={editFolderInputRef}
                        type="text"
                        value={editFolderName}
                        onChange={(e) => setEditFolderName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") renameFolder();
                          if (e.key === "Escape") { setEditingFolderId(null); setEditFolderName(""); }
                        }}
                        onBlur={renameFolder}
                        className="flex-1 min-w-0 text-xs bg-muted/50 border border-border rounded px-1.5 py-1 outline-none focus:ring-1 focus:ring-primary"
                      />
                    </div>
                  ) : (
                    <div
                      onClick={() => setActiveFolder(folder.id)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setActiveFolder(folder.id); } }}
                      onDragOver={handleFolderDragOver}
                      onDragEnter={(e) => handleFolderDragEnter(e, folder.id)}
                      onDragLeave={handleFolderDragLeave}
                      onDrop={(e) => handleFolderDrop(e, folder.id)}
                      className={cn(
                        "w-full flex items-center gap-1.5 px-2 py-1.5 rounded-md text-xs transition-colors text-left group/folder cursor-pointer",
                        activeFolder === folder.id
                          ? "bg-primary/10 text-primary font-medium"
                          : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
                        dropTargetFolder === folder.id && dragTaskId && "ring-2 ring-primary bg-primary/15"
                      )}
                    >
                      <Folder className="h-3 w-3 shrink-0" />
                      <span className="truncate flex-1">{folder.name}</span>
                      {folder.cwd && (
                        <span title={`Project: ${folder.cwd}`}>
                          <FolderCog className="h-2.5 w-2.5 shrink-0 text-primary/50" />
                        </span>
                      )}
                      <span className="text-[10px] opacity-60 group-hover/folder:hidden">
                        {folderCounts.get(folder.id) || 0}
                      </span>
                      <span
                        onClick={(e) => {
                          e.stopPropagation();
                          if (folderMenuId === folder.id) {
                            setFolderMenuId(null);
                            setFolderMenuPos(null);
                          } else {
                            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                            setFolderMenuPos({ top: rect.bottom + 4, left: rect.left });
                            setFolderMenuId(folder.id);
                          }
                        }}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); setFolderMenuId(folderMenuId === folder.id ? null : folder.id); } }}
                        className="hidden group-hover/folder:block text-muted-foreground hover:text-foreground p-0 cursor-pointer"
                      >
                        <MoreHorizontal className="h-3 w-3" />
                      </span>
                    </div>
                   )}

                </div>
              ))}

              {/* Add folder */}
              {addingFolder ? (
                <div className="px-1">
                  <input
                    ref={folderInputRef}
                    type="text"
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") addFolder();
                      if (e.key === "Escape") { setAddingFolder(false); setNewFolderName(""); }
                    }}
                    onBlur={() => {
                      if (newFolderName.trim()) addFolder();
                      else { setAddingFolder(false); setNewFolderName(""); }
                    }}
                    placeholder="Folder name"
                    className="w-full text-xs bg-muted/50 border border-border rounded px-1.5 py-1 outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground"
                  />
                </div>
              ) : (
                <button
                  onClick={() => setAddingFolder(true)}
                  className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded-md text-xs text-muted-foreground/60 hover:text-muted-foreground hover:bg-muted/30 transition-colors"
                >
                  <FolderPlus className="h-3 w-3 shrink-0" />
                  <span>New folder</span>
                </button>
              )}
            </div>
          </ScrollArea>

          {/* Folder cwd setting dialog */}
          {settingCwdFolderId && (
            <div className="border-t border-border/50 pt-1.5 mt-1 px-1">
              <p className="text-[10px] text-muted-foreground mb-1 truncate">
                Project path
              </p>
              <input
                ref={cwdInputRef}
                type="text"
                value={cwdInputValue}
                onChange={(e) => setCwdInputValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    updateFolderCwd(settingCwdFolderId, cwdInputValue.trim());
                    setSettingCwdFolderId(null);
                  }
                  if (e.key === "Escape") setSettingCwdFolderId(null);
                }}
                placeholder="/path/to/project"
                className="w-full text-[10px] bg-muted/50 border border-border rounded px-1.5 py-1 outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground font-mono"
              />
              <div className="flex items-center gap-1 mt-1">
                <button
                  onClick={() => {
                    updateFolderCwd(settingCwdFolderId, cwdInputValue.trim());
                    setSettingCwdFolderId(null);
                  }}
                  className="text-[10px] text-primary hover:underline"
                >
                  Save
                </button>
                <span className="text-muted-foreground/40">|</span>
                <button
                  onClick={() => setSettingCwdFolderId(null)}
                  className="text-[10px] text-muted-foreground hover:text-foreground"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ─── Tasks list ─────────────────────────────────── */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          {/* Add task form */}
          {showAdd && (
            <div className="mb-3 space-y-2">
              <input
                ref={inputRef}
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") addTask();
                  if (e.key === "Escape") setShowAdd(false);
                }}
                placeholder="What needs to be done?"
                className="w-full text-sm bg-muted/50 border border-border rounded-md px-3 py-1.5 placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <div className="flex items-center gap-2">
                <div className="flex gap-1">
                  {(["low", "medium", "high"] as const).map((p) => (
                    <button
                      key={p}
                      onClick={() => setNewPriority(p)}
                      className={cn(
                        "text-[10px] px-2 py-0.5 rounded-full border transition-colors capitalize",
                        newPriority === p
                          ? priorityColors[p] + " border-current"
                          : "border-border text-muted-foreground hover:border-foreground/30"
                      )}
                    >
                      {p}
                    </button>
                  ))}
                </div>
                <button
                  onClick={addTask}
                  disabled={!newTitle.trim()}
                  className="ml-auto text-xs bg-primary text-primary-foreground px-3 py-1 rounded-md hover:bg-primary/90 disabled:opacity-50 transition-colors"
                >
                  Add
                </button>
              </div>
            </div>
          )}

          {/* Progress */}
          {filteredTasks.length > 0 && (
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs text-muted-foreground">
                {completedCount}/{filteredTasks.length} done
              </span>
              <div className="h-1.5 flex-1 mx-3 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all duration-500"
                  style={{ width: `${filteredTasks.length > 0 ? (completedCount / filteredTasks.length) * 100 : 0}%` }}
                />
              </div>
            </div>
          )}

          {loading && tasks.length === 0 ? (
            <div className="flex items-center justify-center flex-1">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="flex items-center justify-center flex-1">
              <div className="flex flex-col items-center gap-2 text-muted-foreground text-center">
                <AlertCircle className="h-5 w-5 text-destructive" />
                <span className="text-xs">{error}</span>
              </div>
            </div>
          ) : filteredTasks.length === 0 ? (
            <div className="flex items-center justify-center flex-1 text-muted-foreground">
              <div className="text-center">
                <p className="text-sm">
                  {activeFolder ? "No tasks in this folder" : "No tasks yet"}
                </p>
                <button
                  onClick={() => setShowAdd(true)}
                  className="text-xs text-primary hover:underline mt-1"
                >
                  Add a task
                </button>
              </div>
            </div>
          ) : (
            <ScrollArea className="flex-1 -mx-1 px-1">
              <div className="space-y-1">
                {activeTasks.map((task) => renderTask(task, false))}
                {completedTasks.length > 0 && (
                  <>
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wider pt-2 pb-1 px-1">
                      Completed
                    </div>
                    {completedTasks.map((task) => renderTask(task, true))}
                  </>
                )}
              </div>
            </ScrollArea>
          )}
        </div>
      </div>
      </>
      )}
    </WidgetWrapper>

    {/* Folder context menu — rendered via portal to escape overflow:hidden */}
    {folderMenuId && folderMenuPos && (() => {
      const folder = folders.find((f) => f.id === folderMenuId);
      if (!folder) return null;
      return createPortal(
        <div
          data-folder-menu
          className="fixed z-[300] bg-popover border border-border rounded-md shadow-md py-1 min-w-[120px]"
          style={{ top: folderMenuPos.top, left: folderMenuPos.left }}
        >
          <button
            onClick={() => {
              setEditingFolderId(folder.id);
              setEditFolderName(folder.name);
              setFolderMenuId(null);
              setFolderMenuPos(null);
            }}
            className="w-full text-left px-3 py-1.5 text-xs hover:bg-muted transition-colors flex items-center gap-2"
          >
            <Pencil className="h-3 w-3" /> Rename
          </button>
          <button
            onClick={() => {
              setSettingCwdFolderId(folder.id);
              setCwdInputValue(folder.cwd || "");
              setFolderMenuId(null);
              setFolderMenuPos(null);
            }}
            className="w-full text-left px-3 py-1.5 text-xs hover:bg-muted transition-colors flex items-center gap-2"
          >
            <FolderCog className="h-3 w-3" /> Project path
          </button>
          <button
            onClick={() => {
              deleteFolder(folder.id);
              setFolderMenuPos(null);
            }}
            className="w-full text-left px-3 py-1.5 text-xs hover:bg-muted text-destructive transition-colors flex items-center gap-2"
          >
            <Trash2 className="h-3 w-3" /> Delete
          </button>
        </div>,
        document.body
      );
    })()}

    </>
  );
}
