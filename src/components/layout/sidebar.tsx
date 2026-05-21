"use client";

import { useCallback, useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Code,
  Mail,
  StickyNote,
  Clock,
  CloudSun,
  Bell,
  Calendar,
  ListTodo,
  GitPullRequest,
  TicketCheck,
  TerminalSquare,
  Bookmark,
  FolderOpen,
  ChevronLeft,
  ChevronRight,
  Plus,
  Focus,
  PanelLeftClose,
  PanelLeft,
  Sunrise,
  Inbox,
  Activity,
  MoreHorizontal,
  Pencil,
  Trash2,
  X,
  Check,
  Layers,
  Monitor,
  Bot,
} from "lucide-react";
import {
  useWorkspace,
  widgetCategories,
  widgetCategoryMap,
  type WidgetCategory,
  type Workspace,
  type FocusCombo,
} from "@/components/workspace-context";
import { useDashboard } from "@/components/dashboard-context";
import { useProfile } from "@/components/profile-context";
import type { WidgetType } from "@/types/widget";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

// ─── Icon registry ──────────────────────────────────────────────────────────

const widgetIcons: Record<WidgetType, React.ComponentType<{ className?: string }>> = {
  clock: Clock,
  weather: CloudSun,
  reminders: Bell,
  calendar: Calendar,
  tasks: ListTodo,
  email: Mail,
  "github-prs": GitPullRequest,
  jira: TicketCheck,
  notes: StickyNote,
  terminal: TerminalSquare,
  bookmarks: Bookmark,
  files: FolderOpen,
  "claude-code": Bot,
};

const workspaceIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  monitor: Monitor,
  "layout-dashboard": LayoutDashboard,
  code: Code,
  mail: Mail,
  "sticky-note": StickyNote,
  sunrise: Sunrise,
  inbox: Inbox,
  activity: Activity,
  layers: Layers,
  focus: Focus,
  bookmark: Bookmark,
  "list-todo": ListTodo,
  calendar: Calendar,
  "terminal-square": TerminalSquare,
  "git-pull-request": GitPullRequest,
};

/** Icons available for custom workspace creation */
const customWorkspaceIconOptions = [
  { id: "layers", label: "Layers" },
  { id: "code", label: "Code" },
  { id: "mail", label: "Mail" },
  { id: "sticky-note", label: "Notes" },
  { id: "list-todo", label: "Tasks" },
  { id: "calendar", label: "Calendar" },
  { id: "bookmark", label: "Bookmark" },
  { id: "terminal-square", label: "Terminal" },
  { id: "git-pull-request", label: "Git" },
  { id: "focus", label: "Focus" },
];

const widgetTitles: Record<WidgetType, string> = {
  clock: "Clock",
  weather: "Weather",
  reminders: "Reminders",
  calendar: "Calendar",
  tasks: "Tasks",
  email: "Email",
  "github-prs": "Pull Requests",
  jira: "Jira",
  notes: "Notes",
  terminal: "Terminal",
  bookmarks: "Bookmarks",
  files: "Files",
  "claude-code": "Claude Code",
};

// ─── Component ──────────────────────────────────────────────────────────────

