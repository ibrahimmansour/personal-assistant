"use client";

import {
  ResponsiveGridLayout,
  useContainerWidth,
  verticalCompactor,
  noCompactor,
  type Layout,
  type LayoutItem,
} from "react-grid-layout";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { WidgetType } from "@/types/widget";
import { useDashboard } from "@/components/dashboard-context";
import { useWidgetNav } from "@/components/widget-nav-context";
import { useIsMobile } from "@/hooks/use-swipe";
import {
  useWorkspace,
} from "@/components/workspace-context";
import { useProfile } from "@/components/profile-context";
import { useAppearance } from "@/components/appearance-context";
import { getDefaultResponsiveLayouts, widgetSections, sectionMeta, type WidgetSection } from "@/lib/dashboard-config";
import { cn } from "@/lib/utils";

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
import { SystemMonitorWidget } from "@/components/widgets/system-monitor-widget";
import { NewsWidget } from "@/components/widgets/news-widget";

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
  "system-monitor": SystemMonitorWidget,
  news: NewsWidget,
};

// ─── Mobile stack heights ────────────────────────────────────────────────────
// On phones the grid is replaced by a single-column flex stack, so each widget
// needs an explicit height: several children (terminal/xterm, Monaco, the
// Claude Code transcript) size themselves from the parent box and collapse
// inside an auto-height container. Values are tuned per widget type — a clock
// in a 380px box is mostly empty, a terminal in a 200px box is unusable.
// Kept as literal class strings so Tailwind's scanner picks them up.
const MOBILE_HEIGHT_CLASS: Record<WidgetType, string> = {
  clock: "h-[200px]",
  weather: "h-[200px]",
  reminders: "h-[280px]",
  bookmarks: "h-[280px]",
  "system-monitor": "h-[280px]",
  calendar: "h-[340px]",
  tasks: "h-[340px]",
  email: "h-[380px]",
  jira: "h-[380px]",
  "github-prs": "h-[380px]",
  news: "h-[380px]",
  files: "h-[380px]",
  notes: "h-[440px]",
  terminal: "h-[440px]",
  "claude-code": "h-[440px]",
};

// Same heights in pixels, for the rare case where the grid still has to render
// a 1-column layout (container narrower than the sm breakpoint on a desktop
// viewport, e.g. an expanded sidebar on a small window).
const MOBILE_HEIGHT_PX: Record<WidgetType, number> = {
  clock: 200,
  weather: 200,
  reminders: 280,
  bookmarks: 280,
  "system-monitor": 280,
  calendar: 340,
  tasks: 340,
  email: 380,
  jira: 380,
  "github-prs": 380,
  news: 380,
  files: 380,
  notes: 440,
  terminal: 440,
  "claude-code": 440,
};

