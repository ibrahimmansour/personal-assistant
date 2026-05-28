"use client";

import {
  ResponsiveGridLayout,
  useContainerWidth,
  verticalCompactor,
  noCompactor,
  type Layout,
  type LayoutItem,
  type ResponsiveLayouts,
} from "react-grid-layout";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { WidgetType } from "@/types/widget";
import { useDashboard } from "@/components/dashboard-context";
import { useWidgetNav } from "@/components/widget-nav-context";
import {
  useWorkspace,
} from "@/components/workspace-context";

import { ClockWidget } from "@/components/widgets/clock-widget";
import { TasksWidget } from "@/components/widgets/tasks-widget";
import { EmailWidget } from "@/components/widgets/email-widget";
import { RemindersWidget } from "@/components/widgets/reminders-widget";
import { CalendarWidget } from "@/components/widgets/calendar-widget";
import { WeatherWidget } from "@/components/widgets/weather-widget";
import { GitHubPRsWidget } from "@/components/widgets/github-prs-widget";
import { JiraWidget } from "@/components/widgets/jira-widget";
import { NotesWidget } from "@/components/widgets/notes-widget";
import { TerminalWidget } from "@/components/widgets/terminal-widget";
import { BookmarksWidget } from "@/components/widgets/bookmarks-widget";
import { FilesWidget } from "@/components/widgets/files-widget";
import { ClaudeCodeWidget } from "@/components/widgets/claude-code-widget";

import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";

const widgetComponents: Record<WidgetType, React.ComponentType> = {
  clock: ClockWidget,
  tasks: TasksWidget,
  email: EmailWidget,
  reminders: RemindersWidget,
  calendar: CalendarWidget,
  weather: WeatherWidget,
  "github-prs": GitHubPRsWidget,
  jira: JiraWidget,
  notes: NotesWidget,
  terminal: TerminalWidget,
  bookmarks: BookmarksWidget,
  files: FilesWidget,
  "claude-code": ClaudeCodeWidget,
};