export function Sidebar() {
  const {
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
    deleteFocusCombo,
    sidebarExpanded,
    toggleSidebar,
  } = useWorkspace();
  const { widgets } = useDashboard();
  const { activeProfile } = useProfile();

  // ─── Workspace creation/editing state ─────────────────────────
  const [wsDialogOpen, setWsDialogOpen] = useState(false);
  const [wsEditId, setWsEditId] = useState<string | null>(null); // null = creating new
  const [wsName, setWsName] = useState("");
  const [wsIcon, setWsIcon] = useState("layers");
  const [wsWidgetIds, setWsWidgetIds] = useState<string[]>([]);
  const [wsMenuId, setWsMenuId] = useState<string | null>(null);

  // ─── Focus combo creation state ───────────────────────────────
  const [fcDialogOpen, setFcDialogOpen] = useState(false);
  const [fcEditId, setFcEditId] = useState<string | null>(null);
  const [fcName, setFcName] = useState("");
  const [fcWidgetIds, setFcWidgetIds] = useState<string[]>([]);
  const [fcDirection, setFcDirection] = useState<"horizontal" | "vertical">("horizontal");
  const [fcMenuId, setFcMenuId] = useState<string | null>(null);

  // Close menus on outside click
  useEffect(() => {
    if (!wsMenuId && !fcMenuId) return;
    const handler = () => { setWsMenuId(null); setFcMenuId(null); };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [wsMenuId, fcMenuId]);

  // ─── Workspace dialog helpers ─────────────────────────────────
  const allWidgetIds = widgets
    .filter((w) => activeProfile === "private" ? w.type !== "jira" : true)
    .map((w) => w.id);

  const openCreateWorkspace = () => {
    setWsEditId(null);
    setWsName("");
    setWsIcon("layers");
    setWsWidgetIds([]);
    setWsDialogOpen(true);
  };

  const openEditWorkspace = (ws: Workspace) => {
    setWsEditId(ws.id);
    setWsName(ws.name);
    setWsIcon(ws.icon);
    setWsWidgetIds([...ws.widgetIds]);
    setWsDialogOpen(true);
    setWsMenuId(null);
  };

  const saveWorkspace = () => {
    const name = wsName.trim();
    if (!name || wsWidgetIds.length === 0) return;
    if (wsEditId) {
      // Update existing
      updateWorkspaceWidgets(wsEditId, wsWidgetIds);
      // Name/icon can't be changed on built-ins; for customs we'd need an updateWorkspace function.
      // For now, just update widgets.
    } else {
      createWorkspace(name, wsIcon, wsWidgetIds);
    }
    setWsDialogOpen(false);
  };

  const toggleWsWidget = (id: string) => {
    setWsWidgetIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  // ─── Focus combo dialog helpers ───────────────────────────────
  const openCreateFocus = () => {
    setFcEditId(null);
    setFcName("");
    setFcWidgetIds([]);
    setFcDirection("horizontal");
    setFcDialogOpen(true);
  };

  const saveFocusCombo = () => {
    const name = fcName.trim();
    if (!name || fcWidgetIds.length < 2 || fcWidgetIds.length > 3) return;
    const evenRatio = Math.round(100 / fcWidgetIds.length);
    const ratios = fcWidgetIds.map(() => evenRatio);
    createFocusCombo({ name, widgetIds: fcWidgetIds, direction: fcDirection, ratios });
    setFcDialogOpen(false);
  };

  const toggleFcWidget = (id: string) => {
    setFcWidgetIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 3) return prev; // max 3
      return [...prev, id];
    });
  };

  /** Scroll to a widget in the grid and briefly highlight it */
  const scrollToWidget = useCallback((widgetId: string) => {
    const el = document.querySelector(`[data-widget-id="${widgetId}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    // Flash highlight
    el.classList.add("widget-highlight");
    setTimeout(() => el.classList.remove("widget-highlight"), 1500);
  }, []);

  // Group widgets in the active workspace by category
  const widgetsByCategory = new Map<WidgetCategory, WidgetType[]>();
  for (const widgetId of activeWorkspace.widgetIds) {
    const widget = widgets.find((w) => w.id === widgetId);
    if (!widget) continue;
    const cat = widgetCategoryMap[widget.type];
    if (!widgetsByCategory.has(cat)) widgetsByCategory.set(cat, []);
    widgetsByCategory.get(cat)!.push(widget.type);
  }

  const sortedCategories = Array.from(widgetsByCategory.keys()).sort(
    (a, b) => widgetCategories[a].order - widgetCategories[b].order
  );

  return (
    <>
      <aside
        className={cn(
          "h-full flex flex-col border-r border-border/50 bg-background/50 backdrop-blur-sm transition-all duration-200 shrink-0 overflow-hidden",
          sidebarExpanded ? "w-[200px]" : "w-[48px]"
        )}
      >
        {/* ─── Workspace tabs ──────────────────────────────────── */}
        <div className="shrink-0 border-b border-border/50 p-1.5 space-y-0.5">
          {workspaces.map((ws) => {
            const Icon = workspaceIcons[ws.icon] || LayoutDashboard;
            const isActive = ws.id === activeWorkspace.id && !activeFocusId;
            const isCustom = !ws.builtIn;
            return (
              <div key={ws.id} className="relative group/ws">
                <div
                  onClick={() => setActiveWorkspace(ws.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setActiveWorkspace(ws.id); } }}
                  className={cn(
                    "flex items-center gap-2 w-full rounded-md transition-colors cursor-pointer",
                    sidebarExpanded ? "px-2.5 py-1.5" : "px-0 py-1.5 justify-center",
                    isActive
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                  )}
                  title={sidebarExpanded ? undefined : `${ws.name}${ws.shortcut ? ` (⌘${ws.shortcut})` : ""}`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {sidebarExpanded && (
                    <>
                      <span className="text-xs font-medium truncate flex-1 text-left">
                        {ws.name}
                      </span>
                      {isCustom ? (
                        <span
                          onClick={(e) => {
                            e.stopPropagation();
                            setWsMenuId(wsMenuId === ws.id ? null : ws.id);
                          }}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); setWsMenuId(wsMenuId === ws.id ? null : ws.id); } }}
                          className="hidden group-hover/ws:block text-muted-foreground hover:text-foreground p-0 cursor-pointer"
                        >
                          <MoreHorizontal className="h-3 w-3" />
                        </span>
                      ) : ws.shortcut ? (
                        <kbd className="text-[9px] text-muted-foreground/60 font-mono">
                          ⌘{ws.shortcut}
                        </kbd>
                      ) : null}
                    </>
                  )}
                </div>
                {/* Custom workspace context menu */}
                {wsMenuId === ws.id && isCustom && (
                  <div className="absolute left-full top-0 ml-1 z-50 bg-popover border border-border rounded-md shadow-md py-1 min-w-[100px]">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        openEditWorkspace(ws);
                      }}
                      className="w-full text-left px-3 py-1.5 text-xs hover:bg-muted transition-colors flex items-center gap-2"
                    >
                      <Pencil className="h-3 w-3" /> Edit
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteWorkspace(ws.id);
                        setWsMenuId(null);
                      }}
                      className="w-full text-left px-3 py-1.5 text-xs hover:bg-muted text-destructive transition-colors flex items-center gap-2"
                    >
                      <Trash2 className="h-3 w-3" /> Delete
                    </button>
                  </div>
                )}
              </div>
            );
          })}
          {/* Add workspace button */}
          <button
            onClick={openCreateWorkspace}
            className={cn(
              "flex items-center gap-2 w-full rounded-md text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted/30 transition-colors",
              sidebarExpanded ? "px-2.5 py-1.5" : "px-0 py-1.5 justify-center"
            )}
            title={sidebarExpanded ? undefined : "New workspace"}
          >
            <Plus className="h-3.5 w-3.5 shrink-0" />
            {sidebarExpanded && <span className="text-xs">New workspace</span>}
          </button>
        </div>

        {/* ─── Focus combos ────────────────────────────────────── */}
        <div className="shrink-0 border-b border-border/50 p-1.5 space-y-0.5">
          {sidebarExpanded && (
            <div className="text-[9px] uppercase tracking-wider text-muted-foreground/50 px-2.5 py-0.5">
              Focus
            </div>
          )}
          {focusCombos.map((combo) => {
            const isActive = activeFocusId === combo.id;
            return (
              <div key={combo.id} className="relative group/fc">
                <div
                  onClick={() => isActive ? exitFocusMode() : enterFocusMode(combo.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); isActive ? exitFocusMode() : enterFocusMode(combo.id); } }}
                  className={cn(
                    "flex items-center gap-2 w-full rounded-md transition-colors cursor-pointer",
                    sidebarExpanded ? "px-2.5 py-1.5" : "px-0 py-1.5 justify-center",
                    isActive
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                  )}
                  title={sidebarExpanded ? undefined : combo.name}
                >
                  <Focus className="h-3.5 w-3.5 shrink-0" />
                  {sidebarExpanded && (
                    <>
                      <span className="text-xs truncate flex-1 text-left">
                        {combo.name}
                      </span>
                      <span
                        onClick={(e) => {
                          e.stopPropagation();
                          setFcMenuId(fcMenuId === combo.id ? null : combo.id);
                        }}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); setFcMenuId(fcMenuId === combo.id ? null : combo.id); } }}
                        className="hidden group-hover/fc:block text-muted-foreground hover:text-foreground p-0 cursor-pointer"
                      >
                        <MoreHorizontal className="h-3 w-3" />
                      </span>
                    </>
                  )}
                </div>
                {/* Focus combo context menu */}
                {fcMenuId === combo.id && (
                  <div className="absolute left-full top-0 ml-1 z-50 bg-popover border border-border rounded-md shadow-md py-1 min-w-[100px]">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteFocusCombo(combo.id);
                        setFcMenuId(null);
                      }}
                      className="w-full text-left px-3 py-1.5 text-xs hover:bg-muted text-destructive transition-colors flex items-center gap-2"
                    >
                      <Trash2 className="h-3 w-3" /> Delete
                    </button>
                  </div>
                )}
              </div>
            );
          })}
          {/* Add focus combo button */}
          <button
            onClick={openCreateFocus}
            className={cn(
              "flex items-center gap-2 w-full rounded-md text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted/30 transition-colors",
              sidebarExpanded ? "px-2.5 py-1.5" : "px-0 py-1.5 justify-center"
            )}
            title={sidebarExpanded ? undefined : "New focus combo"}
          >
            <Plus className="h-3.5 w-3.5 shrink-0" />
            {sidebarExpanded && <span className="text-xs">New combo</span>}
          </button>
        </div>

        {/* ─── Widget list (grouped by category) ───────────────── */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden p-1.5 space-y-2 scrollbar-thin">
          {sortedCategories.map((cat) => {
            const categoryWidgets = widgetsByCategory.get(cat)!;
            return (
              <div key={cat}>
                {sidebarExpanded && (
                  <div className="text-[9px] uppercase tracking-wider text-muted-foreground/50 px-2.5 py-0.5 mb-0.5">
                    {widgetCategories[cat].label}
                  </div>
                )}
                <div className="space-y-0">
                  {categoryWidgets.map((widgetType) => {
                    const Icon = widgetIcons[widgetType];
                    return (
                      <button
                        key={widgetType}
                        onClick={() => scrollToWidget(widgetType)}
                        className={cn(
                          "flex items-center gap-2 w-full rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors",
                          sidebarExpanded ? "px-2.5 py-1" : "px-0 py-1 justify-center"
                        )}
                        title={sidebarExpanded ? undefined : widgetTitles[widgetType]}
                      >
                        <Icon className="h-3.5 w-3.5 shrink-0" />
                        {sidebarExpanded && (
                          <span className="text-[11px] truncate">
                            {widgetTitles[widgetType]}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* ─── Collapse toggle ─────────────────────────────────── */}
        <div className="shrink-0 border-t border-border/50 p-1.5">
          <button
            onClick={toggleSidebar}
            className={cn(
              "flex items-center gap-2 w-full rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors",
              sidebarExpanded ? "px-2.5 py-1.5" : "px-0 py-1.5 justify-center"
            )}
            title={sidebarExpanded ? "Collapse sidebar" : "Expand sidebar"}
          >
            {sidebarExpanded ? (
              <>
                <PanelLeftClose className="h-3.5 w-3.5 shrink-0" />
                <span className="text-[11px]">Collapse</span>
              </>
            ) : (
              <PanelLeft className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
      </aside>

      {/* ─── Workspace creation/edit dialog ────────────────────── */}
      <Dialog open={wsDialogOpen} onOpenChange={(open) => setWsDialogOpen(open)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{wsEditId ? "Edit Workspace" : "New Workspace"}</DialogTitle>
            <DialogDescription>
              {wsEditId
                ? "Update the widgets included in this workspace."
                : "Create a custom workspace with your preferred widgets."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Name */}
            {!wsEditId && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">Name</label>
                <input
                  type="text"
                  value={wsName}
                  onChange={(e) => setWsName(e.target.value)}
                  placeholder="My Workspace"
                  className="w-full text-sm bg-muted/50 border border-border rounded-md px-3 py-1.5 placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  autoFocus
                />
              </div>
            )}

            {/* Icon picker */}
            {!wsEditId && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">Icon</label>
                <div className="flex flex-wrap gap-1">
                  {customWorkspaceIconOptions.map((opt) => {
                    const Icon = workspaceIcons[opt.id] || Layers;
                    return (
                      <button
                        key={opt.id}
                        onClick={() => setWsIcon(opt.id)}
                        className={cn(
                          "flex items-center gap-1.5 px-2 py-1 rounded-md text-xs border transition-colors",
                          wsIcon === opt.id
                            ? "bg-primary/10 text-primary border-primary/30"
                            : "border-border text-muted-foreground hover:text-foreground hover:bg-muted/50"
                        )}
                        title={opt.label}
                      >
                        <Icon className="h-3.5 w-3.5" />
                        <span>{opt.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Widget selection */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">
                Widgets ({wsWidgetIds.length} selected)
              </label>
              <div className="grid grid-cols-2 gap-1">
                {allWidgetIds.map((id) => {
                  const widget = widgets.find((w) => w.id === id);
                  if (!widget) return null;
                  const Icon = widgetIcons[widget.type];
                  const selected = wsWidgetIds.includes(id);
                  return (
                    <button
                      key={id}
                      onClick={() => toggleWsWidget(id)}
                      className={cn(
                        "flex items-center gap-2 px-2 py-1.5 rounded-md text-xs border transition-colors",
                        selected
                          ? "bg-primary/10 text-primary border-primary/30"
                          : "border-border text-muted-foreground hover:text-foreground hover:bg-muted/50"
                      )}
                    >
                      <Icon className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{widgetTitles[widget.type]}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setWsDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={saveWorkspace}
              disabled={(!wsEditId && !wsName.trim()) || wsWidgetIds.length === 0}
            >
              {wsEditId ? "Save" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Focus combo creation dialog ───────────────────────── */}
      <Dialog open={fcDialogOpen} onOpenChange={(open) => setFcDialogOpen(open)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New Focus Combo</DialogTitle>
            <DialogDescription>
              Pick 2-3 widgets for a side-by-side split view.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Name */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Name</label>
              <input
                type="text"
                value={fcName}
                onChange={(e) => setFcName(e.target.value)}
                placeholder="e.g. Code + Terminal"
                className="w-full text-sm bg-muted/50 border border-border rounded-md px-3 py-1.5 placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                autoFocus
              />
            </div>

            {/* Direction */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Layout</label>
              <div className="flex gap-2">
                <button
                  onClick={() => setFcDirection("horizontal")}
                  className={cn(
                    "flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md text-xs border transition-colors",
                    fcDirection === "horizontal"
                      ? "bg-primary/10 text-primary border-primary/30"
                      : "border-border text-muted-foreground hover:text-foreground hover:bg-muted/50"
                  )}
                >
                  <div className="flex gap-0.5">
                    <div className="w-4 h-6 border border-current rounded-sm" />
                    <div className="w-4 h-6 border border-current rounded-sm" />
                  </div>
                  Side by side
                </button>
                <button
                  onClick={() => setFcDirection("vertical")}
                  className={cn(
                    "flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md text-xs border transition-colors",
                    fcDirection === "vertical"
                      ? "bg-primary/10 text-primary border-primary/30"
                      : "border-border text-muted-foreground hover:text-foreground hover:bg-muted/50"
                  )}
                >
                  <div className="flex flex-col gap-0.5">
                    <div className="w-8 h-3 border border-current rounded-sm" />
                    <div className="w-8 h-3 border border-current rounded-sm" />
                  </div>
                  Stacked
                </button>
              </div>
            </div>

            {/* Widget selection (2-3 widgets) */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">
                Widgets ({fcWidgetIds.length}/3 selected, min 2)
              </label>
              <div className="grid grid-cols-2 gap-1">
                {allWidgetIds.map((id) => {
                  const widget = widgets.find((w) => w.id === id);
                  if (!widget) return null;
                  const Icon = widgetIcons[widget.type];
                  const selected = fcWidgetIds.includes(id);
                  const disabled = !selected && fcWidgetIds.length >= 3;
                  return (
                    <button
                      key={id}
                      onClick={() => toggleFcWidget(id)}
                      disabled={disabled}
                      className={cn(
                        "flex items-center gap-2 px-2 py-1.5 rounded-md text-xs border transition-colors",
                        selected
                          ? "bg-primary/10 text-primary border-primary/30"
                          : disabled
                            ? "border-border text-muted-foreground/30 cursor-not-allowed"
                            : "border-border text-muted-foreground hover:text-foreground hover:bg-muted/50"
                      )}
                    >
                      <Icon className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{widgetTitles[widget.type]}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setFcDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={saveFocusCombo}
              disabled={!fcName.trim() || fcWidgetIds.length < 2}
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
