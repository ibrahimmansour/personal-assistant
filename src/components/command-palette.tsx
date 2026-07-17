"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useTheme } from "next-themes";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { useDashboard } from "@/components/dashboard-context";
import {
  useProfile,
  profiles,
  type ProfileId,
} from "@/components/profile-context";
import {
  useAppearance,
  colorThemes,
  fontFamilies,
  fontSizes,
} from "@/components/appearance-context";
import { useWidgetNav } from "@/components/widget-nav-context";
import { useCommandPalette } from "@/components/command-palette-context";
import { useWorkspace } from "@/components/workspace-context";
import {
  ListTodo,
  Mail,
  Bell,
  Calendar,
  CloudSun,
  GitPullRequest,
  Clock,
  TicketCheck,
  StickyNote,
  TerminalSquare,
  Bookmark,
  FolderOpen,
  Maximize2,
  LayoutGrid,
  RotateCcw,
  Briefcase,
  Home,
  Sun,
  Moon,
  Monitor,
  Type,
  Search,
  CheckCircle2,
  Circle,
  Pin,
  File,
  FileText,
  FileCode,
  FileJson,
  FileImage,
  FileVideo,
  FileAudio,
  FileArchive,
  Folder,
  X,
  LayoutDashboard,
  Code,
  Focus,
  PanelLeft,
  LogOut,
  Sunrise,
  Inbox,
  Activity,
  Sparkles,
  Play,
  Loader2,
  Bot,
  AArrowUp,
  AArrowDown,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Icon registries ─────────────────────────────────────────────────────────

const widgetIcons: Record<
  string,
  React.ComponentType<{ className?: string }>
> = {
  clock: Clock,
  tasks: ListTodo,
  email: Mail,
  reminders: Bell,
  calendar: Calendar,
  weather: CloudSun,
  "github-prs": GitPullRequest,
  jira: TicketCheck,
  notes: StickyNote,
  terminal: TerminalSquare,
  bookmarks: Bookmark,
  files: FolderOpen,
};

const profileIcons: Record<
  string,
  React.ComponentType<{ className?: string }>
> = {
  briefcase: Briefcase,
  home: Home,
};

const workspaceIcons: Record<
  string,
  React.ComponentType<{ className?: string }>
> = {
  "layout-dashboard": LayoutDashboard,
  code: Code,
  mail: Mail,
  "sticky-note": StickyNote,
  sunrise: Sunrise,
  inbox: Inbox,
  activity: Activity,
};

// ─── File type helpers for command palette icons ─────────────────────────────

const cpCodeExts = new Set([
  ".js", ".ts", ".tsx", ".jsx", ".py", ".rb", ".go", ".rs",
  ".java", ".c", ".cpp", ".h", ".hpp", ".swift", ".kt",
  ".css", ".scss", ".html", ".xml", ".vue", ".svelte",
  ".sh", ".bash", ".zsh", ".fish", ".mjs", ".cjs",
]);
const cpImageExts = new Set([".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".ico", ".bmp"]);
const cpVideoExts = new Set([".mp4", ".mov", ".avi", ".mkv", ".webm"]);
const cpAudioExts = new Set([".mp3", ".wav", ".flac", ".ogg", ".aac", ".m4a"]);
const cpArchiveExts = new Set([".zip", ".tar", ".gz", ".rar", ".7z", ".bz2"]);

function getFileIcon(ext: string, isDir: boolean): React.ComponentType<{ className?: string }> {
  if (isDir) return Folder;
  if (ext === ".json") return FileJson;
  if (cpCodeExts.has(ext)) return FileCode;
  if (cpImageExts.has(ext)) return FileImage;
  if (cpVideoExts.has(ext)) return FileVideo;
  if (cpAudioExts.has(ext)) return FileAudio;
  if (cpArchiveExts.has(ext)) return FileArchive;
  if (ext === ".md" || ext === ".txt" || ext === ".log") return FileText;
  return File;
}

/** Shorten path for display (replace homedir with ~) */
function shortenPath(fullPath: string): string {
  return fullPath.replace(/^\/Users\/[^/]+/, "~");
}

// ─── Unified search result type ──────────────────────────────────────────────

interface SearchResult {
  id: string;
  group: string;
  title: string;
  subtitle?: string;
  keywords: string[];
  icon: React.ComponentType<{ className?: string }>;
  /** Widget type to navigate to */
  widgetType: string;
  /** Item ID within the widget (e.g., email id, PR id, file path) */
  itemId?: string;
  /** If true, this result came from a server-side search and should bypass cmdk filtering */
  serverSearchResult?: boolean;
}

// ─── Data cache ──────────────────────────────────────────────────────────────

interface CachedData {
  results: SearchResult[];
  timestamp: number;
  profile: ProfileId;
}

const CACHE_TTL = 60_000; // 60 seconds

// ─── Fetchers ────────────────────────────────────────────────────────────────

async function fetchEmails(profile: ProfileId): Promise<SearchResult[]> {
  try {
    const endpoint =
      profile === "work" ? "/api/outlook/emails" : "/api/google/emails";
    // Fetch up to 500 emails (light format, disk-cached) for comprehensive search
    const res = await fetch(`${endpoint}?limit=500`);
    const data = await res.json();
    if (data.error || data.authRequired || !data.emails) return [];
    return data.emails.map(
      (e: {
        id: string;
        from: string;
        fromAddress: string;
        subject: string;
        preview: string;
      }) => ({
        id: `email-${e.id}`,
        group: "Emails",
        title: e.subject || "(no subject)",
        subtitle: e.from,
        keywords: [
          "email",
          "mail",
          e.from,
          e.fromAddress,
          e.subject,
          e.preview,
        ].filter(Boolean),
        icon: Mail,
        widgetType: "email",
        itemId: e.id,
      })
    );
  } catch {
    return [];
  }
}

async function fetchPRs(profile: ProfileId): Promise<SearchResult[]> {
  try {
    const res = await fetch(`/api/github/prs?profile=${profile}`);
    const data = await res.json();
    if (data.error || !data.prs) return [];
    return data.prs.map(
      (pr: {
        id: string;
        title: string;
        repo: string;
        repoShort: string;
        number: number;
        status: string;
        headBranch: string;
        labels: { name: string }[];
      }) => ({
        id: `pr-${pr.id}`,
        group: "Pull Requests",
        title: pr.title,
        subtitle: `${pr.repoShort} #${pr.number} (${pr.status})`,
        keywords: [
          "pr",
          "pull request",
          "github",
          pr.repo,
          pr.repoShort,
          pr.status,
          pr.headBranch,
          ...(pr.labels?.map((l) => l.name) ?? []),
        ].filter(Boolean),
        icon: GitPullRequest,
        widgetType: "github-prs",
        itemId: pr.id,
      })
    );
  } catch {
    return [];
  }
}

async function fetchCalendarEvents(
  profile: ProfileId
): Promise<SearchResult[]> {
  try {
    const endpoint =
      profile === "work" ? "/api/outlook/calendar" : "/api/google/calendar";
    const res = await fetch(endpoint);
    const data = await res.json();
    if (data.error || data.authRequired || !data.events) return [];
    return data.events.slice(0, 20).map(
      (ev: {
        id: string;
        title: string;
        start: string;
        location: string;
        organizer: string;
      }) => ({
        id: `cal-${ev.id}`,
        group: "Calendar",
        title: ev.title,
        subtitle: [ev.start, ev.location].filter(Boolean).join(" - "),
        keywords: [
          "calendar",
          "meeting",
          "event",
          ev.title,
          ev.location,
          ev.organizer,
        ].filter(Boolean),
        icon: Calendar,
        widgetType: "calendar",
        itemId: ev.id,
      })
    );
  } catch {
    return [];
  }
}

async function fetchTasks(profile: ProfileId): Promise<SearchResult[]> {
  try {
    const res = await fetch(`/api/tasks?profile=${profile}`);
    const data = await res.json();
    if (data.error || !data.tasks) return [];
    return data.tasks.map(
      (t: {
        id: string;
        title: string;
        completed: boolean;
        priority: string;
      }) => ({
        id: `task-${t.id}`,
        group: "Tasks",
        title: t.title,
        subtitle: `${t.priority} priority${t.completed ? " (done)" : ""}`,
        keywords: ["task", "todo", t.title, t.priority].filter(Boolean),
        icon: t.completed ? CheckCircle2 : Circle,
        widgetType: "tasks",
        itemId: t.id,
      })
    );
  } catch {
    return [];
  }
}

async function fetchNotes(profile: ProfileId): Promise<SearchResult[]> {
  try {
    const res = await fetch(`/api/notes?profile=${profile}`);
    const data = await res.json();
    if (data.error || !data.notes) return [];
    return data.notes.map(
      (n: {
        id: string;
        title: string;
        content: string;
        pinned: boolean;
      }) => {
        const plainText = n.content
          .replace(/<[^>]*>/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 200);
        return {
          id: `note-${n.id}`,
          group: "Notes",
          title: n.title || "Untitled",
          subtitle: plainText.slice(0, 80) || undefined,
          keywords: ["note", n.title, plainText].filter(Boolean),
          icon: n.pinned ? Pin : StickyNote,
          widgetType: "notes",
          itemId: n.id,
        };
      }
    );
  } catch {
    return [];
  }
}

async function fetchBookmarks(profile: ProfileId): Promise<SearchResult[]> {
  try {
    const res = await fetch(
      `/api/browser?type=bookmarks&profile=${profile}`
    );
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    return data.map(
      (b: { id: string; title: string; url: string; category: string }) => ({
        id: `bm-${b.id}`,
        group: "Bookmarks",
        title: b.title,
        subtitle: b.url,
        keywords: ["bookmark", "link", b.title, b.url, b.category].filter(
          Boolean
        ),
        icon: Bookmark,
        widgetType: "bookmarks",
        // For bookmarks, open URL directly since bookmarks widget has no detail view
        itemId: b.url,
      })
    );
  } catch {
    return [];
  }
}

async function fetchJiraIssues(profile: ProfileId): Promise<SearchResult[]> {
  if (profile !== "work") return [];
  try {
    const res = await fetch("/api/jira");
    const data = await res.json();
    if (data.error || data.authRequired || !data.issues) return [];
    return data.issues.map(
      (i: {
        key: string;
        summary: string;
        status: string;
        priority: string;
        type: string;
        project: string;
      }) => ({
        id: `jira-${i.key}`,
        group: "Jira",
        title: `${i.key}: ${i.summary}`,
        subtitle: `${i.status} - ${i.type} (${i.priority})`,
        keywords: [
          "jira",
          "issue",
          "ticket",
          i.key,
          i.summary,
          i.status,
          i.priority,
          i.type,
          i.project,
        ].filter(Boolean),
        icon: TicketCheck,
        widgetType: "jira",
        itemId: i.key,
      })
    );
  } catch {
    return [];
  }
}

// ─── Widget type → group name mapping ────────────────────────────────────────

const widgetTypeToGroup: Record<string, string> = {
  email: "Emails",
  "github-prs": "Pull Requests",
  calendar: "Calendar",
  jira: "Jira",
  tasks: "Tasks",
  notes: "Notes",
  bookmarks: "Bookmarks",
  files: "Files",
  reminders: "Calendar", // reminders share calendar data
};

// ─── AI types & helpers ──────────────────────────────────────────────────────

interface AIAction {
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

/** Extract a JSON action block from AI response text */
function parseAIAction(text: string): AIAction | null {
  // Look for ```json ... ``` code fence
  const fenceMatch = text.match(/```json\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1].trim());
    } catch {
      return null;
    }
  }
  // Fallback: look for raw JSON object at the end
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
function stripActionJson(text: string): string {
  return text.replace(/\n*```json\s*\n?[\s\S]*?\n?\s*```\s*$/, "").trim();
}

/** Human-readable label for an AI action */
function actionLabel(action: AIAction): string {
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

// ─── Component ───────────────────────────────────────────────────────────────

export function CommandPalette() {
  const { open, filterWidget, setOpen, closeSearch, clearFilter, collapseAllWidgets } = useCommandPalette();
  const [search, setSearch] = useState("");
  const [widgetData, setWidgetData] = useState<SearchResult[]>([]);
  const [fileResults, setFileResults] = useState<SearchResult[]>([]);
  const [emailSearchResults, setEmailSearchResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [fileSearching, setFileSearching] = useState(false);
  const [emailSearching, setEmailSearching] = useState(false);

  // ─── AI mode state ────────────────────────────────────────────────────
  const [aiResponse, setAiResponse] = useState("");
  const [aiAction, setAiAction] = useState<AIAction | null>(null);
  const [aiStreaming, setAiStreaming] = useState(false);
  const [aiAvailable, setAiAvailable] = useState<boolean | null>(null);
  const aiAbortRef = useRef<AbortController | null>(null);
  const aiResponseRef = useRef<HTMLDivElement>(null);
  const cacheRef = useRef<CachedData | null>(null);
  const fileSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const emailSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { widgets, ensureWidgetVisible, resetLayout, autoArrange } =
    useDashboard();
  const { activeProfile, setActiveProfile } = useProfile();
  const { appearance, setColorTheme, setFontFamily, setFontSize, increaseFontSize, decreaseFontSize } = useAppearance();
  const { theme, setTheme } = useTheme();
  const { navigateTo } = useWidgetNav();
  const {
    workspaces,
    activeWorkspace,
    setActiveWorkspace,
    focusCombos,
    activeFocusId,
    enterFocusMode,
    exitFocusMode,
    sidebarExpanded,
    toggleSidebar,
  } = useWorkspace();

  // The active filter group name (e.g. "Emails", "Tasks", etc.)
  const filterGroup = filterWidget ? widgetTypeToGroup[filterWidget] || null : null;

  // Determine which widget types are enabled
  const enabledWidgets = new Set(
    widgets.filter((w) => w.visible).map((w) => w.type)
  );

  // ─── AI mode detection ──────────────────────────────────────────────────
  const isAiMode = search.startsWith(">");
  const aiQuery = isAiMode ? search.slice(1).trim() : "";

  // Check AI availability on mount
  useEffect(() => {
    fetch("/api/ai")
      .then((r) => r.json())
      .then((d) => setAiAvailable(d.available))
      .catch(() => setAiAvailable(false));
  }, []);

  // Reset AI state when closing or leaving AI mode
  useEffect(() => {
    if (!open || !isAiMode) {
      if (aiAbortRef.current) aiAbortRef.current.abort();
      setAiResponse("");
      setAiAction(null);
      setAiStreaming(false);
    }
  }, [open, isAiMode]);

  // AI query submission
  const submitAiQuery = useCallback(async () => {
    if (!aiQuery || aiStreaming) return;

    // Abort any previous request
    if (aiAbortRef.current) aiAbortRef.current.abort();
    const abortController = new AbortController();
    aiAbortRef.current = abortController;

    setAiResponse("");
    setAiAction(null);
    setAiStreaming(true);

    // Build live data summaries from cached widget data
    const cachedResults = cacheRef.current?.results || widgetData;
    const taskItems = cachedResults.filter((r) => r.group === "Tasks");
    const calItems = cachedResults.filter((r) => r.group === "Calendar");
    const prItems = cachedResults.filter((r) => r.group === "Pull Requests");
    const emailItems = cachedResults.filter((r) => r.group === "Emails");
    const jiraItems = cachedResults.filter((r) => r.group === "Jira");

    // Send ALL items so the model can count accurately — titles are short strings
    const taskSummary = taskItems.length > 0
      ? `Tasks (${taskItems.length}):\n${taskItems.map((t) => `- ${t.title}${t.subtitle ? ` [${t.subtitle}]` : ""}`).join("\n")}`
      : undefined;
    const calendarSummary = calItems.length > 0
      ? `Calendar events today (${calItems.length}):\n${calItems.map((e) => `- ${e.title} (${e.subtitle})`).join("\n")}`
      : undefined;
    const prSummary = prItems.length > 0
      ? `Pull Requests (${prItems.length}):\n${prItems.map((p) => `- ${p.title} [${p.subtitle}]`).join("\n")}`
      : undefined;
    const emailSummary = emailItems.length > 0
      ? `Recent emails (${emailItems.length} loaded):\n${emailItems.slice(0, 10).map((e) => `- "${e.title}" from ${e.subtitle}`).join("\n")}`
      : undefined;
    const jiraSummary = jiraItems.length > 0
      ? `Jira issues (${jiraItems.length}):\n${jiraItems.map((j) => `- ${j.title} [${j.subtitle}]`).join("\n")}`
      : undefined;

    try {
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: aiQuery,
          profile: activeProfile,
          context: {
            time: new Date().toLocaleString(),
            workspace: activeWorkspace.id,
            widgets: widgets.filter((w) => w.visible).map((w) => w.type),
            taskSummary,
            calendarSummary,
            prSummary,
            emailSummary,
            jiraSummary,
          },
        }),
        signal: abortController.signal,
      });

      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({ error: "Request failed" }));
        setAiResponse(err.error || "Something went wrong.");
        setAiStreaming(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";
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
              setAiResponse(accumulated);
              // Auto-scroll response area
              if (aiResponseRef.current) {
                aiResponseRef.current.scrollTop = aiResponseRef.current.scrollHeight;
              }
            }
            if (parsed.done) {
              // Parse action from completed response
              const action = parseAIAction(accumulated);
              if (action) setAiAction(action);
            }
            if (parsed.error) {
              setAiResponse(parsed.error);
            }
          } catch {
            // skip malformed lines
          }
        }
      }

      // Final parse in case done was in the last buffer
      if (!aiAction) {
        const action = parseAIAction(accumulated);
        if (action) setAiAction(action);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setAiResponse("Failed to connect to AI. Is Ollama running?");
    } finally {
      setAiStreaming(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiQuery, aiStreaming, activeProfile, activeWorkspace.id, widgets, aiAction]);

  // Execute an AI action
  const executeAiAction = useCallback((action: AIAction) => {
    closeSearch();

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
          setTimeout(() => navigateTo(
            action.widget as Parameters<typeof navigateTo>[0],
            undefined,
            action.query || undefined,
          ), 100);
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
  }, [
    closeSearch, widgets, activeWorkspace, setActiveWorkspace,
    activeFocusId, exitFocusMode, ensureWidgetVisible, navigateTo,
    setActiveProfile, setTheme, focusCombos, enterFocusMode, activeProfile,
  ]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "p") {
        e.preventDefault();
        // Exit fullscreen first so the portaled dialog is visible
        if (document.fullscreenElement && typeof document.exitFullscreen === "function") {
          try {
            const result = document.exitFullscreen();
            if (result && typeof result.catch === "function") result.catch(() => {});
          } catch {
            /* ignore patched/throwing fullscreen APIs (e.g. Windowed extension) */
          }
        }
        setOpen(!open);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, setOpen]);

  // ─── Fetch widget data on open ──────────────────────────────────────────

  useEffect(() => {
    if (!open) {
      setSearch("");
      setFileResults([]);
      setEmailSearchResults([]);
      setEmailSearching(false);
      return;
    }

    // Use cache if fresh and same profile
    if (
      cacheRef.current &&
      cacheRef.current.profile === activeProfile &&
      Date.now() - cacheRef.current.timestamp < CACHE_TTL
    ) {
      setWidgetData(cacheRef.current.results);
      return;
    }

    let cancelled = false;
    setLoading(true);

    const fetchers: Promise<SearchResult[]>[] = [];

    if (enabledWidgets.has("email"))
      fetchers.push(fetchEmails(activeProfile));
    if (enabledWidgets.has("github-prs"))
      fetchers.push(fetchPRs(activeProfile));
    if (enabledWidgets.has("calendar"))
      fetchers.push(fetchCalendarEvents(activeProfile));
    if (enabledWidgets.has("tasks"))
      fetchers.push(fetchTasks(activeProfile));
    if (enabledWidgets.has("notes"))
      fetchers.push(fetchNotes(activeProfile));
    if (enabledWidgets.has("bookmarks"))
      fetchers.push(fetchBookmarks(activeProfile));
    if (enabledWidgets.has("jira"))
      fetchers.push(fetchJiraIssues(activeProfile));

    Promise.all(fetchers).then((results) => {
      if (cancelled) return;
      const allResults = results.flat();
      setWidgetData(allResults);
      cacheRef.current = {
        results: allResults,
        timestamp: Date.now(),
        profile: activeProfile,
      };
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, activeProfile]);

  // ─── Debounced file system search ───────────────────────────────────────

  useEffect(() => {
    if (!open) return;

    if (fileSearchTimerRef.current) {
      clearTimeout(fileSearchTimerRef.current);
    }

    const query = search.trim();
    if (query.length < 2) {
      setFileResults([]);
      setFileSearching(false);
      return;
    }

    setFileSearching(true);
    fileSearchTimerRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/files?search=${encodeURIComponent(query)}`
        );
        const data = await res.json();
        if (data.results) {
          setFileResults(
            data.results.slice(0, 50).map(
              (f: {
                name: string;
                path: string;
                isDirectory: boolean;
                extension: string;
                matchLine?: string;
                matchLineNumber?: number;
              }) => ({
                id: `file-${f.path}`,
                group: "Files",
                title: f.isDirectory ? `${f.name}/` : f.name,
                subtitle: shortenPath(f.path),
                keywords: ["file", "folder", f.name, f.path].filter(Boolean),
                icon: getFileIcon(f.extension, f.isDirectory),
                widgetType: "files",
                itemId: f.path,
              })
            )
          );
        }
      } catch {
        // ignore
      }
      setFileSearching(false);
    }, 150);

    return () => {
      if (fileSearchTimerRef.current) {
        clearTimeout(fileSearchTimerRef.current);
      }
    };
  }, [search, open]);

  // ─── Debounced server-side email search (full mailbox) ──────────────────

  useEffect(() => {
    if (!open) return;

    if (emailSearchTimerRef.current) {
      clearTimeout(emailSearchTimerRef.current);
    }

    const query = search.trim();
    if (query.length < 2) {
      setEmailSearchResults([]);
      setEmailSearching(false);
      return;
    }

    // Only search if email widget is enabled
    if (!enabledWidgets.has("email")) return;

    setEmailSearching(true);
    emailSearchTimerRef.current = setTimeout(async () => {
      try {
        const endpoint =
          activeProfile === "work"
            ? "/api/outlook/emails/search"
            : "/api/google/emails/search";
        const res = await fetch(
          `${endpoint}?q=${encodeURIComponent(query)}`
        );
        const data = await res.json();
        if (data.emails) {
          setEmailSearchResults(
            data.emails.map(
              (e: {
                id: string;
                from: string;
                fromAddress: string;
                subject: string;
                preview: string;
              }) => ({
                id: `email-${e.id}`,
                group: "Emails",
                title: e.subject || "(no subject)",
                subtitle: e.from,
                keywords: [
                  "__server__",
                  "email",
                  "mail",
                  e.from,
                  e.fromAddress,
                  e.subject,
                  e.preview,
                ].filter(Boolean),
                icon: Mail,
                widgetType: "email",
                itemId: e.id,
                serverSearchResult: true,
              })
            )
          );
        }
      } catch {
        // ignore — local results still available
      }
      setEmailSearching(false);
    }, 400);

    return () => {
      if (emailSearchTimerRef.current) {
        clearTimeout(emailSearchTimerRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, open, activeProfile]);

  // ─── Group widget data results ──────────────────────────────────────────

  // Merge local widget data with server-side email search results.
  // When server search completes, its results REPLACE local email matches
  // because the server searched the entire mailbox and knows better.
  // Deduplicate by email ID to avoid showing the same email twice.
  const mergedWidgetData = (() => {
    if (emailSearchResults.length === 0) return widgetData;

    const localNonEmail = widgetData.filter((item) => item.group !== "Emails");
    // Server results replace local email results entirely
    const seenIds = new Set(emailSearchResults.map((e) => e.id));
    // Keep local emails that aren't in server results (edge case: server didn't find them but local filter did)
    const localOnlyEmails = widgetData
      .filter((item) => item.group === "Emails" && !seenIds.has(item.id));
    return [...localNonEmail, ...emailSearchResults, ...localOnlyEmails];
  })();

  // When filtering by widget, only include that group's data
  const filteredWidgetData = filterGroup
    ? mergedWidgetData.filter((item) => item.group === filterGroup)
    : mergedWidgetData;
  const filteredFileResults = filterGroup === "Files" ? fileResults : (filterGroup ? [] : fileResults);

  const allSearchableData = [...filteredWidgetData, ...filteredFileResults];

  const groupedData = allSearchableData.reduce<
    Record<string, SearchResult[]>
  >((acc, item) => {
    if (!acc[item.group]) acc[item.group] = [];
    acc[item.group].push(item);
    return acc;
  }, {});

  // Ordered groups — widget-native content first, heavy/external data last
  const groupOrder = [
    "Tasks",
    "Notes",
    "Bookmarks",
    "Calendar",
    "Pull Requests",
    "Jira",
    "Emails",
    "Files",
  ];
  const orderedGroups = groupOrder.filter((g) => groupedData[g]?.length);

  const hasSearch = search.trim().length > 0;
  // When filtered, show data results immediately (no need to type first)
  const showDataResults = hasSearch || !!filterGroup;

  const handleSelect = useCallback(
    (item: SearchResult) => {
      closeSearch();

      // Ensure we're on a workspace that shows this widget
      const targetWidgetId = widgets.find((w) => w.type === item.widgetType)?.id;
      const wsHasWidget = targetWidgetId && activeWorkspace.widgetIds.includes(targetWidgetId);
      if (!wsHasWidget || activeWorkspace.viewType) {
        // Switch to Dashboard which has all widgets
        setActiveWorkspace("dashboard");
      }
      if (activeFocusId) exitFocusMode();

      // Collapse any currently expanded widget before navigating to the new one
      collapseAllWidgets();

      // For bookmarks, open URL directly (no detail view in widget)
      if (item.widgetType === "bookmarks" && item.itemId) {
        // Ensure widget is visible and expand it, then open the URL
        const widgetConfig = widgets.find((w) => w.type === item.widgetType);
        if (widgetConfig) ensureWidgetVisible(widgetConfig.id);
        window.open(item.itemId, "_blank", "noopener");
        return;
      }

      // For all other widgets: ensure visible, then navigate
      const widgetConfig = widgets.find((w) => w.type === item.widgetType);
      if (widgetConfig) {
        ensureWidgetVisible(widgetConfig.id);
      }

      // Use a small delay to ensure the widget is rendered before navigating
      setTimeout(() => {
        navigateTo(
          item.widgetType as Parameters<typeof navigateTo>[0],
          item.itemId
        );
      }, 100);
    },
    [widgets, ensureWidgetVisible, navigateTo, closeSearch, activeWorkspace, setActiveWorkspace, activeFocusId, exitFocusMode, collapseAllWidgets]
  );

  const runAndClose = useCallback((fn: () => void) => {
    fn();
    closeSearch();
  }, [closeSearch]);

  // ─── Render ─────────────────────────────────────────────────────────────

  // Find the widget title for the filter badge
  const filterWidgetTitle = filterWidget
    ? widgets.find((w) => w.type === filterWidget)?.title || filterWidget
    : null;

  return (
    <CommandDialog
      open={open}
      onOpenChange={(nextOpen) => setOpen(nextOpen)}
      className="sm:max-w-xl"
    >
      <Command
        loop
        filter={(value, search, keywords) => {
          // In AI mode, don't filter anything — we handle it ourselves
          if (search.startsWith(">")) return 1;
          // Server-side search results are pre-filtered — always show them
          if (keywords?.includes("__server__")) return 1;
          const target = [value, ...(keywords ?? [])].join(" ").toLowerCase();
          const terms = search.toLowerCase().split(/\s+/);
          return terms.every((t) => target.includes(t)) ? 1 : 0;
        }}
      >
        {/* Filter badge + search input */}
        {filterWidgetTitle ? (
          <div className="flex items-center border-b border-border px-3">
            <button
              onClick={clearFilter}
              className="shrink-0 flex items-center gap-1 text-[11px] font-medium bg-primary/10 text-primary border border-primary/20 rounded-md px-2 py-0.5 mr-2 hover:bg-primary/20 transition-colors"
              title="Clear filter"
            >
              {(() => { const Icon = widgetIcons[filterWidget!] || Search; return <Icon className="h-3 w-3" />; })()}
              {filterWidgetTitle}
              <X className="h-2.5 w-2.5 ml-0.5" />
            </button>
            <CommandInput
              placeholder={`Search in ${filterWidgetTitle}...`}
              value={search}
              onValueChange={setSearch}
              className="border-0"
            />
          </div>
        ) : (
          <div className="flex items-center">
            {isAiMode && (
              <div className="pl-3 shrink-0">
                <Sparkles className="h-4 w-4 text-primary" />
              </div>
            )}
            <CommandInput
              placeholder={isAiMode ? "Ask AI anything about your dashboard..." : "Search or type > to ask AI..."}
              value={search}
              onValueChange={setSearch}
              onKeyDown={(e) => {
                if (e.key === "Enter" && isAiMode && aiQuery) {
                  e.preventDefault();
                  submitAiQuery();
                }
              }}
              className={cn(isAiMode && "pl-1")}
            />
            {isAiMode && aiQuery && (
              <button
                onClick={submitAiQuery}
                disabled={aiStreaming}
                className="shrink-0 mr-3 p-1 rounded-md text-primary hover:bg-primary/10 transition-colors disabled:opacity-50"
                title="Send to AI (Enter)"
              >
                {aiStreaming ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
              </button>
            )}
          </div>
        )}

        {/* ─── AI mode content ──────────────────────────────── */}
        {isAiMode ? (
          <div className="px-3 py-2 max-h-96 overflow-y-auto">
            {!aiResponse && !aiStreaming && (
              <div className="flex flex-col items-center justify-center py-8 text-muted-foreground text-sm gap-2">
                <Bot className="h-8 w-8 text-muted-foreground/40" />
                <p>Type your question and press <kbd className="text-[10px] font-mono bg-muted rounded px-1 py-0.5">Enter</kbd></p>
                <div className="text-[11px] text-muted-foreground/60 text-center mt-1 space-y-0.5">
                  <p>&quot;show me my calendar&quot; &middot; &quot;switch to dark mode&quot;</p>
                  <p>&quot;open the dev workspace&quot; &middot; &quot;create a task to review PRs&quot;</p>
                </div>
                {aiAvailable === false && (
                  <p className="text-destructive text-[11px] mt-2">Ollama is not running. Start it with: ollama serve</p>
                )}
              </div>
            )}

            {(aiResponse || aiStreaming) && (
              <div className="space-y-3">
                {/* AI response text */}
                <div
                  ref={aiResponseRef}
                  className="text-sm leading-relaxed text-foreground whitespace-pre-wrap"
                >
                  {stripActionJson(aiResponse)}
                  {aiStreaming && (
                    <span className="inline-block w-1.5 h-4 bg-primary/60 animate-pulse ml-0.5 align-text-bottom rounded-sm" />
                  )}
                </div>

                {/* Action button */}
                {aiAction && !aiStreaming && (
                  <button
                    onClick={() => executeAiAction(aiAction)}
                    className="flex items-center gap-2 w-full text-left text-sm px-3 py-2 rounded-lg border border-primary/20 bg-primary/5 hover:bg-primary/10 text-primary transition-colors"
                  >
                    <Play className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{actionLabel(aiAction)}</span>
                    <kbd className="ml-auto shrink-0 text-[10px] font-mono text-primary/60 bg-primary/10 rounded px-1.5 py-0.5">
                      click
                    </kbd>
                  </button>
                )}
              </div>
            )}
          </div>
        ) : (
          <>
        <CommandList className="max-h-96">
          <CommandEmpty>
            {loading || fileSearching || emailSearching ? (
              <div className="flex items-center justify-center gap-2 text-muted-foreground">
                <div className="h-3 w-3 border-2 border-muted-foreground/30 border-t-primary rounded-full animate-spin" />
                {emailSearching ? "Searching all emails..." : "Searching..."}
              </div>
            ) : (
              "No results found."
            )}
          </CommandEmpty>

          {/* ─── Commands (hidden when filtered to a specific widget) ─── */}
          {!filterGroup && (
            <>
          <CommandGroup heading="Widgets">
            {widgets.map((widget) => {
              const Icon = widgetIcons[widget.type] || Clock;
              return (
                <CommandItem
                  key={widget.id}
                  value={`focus ${widget.title}`}
                  keywords={["widget", "expand", "focus", "open", widget.type, ...(!widget.visible ? ["show", "enable"] : [])]}
                  onSelect={() => {
                    closeSearch();
                    // Ensure we're on a workspace that shows this widget
                    const wsHasWidget = activeWorkspace.widgetIds.includes(widget.id);
                    if (!wsHasWidget || activeWorkspace.viewType) {
                      setActiveWorkspace("dashboard");
                    }
                    if (activeFocusId) exitFocusMode();
                    // Collapse any currently expanded widget first
                    collapseAllWidgets();
                    // Ensure the widget is visible (no-op if already visible)
                    ensureWidgetVisible(widget.id);
                    setTimeout(() => {
                      navigateTo(
                        widget.type as Parameters<typeof navigateTo>[0]
                      );
                    }, 100);
                  }}
                >
                  <Maximize2 className="h-4 w-4 text-muted-foreground" />
                  <span>Focus {widget.title}</span>
                  {!widget.visible && (
                    <span className="text-[10px] text-muted-foreground ml-1">(hidden)</span>
                  )}
                  <Icon className="ml-auto h-3.5 w-3.5 text-muted-foreground/60" />
                </CommandItem>
              );
            })}
          </CommandGroup>

          <CommandSeparator />

          {/* ─── Commands: Workspaces ─────────────────────────── */}
          <CommandGroup heading="Workspaces">
            {workspaces.map((ws) => {
              const Icon = workspaceIcons[ws.icon] || LayoutDashboard;
              const isActive = ws.id === activeWorkspace.id && !activeFocusId;
              return (
                <CommandItem
                  key={ws.id}
                  value={`workspace ${ws.name}`}
                  keywords={["workspace", "switch", "view", ws.name, ...(ws.shortcut ? [`cmd+${ws.shortcut}`] : [])]}
                  onSelect={() =>
                    runAndClose(() => setActiveWorkspace(ws.id))
                  }
                >
                  <Icon className="h-4 w-4 text-muted-foreground" />
                  <span>{ws.name}</span>
                  <span className="ml-auto flex items-center gap-1.5">
                    {isActive && (
                      <span className="text-[10px] text-muted-foreground">
                        Active
                      </span>
                    )}
                    {ws.shortcut && (
                      <kbd className="text-[10px] text-muted-foreground/60 font-mono">
                        ⌘{ws.shortcut}
                      </kbd>
                    )}
                  </span>
                </CommandItem>
              );
            })}
          </CommandGroup>

          <CommandSeparator />

          {/* ─── Commands: Focus Mode ─────────────────────────── */}
          <CommandGroup heading="Focus Mode">
            {focusCombos.map((combo) => {
              const isActive = activeFocusId === combo.id;
              return (
                <CommandItem
                  key={combo.id}
                  value={`focus ${combo.name}`}
                  keywords={["focus", "split", "view", "pair", ...combo.widgetIds]}
                  onSelect={() =>
                    runAndClose(() => isActive ? exitFocusMode() : enterFocusMode(combo.id))
                  }
                >
                  <Focus className="h-4 w-4 text-muted-foreground" />
                  <span>{isActive ? `Exit: ${combo.name}` : combo.name}</span>
                  {isActive && (
                    <span className="ml-auto text-[10px] text-muted-foreground">
                      Active
                    </span>
                  )}
                </CommandItem>
              );
            })}
            {activeFocusId && (
              <CommandItem
                value="exit focus mode"
                keywords={["focus", "exit", "close", "escape", "leave"]}
                onSelect={() => runAndClose(exitFocusMode)}
              >
                <LogOut className="h-4 w-4 text-muted-foreground" />
                <span>Exit Focus Mode</span>
                <kbd className="ml-auto text-[10px] text-muted-foreground/60 font-mono">
                  Esc
                </kbd>
              </CommandItem>
            )}
          </CommandGroup>

          <CommandSeparator />

          {/* ─── Commands: Sidebar ─────────────────────────────── */}
          <CommandGroup heading="Sidebar">
            <CommandItem
              value={sidebarExpanded ? "collapse sidebar" : "expand sidebar"}
              keywords={["sidebar", "panel", "toggle", "collapse", "expand"]}
              onSelect={() => runAndClose(toggleSidebar)}
            >
              <PanelLeft className="h-4 w-4 text-muted-foreground" />
              <span>{sidebarExpanded ? "Collapse Sidebar" : "Expand Sidebar"}</span>
            </CommandItem>
          </CommandGroup>

          <CommandSeparator />

          {/* ─── Commands: Layout ─────────────────────────────── */}
          <CommandGroup heading="Layout">
            <CommandItem
              value="auto arrange widgets"
              keywords={["layout", "compact", "organize"]}
              onSelect={() => runAndClose(autoArrange)}
            >
              <LayoutGrid className="h-4 w-4 text-muted-foreground" />
              <span>Auto-arrange widgets</span>
            </CommandItem>
            <CommandItem
              value="reset layout"
              keywords={["layout", "default", "restore"]}
              onSelect={() => runAndClose(resetLayout)}
            >
              <RotateCcw className="h-4 w-4 text-muted-foreground" />
              <span>Reset to default layout</span>
            </CommandItem>
          </CommandGroup>

          <CommandSeparator />

          {/* ─── Commands: Profile ────────────────────────────── */}
          <CommandGroup heading="Profile">
            {profiles.map((p) => {
              const Icon = profileIcons[p.icon] || Briefcase;
              const isActive = p.id === activeProfile;
              return (
                <CommandItem
                  key={p.id}
                  value={`switch ${p.name} profile`}
                  keywords={["profile", p.id]}
                  data-checked={isActive}
                  onSelect={() =>
                    runAndClose(() => setActiveProfile(p.id))
                  }
                >
                  <Icon className="h-4 w-4 text-muted-foreground" />
                  <span>Switch to {p.name}</span>
                  {isActive && (
                    <span className="ml-auto text-[10px] text-muted-foreground">
                      Active
                    </span>
                  )}
                </CommandItem>
              );
            })}
          </CommandGroup>

          <CommandSeparator />

          {/* ─── Commands: Theme ──────────────────────────────── */}
          <CommandGroup heading="Theme">
            <CommandItem
              value="light mode"
              keywords={["theme", "appearance", "bright"]}
              onSelect={() => runAndClose(() => setTheme("light"))}
            >
              <Sun className="h-4 w-4 text-muted-foreground" />
              <span>Light mode</span>
              {theme === "light" && (
                <span className="ml-auto text-[10px] text-muted-foreground">
                  Active
                </span>
              )}
            </CommandItem>
            <CommandItem
              value="dark mode"
              keywords={["theme", "appearance", "night"]}
              onSelect={() => runAndClose(() => setTheme("dark"))}
            >
              <Moon className="h-4 w-4 text-muted-foreground" />
              <span>Dark mode</span>
              {theme === "dark" && (
                <span className="ml-auto text-[10px] text-muted-foreground">
                  Active
                </span>
              )}
            </CommandItem>
            <CommandItem
              value="system theme"
              keywords={["theme", "appearance", "auto"]}
              onSelect={() => runAndClose(() => setTheme("system"))}
            >
              <Monitor className="h-4 w-4 text-muted-foreground" />
              <span>System theme</span>
              {theme === "system" && (
                <span className="ml-auto text-[10px] text-muted-foreground">
                  Active
                </span>
              )}
            </CommandItem>
          </CommandGroup>

          <CommandSeparator />

          {/* ─── Commands: Color themes ───────────────────────── */}
          <CommandGroup heading="Color Theme">
            {colorThemes.map((ct) => (
              <CommandItem
                key={ct.id}
                value={`color ${ct.label}`}
                keywords={["theme", "color", "accent"]}
                data-checked={appearance.colorTheme === ct.id}
                onSelect={() => runAndClose(() => setColorTheme(ct.id))}
              >
                <div
                  className="h-4 w-4 rounded-full border border-border shrink-0"
                  style={{ backgroundColor: ct.preview }}
                />
                <span>{ct.label}</span>
              </CommandItem>
            ))}
          </CommandGroup>

          <CommandSeparator />

          {/* ─── Commands: Fonts ──────────────────────────────── */}
          <CommandGroup heading="Font">
            {fontFamilies.map((ff) => (
              <CommandItem
                key={ff.id}
                value={`font ${ff.label}`}
                keywords={["font", "typography", "typeface"]}
                data-checked={appearance.fontFamily === ff.id}
                onSelect={() => runAndClose(() => setFontFamily(ff.id))}
              >
                <Type className="h-4 w-4 text-muted-foreground" />
                <span>{ff.label}</span>
              </CommandItem>
            ))}
          </CommandGroup>

          {/* ─── Commands: Font Size ─────────────────────────── */}
          <CommandGroup heading="Font Size">
            <CommandItem
              value="increase font size"
              keywords={["font", "size", "bigger", "larger", "zoom in", "scale up"]}
              onSelect={() => runAndClose(() => increaseFontSize())}
            >
              <AArrowUp className="h-4 w-4 text-muted-foreground" />
              <span>Increase Font Size</span>
            </CommandItem>
            <CommandItem
              value="decrease font size"
              keywords={["font", "size", "smaller", "zoom out", "scale down"]}
              onSelect={() => runAndClose(() => decreaseFontSize())}
            >
              <AArrowDown className="h-4 w-4 text-muted-foreground" />
              <span>Decrease Font Size</span>
            </CommandItem>
            {fontSizes.map((fs) => (
              <CommandItem
                key={fs.id}
                value={`font size ${fs.label}`}
                keywords={["font", "size", "text"]}
                data-checked={appearance.fontSize === fs.id}
                onSelect={() => runAndClose(() => setFontSize(fs.id))}
              >
                <Type className="h-4 w-4 text-muted-foreground" />
                <span>{fs.label}</span>
              </CommandItem>
            ))}
          </CommandGroup>
            </>
          )}

          {showDataResults && orderedGroups.length > 0 && !filterGroup && <CommandSeparator />}

          {/* ─── Widget data (shown when searching or filtered) ──── */}
          {showDataResults &&
            orderedGroups.map((groupName) => (
              <CommandGroup key={groupName} heading={groupName}>
                {groupedData[groupName].map((item) => {
                  const Icon = item.icon;
                  return (
                    <CommandItem
                      key={item.id}
                      value={item.id}
                      keywords={item.keywords}
                      onSelect={() => handleSelect(item)}
                    >
                      <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm truncate">{item.title}</div>
                        {item.subtitle && (
                          <div className="text-[10px] text-muted-foreground truncate">
                            {item.subtitle}
                          </div>
                        )}
                      </div>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ))}

        </CommandList>

        {/* ─── Footer ────────────────────────────────────────── */}
        {(loading || fileSearching || emailSearching) && (hasSearch || !!filterGroup) && (
          <div className="border-t border-border px-3 py-1.5 text-[10px] text-muted-foreground flex items-center gap-1.5">
            <div className="h-2.5 w-2.5 border-[1.5px] border-muted-foreground/30 border-t-primary rounded-full animate-spin" />
            {emailSearching ? "Searching all emails..." : fileSearching ? "Searching files..." : "Loading widget data..."}
          </div>
        )}
          </>
        )}

        {/* ─── AI mode hint in footer ─────────────────────────── */}
        {!isAiMode && !filterGroup && (
          <div className="border-t border-border px-3 py-1.5 flex items-center justify-between">
            <div className="text-[10px] text-muted-foreground/50 flex items-center gap-1">
              <Sparkles className="h-2.5 w-2.5" />
              Type <kbd className="font-mono bg-muted/50 rounded px-1">&gt;</kbd> to ask AI
            </div>
            {aiAvailable === false && (
              <div className="text-[10px] text-destructive/60">AI offline</div>
            )}
            {aiAvailable === true && (
              <div className="text-[10px] text-emerald-500/60 flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500/60" />
                AI ready
              </div>
            )}
          </div>
        )}
      </Command>
    </CommandDialog>
  );
}
