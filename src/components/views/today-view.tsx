"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useProfile } from "@/components/profile-context";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  Calendar,
  ListTodo,
  Mail,
  GitPullRequest,
  TicketCheck,
  Circle,
  Loader2,
  MapPin,
  Thermometer,
  Wind,
  Droplets,
  Sunrise,
  ArrowRight,
} from "lucide-react";
import { useWorkspace } from "@/components/workspace-context";

// ─── Types ───────────────────────────────────────────────────────────────────

interface WeatherInfo {
  temperature: number;
  condition: string;
  conditionCode: number;
  humidity: number;
  wind: number;
  high: number;
  low: number;
  location: string;
}

interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  location?: string;
  isAllDay?: boolean;
  organizer?: string;
}

interface TaskItem {
  id: string;
  title: string;
  completed: boolean;
  priority: "low" | "medium" | "high";
  dueDate?: string;
}

interface EmailSummary {
  unreadCount: number;
  total: number;
  latestFrom?: string;
  latestSubject?: string;
}

interface PRSummary {
  openCount: number;
  reviewRequested: number;
}

interface JiraSummary {
  inProgressCount: number;
  totalCount: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatEventTime(start: string, end: string, isAllDay?: boolean): string {
  if (isAllDay) return "All day";
  const s = new Date(start);
  const e = new Date(end);
  const fmt = (d: Date) =>
    d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
  return `${fmt(s)} – ${fmt(e)}`;
}

function isNow(start: string, end: string): boolean {
  const now = Date.now();
  return new Date(start).getTime() <= now && now <= new Date(end).getTime();
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function formatDate(): string {
  return new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

const priorityColors: Record<string, string> = {
  high: "text-red-500",
  medium: "text-amber-500",
  low: "text-blue-500",
};

// ─── Component ───────────────────────────────────────────────────────────────

export function TodayView() {
  const { activeProfile } = useProfile();
  const { setActiveWorkspace } = useWorkspace();

  const [weather, setWeather] = useState<WeatherInfo | null>(null);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [emailSummary, setEmailSummary] = useState<EmailSummary | null>(null);
  const [prSummary, setPRSummary] = useState<PRSummary | null>(null);
  const [jiraSummary, setJiraSummary] = useState<JiraSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentTime, setCurrentTime] = useState(new Date());

  // Update clock every minute
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const results = await Promise.allSettled([
      // Weather
      fetch("/api/weather").then((r) => r.json()),
      // Calendar
      fetch(activeProfile === "work" ? "/api/outlook/calendar" : "/api/google/calendar").then((r) => r.json()),
      // Tasks
      fetch(`/api/tasks?profile=${activeProfile}`).then((r) => r.json()),
      // Email (just need counts)
      fetch(activeProfile === "work" ? "/api/outlook/emails" : "/api/google/emails").then((r) => r.json()),
      // PRs
      fetch(`/api/github/prs?profile=${activeProfile}`).then((r) => r.json()),
      // Jira (work only)
      activeProfile === "work" ? fetch("/api/jira").then((r) => r.json()) : Promise.resolve(null),
    ]);

    // Weather
    if (results[0].status === "fulfilled" && !results[0].value.error) {
      const w = results[0].value;
      setWeather({
        temperature: Math.round(w.current?.temperature ?? 0),
        condition: w.current?.condition ?? "",
        conditionCode: w.current?.weatherCode ?? 0,
        humidity: w.current?.humidity ?? 0,
        wind: Math.round(w.current?.windSpeed ?? 0),
        high: Math.round(w.forecast?.[0]?.high ?? 0),
        low: Math.round(w.forecast?.[0]?.low ?? 0),
        location: w.location ?? "Berlin",
      });
    }

    // Calendar — only today's events
    if (results[1].status === "fulfilled" && results[1].value.events) {
      const today = new Date().toDateString();
      const todayEvents = results[1].value.events.filter((e: { start: string }) => {
        const eventDate = new Date(e.start).toDateString();
        return eventDate === today;
      });
      setEvents(todayEvents);
    }

    // Tasks — only incomplete
    if (results[2].status === "fulfilled" && results[2].value.tasks) {
      const incomplete = results[2].value.tasks.filter((t: { completed: boolean }) => !t.completed);
      setTasks(incomplete.slice(0, 10));
    }

    // Email
    if (results[3].status === "fulfilled" && results[3].value.emails) {
      const emails = results[3].value.emails;
      const unread = emails.filter((e: { read: boolean }) => !e.read).length;
      setEmailSummary({
        unreadCount: unread,
        total: emails.length,
        latestFrom: emails[0]?.from,
        latestSubject: emails[0]?.subject,
      });
    }

    // PRs
    if (results[4].status === "fulfilled" && results[4].value.prs) {
      const prs = results[4].value.prs;
      setPRSummary({
        openCount: prs.filter((p: { status: string }) => p.status === "open").length,
        reviewRequested: prs.filter((p: { reviewRequested: boolean }) => p.reviewRequested).length,
      });
    }

    // Jira
    if (results[5].status === "fulfilled" && results[5].value && !results[5].value.error) {
      const issues = results[5].value.issues || [];
      setJiraSummary({
        inProgressCount: issues.filter((i: { status?: string }) => i.status?.toLowerCase().includes("progress")).length,
        totalCount: issues.length,
      });
    }

    setLoading(false);
  }, [activeProfile]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchData();
    const interval = setInterval(fetchData, 5 * 60_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const nextEvent = useMemo(
    () => events.find((e) => new Date(e.end).getTime() > currentTime.getTime()),
    [events, currentTime]
  );

  if (loading && !weather && events.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
          <span className="text-sm">Preparing your day...</span>
        </div>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">
        {/* ─── Header / Greeting ─────────────────────────────── */}
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <Sunrise className="h-6 w-6 text-amber-500" />
            <h1 className="text-2xl font-bold tracking-tight">
              {getGreeting()}
            </h1>
          </div>
          <p className="text-sm text-muted-foreground ml-9">
            {formatDate()} · {currentTime.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })}
          </p>
        </div>

        {/* ─── Weather ───────────────────────────────────────── */}
        {weather && (
          <Card className="border-border/50 bg-gradient-to-br from-card to-card/80">
            <CardContent className="py-4 px-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="text-4xl font-light tracking-tighter">
                    {weather.temperature}°
                  </div>
                  <div className="space-y-0.5">
                    <div className="text-sm font-medium">{weather.condition}</div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Thermometer className="h-3 w-3" />
                        H:{weather.high}° L:{weather.low}°
                      </span>
                      <span className="flex items-center gap-1">
                        <Droplets className="h-3 w-3" />
                        {weather.humidity}%
                      </span>
                      <span className="flex items-center gap-1">
                        <Wind className="h-3 w-3" />
                        {weather.wind} km/h
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <MapPin className="h-3 w-3" />
                  {weather.location}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ─── Quick Stats Row ───────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {emailSummary && (
            <button
              onClick={() => setActiveWorkspace("comms")}
              className="text-left"
            >
              <Card className="border-border/50 hover:border-primary/30 transition-colors cursor-pointer">
                <CardContent className="py-3 px-4">
                  <div className="flex items-center gap-2 mb-1">
                    <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">Email</span>
                  </div>
                  <div className="text-xl font-semibold">
                    {emailSummary.unreadCount}
                    <span className="text-xs font-normal text-muted-foreground ml-1">unread</span>
                  </div>
                </CardContent>
              </Card>
            </button>
          )}

          {prSummary && (
            <button
              onClick={() => setActiveWorkspace("dev")}
              className="text-left"
            >
              <Card className="border-border/50 hover:border-primary/30 transition-colors cursor-pointer">
                <CardContent className="py-3 px-4">
                  <div className="flex items-center gap-2 mb-1">
                    <GitPullRequest className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">PRs</span>
                  </div>
                  <div className="text-xl font-semibold">
                    {prSummary.openCount}
                    <span className="text-xs font-normal text-muted-foreground ml-1">open</span>
                  </div>
                </CardContent>
              </Card>
            </button>
          )}

          {jiraSummary && activeProfile === "work" && (
            <button
              onClick={() => setActiveWorkspace("dev")}
              className="text-left"
            >
              <Card className="border-border/50 hover:border-primary/30 transition-colors cursor-pointer">
                <CardContent className="py-3 px-4">
                  <div className="flex items-center gap-2 mb-1">
                    <TicketCheck className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">Jira</span>
                  </div>
                  <div className="text-xl font-semibold">
                    {jiraSummary.inProgressCount}
                    <span className="text-xs font-normal text-muted-foreground ml-1">in progress</span>
                  </div>
                </CardContent>
              </Card>
            </button>
          )}

          <button
            onClick={() => setActiveWorkspace("notes-tasks")}
            className="text-left"
          >
            <Card className="border-border/50 hover:border-primary/30 transition-colors cursor-pointer">
              <CardContent className="py-3 px-4">
                <div className="flex items-center gap-2 mb-1">
                  <ListTodo className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">Tasks</span>
                </div>
                <div className="text-xl font-semibold">
                  {tasks.length}
                  <span className="text-xs font-normal text-muted-foreground ml-1">pending</span>
                </div>
              </CardContent>
            </Card>
          </button>
        </div>

        {/* ─── Next Up ───────────────────────────────────────── */}
        {nextEvent && (
          <Card className={cn(
            "border-border/50",
            isNow(nextEvent.start, nextEvent.end) && "border-primary/40 bg-primary/5"
          )}>
            <CardHeader className="pb-2 px-5 pt-4">
              <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {isNow(nextEvent.start, nextEvent.end) ? "Happening Now" : "Next Up"}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-5 pb-4">
              <div className="flex items-start gap-3">
                <div className={cn(
                  "w-1 self-stretch rounded-full mt-0.5",
                  isNow(nextEvent.start, nextEvent.end) ? "bg-primary" : "bg-muted-foreground/30"
                )} />
                <div>
                  <div className="font-medium text-sm">{nextEvent.title}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {formatEventTime(nextEvent.start, nextEvent.end, nextEvent.isAllDay)}
                    {nextEvent.location && ` · ${nextEvent.location}`}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ─── Today's Schedule ───────────────────────────────── */}
        <Card className="border-border/50">
          <CardHeader className="pb-2 px-5 pt-4 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              Schedule
            </CardTitle>
            <span className="text-xs text-muted-foreground">{events.length} events</span>
          </CardHeader>
          <CardContent className="px-5 pb-4">
            {events.length === 0 ? (
              <p className="text-sm text-muted-foreground py-2">No events today. Clear day ahead!</p>
            ) : (
              <div className="space-y-1">
                {events.map((event) => {
                  const happening = isNow(event.start, event.end);
                  return (
                    <div
                      key={event.id}
                      className={cn(
                        "flex items-center gap-3 py-1.5 px-2 rounded-md transition-colors",
                        happening && "bg-primary/5"
                      )}
                    >
                      <div className={cn(
                        "w-1.5 h-1.5 rounded-full shrink-0",
                        happening ? "bg-primary animate-pulse" : "bg-muted-foreground/30"
                      )} />
                      <span className="text-xs text-muted-foreground w-24 shrink-0">
                        {formatEventTime(event.start, event.end, event.isAllDay)}
                      </span>
                      <span className={cn("text-sm truncate", happening && "font-medium")}>
                        {event.title}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* ─── Tasks ─────────────────────────────────────────── */}
        {tasks.length > 0 && (
          <Card className="border-border/50">
            <CardHeader className="pb-2 px-5 pt-4 flex flex-row items-center justify-between">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <ListTodo className="h-4 w-4 text-muted-foreground" />
                Tasks
              </CardTitle>
              <button
                onClick={() => setActiveWorkspace("notes-tasks")}
                className="text-xs text-primary hover:underline flex items-center gap-0.5"
              >
                View all <ArrowRight className="h-3 w-3" />
              </button>
            </CardHeader>
            <CardContent className="px-5 pb-4">
              <div className="space-y-1">
                {tasks.map((task) => (
                  <div
                    key={task.id}
                    className="flex items-center gap-2.5 py-1.5 px-2 rounded-md hover:bg-muted/30 transition-colors"
                  >
                    <Circle className={cn("h-3.5 w-3.5 shrink-0", priorityColors[task.priority])} />
                    <span className="text-sm truncate flex-1">{task.title}</span>
                    <span className="text-[10px] text-muted-foreground capitalize">{task.priority}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* ─── Latest Email ──────────────────────────────────── */}
        {emailSummary && emailSummary.latestFrom && (
          <Card className="border-border/50">
            <CardContent className="py-3 px-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 min-w-0">
                  <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{emailSummary.latestSubject}</div>
                    <div className="text-xs text-muted-foreground">From {emailSummary.latestFrom}</div>
                  </div>
                </div>
                <button
                  onClick={() => setActiveWorkspace("comms")}
                  className="text-xs text-primary hover:underline shrink-0 ml-3 flex items-center gap-0.5"
                >
                  Open <ArrowRight className="h-3 w-3" />
                </button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </ScrollArea>
  );
}
