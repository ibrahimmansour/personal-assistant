"use client";

import { WidgetWrapper } from "@/components/widget-wrapper";
import { HtmlContent } from "@/components/html-content";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  Calendar,
  ChevronRight,
  RefreshCw,
  Loader2,
  AlertCircle,
  MapPin,
  ExternalLink,
  ArrowLeft,
  Clock,
  Users,
  Video,
  User,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useEffect, useState, useCallback } from "react";
import { useProfile } from "@/components/profile-context";
import { useWidgetNavFor } from "@/components/widget-nav-context";
import { useRefreshOnVisible } from "@/hooks/use-refresh-on-visible";

interface Attendee {
  name: string;
  status: string;
}

interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  startRaw: string;
  endRaw: string;
  startFormatted?: string;
  endFormatted?: string;
  location: string;
  organizer: string;
  isAllDay: boolean;
  isToday: boolean;
  color: string;
  webLink: string;
  bodyPreview: string;
  bodyHtml: string | null;
  onlineMeetingUrl: string;
  attendees: Attendee[];
}

function formatEventTime(isoStr: string): string {
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return isoStr;
  return d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

const responseLabels: Record<string, { label: string; color: string }> = {
  accepted: { label: "Accepted", color: "text-green-600 dark:text-green-400" },
  tentativelyAccepted: { label: "Tentative", color: "text-amber-600 dark:text-amber-400" },
  declined: { label: "Declined", color: "text-red-600 dark:text-red-400" },
  none: { label: "No response", color: "text-muted-foreground" },
  notResponded: { label: "No response", color: "text-muted-foreground" },
  organizer: { label: "Organizer", color: "text-primary" },
};

function formatDuration(startRaw: string, endRaw: string): string {
  const start = new Date(startRaw + "Z");
  const end = new Date(endRaw + "Z");
  const diffMs = end.getTime() - start.getTime();
  const diffMin = Math.round(diffMs / 60000);
  if (diffMin < 60) return `${diffMin} min`;
  const hours = Math.floor(diffMin / 60);
  const mins = diffMin % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

export function CalendarWidget() {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const { activeProfile } = useProfile();
  const { expandRequested, onExpandHandled, pendingItemId, clearPendingItem } =
    useWidgetNavFor("calendar");

  // Handle navigation from command palette
  useEffect(() => {
    if (pendingItemId) {
      setSelectedId(pendingItemId);
      clearPendingItem();
    }
  }, [pendingItemId, clearPendingItem]);

  const fetchEvents = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      setAuthUrl(null);
      const endpoint = activeProfile === "private"
        ? "/api/google/calendar"
        : "/api/outlook/calendar";
      const res = await fetch(endpoint);
      const data = await res.json();
      if (data.authRequired && data.authUrl) {
        setAuthUrl(data.authUrl);
        setError(data.error);
        return;
      }
      if (data.error) {
        setError(data.error);
        return;
      }
      setEvents(data.events);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch calendar");
    } finally {
      setLoading(false);
    }
  }, [activeProfile]);

  useEffect(() => {
    setSelectedId(null);
    fetchEvents();
    const interval = setInterval(fetchEvents, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchEvents]);

  // Refresh events when tab becomes visible after being hidden 30s+
  useRefreshOnVisible(fetchEvents);

  const todayEvents = events.filter((e) => e.isToday);
  const selectedEvent = selectedId ? events.find((e) => e.id === selectedId) : null;

  // Detail view for a selected event
  if (selectedEvent) {
    const duration = selectedEvent.isAllDay
      ? "All day"
      : formatDuration(selectedEvent.startRaw, selectedEvent.endRaw);

    return (
      <WidgetWrapper
        title="Today's Schedule"
        widgetType="calendar"
        icon={<Calendar className="h-4 w-4" />}
        expandRequested={expandRequested}
        onExpandHandled={onExpandHandled}
        headerAction={
          <div className="flex items-center gap-1">
            <button
              onClick={() => setSelectedId(null)}
              className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded-md hover:bg-muted"
              title="Back to schedule"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
            </button>
            {selectedEvent.webLink && (
              <a
                href={selectedEvent.webLink}
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded-md hover:bg-muted"
                title="Open in Outlook"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
          </div>
        }
      >
        <div className="flex flex-col h-full">
          {/* Title with color dot */}
          <div className="flex items-start gap-2 mb-3">
            <div className={cn("w-3 h-3 rounded-full shrink-0 mt-0.5", selectedEvent.color)} />
            <h3 className="text-sm font-semibold leading-snug">
              {selectedEvent.title}
            </h3>
          </div>

          {/* Time & duration */}
          <div className="space-y-2 mb-3">
            <div className="flex items-center gap-2 text-xs">
              <Clock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              {selectedEvent.isAllDay ? (
                <span>All day</span>
              ) : (
                <span>
                  {selectedEvent.startFormatted || formatEventTime(selectedEvent.start)} - {selectedEvent.endFormatted || formatEventTime(selectedEvent.end)}
                  <span className="text-muted-foreground ml-1">({duration})</span>
                </span>
              )}
            </div>

            {/* Location */}
            {selectedEvent.location && (
              <div className="flex items-center gap-2 text-xs">
                <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="truncate">{selectedEvent.location}</span>
              </div>
            )}

            {/* Online meeting */}
            {selectedEvent.onlineMeetingUrl && (
              <div className="flex items-center gap-2 text-xs">
                <Video className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <a
                  href={selectedEvent.onlineMeetingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline truncate"
                >
                  Join online meeting
                </a>
              </div>
            )}

            {/* Organizer */}
            {selectedEvent.organizer && (
              <div className="flex items-center gap-2 text-xs">
                <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="text-muted-foreground">Organizer:</span>
                <span className="truncate">{selectedEvent.organizer}</span>
              </div>
            )}
          </div>

          {/* Attendees */}
          {selectedEvent.attendees.length > 0 && (
            <>
              <Separator className="mb-2" />
              <div className="mb-2">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1.5">
                  <Users className="h-3.5 w-3.5" />
                  <span>{selectedEvent.attendees.length} attendees</span>
                </div>
                <ScrollArea className="max-h-24">
                  <div className="space-y-1">
                    {selectedEvent.attendees.map((a, i) => {
                      const resp = responseLabels[a.status] || responseLabels.none;
                      return (
                        <div key={i} className="flex items-center justify-between text-xs px-1">
                          <span className="truncate flex-1">{a.name}</span>
                          <span className={cn("text-[10px] shrink-0 ml-2", resp.color)}>
                            {resp.label}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>
              </div>
            </>
          )}

          {/* Body - render HTML in sandboxed iframe, fallback to plain text preview */}
          {(selectedEvent.bodyHtml || selectedEvent.bodyPreview) && (
            <>
              <Separator className="mb-2" />
              <ScrollArea className="flex-1 -mx-1 px-1">
                <HtmlContent
                  html={selectedEvent.bodyHtml || ""}
                  fallbackText={selectedEvent.bodyPreview}
                />
              </ScrollArea>
            </>
          )}
        </div>
      </WidgetWrapper>
    );
  }

  // List view
  return (
    <WidgetWrapper
      title="Today's Schedule"
      widgetType="calendar"
      icon={<Calendar className="h-4 w-4" />}
      expandRequested={expandRequested}
      onExpandHandled={onExpandHandled}
      headerAction={
        <div className="flex items-center gap-2">
          {!loading && !error && (
            <span className="text-xs text-muted-foreground">
              {todayEvents.length} events
            </span>
          )}
          <button
            onClick={fetchEvents}
            disabled={loading}
            className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded-md hover:bg-muted disabled:opacity-50"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          </button>
        </div>
      }
    >
      {loading && events.length === 0 ? (
        <div className="flex items-center justify-center h-full">
          <div className="flex flex-col items-center gap-2 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-xs">Loading calendar...</span>
          </div>
        </div>
      ) : error ? (
        <div className="flex items-center justify-center h-full">
          <div className="flex flex-col items-center gap-2 text-muted-foreground text-center px-4">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-xs">{error}</span>
            {authUrl ? (
              <a
                href={authUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-primary hover:underline mt-1"
              >
                Connect Google Account
              </a>
            ) : (
              <button onClick={fetchEvents} className="text-xs text-primary hover:underline mt-1">
                Try again
              </button>
            )}
          </div>
        </div>
      ) : todayEvents.length === 0 ? (
        <div className="flex items-center justify-center h-full text-muted-foreground">
          <span className="text-sm">No events today</span>
        </div>
      ) : (
        <ScrollArea className="h-full -mx-1 px-1">
          <div className="space-y-2">
            {todayEvents.map((event, index) => (
              <div
                key={event.id}
                onClick={() => setSelectedId(event.id)}
                className="flex items-stretch gap-3 group cursor-pointer"
              >
                <div className="flex flex-col items-end w-16 shrink-0 pt-0.5">
                  {event.isAllDay ? (
                    <span className="text-xs font-medium">All day</span>
                  ) : (
                    <>
                      <span className="text-xs font-medium tabular-nums">{event.startFormatted || formatEventTime(event.start)}</span>
                      <span className="text-[10px] text-muted-foreground tabular-nums">{event.endFormatted || formatEventTime(event.end)}</span>
                    </>
                  )}
                </div>
                <div className="flex flex-col items-center">
                  <div className={cn("w-2 h-2 rounded-full shrink-0 mt-1.5", event.color)} />
                  {index < todayEvents.length - 1 && (
                    <div className="w-0.5 flex-1 bg-border mt-1" />
                  )}
                </div>
                <div className="flex-1 pb-3 min-w-0">
                  <p className="text-sm font-medium truncate group-hover:text-primary transition-colors">
                    {event.title}
                  </p>
                  {event.location && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                      <MapPin className="h-3 w-3 shrink-0" />
                      <span className="truncate">{event.location}</span>
                    </p>
                  )}
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity mt-1 shrink-0" />
              </div>
            ))}
          </div>
        </ScrollArea>
      )}
    </WidgetWrapper>
  );
}
