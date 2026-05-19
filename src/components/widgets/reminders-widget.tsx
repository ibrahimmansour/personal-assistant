"use client";

import { WidgetWrapper } from "@/components/widget-wrapper";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Bell,
  RefreshCw,
  Loader2,
  AlertCircle,
  Clock,
  CheckCircle2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useEffect, useState, useCallback } from "react";
import { useProfile } from "@/components/profile-context";
import { useWidgetNavFor } from "@/components/widget-nav-context";

interface ReminderEvent {
  id: string;
  title: string;
  start: string;
  startRaw: string;
  location: string;
  isAllDay: boolean;
  isPast: boolean;
  isNow: boolean;
  minutesUntil: number;
}

export function RemindersWidget() {
  const [reminders, setReminders] = useState<ReminderEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { activeProfile } = useProfile();
  const { expandRequested, onExpandHandled } = useWidgetNavFor("reminders");

  const fetchReminders = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const endpoint = activeProfile === "private"
        ? "/api/google/calendar"
        : "/api/outlook/calendar";
      const res = await fetch(endpoint);
      const data = await res.json();
      if (data.error) {
        setError(data.error);
        return;
      }

      const now = new Date();
      const todayEvents = (data.events || [])
        .filter((e: any) => e.isToday && !e.isAllDay)
        .map((e: any) => {
          // Handle both Outlook (bare datetime + "Z") and Google (ISO with offset)
          const startDate = new Date(
            e.startRaw.includes("T") && !e.startRaw.includes("Z") && !e.startRaw.includes("+") && !e.startRaw.includes("-", 10)
              ? e.startRaw + "Z"
              : e.startRaw
          );
          const endDate = new Date(
            e.endRaw.includes("T") && !e.endRaw.includes("Z") && !e.endRaw.includes("+") && !e.endRaw.includes("-", 10)
              ? e.endRaw + "Z"
              : e.endRaw
          );
          const diffMs = startDate.getTime() - now.getTime();
          const minutesUntil = Math.floor(diffMs / 60000);
          const isPast = endDate.getTime() < now.getTime();
          const isNow =
            startDate.getTime() <= now.getTime() &&
            endDate.getTime() >= now.getTime();

          return {
            id: e.id,
            title: e.title,
            start: e.start,
            startRaw: e.startRaw,
            location: e.location,
            isAllDay: e.isAllDay,
            isPast,
            isNow,
            minutesUntil,
          };
        });

      setReminders(todayEvents);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch reminders");
    } finally {
      setLoading(false);
    }
  }, [activeProfile]);

  useEffect(() => {
    setReminders([]);
    setError(null);
    fetchReminders();
    // Refresh every minute to update "minutes until"
    const interval = setInterval(fetchReminders, 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchReminders]);

  const upcoming = reminders.filter((r) => !r.isPast);
  const past = reminders.filter((r) => r.isPast);

  function formatUntil(minutes: number, isNow: boolean): string {
    if (isNow) return "Now";
    if (minutes < 0) return "Passed";
    if (minutes < 1) return "Starting";
    if (minutes < 60) return `in ${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `in ${hours}h ${mins}m` : `in ${hours}h`;
  }

  return (
    <WidgetWrapper
      title="Reminders"
      widgetType="reminders"
      icon={<Bell className="h-4 w-4" />}
      expandRequested={expandRequested}
      onExpandHandled={onExpandHandled}
      headerAction={
        <div className="flex items-center gap-2">
          {!loading && !error && (
            <span className="text-xs text-muted-foreground">
              {upcoming.length} upcoming
            </span>
          )}
          <button
            onClick={fetchReminders}
            disabled={loading}
            className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded-md hover:bg-muted disabled:opacity-50"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          </button>
        </div>
      }
    >
      {loading && reminders.length === 0 ? (
        <div className="flex items-center justify-center h-full">
          <div className="flex flex-col items-center gap-2 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-xs">Loading reminders...</span>
          </div>
        </div>
      ) : error ? (
        <div className="flex items-center justify-center h-full">
          <div className="flex flex-col items-center gap-2 text-muted-foreground text-center px-4">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-xs">{error}</span>
            <button onClick={fetchReminders} className="text-xs text-primary hover:underline mt-1">
              Try again
            </button>
          </div>
        </div>
      ) : reminders.length === 0 ? (
        <div className="flex items-center justify-center h-full text-muted-foreground">
          <span className="text-sm">No events today</span>
        </div>
      ) : (
        <ScrollArea className="h-full -mx-1 px-1">
          <div className="space-y-1">
            {upcoming.map((r) => (
              <div
                key={r.id}
                className={cn(
                  "flex items-center gap-3 p-2 rounded-lg transition-colors",
                  r.isNow
                    ? "bg-primary/10 border border-primary/20"
                    : "hover:bg-muted/50"
                )}
              >
                {r.isNow ? (
                  <div className="h-2 w-2 rounded-full bg-primary animate-pulse shrink-0" />
                ) : (
                  <Clock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <p className={cn("text-sm truncate", r.isNow && "font-medium")}>
                    {r.title}
                  </p>
                </div>
                <span
                  className={cn(
                    "text-xs shrink-0 tabular-nums",
                    r.isNow
                      ? "text-primary font-medium"
                      : r.minutesUntil <= 15
                        ? "text-orange-500 font-medium"
                        : "text-muted-foreground"
                  )}
                >
                  {formatUntil(r.minutesUntil, r.isNow)}
                </span>
              </div>
            ))}
            {past.length > 0 && (
              <>
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider pt-2 pb-1 px-1">
                  Completed
                </div>
                {past.map((r) => (
                  <div
                    key={r.id}
                    className="flex items-center gap-3 p-2 rounded-lg opacity-50"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <p className="text-sm truncate flex-1 line-through text-muted-foreground">
                      {r.title}
                    </p>
                    <span className="text-xs text-muted-foreground shrink-0">{r.start}</span>
                  </div>
                ))}
              </>
            )}
          </div>
        </ScrollArea>
      )}
    </WidgetWrapper>
  );
}
