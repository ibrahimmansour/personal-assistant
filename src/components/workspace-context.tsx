"use client";

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
} from "react";
import type { Layout, LayoutItem } from "react-grid-layout";
import type { WidgetType } from "@/types/widget";
import { useProfile, type ProfileId } from "@/components/profile-context";

// ─── Types ───────────────────────────────────────────────────────────────────

/** A widget category for grouping in sidebar and collapsible sections */
export type WidgetCategory = "glance" | "productivity" | "development" | "tools";

export const widgetCategories: Record<
  WidgetCategory,
  { label: string; order: number }
> = {
  glance: { label: "At a Glance", order: 0 },
  productivity: { label: "Productivity", order: 1 },
  development: { label: "Development", order: 2 },
  tools: { label: "Tools", order: 3 },
};

/** Maps each widget type to its category */
export const widgetCategoryMap: Record<WidgetType, WidgetCategory> = {
  clock: "glance",
  weather: "glance",
  reminders: "glance",
  calendar: "productivity",
  tasks: "productivity",
  email: "productivity",
  "github-prs": "development",
  jira: "development",
  notes: "development",
  terminal: "tools",
  bookmarks: "tools",
  files: "tools",
  "claude-code": "development",
};

/** Custom view type for workspaces that render a dedicated UI instead of the widget grid */
export type ViewType = "today" | "inbox" | "timeline" | "status-board";

/** A workspace is a named subset of widgets with its own layout */
export interface Workspace {
  id: string;
  name: string;
  icon: string; // lucide icon name
  /** Widget IDs included in this workspace */
  widgetIds: string[];
  /** Per-workspace layout. If undefined, uses auto-layout */
  layout?: Layout;
  /** Whether this is a built-in workspace (cannot be deleted) */
  builtIn?: boolean;
  /** Keyboard shortcut number (1-9) */
  shortcut?: number;
  /** If set, renders a custom view instead of the widget grid */
  viewType?: ViewType;
}

/** A saved focus mode combination */
export interface FocusCombo {
  id: string;
  name: string;
  /** Widget IDs in this combo (2-3) */
  widgetIds: string[];
  /** Split direction */
  direction: "horizontal" | "vertical";
  /** Split ratios (e.g., [50, 50] or [60, 40]) */
  ratios: number[];
  /** Keyboard shortcut (optional) */
  shortcut?: string;
}

/** Collapsed section state for the Dashboard workspace */
export type CollapsedSections = Record<WidgetCategory, boolean>;

export interface WorkspaceState {
  workspaces: Workspace[];
  activeWorkspaceId: string;
  focusCombos: FocusCombo[];
  /** Currently active focus combo (null = not in focus mode) */
  activeFocusId: string | null;
  /** Which category sections are collapsed in the Dashboard workspace */
  collapsedSections: CollapsedSections;
  /** Which widget IDs are "pinned" (shown larger in priority row) */
  pinnedWidgetIds: string[];
  /** Whether sidebar is expanded */
  sidebarExpanded: boolean;
}

// ─── Defaults ────────────────────────────────────────────────────────────────

const ALL_WIDGET_IDS = [
  "clock", "weather", "reminders", "calendar", "tasks", "email",
  "github-prs", "jira", "notes", "terminal", "bookmarks", "files",
];

const ALL_WIDGET_IDS_PRIVATE = ALL_WIDGET_IDS.filter((id) => id !== "jira");

function getDefaultWorkspaces(profile: ProfileId): Workspace[] {
  const allIds = profile === "private" ? ALL_WIDGET_IDS_PRIVATE : ALL_WIDGET_IDS;
  const devIds = profile === "private"
    ? ["terminal", "files", "github-prs", "notes"]
    : ["terminal", "files", "github-prs", "jira"];

  return [
    {
      id: "status-board",
      name: "Status",
      icon: "monitor",
      widgetIds: [],
      builtIn: true,
      shortcut: 1,
      viewType: "status-board",
    },
    {
      id: "dashboard",
      name: "Dashboard",
      icon: "layout-dashboard",
      widgetIds: allIds,
      builtIn: true,
      shortcut: 2,
    },
    {
      id: "dev",
      name: "Dev",
      icon: "code",
      widgetIds: devIds,
      builtIn: true,
      shortcut: 3,
    },
    {
      id: "comms",
      name: "Comms",
      icon: "mail",
      widgetIds: ["email", "calendar", "reminders"],
      builtIn: true,
      shortcut: 4,
    },
    {
      id: "notes-tasks",
      name: "Notes",
      icon: "sticky-note",
      widgetIds: ["notes", "tasks", "bookmarks"],
      builtIn: true,
      shortcut: 5,
    },
    {
      id: "today",
      name: "Today",
      icon: "sunrise",
      widgetIds: [],
      builtIn: true,
      shortcut: 6,
      viewType: "today",
    },
    {
      id: "inbox",
      name: "Inbox",
      icon: "inbox",
      widgetIds: [],
      builtIn: true,
      shortcut: 7,
      viewType: "inbox",
    },
    {
      id: "timeline",
      name: "Timeline",
      icon: "activity",
      widgetIds: [],
      builtIn: true,
      shortcut: 8,
      viewType: "timeline",
    },
  ];
}

