"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { GripVertical, Maximize2, Minimize2, Pin, Columns2, X } from "lucide-react";
import { ReactNode, useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { useCommandPalette } from "@/components/command-palette-context";
import { useWorkspace } from "@/components/workspace-context";
import { useDashboard } from "@/components/dashboard-context";
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
  const [splitWidget, setSplitWidget] = useState<WidgetType | null>(null);
  const [showSplitPicker, setShowSplitPicker] = useState(false);
  const splitPickerRef = useRef<HTMLDivElement>(null);
  const { setExpandedWidget } = useCommandPalette();
  const { pinnedWidgetIds, togglePinWidget, activeWorkspace } = useWorkspace();
  const { widgets } = useDashboard();
  const isPinned = widgetType ? pinnedWidgetIds.includes(widgetType) : false;
  const showPinButton = widgetType && activeWorkspace.id === "dashboard";

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

  // Handle controlled expand requests
  useEffect(() => {
    if (expandRequested && !isExpanded) {
      setIsExpanded(true);
      onExpandChange?.(true);
      onExpandHandled?.();
    }
  }, [expandRequested, isExpanded, onExpandChange, onExpandHandled]);

  // Handle forceExpand from children (e.g. files widget opening split terminal)
  useEffect(() => {
    if (forceExpand && !isExpanded) {
      setIsExpanded(true);
      onExpandChange?.(true);
    }
  }, [forceExpand, isExpanded, onExpandChange]);

  const toggleExpand = useCallback(() => {
    setIsExpanded((prev) => {
      const next = !prev;
      onExpandChange?.(next);
      return next;
    });
  }, [onExpandChange]);

  const collapse = useCallback(() => {
    setIsExpanded(false);
    onExpandChange?.(false);
  }, [onExpandChange]);

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
        "transition-colors p-1 rounded-md hover:bg-muted",
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
      className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded-md hover:bg-muted"
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
          "transition-colors p-1 rounded-md hover:bg-muted",
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

        {/* Fullscreen overlay */}
        {createPortal(
          <div
            className="fixed inset-0 z-[200] flex items-center justify-center p-6 md:p-12"
          >
            {/* Backdrop – click to close */}
            <div
              className="absolute inset-0 bg-background/80 backdrop-blur-sm"
              onClick={collapse}
            />

            {/* Expanded content — split view when sidePanel or splitWidget is active */}
            <div className={cn(
              "relative z-10 w-full h-full max-h-[90vh] flex gap-3",
              hasSplit ? "max-w-[95vw]" : "max-w-[90vw]"
            )}>
              {/* Main card */}
              <Card
                className={cn(
                  "h-full flex flex-col overflow-hidden border-border shadow-2xl bg-card",
                  hasSplit ? "flex-1 min-w-0" : "w-full",
                  className
                )}
              >
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 px-5 pt-4">
                  <div className="flex items-center gap-2">
                    {icon && <span className="text-muted-foreground">{icon}</span>}
                    <CardTitle className="text-base font-semibold">{title}</CardTitle>
                  </div>
                  <div className="flex items-center gap-1">
                    {headerAction}
                    {splitButton}
                    {pinButton}
                    {expandButton}
                  </div>
                </CardHeader>
                <CardContent className="flex-1 overflow-auto px-5 pb-4">
                  {children}
                </CardContent>
              </Card>

              {/* Dynamic split panel from picker */}
              {SplitComponent && (
                <Card className="w-[45%] min-w-[350px] max-w-[600px] h-full shrink-0 flex flex-col overflow-hidden border-border shadow-2xl bg-card">
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 px-5 pt-4">
                    <div className="flex items-center gap-2">
                      <CardTitle className="text-base font-semibold">{widgetLabels[splitWidget!]}</CardTitle>
                    </div>
                    <button
                      onClick={() => setSplitWidget(null)}
                      className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded-md hover:bg-muted"
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

              {/* Side panel (e.g. terminal from files widget) */}
              {!SplitComponent && sidePanel && (
                <div className="w-[45%] min-w-[350px] max-w-[600px] h-full shrink-0">
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
        className
      )}
      data-widget-type={widgetType}
    >
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 px-4 pt-3">
        <div className="flex items-center gap-2">
          <div className="cursor-grab active:cursor-grabbing drag-handle text-muted-foreground hover:text-foreground transition-colors">
            <GripVertical className="h-4 w-4" />
          </div>
          {icon && (
            <span className="text-muted-foreground">{icon}</span>
          )}
          <CardTitle className="text-sm font-semibold">{title}</CardTitle>
        </div>
        <div className="flex items-center gap-1">
          {headerAction}
          {pinButton}
          {expandButton}
        </div>
      </CardHeader>
      <CardContent className="flex-1 overflow-auto px-4 pb-3">
        {children}
      </CardContent>
    </Card>
  );
}
