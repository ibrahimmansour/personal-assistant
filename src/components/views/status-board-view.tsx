"use client";

import { useEffect, useState, useCallback } from "react";
import { useProfile } from "@/components/profile-context";
import { useWorkspace } from "@/components/workspace-context";
import { cn } from "@/lib/utils";
import {
  CloudSun,
  Cloud,
  Sun,
  CloudRain,
  Snowflake,
  Calendar,
  Mail,
  GitPullRequest,
  TicketCheck,
  Loader2,
  TrendingUp,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

interface WeatherInfo {
  temperature: number;
  condition: string;
  conditionCode: number;
  high: number;
  low: number;
  location: string;
}

interface NextMeeting {
  title: string;
  start: string;
  end: string;
  location?: string;
  minutesUntil: number;
}

interface UnreadCounts {
  emails: number;
  prs: number;
  jira: number;
}

interface SprintInfo {
  currentDay: number;
  totalDays: number;
  completedPoints: number;
  totalPoints: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getWeatherIcon(code: number) {
  if (code <= 1) return <Sun className="h-12 w-12 text-amber-400" />;
  if (code <= 3) return <CloudSun className="h-12 w-12 text-amber-300" />;
  if (code <= 48) return <Cloud className="h-12 w-12 text-muted-foreground" />;
  if (code <= 67) return <CloudRain className="h-12 w-12 text-blue-400" />;
  if (code <= 77) return <Snowflake className="h-12 w-12 text-blue-200" />;
  return <CloudRain className="h-12 w-12 text-blue-400" />;
}

function formatMeetingCountdown(minutes: number): string {
  if (minutes <= 0) return "Now";
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function formatMeetingTime(start: string, end: string): string {
  const fmt = (d: Date) =>
    d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
  return `${fmt(new Date(start))} · ${Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000)} min`;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function StatusBoardView() {
  const { activeProfile } = useProfile();
  const { setActiveWorkspace } = useWorkspace();

  const [currentTime, setCurrentTime] = useState(new Date());
  const [weather, setWeather] = useState<WeatherInfo | null>(null);
  const [nextMeeting, setNextMeeting] = useState<NextMeeting | null>(null);
  const [unread, setUnread] = useState<UnreadCounts>({ emails: 0, prs: 0, jira: 0 });
  const [sprint, setSprint] = useState<SprintInfo | null>(null);
  const [tasks, setTasks] = useState({ completed: 0, total: 0 });
  const [loading, setLoading] = useState(true);

  // Live clock — update every second
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const results = await Promise.allSettled([
      fetch("/api/weather").then((r) => r.json()),
      fetch(activeProfile === "work" ? "/api/outlook/calendar" : "/api/google/calendar").then((r) => r.json()),
      fetch(activeProfile === "work" ? "/api/outlook/emails" : "/api/google/emails").then((r) => r.json()),
      fetch(`/api/github/prs?profile=${activeProfile}`).then((r) => r.json()),
      activeProfile === "work" ? fetch("/api/jira").then((r) => r.json()) : Promise.resolve(null),
      fetch(`/api/tasks?profile=${activeProfile}`).then((r) => r.json()),
    ]);

    // Weather
    if (results[0].status === "fulfilled" && !results[0].value.error) {
      const w = results[0].value;
      setWeather({
        temperature: Math.round(w.current?.temperature ?? 0),
        condition: w.current?.condition ?? "",
        conditionCode: w.current?.weatherCode ?? 0,
        high: Math.round(w.forecast?.[0]?.high ?? 0),
        low: Math.round(w.forecast?.[0]?.low ?? 0),
        location: w.location ?? "Berlin",
      });
    }

    // Calendar — find next meeting
    if (results[1].status === "fulfilled" && results[1].value.events) {
      const now = Date.now();
      const upcoming = results[1].value.events
        .filter((e: { end: string; isAllDay?: boolean }) => new Date(e.end).getTime() > now && !e.isAllDay)
        .sort((a: { start: string }, b: { start: string }) => new Date(a.start).getTime() - new Date(b.start).getTime());
      if (upcoming.length > 0) {
        const evt = upcoming[0];
        const minutesUntil = Math.max(0, Math.round((new Date(evt.start).getTime() - now) / 60000));
        setNextMeeting({
          title: evt.title,
          start: evt.start,
          end: evt.end,
          location: evt.location,
          minutesUntil,
        });
      } else {
        setNextMeeting(null);
      }
    }

    // Email unread count
    let emailCount = 0;
    if (results[2].status === "fulfilled" && results[2].value.emails) {
      emailCount = results[2].value.emails.filter((e: { read?: boolean }) => !e.read).length;
    }

    // PR count
    let prCount = 0;
    if (results[3].status === "fulfilled" && results[3].value.prs) {
      prCount = results[3].value.prs.filter((p: { reviewRequested?: boolean }) => p.reviewRequested).length;
    }

    // Jira count
    let jiraCount = 0;
    if (results[4].status === "fulfilled" && results[4].value && !results[4].value.error) {
      jiraCount = (results[4].value.issues || []).length;
    }

    setUnread({ emails: emailCount, prs: prCount, jira: jiraCount });

    // Tasks
    if (results[5].status === "fulfilled" && results[5].value.tasks) {
      const allTasks = results[5].value.tasks;
      setTasks({
        completed: allTasks.filter((t: { completed?: boolean }) => t.completed).length,
        total: allTasks.length,
      });
    }

    // Sprint (mock for now — could be sourced from Jira API later)
    if (activeProfile === "work") {
      const dayOfSprint = new Date().getDay() || 7; // 1-7
      setSprint({
        currentDay: Math.min(dayOfSprint + 3, 14),
        totalDays: 14,
        completedPoints: 18,
        totalPoints: 29,
      });
    }

    setLoading(false);
  }, [activeProfile]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 3 * 60_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // Update meeting countdown every minute
  useEffect(() => {
    if (!nextMeeting) return;
    const timer = setInterval(() => {
      const minutesUntil = Math.max(
        0,
        Math.round((new Date(nextMeeting.start).getTime() - Date.now()) / 60000)
      );
      setNextMeeting((prev) => (prev ? { ...prev, minutesUntil } : null));
    }, 60_000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nextMeeting?.start]);

  if (loading && !weather) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
          <span className="text-sm">Loading status board...</span>
        </div>
      </div>
    );
  }

  const hours = String(currentTime.getHours()).padStart(2, "0");
  const minutes = String(currentTime.getMinutes()).padStart(2, "0");
  const seconds = String(currentTime.getSeconds()).padStart(2, "0");
  const dateStr = currentTime.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  const sprintPct = sprint ? Math.round((sprint.completedPoints / sprint.totalPoints) * 100) : 0;
  const taskPct = tasks.total > 0 ? Math.round((tasks.completed / tasks.total) * 100) : 0;

  return (
    <div className="h-full p-3 md:p-5 flex flex-col gap-3 md:gap-5">
      <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 md:grid-rows-2 gap-3 md:gap-5 min-h-0 overflow-auto md:overflow-hidden">
        {/* ─── Clock ─────────────────────────────────────────── */}
        <div
          className="rounded-2xl border bg-card flex flex-col items-center justify-center cursor-pointer hover:bg-accent/5 transition-colors"
          onClick={() => setActiveWorkspace("dashboard")}
        >
          <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">
            Time
          </span>
          <div className="tabular-nums font-extralight leading-none" style={{ fontSize: "clamp(3rem, 6vw, 6rem)" }}>
            {hours}:{minutes}
            <span className="text-muted-foreground ml-1" style={{ fontSize: "0.4em" }}>
              {seconds}
            </span>
          </div>
          <span className="text-sm text-muted-foreground mt-2">{dateStr}</span>
        </div>

        {/* ─── Weather ───────────────────────────────────────── */}
        <div className="rounded-2xl border bg-card flex flex-col items-center justify-center">
          <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">
            Weather · {weather?.location ?? "—"}
          </span>
          {weather ? (
            <>
              {getWeatherIcon(weather.conditionCode)}
              <div className="font-extralight leading-none mt-2" style={{ fontSize: "clamp(2.5rem, 5vw, 5rem)" }}>
                {weather.temperature}°
              </div>
              <span className="text-sm text-muted-foreground mt-1">{weather.condition}</span>
              <span className="text-xs text-muted-foreground mt-0.5">
                H: {weather.high}° · L: {weather.low}°
              </span>
            </>
          ) : (
            <span className="text-muted-foreground text-sm">Unavailable</span>
          )}
        </div>

        {/* ─── Next Meeting ──────────────────────────────────── */}
        <div
          className="rounded-2xl border bg-card flex flex-col items-center justify-center cursor-pointer hover:bg-accent/5 transition-colors"
          onClick={() => setActiveWorkspace("comms")}
        >
          <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">
            Next Meeting
          </span>
          {nextMeeting ? (
            <>
              <div
                className={cn(
                  "font-extralight leading-none",
                  nextMeeting.minutesUntil <= 5 ? "text-red-500" : nextMeeting.minutesUntil <= 15 ? "text-amber-500" : "text-amber-400"
                )}
                style={{ fontSize: "clamp(2rem, 4vw, 4rem)" }}
              >
                {formatMeetingCountdown(nextMeeting.minutesUntil)}
              </div>
              <span className="text-lg font-medium mt-2">{nextMeeting.title}</span>
              <span className="text-xs text-muted-foreground mt-1">
                {formatMeetingTime(nextMeeting.start, nextMeeting.end)}
                {nextMeeting.location ? ` · ${nextMeeting.location}` : ""}
              </span>
            </>
          ) : (
            <>
              <Calendar className="h-10 w-10 text-muted-foreground/50 mb-2" />
              <span className="text-muted-foreground text-sm">No upcoming meetings</span>
            </>
          )}
        </div>

        {/* ─── Tasks Progress ────────────────────────────────── */}
        <div
          className="rounded-2xl border bg-card flex flex-col items-center justify-center cursor-pointer hover:bg-accent/5 transition-colors"
          onClick={() => setActiveWorkspace("notes-tasks")}
        >
          <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">
            Tasks
          </span>
          <div className="relative flex items-center justify-center">
            <svg width="100" height="100" viewBox="0 0 100 100">
              <circle cx="50" cy="50" r="42" fill="none" stroke="currentColor" strokeWidth="4" className="text-border" />
              <circle
                cx="50"
                cy="50"
                r="42"
                fill="none"
                stroke="currentColor"
                strokeWidth="4"
                strokeDasharray={`${2 * Math.PI * 42}`}
                strokeDashoffset={`${2 * Math.PI * 42 * (1 - taskPct / 100)}`}
                strokeLinecap="round"
                className="text-green-500 -rotate-90 origin-center transition-all duration-700"
              />
            </svg>
            <span className="absolute text-2xl font-light">{taskPct}%</span>
          </div>
          <span className="text-sm text-muted-foreground mt-2">
            {tasks.completed} of {tasks.total} done
          </span>
        </div>

        {/* ─── Unread Counts ─────────────────────────────────── */}
        <div className="rounded-2xl border bg-card flex flex-col items-center justify-center">
          <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-4">
            Unread
          </span>
          <div className="flex gap-6 md:gap-10">
            <button
              onClick={() => setActiveWorkspace("comms")}
              className="text-center group cursor-pointer"
            >
              <div className="font-extralight leading-none text-primary tabular-nums" style={{ fontSize: "clamp(2rem, 4vw, 4rem)" }}>
                {unread.emails}
              </div>
              <div className="flex items-center gap-1.5 mt-2 text-xs text-muted-foreground uppercase tracking-wide group-hover:text-foreground transition-colors">
                <Mail className="h-3.5 w-3.5" />
                Emails
              </div>
            </button>
            <button
              onClick={() => setActiveWorkspace("dev")}
              className="text-center group cursor-pointer"
            >
              <div className="font-extralight leading-none text-green-500 tabular-nums" style={{ fontSize: "clamp(2rem, 4vw, 4rem)" }}>
                {unread.prs}
              </div>
              <div className="flex items-center gap-1.5 mt-2 text-xs text-muted-foreground uppercase tracking-wide group-hover:text-foreground transition-colors">
                <GitPullRequest className="h-3.5 w-3.5" />
                PRs
              </div>
            </button>
            {activeProfile === "work" && (
              <button
                onClick={() => setActiveWorkspace("dev")}
                className="text-center group cursor-pointer"
              >
                <div className="font-extralight leading-none text-amber-500 tabular-nums" style={{ fontSize: "clamp(2rem, 4vw, 4rem)" }}>
                  {unread.jira}
                </div>
                <div className="flex items-center gap-1.5 mt-2 text-xs text-muted-foreground uppercase tracking-wide group-hover:text-foreground transition-colors">
                  <TicketCheck className="h-3.5 w-3.5" />
                  Jira
                </div>
              </button>
            )}
          </div>
        </div>

        {/* ─── Sprint / Progress ─────────────────────────────── */}
        <div className="rounded-2xl border bg-card flex flex-col items-center justify-center">
          <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">
            {activeProfile === "work" ? "Sprint Progress" : "Weekly Progress"}
          </span>
          {sprint && activeProfile === "work" ? (
            <>
              <div className="font-extralight leading-none text-primary" style={{ fontSize: "clamp(2rem, 4vw, 4rem)" }}>
                {sprintPct}%
              </div>
              <span className="text-sm text-muted-foreground mt-2">
                Day {sprint.currentDay} of {sprint.totalDays} · {sprint.completedPoints} of {sprint.totalPoints} pts
              </span>
              <div className="w-full max-w-[280px] h-3 bg-border rounded-full overflow-hidden mt-3">
                <div
                  className="h-full bg-primary rounded-full transition-all duration-700"
                  style={{ width: `${sprintPct}%` }}
                />
              </div>
            </>
          ) : (
            <>
              <div className="relative flex items-center justify-center">
                <svg width="100" height="100" viewBox="0 0 100 100">
                  <circle cx="50" cy="50" r="42" fill="none" stroke="currentColor" strokeWidth="4" className="text-border" />
                  <circle
                    cx="50"
                    cy="50"
                    r="42"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="4"
                    strokeDasharray={`${2 * Math.PI * 42}`}
                    strokeDashoffset={`${2 * Math.PI * 42 * (1 - taskPct / 100)}`}
                    strokeLinecap="round"
                    className="text-primary -rotate-90 origin-center transition-all duration-700"
                  />
                </svg>
                <TrendingUp className="absolute h-6 w-6 text-primary" />
              </div>
              <span className="text-sm text-muted-foreground mt-2">
                {tasks.completed} tasks completed this week
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