function getDefaultFocusCombos(profile: ProfileId): FocusCombo[] {
  return [
    {
      id: "terminal-files",
      name: "Terminal + Files",
      widgetIds: ["terminal", "files"],
      direction: "horizontal",
      ratios: [60, 40],
    },
    {
      id: "email-calendar",
      name: "Email + Calendar",
      widgetIds: ["email", "calendar"],
      direction: "horizontal",
      ratios: [60, 40],
    },
    {
      id: "notes-tasks",
      name: "Notes + Tasks",
      widgetIds: ["notes", "tasks"],
      direction: "horizontal",
      ratios: [60, 40],
    },
  ];
}

const defaultCollapsed: CollapsedSections = {
  glance: false,
  productivity: false,
  development: false,
  tools: false,
};

// ─── Persistence ─────────────────────────────────────────────────────────────

const WORKSPACE_VERSION = 3;

function wsStorageKey(profile: ProfileId) {
  return `workspace-state-${profile}`;
}

function loadWorkspaceState(profile: ProfileId): WorkspaceState | null {
  try {
    const raw = localStorage.getItem(wsStorageKey(profile));
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data.version !== WORKSPACE_VERSION) return null;
    return data.state as WorkspaceState;
  } catch {
    return null;
  }
}

function saveWorkspaceState(profile: ProfileId, state: WorkspaceState) {
  try {
    localStorage.setItem(
      wsStorageKey(profile),
      JSON.stringify({ version: WORKSPACE_VERSION, state })
    );
  } catch {
    // ignore
  }
  // Also save to server
  fetch("/api/dashboard", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      profile,
      workspaceState: state,
      workspaceVersion: WORKSPACE_VERSION,
    }),
  }).catch(() => {});
}

// ─── Context ─────────────────────────────────────────────────────────────────

interface WorkspaceContextType {
  /** All workspaces */
  workspaces: Workspace[];
  /** The active workspace */
  activeWorkspace: Workspace;
  /** Switch to a workspace by ID */
  setActiveWorkspace: (id: string) => void;
  /** Create a custom workspace */
  createWorkspace: (name: string, icon: string, widgetIds: string[]) => void;
  /** Update a workspace's widget list */
  updateWorkspaceWidgets: (workspaceId: string, widgetIds: string[]) => void;
  /** Delete a custom workspace */
  deleteWorkspace: (id: string) => void;

  /** Focus combos */
  focusCombos: FocusCombo[];
  /** Currently active focus combo (null = normal mode) */
  activeFocusId: string | null;
  /** Enter focus mode with a combo */
  enterFocusMode: (comboId: string) => void;
  /** Exit focus mode */
  exitFocusMode: () => void;
  /** Create a focus combo */
  createFocusCombo: (combo: Omit<FocusCombo, "id">) => void;
  /** Update focus combo ratios */
  updateFocusRatios: (comboId: string, ratios: number[]) => void;
  /** Delete a focus combo */
  deleteFocusCombo: (id: string) => void;

  /** Collapsed sections in Dashboard workspace */
  collapsedSections: CollapsedSections;
  /** Toggle a section's collapsed state */
  toggleSection: (category: WidgetCategory) => void;

  /** Pinned widget IDs */
  pinnedWidgetIds: string[];
  /** Toggle pin for a widget */
  togglePinWidget: (widgetId: string) => void;

  /** Sidebar expanded state */
  sidebarExpanded: boolean;
  /** Toggle sidebar */
  toggleSidebar: () => void;
  setSidebarExpanded: (expanded: boolean) => void;
}

