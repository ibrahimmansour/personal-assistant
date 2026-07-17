"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { GripVertical, Maximize2, Minimize2, Pin, Columns2, X, ArrowUp, ArrowDown, Check } from "lucide-react";
import { ReactNode, useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { useCommandPalette } from "@/components/command-palette-context";
import { useWorkspace } from "@/components/workspace-context";
import { useDashboard } from "@/components/dashboard-context";
import { useSwipe, useLongPress, useIsMobile } from "@/hooks/use-swipe";
import type { WidgetType } from "@/types/widget";

// Lazy widget component map for split view
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

const splitWidgetComponents: Record<WidgetType, React.ComponentType> = {
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

const widgetLabels: Record<WidgetType, string> = {
  clock: "Clock",
  tasks: "Tasks",
  email: "Email",
  reminders: "Reminders",
  calendar: "Calendar",
  weather: "Weather",
  "github-prs": "GitHub PRs",
  jira: "Jira",
  notes: "Notes",
  terminal: "Terminal",
  bookmarks: "Bookmarks",
  files: "Files",
  "claude-code": "Claude Code",
  "system-monitor": "System Monitor",
  news: "News",
};

interface WidgetWrapperProps {
  title: string;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
  headerAction?: ReactNode;
  /** Widget type — used for the per-widget search button */
  widgetType?: WidgetType;
  /** Called when expand state changes – useful for widgets that need to react (e.g. terminal) */
  onExpandChange?: (expanded: boolean) => void;
  /** Controlled expand: when set to true from outside, the widget expands */
  expandRequested?: boolean;
  /** Called after the widget has expanded in response to expandRequested */
  onExpandHandled?: () => void;
  /** Side panel content rendered next to the main card when expanded (split view) */
  sidePanel?: ReactNode;
  /** If true, forces the widget into expanded state (controlled by child) */
  forceExpand?: boolean;
}

export function WidgetWrapper({
  title,
  icon,
  children,
  className,
  headerAction,
  widgetType,
  onExpandChange,
  expandRequested,
  onExpandHandled,
  sidePanel,
  forceExpand,
}: WidgetWrapperProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [splitWidget, setSplitWidget] = useState<WidgetType | null>(null);
  const [showSplitPicker, setShowSplitPicker] = useState(false);
  const splitPickerRef = useRef<HTMLDivElement>(null);
  const fullscreenRef = useRef<HTMLDivElement>(null);
  const isExpandedRef = useRef(false);
  const { setExpandedWidget, collapseSeq } = useCommandPalette();
  const { pinnedWidgetIds, togglePinWidget, activeWorkspace } = useWorkspace();
  const { widgets, moveWidget } = useDashboard();
  const isPinned = widgetType ? pinnedWidgetIds.includes(widgetType) : false;
  const showPinButton = widgetType && activeWorkspace.id === "dashboard";
  const isMobile = useIsMobile();

  // ─── Mobile reorder mode (global) ───
  // A long-press on any widget header dispatches a window event that flips
  // every WidgetWrapper into reorder mode. While in reorder mode, the
  // header shows up/down arrows that call moveWidget() in dashboard-context.
  const [reorderMode, setReorderMode] = useState(false);
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ active: boolean }>).detail;
      setReorderMode(detail?.active ?? false);
    };
    window.addEventListener("widget-reorder-mode", handler);
    return () => window.removeEventListener("widget-reorder-mode", handler);
  }, []);

  // Long-press on the widget header → toggle global reorder mode
  const longPressRef = useLongPress<HTMLDivElement>({
    disabled: isExpanded || activeWorkspace.id !== "dashboard",
    ms: 500,
    onLongPress: () => {
      window.dispatchEvent(
        new CustomEvent("widget-reorder-mode", { detail: { active: !reorderMode } })
      );
    },
  });

  // Close split picker on outside click
  useEffect(() => {
    if (!showSplitPicker) return;
    const handleClick = (e: MouseEvent) => {
      if (splitPickerRef.current && !splitPickerRef.current.contains(e.target as Node)) {
        setShowSplitPicker(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showSplitPicker]);

  // Reset split when collapsing
  useEffect(() => {
    if (!isExpanded) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSplitWidget(null);
      setShowSplitPicker(false);
    }
  }, [isExpanded]);

  // Report expand/collapse to context so Cmd+P knows which widget is active
  useEffect(() => {
    if (isExpanded && widgetType) {
      setExpandedWidget(widgetType);
      return () => setExpandedWidget(null);
    }
  }, [isExpanded, widgetType, setExpandedWidget]);

  // Collapse when a global collapseAll signal fires (e.g. navigating to another widget)
  const collapseSeqRef = useRef(collapseSeq);
  useEffect(() => {
    if (collapseSeq !== collapseSeqRef.current) {
      collapseSeqRef.current = collapseSeq;
      if (isExpanded) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setIsExpanded(false);
        onExpandChange?.(false);
      }
    }
  }, [collapseSeq, isExpanded, onExpandChange]);

  // Handle controlled expand requests
  useEffect(() => {
    if (expandRequested && !isExpanded) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsExpanded(true);
      onExpandChange?.(true);
      onExpandHandled?.();
    }
  }, [expandRequested, isExpanded, onExpandChange, onExpandHandled]);

  // Handle forceExpand from children (e.g. files widget opening split terminal)
  useEffect(() => {
    if (forceExpand && !isExpanded) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsExpanded(true);
      onExpandChange?.(true);
    }
  }, [forceExpand, isExpanded, onExpandChange]);

  // Keep a ref in sync so async handlers (fullscreenchange) read fresh state
  useEffect(() => {
    isExpandedRef.current = isExpanded;
  }, [isExpanded]);

  const collapse = useCallback(() => {
    isExpandedRef.current = false;
    setIsExpanded(false);
    onExpandChange?.(false);
  }, [onExpandChange]);

  const toggleExpand = useCallback(() => {
    if (isExpandedRef.current) {
      collapse();
    } else {
      isExpandedRef.current = true;
      setIsExpanded(true);
      onExpandChange?.(true);
    }
  }, [collapse, onExpandChange]);

  // Track browser (page-level) fullscreen only so mobile swipe-to-dismiss can
  // opt out. Expanding a widget does NOT toggle the native Fullscreen API — the
  // expanded widget is a full-viewport overlay, so collapsing it never drops
  // the page out of fullscreen.
  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  // Close on Escape (but not when focused inside a terminal)
  useEffect(() => {
    if (!isExpanded) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // Don't collapse if Escape was pressed inside a terminal (xterm)
        const target = e.target as HTMLElement;
        if (target?.closest?.(".xterm")) return;
        collapse();
      }
    };
    document.addEventListener("keydown", handleKey);
    // Prevent body scroll when expanded
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = "";
    };
  }, [isExpanded, collapse]);

  const pinButton = showPinButton ? (
    <button
      onClick={() => togglePinWidget(widgetType)}
      className={cn(
        "transition-colors p-2 md:p-1 rounded-md hover:bg-muted",
        isPinned
          ? "text-primary hover:text-primary/80"
          : "text-muted-foreground hover:text-foreground"
      )}
      title={isPinned ? "Unpin from top" : "Pin to top"}
    >
      <Pin className={cn("h-3.5 w-3.5", isPinned && "fill-current")} />
    </button>
  ) : null;

  const expandButton = (
    <button
      onClick={toggleExpand}
      className="text-muted-foreground hover:text-foreground transition-colors p-2 md:p-1 rounded-md hover:bg-muted"
      title={isExpanded ? "Collapse" : "Expand"}
    >
      {isExpanded ? (
        <Minimize2 className="h-3.5 w-3.5" />
      ) : (
        <Maximize2 className="h-3.5 w-3.5" />
      )}
    </button>
  );

  const splitButton = isExpanded && widgetType ? (
    <div className="relative" ref={splitPickerRef}>
      <button
        onClick={() => splitWidget ? setSplitWidget(null) : setShowSplitPicker(!showSplitPicker)}
        className={cn(
          "transition-colors p-2 md:p-1 rounded-md hover:bg-muted",
          splitWidget
            ? "text-primary hover:text-primary/80"
            : "text-muted-foreground hover:text-foreground"
        )}
        title={splitWidget ? "Close split view" : "Split with another widget"}
      >
        {splitWidget ? <X className="h-3.5 w-3.5" /> : <Columns2 className="h-3.5 w-3.5" />}
      </button>
      {showSplitPicker && (
        <div className="absolute right-0 top-full mt-1 z-50 bg-popover border border-border rounded-lg shadow-lg py-1 w-44 max-h-64 overflow-auto">
          {(Object.keys(widgetLabels) as WidgetType[])
            .filter((wt) => wt !== widgetType && widgets.some((w) => w.type === wt && w.visible))
            .map((wt) => (
              <button
                key={wt}
                className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted transition-colors"
                onClick={() => {
                  setSplitWidget(wt);
                  setShowSplitPicker(false);
                }}
              >
                {widgetLabels[wt]}
              </button>
            ))}
        </div>
      )}
    </div>
  ) : null;

  const hasSplit = splitWidget || sidePanel;

  // ─── Mobile gesture: swipe-down to dismiss expanded widget ───
  // Only active in the expanded overlay. We translate the card downward as
  // the finger moves so the dismissal feels physical.
  const [dismissDragY, setDismissDragY] = useState<number | null>(null);
  const dismissSwipeRef = useSwipe<HTMLDivElement>({
    disabled: !isExpanded || isFullscreen,
    axis: "vertical",
    threshold: 100,
    velocityThreshold: 0.5,
    ignoreOnScrollers: true,
    onProgress: ({ dy, axis }) => {
      if (axis !== "vertical" || dy <= 0) {
        setDismissDragY(null);
        return;
      }
      // Apply a soft cap (rubber-band) past 240px
      const capped = dy > 240 ? 240 + (dy - 240) * 0.3 : dy;
      setDismissDragY(capped);
    },
    onSwipeDown: () => {
      setDismissDragY(null);
      collapse();
    },
  });

  // Fullscreen overlay rendered via portal
  if (isExpanded) {
    const SplitComponent = splitWidget ? splitWidgetComponents[splitWidget] : null;

    return (
      <>
        {/* Keep the card in-place as a placeholder so the grid doesn't collapse */}
        <Card
          className={cn(
            "h-full flex flex-col overflow-hidden border-border/50 shadow-sm bg-card opacity-40",
            className
          )}
          data-widget-type={widgetType}
        >
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 px-4 pt-3">
            <div className="flex items-center gap-2">
              <div className="drag-handle text-muted-foreground">
                <GripVertical className="h-4 w-4" />
              </div>
              {icon && <span className="text-muted-foreground">{icon}</span>}
              <CardTitle className="text-sm font-semibold">{title}</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="flex-1 px-4 pb-3" />
        </Card>

        {/* Full-screen overlay — always fills the viewport (no windowed mode) */}
        {createPortal(
          <div
            ref={fullscreenRef}
            className="fixed inset-0 z-[200] flex items-center justify-center p-0 bg-card"
          >
            {/* Expanded content — split view when sidePanel or splitWidget is active */}
            <div className="relative z-10 w-full h-full flex gap-3 max-w-full max-h-full">
              {/* Main card */}
              <Card
                ref={dismissSwipeRef as React.RefObject<HTMLDivElement>}
                style={
                  dismissDragY !== null
                    ? { transform: `translateY(${dismissDragY}px)`, transitionDuration: "0ms" }
                    : undefined
                }
                className={cn(
                  "h-full flex flex-col overflow-hidden border-border shadow-2xl bg-card touch-pan-y rounded-none",
                  hasSplit ? "flex-1 min-w-0" : "w-full",
                  className
                )}
              >
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 px-4 md:px-5 pt-3 md:pt-4">
                  <div className="flex items-center gap-2">
                    {icon && <span className="text-muted-foreground">{icon}</span>}
                    <CardTitle className="text-sm md:text-base font-semibold">{title}</CardTitle>
                  </div>
                  <div className="flex items-center gap-1">
                    {headerAction}
                    <span className="hidden md:inline-flex">{splitButton}</span>
                    {pinButton}
                    {expandButton}
                  </div>
                </CardHeader>
                <CardContent className="flex-1 overflow-auto px-4 md:px-5 pb-3 md:pb-4">
                  {children}
                </CardContent>
              </Card>

              {/* Dynamic split panel from picker (hidden on mobile) */}
              {SplitComponent && (
                <Card className="hidden md:flex w-[45%] min-w-[350px] max-w-[600px] h-full shrink-0 flex-col overflow-hidden border-border shadow-2xl bg-card">
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 px-5 pt-4">
                    <div className="flex items-center gap-2">
                      <CardTitle className="text-base font-semibold">{widgetLabels[splitWidget!]}</CardTitle>
                    </div>
                    <button
                      onClick={() => setSplitWidget(null)}
                      className="text-muted-foreground hover:text-foreground transition-colors p-2 md:p-1 rounded-md hover:bg-muted"
                      title="Close split panel"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </CardHeader>
                  <CardContent className="flex-1 overflow-auto px-5 pb-4">
                    <SplitComponent />
                  </CardContent>
                </Card>
              )}

              {/* Side panel (e.g. terminal from files widget) - hidden on mobile */}
              {!SplitComponent && sidePanel && (
                <div className="hidden md:block w-[45%] min-w-[350px] max-w-[600px] h-full shrink-0">
                  {sidePanel}
                </div>
              )}
            </div>
          </div>,
          document.body
        )}
      </>
    );
  }

  return (
    <Card
      className={cn(
        "h-full flex flex-col overflow-hidden border-border/50 shadow-sm hover:shadow-md transition-shadow bg-card",
        isPinned && "ring-1 ring-primary/30",
        reorderMode && isMobile && "ring-2 ring-primary/40 animate-wiggle",
        className
      )}
      data-widget-type={widgetType}
    >
      <CardHeader
        ref={longPressRef}
        className="flex flex-row items-center justify-between space-y-0 pb-2 px-3 md:px-4 pt-2.5 md:pt-3 select-none"
      >
        <div className="flex items-center gap-2 min-w-0">
          <div className="cursor-grab active:cursor-grabbing drag-handle text-muted-foreground hover:text-foreground transition-colors hidden md:block">
            <GripVertical className="h-4 w-4" />
          </div>
          {icon && (
            <span className="text-muted-foreground">{icon}</span>
          )}
          <CardTitle className="text-xs md:text-sm font-semibold truncate">{title}</CardTitle>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {reorderMode && isMobile && widgetType ? (
            <>
              <button
                onClick={() => moveWidget(widgetType, "up")}
                className="text-muted-foreground hover:text-foreground active:text-primary transition-colors p-2 -m-1 rounded-md hover:bg-muted"
                title="Move up"
                aria-label="Move widget up"
              >
                <ArrowUp className="h-4 w-4" />
              </button>
              <button
                onClick={() => moveWidget(widgetType, "down")}
                className="text-muted-foreground hover:text-foreground active:text-primary transition-colors p-2 -m-1 rounded-md hover:bg-muted"
                title="Move down"
                aria-label="Move widget down"
              >
                <ArrowDown className="h-4 w-4" />
              </button>
              <button
                onClick={() =>
                  window.dispatchEvent(
                    new CustomEvent("widget-reorder-mode", {
                      detail: { active: false },
                    })
                  )
                }
                className="text-primary hover:text-primary/80 transition-colors p-2 -m-1 rounded-md hover:bg-muted ml-1"
                title="Done"
                aria-label="Exit reorder mode"
              >
                <Check className="h-4 w-4" />
              </button>
            </>
          ) : (
            <>
              {headerAction}
              {pinButton}
              {expandButton}
            </>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex-1 overflow-auto px-3 md:px-4 pb-2.5 md:pb-3">
        {children}
      </CardContent>
    </Card>
  );
}
