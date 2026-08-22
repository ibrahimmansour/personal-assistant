"use client";

import { useEffect, useState, useCallback } from "react";
import { useProfile } from "@/components/profile-context";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { ItemDetail, type DetailItem } from "@/components/views/item-detail";
import {
  Mail,
  GitPullRequest,
  TicketCheck,
  Calendar,
  ListTodo,
  Loader2,
  Inbox,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

type InboxFilter = "all" | "email" | "prs" | "jira" | "calendar" | "tasks";

/** Adds the two list-only flags on top of the shared detail shape. */
interface InboxItem extends DetailItem {
  read?: boolean;
  priority?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function timeAgo(isoStr: string): string {
  const diff = Date.now() - new Date(isoStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  return new Date(isoStr).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const filterConfig: { id: InboxFilter; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "all", label: "All", icon: Inbox },
  { id: "email", label: "Email", icon: Mail },
  { id: "prs", label: "PRs", icon: GitPullRequest },
  { id: "jira", label: "Jira", icon: TicketCheck },
  { id: "calendar", label: "Calendar", icon: Calendar },
  { id: "tasks", label: "Tasks", icon: ListTodo },
];

const typeIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  email: Mail,
  prs: GitPullRequest,
  jira: TicketCheck,
  calendar: Calendar,
  tasks: ListTodo,
};

// ─── Component ───────────────────────────────────────────────────────────────

export function InboxView() {
  const { activeProfile } = useProfile();
  const [items, setItems] = useState<InboxItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<InboxFilter>("all");
  const [selectedItem, setSelectedItem] = useState<InboxItem | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const allItems: InboxItem[] = [];

    const results = await Promise.allSettled([
      // Emails
      fetch(activeProfile === "work" ? "/api/outlook/emails" : "/api/google/emails").then((r) => r.json()),
      // PRs
      fetch(`/api/github/prs?profile=${activeProfile}`).then((r) => r.json()),
      // Calendar
      fetch(activeProfile === "work" ? "/api/outlook/calendar" : "/api/google/calendar").then((r) => r.json()),
      // Tasks
      fetch(`/api/tasks?profile=${activeProfile}`).then((r) => r.json()),
      // Jira (work only)
      activeProfile === "work" ? fetch("/api/jira").then((r) => r.json()) : Promise.resolve(null),
    ]);

    // Emails
    if (results[0].status === "fulfilled" && results[0].value.emails) {
      for (const e of results[0].value.emails) {
        allItems.push({
          id: `email-${e.id}`,
          type: "email",
          title: e.subject || "(no subject)",
          subtitle: e.from,
          time: e.time,
          read: e.read,
          data: e,
        });
      }
    }

    // PRs
    if (results[1].status === "fulfilled" && results[1].value.prs) {
      for (const pr of results[1].value.prs) {
        allItems.push({
          id: `pr-${pr.id}`,
          type: "prs",
          title: pr.title,
          subtitle: `${pr.repoShort} #${pr.number}`,
          time: pr.updatedAt || pr.createdAt,
          data: pr,
        });
      }
    }

    // Calendar
    if (results[2].status === "fulfilled" && results[2].value.events) {
      for (const ev of results[2].value.events) {
        allItems.push({
          id: `cal-${ev.id}`,
          type: "calendar",
          title: ev.title,
          subtitle: ev.location || ev.organizer || "",
          time: ev.start,
          data: ev,
        });
      }
    }

    // Tasks
    if (results[3].status === "fulfilled" && results[3].value.tasks) {
      for (const t of results[3].value.tasks) {
        if (!t.completed) {
          allItems.push({
            id: `task-${t.id}`,
            type: "tasks",
            title: t.title,
            subtitle: `${t.priority} priority`,
            time: t.createdAt || new Date().toISOString(),
            priority: t.priority,
            data: t,
          });
        }
      }
    }

    // Jira
    if (results[4].status === "fulfilled" && results[4].value?.issues) {
      for (const i of results[4].value.issues) {
        allItems.push({
          id: `jira-${i.key}`,
          type: "jira",
          title: `${i.key}: ${i.summary}`,
          subtitle: `${i.status} · ${i.type}`,
          time: i.updated || i.created || new Date().toISOString(),
          priority: i.priority,
          data: i,
        });
      }
    }

    // Sort by time (newest first)
    allItems.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
    setItems(allItems);
    setLoading(false);
  }, [activeProfile]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchAll();
    const interval = setInterval(fetchAll, 3 * 60_000);
    return () => clearInterval(interval);
  }, [fetchAll]);

  const filteredItems = filter === "all" ? items : items.filter((i) => i.type === filter);
  const availableFilters = filterConfig.filter(
    (f) => f.id === "all" || items.some((i) => i.type === f.id)
  );

  // Counts per type
  const counts: Record<string, number> = {};
  for (const item of items) {
    counts[item.type] = (counts[item.type] || 0) + 1;
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* ─── Left: List ─────────────────────────────────────── */}
      <div className={cn(
        "flex flex-col border-r border-border/50 overflow-hidden transition-all min-h-0",
        selectedItem ? "hidden md:flex w-full md:w-[380px]" : "flex-1 max-w-2xl mx-auto"
      )}>
        {/* Filter tabs */}
        <div className="shrink-0 flex items-center gap-1 px-3 py-2 border-b border-border/50 overflow-x-auto">
          {availableFilters.map((f) => {
            const Icon = f.icon;
            const count = f.id === "all" ? items.length : (counts[f.id] || 0);
            return (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                className={cn(
                  "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors shrink-0",
                  filter === f.id
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                )}
              >
                <Icon className="h-3 w-3" />
                {f.label}
                <span className="text-[0.625rem] opacity-60">{count}</span>
              </button>
            );
          })}
        </div>

        {/* Item list */}
        <ScrollArea className="flex-1 min-h-0 overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="text-sm text-muted-foreground text-center py-12">
              No items
            </div>
          ) : (
            <div className="divide-y divide-border/30">
              {filteredItems.map((item) => {
                const Icon = typeIcons[item.type] || Mail;
                const isSelected = selectedItem?.id === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => setSelectedItem(item)}
                    className={cn(
                      "w-full text-left px-4 py-3 hover:bg-muted/30 transition-colors flex items-start gap-3",
                      isSelected && "bg-primary/5 border-l-2 border-primary",
                      item.type === "email" && !item.read && "bg-primary/[0.02]"
                    )}
                  >
                    <div className="mt-0.5 shrink-0">
                      {item.type === "email" && !item.read ? (
                        <div className="h-2 w-2 rounded-full bg-primary mt-1.5" />
                      ) : (
                        <Icon className="h-4 w-4 text-muted-foreground" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className={cn(
                          "text-sm truncate",
                          item.type === "email" && !item.read && "font-semibold"
                        )}>
                          {item.title}
                        </span>
                        <span className="text-[0.625rem] text-muted-foreground shrink-0">
                          {timeAgo(item.time)}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground truncate mt-0.5">
                        {item.subtitle}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </div>

      {/* ─── Right: Detail Pane ──────────────────────────────── */}
      {/* Deliberately unkeyed: ItemDetail re-fetches on an item change by
          itself, and remounting it would churn the history entry that backs
          the pane's back-gesture layer. */}
      {selectedItem && (
        <ItemDetail item={selectedItem} onBack={() => setSelectedItem(null)} />
      )}
    </div>
  );
}