const WorkspaceContext = createContext<WorkspaceContextType | null>(null);

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used within WorkspaceProvider");
  return ctx;
}

// ─── Provider ────────────────────────────────────────────────────────────────

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const { activeProfile } = useProfile();

  const [workspaces, setWorkspaces] = useState<Workspace[]>(() =>
    getDefaultWorkspaces(activeProfile)
  );
  const [activeWorkspaceId, setActiveWorkspaceId] = useState("status-board");
  const [focusCombos, setFocusCombos] = useState<FocusCombo[]>(() =>
    getDefaultFocusCombos(activeProfile)
  );
  const [activeFocusId, setActiveFocusId] = useState<string | null>(null);
  const [collapsedSections, setCollapsedSections] = useState<CollapsedSections>(defaultCollapsed);
  const [pinnedWidgetIds, setPinnedWidgetIds] = useState<string[]>([]);
  const [sidebarExpanded, setSidebarExpanded] = useState(false);
  const profileRef = useRef(activeProfile);

  // Load state on profile change
  useEffect(() => {
    profileRef.current = activeProfile;
    const saved = loadWorkspaceState(activeProfile);
    if (saved) {
      // Always ensure the Dashboard workspace has all widget IDs for the current profile
      const allIds = activeProfile === "private" ? ALL_WIDGET_IDS_PRIVATE : ALL_WIDGET_IDS;
      let repairedWorkspaces = saved.workspaces.map((ws) =>
        ws.id === "dashboard" ? { ...ws, widgetIds: allIds } : ws
      );
      // Migrate: ensure status-board workspace exists
      if (!repairedWorkspaces.find((ws) => ws.id === "status-board")) {
        repairedWorkspaces = [
          {
            id: "status-board",
            name: "Status",
            icon: "monitor",
            widgetIds: [],
            builtIn: true,
            shortcut: 1,
            viewType: "status-board" as ViewType,
          },
          ...repairedWorkspaces,
        ];
      }
      setWorkspaces(repairedWorkspaces);
      setActiveWorkspaceId(saved.activeWorkspaceId);
      setFocusCombos(saved.focusCombos);
      setActiveFocusId(saved.activeFocusId);
      setCollapsedSections(saved.collapsedSections);
      setPinnedWidgetIds(saved.pinnedWidgetIds);
      setSidebarExpanded(saved.sidebarExpanded);
    } else {
      setWorkspaces(getDefaultWorkspaces(activeProfile));
      setActiveWorkspaceId("status-board");
      setFocusCombos(getDefaultFocusCombos(activeProfile));
      setActiveFocusId(null);
      setCollapsedSections(defaultCollapsed);
      setPinnedWidgetIds([]);
      setSidebarExpanded(false);
    }
  }, [activeProfile]);

  // Persist on state change
  const persist = useCallback(
    (overrides?: Partial<WorkspaceState>) => {
      const state: WorkspaceState = {
        workspaces,
        activeWorkspaceId,
        focusCombos,
        activeFocusId,
        collapsedSections,
        pinnedWidgetIds,
        sidebarExpanded,
        ...overrides,
      };
      saveWorkspaceState(profileRef.current, state);
    },
    [workspaces, activeWorkspaceId, focusCombos, activeFocusId, collapsedSections, pinnedWidgetIds, sidebarExpanded]
  );

  // ─── Workspace actions ────────────────────────────────────────────────

  const setActiveWorkspace = useCallback(
    (id: string) => {
      setActiveWorkspaceId(id);
      setActiveFocusId(null); // exit focus mode when switching workspaces
      persist({ activeWorkspaceId: id, activeFocusId: null });
    },
    [persist]
  );

  const createWorkspace = useCallback(
    (name: string, icon: string, widgetIds: string[]) => {
      const id = `custom-${Date.now()}`;
      const ws: Workspace = { id, name, icon, widgetIds };
      const next = [...workspaces, ws];
      setWorkspaces(next);
      persist({ workspaces: next });
    },
    [workspaces, persist]
  );

  const updateWorkspaceWidgets = useCallback(
    (workspaceId: string, widgetIds: string[]) => {
      const next = workspaces.map((ws) =>
        ws.id === workspaceId ? { ...ws, widgetIds } : ws
      );
      setWorkspaces(next);
      persist({ workspaces: next });
    },
    [workspaces, persist]
  );

  const deleteWorkspace = useCallback(
    (id: string) => {
      const next = workspaces.filter((ws) => ws.id !== id || ws.builtIn);
      setWorkspaces(next);
      if (activeWorkspaceId === id) {
        setActiveWorkspaceId("dashboard");
        persist({ workspaces: next, activeWorkspaceId: "status-board" });
      } else {
        persist({ workspaces: next });
      }
    },
    [workspaces, activeWorkspaceId, persist]
  );

  // ─── Focus mode actions ───────────────────────────────────────────────

  const enterFocusMode = useCallback(
    (comboId: string) => {
      setActiveFocusId(comboId);
      persist({ activeFocusId: comboId });
    },
    [persist]
  );

  const exitFocusMode = useCallback(() => {
    setActiveFocusId(null);
    persist({ activeFocusId: null });
  }, [persist]);

  const createFocusCombo = useCallback(
    (combo: Omit<FocusCombo, "id">) => {
      const id = `focus-${Date.now()}`;
      const next = [...focusCombos, { ...combo, id }];
      setFocusCombos(next);
      persist({ focusCombos: next });
    },
    [focusCombos, persist]
  );

  const updateFocusRatios = useCallback(
    (comboId: string, ratios: number[]) => {
      const next = focusCombos.map((c) =>
        c.id === comboId ? { ...c, ratios } : c
      );
      setFocusCombos(next);
      persist({ focusCombos: next });
    },
    [focusCombos, persist]
  );

  const deleteFocusCombo = useCallback(
    (id: string) => {
      const next = focusCombos.filter((c) => c.id !== id);
      setFocusCombos(next);
      if (activeFocusId === id) {
        setActiveFocusId(null);
        persist({ focusCombos: next, activeFocusId: null });
      } else {
        persist({ focusCombos: next });
      }
    },
    [focusCombos, activeFocusId, persist]
  );

  // ─── Section collapse actions ─────────────────────────────────────────

  const toggleSection = useCallback(
    (category: WidgetCategory) => {
      setCollapsedSections((prev) => {
        const next = { ...prev, [category]: !prev[category] };
        persist({ collapsedSections: next });
        return next;
      });
    },
    [persist]
  );

  // ─── Pin actions ──────────────────────────────────────────────────────

  const togglePinWidget = useCallback(
    (widgetId: string) => {
      setPinnedWidgetIds((prev) => {
        const next = prev.includes(widgetId)
          ? prev.filter((id) => id !== widgetId)
          : [...prev, widgetId];
        persist({ pinnedWidgetIds: next });
        return next;
      });
    },
    [persist]
  );

  // ─── Sidebar actions ─────────────────────────────────────────────────

  const toggleSidebar = useCallback(() => {
    setSidebarExpanded((prev) => {
      const next = !prev;
      persist({ sidebarExpanded: next });
      return next;
    });
  }, [persist]);

  const setSidebarExpandedCb = useCallback(
    (expanded: boolean) => {
      setSidebarExpanded(expanded);
      persist({ sidebarExpanded: expanded });
    },
    [persist]
  );

  // ─── Keyboard shortcuts ──────────────────────────────────────────────

   useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Esc to exit focus mode — always works regardless of focus target
      if (e.key === "Escape" && activeFocusId) {
        exitFocusMode();
        return;
      }

      // Cmd+1/2/3/4 to switch workspaces (only if not typing in input)
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;

      if (e.metaKey || e.ctrlKey) {
        const num = parseInt(e.key, 10);
        if (num >= 1 && num <= 9) {
          const ws = workspaces.find((w) => w.shortcut === num);
          if (ws) {
            e.preventDefault();
            setActiveWorkspace(ws.id);
          }
        }
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [workspaces, activeFocusId, setActiveWorkspace, exitFocusMode]);

  // ─── Derived values ───────────────────────────────────────────────────

  const activeWorkspace = workspaces.find((ws) => ws.id === activeWorkspaceId) || workspaces[0];

  return (
    <WorkspaceContext.Provider
      value={{
        workspaces,
        activeWorkspace,
        setActiveWorkspace,
        createWorkspace,
        updateWorkspaceWidgets,
        deleteWorkspace,
        focusCombos,
        activeFocusId,
        enterFocusMode,
        exitFocusMode,
        createFocusCombo,
        updateFocusRatios,
        deleteFocusCombo,
        collapsedSections,
        toggleSection,
        pinnedWidgetIds,
        togglePinWidget,
        sidebarExpanded,
        toggleSidebar,
        setSidebarExpanded: setSidebarExpandedCb,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}
