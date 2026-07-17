"use client";

import { useEffect, useState, useCallback } from "react";
import { useProfile } from "@/components/profile-context";
import { HtmlContent } from "@/components/html-content";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { useSwipe } from "@/hooks/use-swipe";
import {
  Mail,
  GitPullRequest,
  TicketCheck,
  Calendar,
  ListTodo,
  Loader2,
  ArrowLeft,
  ExternalLink,
  Paperclip,
  Inbox,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

type InboxFilter = "all" | "email" | "prs" | "jira" | "calendar" | "tasks";

interface InboxItem {
  id: string;
  type: InboxFilter;
  title: string;
  subtitle: string;
  time: string;
  read?: boolean;
  priority?: string;
  /** Type-specific data for detail view */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: Record<string, any>;
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

function formatFullDate(isoStr: string): string {
  return new Date(isoStr).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
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
  const [detailHtml, setDetailHtml] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

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

  // Fetch email detail when selecting an email
  const selectItem = useCallback(async (item: InboxItem) => {
    setSelectedItem(item);
    setDetailHtml(null);

    if (item.type === "email" && item.data?.id) {
      setDetailLoading(true);
      try {
        const endpoint = activeProfile === "work"
          ? `/api/outlook/emails/${encodeURIComponent(item.data.id)}`
          : `/api/google/emails/${encodeURIComponent(item.data.id)}`;
        const res = await fetch(endpoint);
        const data = await res.json();
        if (data.email) {
          setDetailHtml(data.email.bodyHtml || data.email.bodyText || item.data.preview || "");
          // Update the item data with full content
          setSelectedItem((prev) => prev ? { ...prev, data: { ...prev.data, ...data.email } } : null);
        }
      } catch {
        // keep preview
      }
      setDetailLoading(false);
    }
  }, [activeProfile]);

  const filteredItems = filter === "all" ? items : items.filter((i) => i.type === filter);
  const availableFilters = filterConfig.filter(
    (f) => f.id === "all" || items.some((i) => i.type === f.id)
  );

  // Counts per type
  const counts: Record<string, number> = {};
  for (const item of items) {
    counts[item.type] = (counts[item.type] || 0) + 1;
  }

  // ─── Mobile gesture: swipe-right anywhere on detail pane returns to list ───
  // We accept swipes that begin within 60px of the left edge to mimic iOS back.
  const detailSwipeRef = useSwipe<HTMLDivElement>({
    disabled: !selectedItem,
    axis: "horizontal",
    threshold: 70,
    velocityThreshold: 0.4,
    ignoreOnScrollers: true,
    onSwipeRight: () => setSelectedItem(null),
  });

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
                <span className="text-[10px] opacity-60">{count}</span>
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
                    onClick={() => selectItem(item)}
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
                        <span className="text-[10px] text-muted-foreground shrink-0">
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
      {selectedItem && (
        <div
          ref={detailSwipeRef}
          data-swipe-stop
          className="flex-1 flex flex-col overflow-hidden min-h-0 touch-pan-y"
        >
          {/* Detail header */}
          <div className="shrink-0 flex items-center gap-2 px-4 py-2.5 border-b border-border/50">
            <button
              onClick={() => setSelectedItem(null)}
              className="text-muted-foreground hover:text-foreground p-1 rounded-md hover:bg-muted transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold truncate">{selectedItem.title}</div>
              <div className="text-xs text-muted-foreground truncate">{selectedItem.subtitle}</div>
            </div>
            {selectedItem.data?.webLink && (
              <a
                href={selectedItem.data.webLink}
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground hover:text-foreground p-1 rounded-md hover:bg-muted transition-colors"
              >
                <ExternalLink className="h-4 w-4" />
              </a>
            )}
          </div>

          {/* Detail content */}
          <ScrollArea className="flex-1 min-h-0 overflow-hidden px-5 py-4">
            {selectedItem.type === "email" ? (
              <div className="space-y-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-muted-foreground">From</span>
                    <span className="font-medium">{selectedItem.data.from}</span>
                    {selectedItem.data.fromAddress && (
                      <span className="text-muted-foreground text-[10px]">
                        &lt;{selectedItem.data.fromAddress}&gt;
                      </span>
                    )}
                  </div>
                  {selectedItem.data.to?.length > 0 && (
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-muted-foreground">To</span>
                      <span className="truncate">{selectedItem.data.to.join(", ")}</span>
                    </div>
                  )}
                  <div className="text-[10px] text-muted-foreground">
                    {formatFullDate(selectedItem.time)}
                    {selectedItem.data.hasAttachments && (
                      <span className="inline-flex items-center gap-0.5 ml-2">
                        <Paperclip className="h-2.5 w-2.5" /> Attachments
                      </span>
                    )}
                  </div>
                </div>
                <Separator />
                {detailLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <HtmlContent
                    html={detailHtml || selectedItem.data.bodyHtml || ""}
                    fallbackText={selectedItem.data.bodyText || selectedItem.data.preview || ""}
                  />
                )}
              </div>
            ) : selectedItem.type === "prs" ? (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <div className="text-xs text-muted-foreground">
                    {selectedItem.data.repoShort} #{selectedItem.data.number}
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <span className={cn(
                      "px-2 py-0.5 rounded-full text-[10px] font-medium",
                      selectedItem.data.status === "open" ? "bg-green-500/10 text-green-600" :
                      selectedItem.data.status === "merged" ? "bg-purple-500/10 text-purple-600" :
                      "bg-red-500/10 text-red-600"
                    )}>
                      {selectedItem.data.status}
                    </span>
                    <span className="text-muted-foreground">{selectedItem.data.headBranch}</span>
                  </div>
                  {(selectedItem.data.labels as Array<{ name: string }>)?.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {(selectedItem.data.labels as Array<{ name: string }>).map((l: { name: string }) => (
                        <span key={l.name} className="px-1.5 py-0.5 bg-muted rounded text-[10px]">
                          {l.name}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="text-[10px] text-muted-foreground mt-1">
                    {formatFullDate(selectedItem.time)}
                  </div>
                </div>
                <Separator />
                <div className="text-xs text-muted-foreground flex items-center gap-4">
                  <span className="text-green-600">+{selectedItem.data.additions ?? 0}</span>
                  <span className="text-red-600">-{selectedItem.data.deletions ?? 0}</span>
                  <span>{selectedItem.data.comments ?? 0} comments</span>
                  <span>{selectedItem.data.files ?? 0} files</span>
                </div>
              </div>
            ) : selectedItem.type === "jira" ? (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="px-2 py-0.5 rounded-full bg-muted text-[10px] font-medium">
                      {selectedItem.data.status}
                    </span>
                    <span className="text-muted-foreground">{selectedItem.data.type}</span>
                    <span className="text-muted-foreground">·</span>
                    <span className="text-muted-foreground">{selectedItem.data.priority}</span>
                  </div>
                  {selectedItem.data.assignee && (
                    <div className="text-xs">
                      <span className="text-muted-foreground">Assignee:</span> {selectedItem.data.assignee}
                    </div>
                  )}
                  <div className="text-[10px] text-muted-foreground">
                    {formatFullDate(selectedItem.time)}
                  </div>
                </div>
                {selectedItem.data.description && (
                  <>
                    <Separator />
                    <div className="text-sm whitespace-pre-wrap">{selectedItem.data.description}</div>
                  </>
                )}
              </div>
            ) : selectedItem.type === "calendar" ? (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <div className="text-xs text-muted-foreground">
                    {formatFullDate(selectedItem.data.start)}
                    {selectedItem.data.end && ` – ${new Date(selectedItem.data.end).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })}`}
                  </div>
                  {selectedItem.data.location && (
                    <div className="text-xs"><span className="text-muted-foreground">Location:</span> {selectedItem.data.location}</div>
                  )}
                  {selectedItem.data.organizer && (
                    <div className="text-xs"><span className="text-muted-foreground">Organizer:</span> {selectedItem.data.organizer}</div>
                  )}
                </div>
                {selectedItem.data.body && (
                  <>
                    <Separator />
                    <div className="text-sm whitespace-pre-wrap">{selectedItem.data.body}</div>
                  </>
                )}
              </div>
            ) : selectedItem.type === "tasks" ? (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 text-xs">
                    <span className={cn(
                      "px-2 py-0.5 rounded-full text-[10px] font-medium",
                      selectedItem.data.priority === "high" ? "bg-red-500/10 text-red-600" :
                      selectedItem.data.priority === "medium" ? "bg-amber-500/10 text-amber-600" :
                      "bg-blue-500/10 text-blue-600"
                    )}>
                      {selectedItem.data.priority}
                    </span>
                    <span className="text-muted-foreground">
                      {selectedItem.data.completed ? "Completed" : "Pending"}
                    </span>
                  </div>
                  {selectedItem.data.dueDate && (
                    <div className="text-xs"><span className="text-muted-foreground">Due:</span> {formatFullDate(selectedItem.data.dueDate)}</div>
                  )}
                </div>
                {selectedItem.data.description && (
                  <>
                    <Separator />
                    <div className="text-sm whitespace-pre-wrap">{selectedItem.data.description}</div>
                  </>
                )}
              </div>
            ) : null}
          </ScrollArea>
        </div>
      )}
    </div>
  );
}
