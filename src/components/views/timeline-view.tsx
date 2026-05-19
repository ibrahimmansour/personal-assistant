"use client";

import { useEffect, useState, useCallback } from "react";
import { useProfile } from "@/components/profile-context";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  Mail,
  MailOpen,
  GitPullRequest,
  GitMerge,
  TicketCheck,
  Calendar,
  ListTodo,
  CheckCircle2,
  Loader2,
  Clock,
  Activity,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

interface TimelineEntry {
  id: string;
  type: "email" | "pr" | "jira" | "calendar" | "task";
  action: string; // e.g. "received", "merged", "created", "completed", "started"
  title: string;
  subtitle: string;
  time: string;
  icon: React.ComponentType<{ className?: string }>;
  iconColor: string;
  data?: any;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatTime(isoStr: string): string {
  return new Date(isoStr).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function formatDayHeader(isoStr: string): string {
  const date = new Date(isoStr);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";

  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function groupByDay(entries: TimelineEntry[]): Map<string, TimelineEntry[]> {
  const groups = new Map<string, TimelineEntry[]>();
  for (const entry of entries) {
    const day = new Date(entry.time).toDateString();
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day)!.push(entry);
  }
  return groups;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function TimelineView() {
  const { activeProfile } = useProfile();
  const [entries, setEntries] = useState<TimelineEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const all: TimelineEntry[] = [];

    const results = await Promise.allSettled([
      // Emails (500 cached)
      fetch(
        (activeProfile === "work" ? "/api/outlook/emails" : "/api/google/emails") + "?limit=500"
      ).then((r) => r.json()),
      // PRs
      fetch(`/api/github/prs?profile=${activeProfile}`).then((r) => r.json()),
      // Calendar
      fetch(activeProfile === "work" ? "/api/outlook/calendar" : "/api/google/calendar").then((r) => r.json()),
      // Tasks
      fetch(`/api/tasks?profile=${activeProfile}`).then((r) => r.json()),
      // Jira
      activeProfile === "work" ? fetch("/api/jira").then((r) => r.json()) : Promise.resolve(null),
    ]);

    // Emails
    if (results[0].status === "fulfilled" && results[0].value.emails) {
      for (const e of results[0].value.emails) {
        all.push({
          id: `email-${e.id}`,
          type: "email",
          action: e.read ? "read" : "received",
          title: e.subject || "(no subject)",
          subtitle: `From ${e.from}`,
          time: e.time,
          icon: e.read ? MailOpen : Mail,
          iconColor: e.read ? "text-muted-foreground" : "text-blue-500",
          data: e,
        });
      }
    }

    // PRs
    if (results[1].status === "fulfilled" && results[1].value.prs) {
      for (const pr of results[1].value.prs) {
        const isMerged = pr.status === "merged";
        all.push({
          id: `pr-${pr.id}`,
          type: "pr",
          action: isMerged ? "merged" : pr.status === "closed" ? "closed" : "opened",
          title: pr.title,
          subtitle: `${pr.repoShort} #${pr.number}`,
          time: pr.updatedAt || pr.createdAt,
          icon: isMerged ? GitMerge : GitPullRequest,
          iconColor: isMerged ? "text-purple-500" : pr.status === "open" ? "text-green-500" : "text-red-500",
          data: pr,
        });
      }
    }

    // Calendar
    if (results[2].status === "fulfilled" && results[2].value.events) {
      for (const ev of results[2].value.events) {
        const isPast = new Date(ev.end || ev.start).getTime() < Date.now();
        all.push({
          id: `cal-${ev.id}`,
          type: "calendar",
          action: isPast ? "ended" : "scheduled",
          title: ev.title,
          subtitle: ev.location || ev.organizer || "",
          time: ev.start,
          icon: Calendar,
          iconColor: isPast ? "text-muted-foreground" : "text-amber-500",
          data: ev,
        });
      }
    }

    // Tasks
    if (results[3].status === "fulfilled" && results[3].value.tasks) {
      for (const t of results[3].value.tasks) {
        all.push({
          id: `task-${t.id}`,
          type: "task",
          action: t.completed ? "completed" : "created",
          title: t.title,
          subtitle: `${t.priority} priority`,
          time: t.completedAt || t.createdAt || new Date().toISOString(),
          icon: t.completed ? CheckCircle2 : ListTodo,
          iconColor: t.completed ? "text-green-500" : "text-amber-500",
          data: t,
        });
      }
    }

    // Jira
    if (results[4].status === "fulfilled" && results[4].value?.issues) {
      for (const i of results[4].value.issues) {
        all.push({
          id: `jira-${i.key}`,
          type: "jira",
          action: i.status?.toLowerCase().includes("done") ? "resolved" :
                  i.status?.toLowerCase().includes("progress") ? "in progress" : "updated",
          title: `${i.key}: ${i.summary}`,
          subtitle: `${i.status} · ${i.type}`,
          time: i.updated || i.created || new Date().toISOString(),
          icon: TicketCheck,
          iconColor: i.status?.toLowerCase().includes("done") ? "text-green-500" : "text-blue-500",
          data: i,
        });
      }
    }

    // Sort newest first
    all.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
    setEntries(all);
    setLoading(false);
  }, [activeProfile]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5 * 60_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const filtered = typeFilter ? entries.filter((e) => e.type === typeFilter) : entries;
  const grouped = groupByDay(filtered);

  // Type counts for filter
  const typeCounts: Record<string, number> = {};
  for (const e of entries) {
    typeCounts[e.type] = (typeCounts[e.type] || 0) + 1;
  }

  const filterButtons: { id: string | null; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: null, label: "All", icon: Activity },
    { id: "email", label: "Email", icon: Mail },
    { id: "pr", label: "PRs", icon: GitPullRequest },
    ...(activeProfile === "work" ? [{ id: "jira", label: "Jira", icon: TicketCheck }] : []),
    { id: "calendar", label: "Calendar", icon: Calendar },
    { id: "task", label: "Tasks", icon: ListTodo },
  ];

  if (loading && entries.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
          <span className="text-sm">Loading timeline...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ─── Filter bar ──────────────────────────────────────── */}
      <div className="shrink-0 flex items-center gap-1 px-4 py-2 border-b border-border/50">
        {filterButtons.map((f) => {
          const Icon = f.icon;
          const count = f.id ? (typeCounts[f.id] || 0) : entries.length;
          return (
            <button
              key={f.id ?? "all"}
              onClick={() => setTypeFilter(f.id)}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors shrink-0",
                typeFilter === f.id
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
              )}
            >
              <Icon className="h-3 w-3" />
              {f.label}
              <span className="text-[10px] opacity-60">{count}</span>
            </button>
          );
        })}
      </div>

      {/* ─── Timeline ────────────────────────────────────────── */}
      <ScrollArea className="flex-1 min-h-0 overflow-hidden">
        <div className="max-w-2xl mx-auto px-6 py-4">
          {Array.from(grouped.entries()).map(([dayKey, dayEntries]) => (
            <div key={dayKey} className="mb-6">
              {/* Day header */}
              <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm py-1.5 mb-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {formatDayHeader(dayEntries[0].time)}
                </h3>
              </div>

              {/* Timeline items */}
              <div className="relative">
                {/* Vertical line */}
                <div className="absolute left-[11px] top-2 bottom-2 w-px bg-border/50" />

                <div className="space-y-0.5">
                  {dayEntries.map((entry, idx) => {
                    const Icon = entry.icon;
                    return (
                      <div
                        key={entry.id}
                        className="flex items-start gap-3 py-1.5 pl-0 pr-2 rounded-lg hover:bg-muted/20 transition-colors group"
                      >
                        {/* Icon dot */}
                        <div className="relative z-[1] shrink-0 mt-0.5">
                          <div className={cn(
                            "h-[22px] w-[22px] rounded-full flex items-center justify-center bg-background border border-border/50 group-hover:border-border",
                          )}>
                            <Icon className={cn("h-3 w-3", entry.iconColor)} />
                          </div>
                        </div>

                        {/* Content */}
                        <div className="flex-1 min-w-0 pt-0.5">
                          <div className="flex items-center gap-2">
                            <span className="text-sm truncate">{entry.title}</span>
                            <span className="text-[10px] text-muted-foreground shrink-0">
                              {formatTime(entry.time)}
                            </span>
                          </div>
                          <div className="text-xs text-muted-foreground truncate">
                            <span className="capitalize">{entry.action}</span>
                            {entry.subtitle && ` · ${entry.subtitle}`}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          ))}

          {filtered.length === 0 && (
            <div className="text-sm text-muted-foreground text-center py-12">
              No activity to show
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