export function DashboardGrid() {
  const { width, containerRef } = useContainerWidth({ initialWidth: 1200 });
  const { widgets, layouts, layoutLocked, updateLayouts } = useDashboard();
  const { navigateTo } = useWidgetNav();
  const {
    activeWorkspace,
    pinnedWidgetIds,
  } = useWorkspace();

  // Determine which widgets should be shown based on workspace + visibility
  const workspaceWidgetIds = useMemo(
    () => new Set(activeWorkspace.widgetIds),
    [activeWorkspace.widgetIds]
  );

  const visibleWidgets = useMemo(
    () => widgets.filter((w) => w.visible && workspaceWidgetIds.has(w.id)),
    [widgets, workspaceWidgetIds]
  );

  const visibleIds = useMemo(
    () => new Set(visibleWidgets.map((w) => w.id)),
    [visibleWidgets]
  );

  // Check if we're on the Dashboard workspace or a focused workspace
  const isDashboard = activeWorkspace.id === "dashboard";

  // Track current breakpoint to avoid persisting sm/md layouts as the canonical layout.
  // Start unknown until the grid reports the real breakpoint.
  const currentBreakpointRef = useRef<string | null>(null);

  // Keep layouts in a ref so handleLayoutChange can read the latest value
  // without depending on it — that dependency is what causes the infinite loop.
  const layoutsRef = useRef(layouts);
  useEffect(() => { layoutsRef.current = layouts; });

  // Track layoutLocked in a ref so handleLayoutChange can read it without
  // adding it to the dependency array (same pattern as layoutsRef).
  const layoutLockedRef = useRef(layoutLocked);
  useEffect(() => { layoutLockedRef.current = layoutLocked; });

  // Memoize the active compactor to avoid reference changes causing re-renders.
  // noCompactor.compact() clones the layout (new refs), so we must keep a stable
  // reference AND guard handleLayoutChange to prevent the clone→save→rerender loop.
  const activeCompactor = useMemo(
    () => (layoutLocked ? noCompactor : verticalCompactor),
    [layoutLocked]
  );

  // ─── Auto-focus widget when a link inside it is opened in Split View ──────
  // When the user right-clicks an <a> inside a widget and chooses
  // "Open in Split View", Chrome resizes our window shortly after.
  // We record which widget the link belonged to, then expand it on resize.
  const contextMenuWidgetRef = useRef<string | null>(null);
  const contextMenuTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function handleContextMenu(e: MouseEvent) {
      const target = e.target as HTMLElement;
      // Only care about right-clicks on <a> tags
      const anchor = target.closest("a");
      if (!anchor) return;
      // Find the nearest widget wrapper
      const card = anchor.closest("[data-widget-type]") as HTMLElement | null;
      if (!card) return;
      const wt = card.dataset.widgetType;
      if (!wt) return;
      contextMenuWidgetRef.current = wt;
      // Clear after 5s if no resize follows
      if (contextMenuTimerRef.current) clearTimeout(contextMenuTimerRef.current);
      contextMenuTimerRef.current = setTimeout(() => {
        contextMenuWidgetRef.current = null;
      }, 5000);
    }

    function handleResize() {
      const wt = contextMenuWidgetRef.current;
      if (!wt) return;
      contextMenuWidgetRef.current = null;
      if (contextMenuTimerRef.current) {
        clearTimeout(contextMenuTimerRef.current);
        contextMenuTimerRef.current = null;
      }
      // Expand the widget that contained the right-clicked link
      navigateTo(wt as Parameters<typeof navigateTo>[0]);
    }

    window.addEventListener("contextmenu", handleContextMenu);
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("contextmenu", handleContextMenu);
      window.removeEventListener("resize", handleResize);
      if (contextMenuTimerRef.current) clearTimeout(contextMenuTimerRef.current);
    };
  }, [navigateTo]);

  // For non-dashboard workspaces, auto-generate a compact layout
  // based on the subset of widgets in the workspace
  const effectiveLayouts = useMemo(() => {
    if (isDashboard) {
      // Use the normal layouts, filtered to visible
      const filtered = layouts.filter((item) => visibleIds.has(item.i));

      // If there are pinned widgets, sort them to have the lowest y values
      if (pinnedWidgetIds.length > 0) {
        const pinSet = new Set(pinnedWidgetIds);
        const pinned = filtered.filter((item) => pinSet.has(item.i));
        const unpinned = filtered.filter((item) => !pinSet.has(item.i));

        if (pinned.length > 0) {
          // Find the minimum y among all items
          const minY = Math.min(...filtered.map((item) => item.y));
          const adjustedPinned = pinned.map((item) => ({
            ...item,
            y: Math.min(item.y, minY), // Bring to top if not already there
          }));
          // Don't adjust unpinned — let the compactor handle overlap
          return [...adjustedPinned, ...unpinned] as Layout;
        }
      }

      return filtered;
    }

    // For other workspaces: auto-layout the subset of widgets
    const wsWidgets = visibleWidgets;
    const cols = 12;
    const items: LayoutItem[] = [];

    // If workspace has <= 4 widgets, give them more space
    const widgetCount = wsWidgets.length;
    let defaultW = 4;
    let defaultH = 5;

    if (widgetCount <= 2) {
      defaultW = 6;
      defaultH = 6;
    } else if (widgetCount <= 3) {
      defaultW = 4;
      defaultH = 6;
    } else if (widgetCount <= 4) {
      defaultW = 6;
      defaultH = 5;
    }

    let x = 0;
    let y = 0;
    for (const widget of wsWidgets) {
      // Check if there's an existing layout item from the main layouts
      const existing = (layouts as readonly LayoutItem[]).find((l) => l.i === widget.id);
      const minW = existing?.minW ?? 3;
      const minH = existing?.minH ?? 3;

      if (x + defaultW > cols) {
        x = 0;
        y += defaultH;
      }

      items.push({
        i: widget.id,
        x,
        y,
        w: defaultW,
        h: defaultH,
        minW,
        minH,
      });
      x += defaultW;
    }

    return items as Layout;
  }, [isDashboard, layouts, visibleWidgets, visibleIds, pinnedWidgetIds]);

  const handleBreakpointChange = useCallback(
    (newBreakpoint: string, _newCols: number) => {
      currentBreakpointRef.current = newBreakpoint;
    },
    []
  );

  const handleLayoutChange = useCallback(
    (currentLayout: Layout, _allLayouts: ResponsiveLayouts) => {
      if (!isDashboard) return;
      if (currentBreakpointRef.current == null) return;
      if (currentBreakpointRef.current !== "lg") return;

      // When layout is locked, only persist if an item actually moved/resized.
      // noCompactor.compact() clones the layout on every render, producing new
      // references that trigger onLayoutChange even though nothing changed.
      // Without this guard we get an infinite setState loop.
      if (layoutLockedRef.current) {
        const prev = layoutsRef.current;
        const changed = currentLayout.some((item) => {
          const old = prev.find((p) => p.i === item.i) as LayoutItem | undefined;
          if (!old) return true;
          return item.x !== old.x || item.y !== old.y || item.w !== old.w || item.h !== old.h;
        });
        if (!changed) return;
      }

      // Merge changed items back with hidden/other-workspace items.
      // Read layouts from the ref — no dependency on layouts state.
      const changedIds = new Set(currentLayout.map((item) => item.i));
      const unchangedLayouts = layoutsRef.current.filter((item) => !changedIds.has(item.i));
      updateLayouts([...currentLayout, ...unchangedLayouts] as Layout);
    },
    [updateLayouts, isDashboard]   // ← layouts intentionally removed
  );

  // Detect mobile for different row height and disabling drag
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia("(max-width: 767px)");
    setIsMobile(mql.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  // Generate a single-column mobile layout
  const mobileLayouts = useMemo(() => {
    const items: LayoutItem[] = [];
    let y = 0;
    for (const widget of visibleWidgets) {
      items.push({
        i: widget.id,
        x: 0,
        y,
        w: 1,
        h: 4,
        minW: 1,
        minH: 3,
      });
      y += 4;
    }
    return items as Layout;
  }, [visibleWidgets]);

  return (
    <div className="flex flex-col h-full">
      {/* ─── Grid ─────────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto p-2 md:p-4" ref={containerRef}>
        {width > 0 && visibleWidgets.length > 0 && (
          <ResponsiveGridLayout
            className="layout"
            width={width}
            layouts={{
              lg: effectiveLayouts,
              md: effectiveLayouts,
              sm: effectiveLayouts,
              xs: mobileLayouts,
            }}
            breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 0 }}
            cols={{ lg: 12, md: 8, sm: 4, xs: 1 }}
            rowHeight={isMobile ? 70 : 80}
            margin={isMobile ? [12, 12] : [16, 16]}
            containerPadding={[0, 0]}
            compactor={activeCompactor}
            dragConfig={{
              enabled: isDashboard && !isMobile,
              handle: ".drag-handle",
              bounded: false,
              threshold: 3,
            }}
            resizeConfig={{
              enabled: isDashboard && !isMobile,
              handles: ["se"],
            }}
            onLayoutChange={handleLayoutChange}
            onBreakpointChange={handleBreakpointChange}
            autoSize={true}
          >
            {visibleWidgets.map((widget) => {
              const WidgetComponent = widgetComponents[widget.type];
              return (
                <div key={widget.id} className="widget-container" data-widget-id={widget.id}>
                  <WidgetComponent />
                </div>
              );
            })}
          </ResponsiveGridLayout>
        )}
        {visibleWidgets.length === 0 && (
          <div className="flex items-center justify-center h-64 text-muted-foreground">
            <p className="text-sm">No widgets in this workspace.</p>
          </div>
        )}
      </div>
    </div>
  );
}
