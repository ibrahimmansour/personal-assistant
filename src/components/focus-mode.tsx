"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";
import { useWorkspace } from "@/components/workspace-context";
import { useDashboard } from "@/components/dashboard-context";
import { useIsMobile } from "@/hooks/use-swipe";
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
import { NewsWidget } from "@/components/widgets/news-widget";

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

export function FocusMode() {
  const { focusCombos, activeFocusId, exitFocusMode, updateFocusRatios } = useWorkspace();
  const { widgets } = useDashboard();
  const isMobile = useIsMobile();

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

  // Splitter drag handler — uses Pointer Events so it works for both
  // mouse (desktop) and touch (mobile/tablet).
  const handleSplitterPointerDown = useCallback(
    (e: React.PointerEvent, index: number) => {
      e.preventDefault();
      if (!combo || !containerRef.current) return;

      // Capture pointer so move/up events fire even if the finger leaves the splitter.
      const target = e.currentTarget as HTMLElement;
      target.setPointerCapture(e.pointerId);

      // On mobile, horizontal combos auto-stack vertically (see effectiveDirection
      // below), so the splitter operates on the Y axis there.
      const dir: "horizontal" | "vertical" = isMobile ? "vertical" : combo.direction;
      const isHoriz = dir === "horizontal";
      const startPos = isHoriz ? e.clientX : e.clientY;
      const containerRect = containerRef.current.getBoundingClientRect();
      const containerSize = isHoriz ? containerRect.width : containerRect.height;

      dragStartRef.current = { pos: startPos, ratios: [...combo.ratios] };
      setIsDragging(true);

      function onPointerMove(ev: PointerEvent) {
        if (!dragStartRef.current || !combo) return;
        const currentPos = isHoriz ? ev.clientX : ev.clientY;
        const delta = currentPos - dragStartRef.current.pos;
        const deltaPercent = (delta / containerSize) * 100;

        const newRatios = [...dragStartRef.current.ratios];
        newRatios[index] = Math.max(15, Math.min(85, newRatios[index] + deltaPercent));
        newRatios[index + 1] = Math.max(15, Math.min(85, newRatios[index + 1] - deltaPercent));

        updateFocusRatios(combo.id, newRatios);
      }

      function onPointerUp() {
        setIsDragging(false);
        dragStartRef.current = null;
        target.removeEventListener("pointermove", onPointerMove);
        target.removeEventListener("pointerup", onPointerUp);
        target.removeEventListener("pointercancel", onPointerUp);
      }

      target.addEventListener("pointermove", onPointerMove);
      target.addEventListener("pointerup", onPointerUp);
      target.addEventListener("pointercancel", onPointerUp);
    },
    [combo, updateFocusRatios, isMobile]
  );

  if (!combo) return null;

  // On mobile, force horizontal combos to stack vertically so each panel
  // gets full width. Splitter direction follows.
  const effectiveDirection: "horizontal" | "vertical" =
    isMobile ? "vertical" : combo.direction;
  const isHorizontal = effectiveDirection === "horizontal";

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
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground active:text-foreground px-2.5 py-1.5 rounded-md hover:bg-muted transition-colors"
        >
          <X className="h-3.5 w-3.5 sm:hidden" />
          <span className="hidden sm:inline">Exit</span>
          <kbd className="hidden sm:inline text-[9px] font-mono border border-border rounded px-1 py-0.5">Esc</kbd>
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
                    "shrink-0 flex items-center justify-center group transition-colors touch-none",
                    isHorizontal
                      ? "w-1.5 md:w-1.5 cursor-col-resize hover:bg-primary/10"
                      : "h-3 md:h-1.5 cursor-row-resize hover:bg-primary/10",
                    isDragging && "bg-primary/20"
                  )}
                  onPointerDown={(e) => handleSplitterPointerDown(e, i)}
                >
                  <div
                    className={cn(
                      "rounded-full bg-border group-hover:bg-primary/50 transition-colors",
                      isHorizontal ? "w-0.5 h-8" : "h-0.5 w-12 md:w-8"
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
