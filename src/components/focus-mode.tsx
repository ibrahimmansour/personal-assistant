"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { X, GripVertical } from "lucide-react";
import { useWorkspace } from "@/components/workspace-context";
import { useDashboard } from "@/components/dashboard-context";
import type { WidgetType } from "@/types/widget";

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
};

export function FocusMode() {
  const { focusCombos, activeFocusId, exitFocusMode, updateFocusRatios } = useWorkspace();
  const { widgets } = useDashboard();

  const combo = focusCombos.find((c) => c.id === activeFocusId);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ pos: number; ratios: number[] } | null>(null);

  // Exit focus mode on Escape (also handled in workspace context, but this is a safety net)
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") exitFocusMode();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [exitFocusMode]);

  const handleSplitterMouseDown = useCallback(
    (e: React.MouseEvent, index: number) => {
      e.preventDefault();
      if (!combo || !containerRef.current) return;

      const isHorizontal = combo.direction === "horizontal";
      const startPos = isHorizontal ? e.clientX : e.clientY;
      const containerRect = containerRef.current.getBoundingClientRect();
      const containerSize = isHorizontal ? containerRect.width : containerRect.height;

      dragStartRef.current = { pos: startPos, ratios: [...combo.ratios] };
      setIsDragging(true);

      function onMouseMove(e: MouseEvent) {
        if (!dragStartRef.current || !combo) return;
        const currentPos = isHorizontal ? e.clientX : e.clientY;
        const delta = currentPos - dragStartRef.current.pos;
        const deltaPercent = (delta / containerSize) * 100;

        const newRatios = [...dragStartRef.current.ratios];
        // Move the boundary between panel `index` and `index + 1`
        newRatios[index] = Math.max(15, Math.min(85, newRatios[index] + deltaPercent));
        newRatios[index + 1] = Math.max(15, Math.min(85, newRatios[index + 1] - deltaPercent));

        updateFocusRatios(combo.id, newRatios);
      }

      function onMouseUp() {
        setIsDragging(false);
        dragStartRef.current = null;
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
      }

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [combo, updateFocusRatios]
  );

  if (!combo) return null;

  const isHorizontal = combo.direction === "horizontal";

  return (
    <div className="flex flex-col h-full">
      {/* Focus mode header */}
      <div className="shrink-0 flex items-center justify-between px-4 py-2 border-b border-border/50 bg-background/50">
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-primary animate-pulse" />
          <span className="text-xs font-medium">{combo.name}</span>
          <span className="text-[10px] text-muted-foreground">Focus Mode</span>
        </div>
        <button
          onClick={exitFocusMode}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded-md hover:bg-muted transition-colors"
        >
          <span className="hidden sm:inline">Exit</span>
          <kbd className="text-[9px] font-mono border border-border rounded px-1 py-0.5">Esc</kbd>
        </button>
      </div>

      {/* Split panels */}
      <div
        ref={containerRef}
        className={cn(
          "flex-1 flex overflow-hidden",
          isHorizontal ? "flex-row" : "flex-col"
        )}
      >
        {combo.widgetIds.map((widgetId, i) => {
          const widget = widgets.find((w) => w.id === widgetId);
          if (!widget) return null;
          const WidgetComponent = widgetComponents[widget.type];
          if (!WidgetComponent) return null;

          const ratio = combo.ratios[i] || (100 / combo.widgetIds.length);
          const isLast = i === combo.widgetIds.length - 1;

          return (
            <div key={widgetId} className="contents">
              <div
                className="overflow-hidden"
                style={{
                  [isHorizontal ? "width" : "height"]: `${ratio}%`,
                  flexShrink: 0,
                  flexGrow: 0,
                }}
              >
                <div className="h-full p-2">
                  <WidgetComponent />
                </div>
              </div>
              {/* Splitter */}
              {!isLast && (
                <div
                  className={cn(
                    "shrink-0 flex items-center justify-center group transition-colors",
                    isHorizontal
                      ? "w-1.5 cursor-col-resize hover:bg-primary/10"
                      : "h-1.5 cursor-row-resize hover:bg-primary/10",
                    isDragging && "bg-primary/20"
                  )}
                  onMouseDown={(e) => handleSplitterMouseDown(e, i)}
                >
                  <div
                    className={cn(
                      "rounded-full bg-border group-hover:bg-primary/50 transition-colors",
                      isHorizontal ? "w-0.5 h-8" : "h-0.5 w-8"
                    )}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
