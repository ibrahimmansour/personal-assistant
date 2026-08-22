"use client";

import { useEffect, useState } from "react";
import { useProfile } from "@/components/profile-context";
import { HtmlContent } from "@/components/html-content";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { useSwipe } from "@/hooks/use-swipe";
import { useBackHandler } from "@/hooks/use-back-handler";
import { ArrowLeft, ExternalLink, Loader2, Paperclip } from "lucide-react";

/** The five aggregate item kinds the inbox and the timeline both draw from. */
export type DetailItemType = "email" | "prs" | "jira" | "calendar" | "tasks";

export interface DetailItem {
  id: string;
  type: DetailItemType;
  title: string;
  subtitle: string;
  time: string;
  /** The raw record from the source API. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: Record<string, any>;
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

interface ItemDetailProps {
  item: DetailItem;
  onBack: () => void;
  className?: string;
}

/**
 * Read-only detail pane for an aggregate item. Shared by the inbox (right-hand
 * pane) and the timeline (overlay), which rendered the same five layouts and
 * only the inbox had them.
 *
 * Owns the email-body fetch: the list endpoints return a light shape with no
 * body at all above 50 messages, so an email always needs its full record
 * pulled by ID before it can render as HTML.
 */
export function ItemDetail({ item, onBack, className }: ItemDetailProps) {
  const { activeProfile } = useProfile();
  // Keyed by the email ID it belongs to, so switching items drops the previous
  // body on the next render instead of needing a reset inside the effect.
  const [full, setFull] = useState<{ id: string; data: DetailItem["data"] } | null>(null);
  const [loading, setLoading] = useState(false);

  const emailId: string | null = item.type === "email" ? item.data?.id ?? null : null;

  useEffect(() => {
    if (!emailId) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    const endpoint =
      activeProfile === "work"
        ? `/api/outlook/emails/${encodeURIComponent(emailId)}`
        : `/api/google/emails/${encodeURIComponent(emailId)}`;
    fetch(endpoint)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled && data.email) setFull({ id: emailId, data: data.email });
      })
      .catch(() => {
        // Keep whatever the list gave us (preview text at worst).
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [emailId, activeProfile]);

  const fullData = full && full.id === emailId ? full.data : null;
  const data = fullData ? { ...item.data, ...fullData } : item.data;

  // Swipe-right anywhere on the pane returns to the list, mimicking iOS back.
  const swipeRef = useSwipe<HTMLDivElement>({
    axis: "horizontal",
    threshold: 70,
    velocityThreshold: 0.4,
    ignoreOnScrollers: true,
    onSwipeRight: onBack,
  });

  // Mounted only while a detail is open, so `true` is exactly "detail is open".
  useBackHandler(true, onBack);

  return (
    <div
      ref={swipeRef}
      data-swipe-stop
      className={cn("flex-1 flex flex-col overflow-hidden min-h-0 touch-pan-y", className)}
    >
      {/* Detail header */}
      <div className="shrink-0 flex items-center gap-2 px-4 py-2 border-b border-border/50">
        <button
          onClick={onBack}
          aria-label="Back to list"
          className="text-muted-foreground hover:text-foreground inline-flex items-center justify-center h-11 w-11 md:h-8 md:w-8 rounded-md hover:bg-muted transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold truncate">{item.title}</div>
          <div className="text-xs text-muted-foreground truncate">{item.subtitle}</div>
        </div>
        {data?.webLink && (
          <a
            href={data.webLink}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Open in the source app"
            className="text-muted-foreground hover:text-foreground inline-flex items-center justify-center h-11 w-11 md:h-8 md:w-8 rounded-md hover:bg-muted transition-colors"
          >
            <ExternalLink className="h-4 w-4" />
          </a>
        )}
      </div>

      {/* Detail content */}
      <ScrollArea className="flex-1 min-h-0 overflow-hidden px-5 py-4">
        {item.type === "email" ? (
          <div className="space-y-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-xs">
                <span className="text-muted-foreground">From</span>
                <span className="font-medium">{data.from}</span>
                {data.fromAddress && (
                  <span className="text-muted-foreground text-[0.625rem]">
                    &lt;{data.fromAddress}&gt;
                  </span>
                )}
              </div>
              {data.to?.length > 0 && (
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-muted-foreground">To</span>
                  <span className="truncate">{data.to.join(", ")}</span>
                </div>
              )}
              <div className="text-[0.625rem] text-muted-foreground">
                {formatFullDate(item.time)}
                {data.hasAttachments && (
                  <span className="inline-flex items-center gap-0.5 ml-2">
                    <Paperclip className="h-2.5 w-2.5" /> Attachments
                  </span>
                )}
              </div>
            </div>
            <Separator />
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <HtmlContent
                html={data.bodyHtml || ""}
                fallbackText={data.bodyText || data.preview || ""}
              />
            )}
          </div>
        ) : item.type === "prs" ? (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <div className="text-xs text-muted-foreground">
                {data.repoShort} #{data.number}
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className={cn(
                  "px-2 py-0.5 rounded-full text-[0.625rem] font-medium",
                  data.status === "open" ? "bg-green-500/10 text-green-600" :
                  data.status === "merged" ? "bg-purple-500/10 text-purple-600" :
                  "bg-red-500/10 text-red-600"
                )}>
                  {data.status}
                </span>
                <span className="text-muted-foreground">{data.headBranch}</span>
              </div>
              {(data.labels as Array<{ name: string }>)?.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {(data.labels as Array<{ name: string }>).map((l: { name: string }) => (
                    <span key={l.name} className="px-1.5 py-0.5 bg-muted rounded text-[0.625rem]">
                      {l.name}
                    </span>
                  ))}
                </div>
              )}
              <div className="text-[0.625rem] text-muted-foreground mt-1">
                {formatFullDate(item.time)}
              </div>
            </div>
            <Separator />
            <div className="text-xs text-muted-foreground flex flex-wrap gap-x-4 gap-y-1">
              <span className="text-green-600">+{data.additions ?? 0}</span>
              <span className="text-red-600">-{data.deletions ?? 0}</span>
              <span>{data.comments ?? 0} comments</span>
              <span>{data.files ?? 0} files</span>
            </div>
          </div>
        ) : item.type === "jira" ? (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="px-2 py-0.5 rounded-full bg-muted text-[0.625rem] font-medium">
                  {data.status}
                </span>
                <span className="text-muted-foreground">{data.type}</span>
                <span className="text-muted-foreground">·</span>
                <span className="text-muted-foreground">{data.priority}</span>
              </div>
              {data.assignee && (
                <div className="text-xs">
                  <span className="text-muted-foreground">Assignee:</span> {data.assignee}
                </div>
              )}
              <div className="text-[0.625rem] text-muted-foreground">
                {formatFullDate(item.time)}
              </div>
            </div>
            {data.description && (
              <>
                <Separator />
                <div className="text-sm whitespace-pre-wrap">{data.description}</div>
              </>
            )}
          </div>
        ) : item.type === "calendar" ? (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <div className="text-xs text-muted-foreground">
                {formatFullDate(data.start)}
                {data.end && ` – ${new Date(data.end).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })}`}
              </div>
              {data.location && (
                <div className="text-xs"><span className="text-muted-foreground">Location:</span> {data.location}</div>
              )}
              {data.organizer && (
                <div className="text-xs"><span className="text-muted-foreground">Organizer:</span> {data.organizer}</div>
              )}
            </div>
            {data.body && (
              <>
                <Separator />
                <div className="text-sm whitespace-pre-wrap">{data.body}</div>
              </>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-xs">
                <span className={cn(
                  "px-2 py-0.5 rounded-full text-[0.625rem] font-medium",
                  data.priority === "high" ? "bg-red-500/10 text-red-600" :
                  data.priority === "medium" ? "bg-amber-500/10 text-amber-600" :
                  "bg-blue-500/10 text-blue-600"
                )}>
                  {data.priority}
                </span>
                <span className="text-muted-foreground">
                  {data.completed ? "Completed" : "Pending"}
                </span>
              </div>
              {data.dueDate && (
                <div className="text-xs"><span className="text-muted-foreground">Due:</span> {formatFullDate(data.dueDate)}</div>
              )}
            </div>
            {data.description && (
              <>
                <Separator />
                <div className="text-sm whitespace-pre-wrap">{data.description}</div>
              </>
            )}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