export function DashboardGrid() {
  const { width, containerRef } = useContainerWidth({ initialWidth: 1200 });
  const { widgets, layouts, layoutLocked, updateLayouts } = useDashboard();
  const { navigateTo } = useWidgetNav();
  const { activeProfile } = useProfile();
  const { appearance } = useAppearance();
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

  // Derive responsive (md/sm) layouts from the effective lg layout
  const responsiveLayoutSet = useMemo(() => {
    if (!isDashboard) {
      // Non-dashboard workspaces: same layout for all breakpoints (auto-generated above)
      return { lg: effectiveLayouts, md: effectiveLayouts, sm: effectiveLayouts };
    }
    // For dashboard: derive proper md/sm layouts from the lg layout
    const defaults = getDefaultResponsiveLayouts(activeProfile);
    // Filter each breakpoint layout to only include visible widgets
    const filteredMd = defaults.md.filter((item) => visibleIds.has(item.i));
    const filteredSm = defaults.sm.filter((item) => visibleIds.has(item.i));
    return { lg: effectiveLayouts, md: filteredMd, sm: filteredSm };
  }, [isDashboard, effectiveLayouts, activeProfile, visibleIds]);

  const handleBreakpointChange = useCallback(
    (newBreakpoint: string) => {
      currentBreakpointRef.current = newBreakpoint;
    },
    []
  );

  const handleLayoutChange = useCallback(
    (currentLayout: Layout) => {
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

  // Phones get a plain flex stack instead of the grid (see the mobile branch
  // below). Reads matchMedia synchronously on mount so the first paint is
  // already correct — no grid-then-stack flash.
  const isMobile = useIsMobile();

  // ─── Section labels: compute pixel positions from layout ─────────────
  // Density affects row height and margins
  const densityConfig = useMemo(() => {
    switch (appearance.density) {
      case "compact":    return { rowHeight: 64, margin: 10 };
      case "spacious":   return { rowHeight: 96, margin: 20 };
      case "comfortable":
      default:           return { rowHeight: 80, margin: 16 };
    }
  }, [appearance.density]);

  const rowHeight = densityConfig.rowHeight;
  const marginY = densityConfig.margin;

  // Single-column (xs) grid layout. Phones never reach it — they render the
  // flex stack below — but the grid still needs an xs entry for the case where
  // the *container* is narrower than the sm breakpoint on a desktop viewport.
  // Heights are converted from MOBILE_HEIGHT_PX into row units.
  const mobileLayouts = useMemo(() => {
    const items: LayoutItem[] = [];
    let y = 0;
    for (const widget of visibleWidgets) {
      const px = MOBILE_HEIGHT_PX[widget.type] ?? 340;
      const h = Math.max(2, Math.round((px + marginY) / (rowHeight + marginY)));
      items.push({ i: widget.id, x: 0, y, w: 1, h, minW: 1, minH: 2 });
      y += h;
    }
    return items as Layout;
  }, [visibleWidgets, rowHeight, marginY]);

  const sectionLabels = useMemo(() => {
    if (!isDashboard || isMobile) return [];

    // Group visible widgets by section, find the min-y for each section
    const sectionMinY: Partial<Record<WidgetSection, number>> = {};
    const lgLayout = responsiveLayoutSet.lg;

    for (const item of lgLayout) {
      const section = widgetSections[item.i];
      if (!section) continue;
      if (sectionMinY[section] === undefined || item.y < sectionMinY[section]!) {
        sectionMinY[section] = item.y;
      }
    }

    // Convert to sorted array with pixel positions
    return Object.entries(sectionMinY)
      .map(([section, y]) => ({
        section: section as WidgetSection,
        label: sectionMeta[section as WidgetSection].label,
        order: sectionMeta[section as WidgetSection].order,
        pixelY: y! * (rowHeight + marginY),
      }))
      .sort((a, b) => a.order - b.order);
  }, [isDashboard, isMobile, responsiveLayoutSet.lg, rowHeight, marginY]);

  // ─── Mobile: flex stack instead of the grid ──────────────────────────────
  // react-grid-layout absolutely-positions every item and recomputes the whole
  // layout on each render. On a phone that buys nothing: there is one column,
  // and drag/resize are disabled anyway. A flex column scrolls natively, drops
  // the layout math, and keeps widget order in sync with moveWidget() (which
  // reorders `widgets`, which is what visibleWidgets is derived from).
  if (isMobile) {
    return (
      <div className="h-full overflow-y-auto overscroll-contain p-2 flex flex-col gap-2">
        {visibleWidgets.map((widget) => {
          const WidgetComponent = widgetComponents[widget.type];
          return (
            <div
              key={widget.id}
              data-widget-id={widget.id}
              className={cn("shrink-0", MOBILE_HEIGHT_CLASS[widget.type] ?? "h-[340px]")}
            >
              <WidgetComponent />
            </div>
          );
        })}
        {visibleWidgets.length === 0 && (
          <div className="flex items-center justify-center h-64 text-muted-foreground">
            <p className="text-sm">No widgets in this workspace.</p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* ─── Grid ─────────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto p-2 md:p-4" ref={containerRef}>
        {width > 0 && visibleWidgets.length > 0 && (
          <div className="relative">
            {/* Section divider labels (between widget groups, skip the first section) */}
            {sectionLabels.slice(1).map((section) => (
              <div
                key={section.section}
                className="absolute left-0 right-0 z-10 pointer-events-none flex items-center gap-2"
                style={{ top: section.pixelY - 20 }}
              >
                <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/50 shrink-0">
                  {section.label}
                </span>
                <div className="flex-1 h-px bg-border/40" />
              </div>
            ))}
            <ResponsiveGridLayout
              className="layout"
              width={width}
              layouts={{
                lg: responsiveLayoutSet.lg,
                md: responsiveLayoutSet.md,
                sm: responsiveLayoutSet.sm,
                xs: mobileLayouts,
              }}
            breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 0 }}
            cols={{ lg: 12, md: 8, sm: 4, xs: 1 }}
            rowHeight={rowHeight}
            margin={[densityConfig.margin, densityConfig.margin] as [number, number]}
            containerPadding={[0, 0]}
            compactor={activeCompactor}
            dragConfig={{
              enabled: isDashboard,
              handle: ".drag-handle",
              bounded: false,
              threshold: 3,
            }}
            resizeConfig={{
              enabled: isDashboard,
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
          </div>
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
