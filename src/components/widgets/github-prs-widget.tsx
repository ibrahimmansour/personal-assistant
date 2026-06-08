"use client";

import { WidgetWrapper } from "@/components/widget-wrapper";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import {
  GitPullRequest,
  GitMerge,
  GitPullRequestClosed,
  GitPullRequestDraft,
  MessageSquare,
  Plus,
  Minus,
  RefreshCw,
  ExternalLink,
  AlertCircle,
  Loader2,
  Search,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useEffect, useState, useCallback, useRef } from "react";
import { useProfile } from "@/components/profile-context";
import { useWidgetNavFor } from "@/components/widget-nav-context";
import { useRefreshOnVisible } from "@/hooks/use-refresh-on-visible";

interface GitHubPRData {
  id: string;
  number: number;
  title: string;
  repo: string;
  repoShort: string;
  author: string;
  authorAvatar: string;
  status: "open" | "merged" | "closed" | "draft";
  url: string;
  createdAt: string;
  updatedAt: string;
  comments: number;
  additions: number;
  deletions: number;
  labels: { name: string; color: string }[];
  baseBranch: string;
  headBranch: string;
  isAuthor: boolean;
}

interface APIResponse {
  prs: GitHubPRData[];
  username: string;
  fetchedAt: string;
  error?: string;
}

function timeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return dateStr;
  const diffMs = Date.now() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  return `${Math.floor(diffDays / 30)}mo ago`;
}

const statusConfig: Record<
  GitHubPRData["status"],
  { icon: typeof GitPullRequest; color: string; label: string }
> = {
  open: {
    icon: GitPullRequest,
    color: "text-green-600 dark:text-green-400",
    label: "Open",
  },
  merged: {
    icon: GitMerge,
    color: "text-purple-600 dark:text-purple-400",
    label: "Merged",
  },
  closed: {
    icon: GitPullRequestClosed,
    color: "text-red-600 dark:text-red-400",
    label: "Closed",
  },
  draft: {
    icon: GitPullRequestDraft,
    color: "text-muted-foreground",
    label: "Draft",
  },
};

export function GitHubPRsWidget() {
  const [prs, setPRs] = useState<GitHubPRData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<string | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [filterQuery, setFilterQuery] = useState("");
  const [showFilter, setShowFilter] = useState(false);
  const filterInputRef = useRef<HTMLInputElement>(null);
  const { activeProfile } = useProfile();
  const { expandRequested, onExpandHandled, pendingItemId, clearPendingItem, pendingSearchQuery, clearPendingSearch } =
    useWidgetNavFor("github-prs");
  const highlightRef = useRef<HTMLAnchorElement>(null);

  // Handle navigation from command palette
  useEffect(() => {
    if (pendingItemId) {
      setHighlightedId(pendingItemId);
      clearPendingItem();
      // Clear highlight after 3 seconds
      const timer = setTimeout(() => setHighlightedId(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [pendingItemId, clearPendingItem]);

  // Handle search from AI actions
  useEffect(() => {
    if (pendingSearchQuery) {
      setFilterQuery(pendingSearchQuery);
      setShowFilter(true);
      clearPendingSearch();
    }
  }, [pendingSearchQuery, clearPendingSearch]);

  // Focus filter input when shown
  useEffect(() => {
    if (showFilter) setTimeout(() => filterInputRef.current?.focus(), 50);
  }, [showFilter]);

  // Scroll to highlighted PR
  useEffect(() => {
    if (highlightedId && highlightRef.current) {
      highlightRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [highlightedId]);

  const fetchPRs = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`/api/github/prs?profile=${activeProfile}`);
      const data: APIResponse = await res.json();

      if (data.error) {
        setError(data.error);
        return;
      }

      setPRs(data.prs);
      setLastFetched(data.fetchedAt);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch PRs");
    } finally {
      setLoading(false);
    }
  }, [activeProfile]);

  useEffect(() => {
    fetchPRs();
    const interval = setInterval(fetchPRs, 2 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchPRs]);

  // Refresh PRs when tab becomes visible after being hidden 30s+
  useRefreshOnVisible(fetchPRs);

  const openCount = prs.filter((pr) => pr.status === "open" || pr.status === "draft").length;

  // Client-side filter
  const filteredPRs = filterQuery
    ? prs.filter((pr) => {
        const q = filterQuery.toLowerCase();
        return (
          pr.title.toLowerCase().includes(q) ||
          pr.repoShort.toLowerCase().includes(q) ||
          pr.headBranch.toLowerCase().includes(q) ||
          pr.labels.some((l) => l.name.toLowerCase().includes(q)) ||
          pr.status.toLowerCase().includes(q) ||
          `#${pr.number}`.includes(q)
        );
      })
    : prs;

  return (
    <WidgetWrapper
      title="Pull Requests"
      widgetType="github-prs"
      icon={<GitPullRequest className="h-4 w-4" />}
      expandRequested={expandRequested}
      onExpandHandled={onExpandHandled}
      headerAction={
        <div className="flex items-center gap-2">
          {!loading && !error && (
            <span className="text-xs text-muted-foreground">
              {openCount} open
            </span>
          )}
          <button
            onClick={() => { setShowFilter((v) => !v); if (showFilter) setFilterQuery(""); }}
            className={cn(
              "text-muted-foreground hover:text-foreground transition-colors p-1 rounded-md hover:bg-muted",
              showFilter && "text-primary bg-primary/10"
            )}
          >
            <Search className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={fetchPRs}
            disabled={loading}
            className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded-md hover:bg-muted disabled:opacity-50"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          </button>
        </div>
      }
    >
      {loading && prs.length === 0 ? (
        <div className="flex items-center justify-center h-full">
          <div className="flex flex-col items-center gap-2 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-xs">Loading pull requests...</span>
          </div>
        </div>
      ) : error ? (
        <div className="flex items-center justify-center h-full">
          <div className="flex flex-col items-center gap-2 text-muted-foreground text-center px-4">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-xs">{error}</span>
            <button
              onClick={fetchPRs}
              className="text-xs text-primary hover:underline mt-1"
            >
              Try again
            </button>
          </div>
        </div>
      ) : prs.length === 0 ? (
        <div className="flex items-center justify-center h-full text-muted-foreground">
          <span className="text-xs">No pull requests found</span>
        </div>
      ) : (
        <div className="flex flex-col h-full">
          {showFilter && (
            <div className="flex items-center gap-2 mb-2 shrink-0">
              <div className="relative flex-1">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                <input
                  ref={filterInputRef}
                  value={filterQuery}
                  onChange={(e) => setFilterQuery(e.target.value)}
                  placeholder="Filter PRs..."
                  className="w-full h-7 text-xs rounded-md border border-border/50 bg-muted/30 pl-7 pr-7 placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
                />
                {filterQuery && (
                  <button
                    onClick={() => setFilterQuery("")}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
              <span className="text-[10px] text-muted-foreground shrink-0">{filteredPRs.length}/{prs.length}</span>
            </div>
          )}
          <ScrollArea className="flex-1 -mx-1 px-1">
          <div className="space-y-1">
            {filteredPRs.map((pr, index) => {
              const config = statusConfig[pr.status];
              const StatusIcon = config.icon;
              const showRepoHeader =
                index === 0 || pr.repoShort !== filteredPRs[index - 1].repoShort;

              return (
                <div key={pr.id}>
                  {showRepoHeader && (
                    <div className={cn(
                      "text-[10px] text-muted-foreground uppercase tracking-wider px-1 pb-1 font-semibold",
                      index > 0 && "pt-2 mt-1 border-t border-border/50"
                    )}>
                      {pr.repoShort}
                    </div>
                  )}
                  <a
                    href={pr.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    ref={pr.id === highlightedId ? highlightRef : undefined}
                    className={cn(
                      "block p-2.5 rounded-lg hover:bg-muted/50 transition-colors cursor-pointer group",
                      pr.id === highlightedId && "ring-2 ring-primary bg-primary/10"
                    )}
                  >
                    <div className="flex items-start gap-2.5">
                      <StatusIcon
                        className={cn("h-4 w-4 mt-0.5 shrink-0", config.color)}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start gap-1">
                          <p className="text-sm font-medium truncate group-hover:text-primary transition-colors flex-1">
                            {pr.title}
                          </p>
                          <ExternalLink className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-0.5" />
                        </div>
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          {pr.labels.slice(0, 2).map((label) => (
                            <Badge
                              key={label.name}
                              variant="secondary"
                              className="text-[10px] px-1.5 py-0"
                              style={{
                                backgroundColor: `${label.color}20`,
                                color: label.color,
                                borderColor: `${label.color}40`,
                              }}
                            >
                              {label.name}
                            </Badge>
                          ))}
                          <span className="text-[10px] text-muted-foreground">
                            #{pr.number} &middot; {timeAgo(pr.updatedAt)}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 mt-1.5 text-[10px] text-muted-foreground">
                          <span className="flex items-center gap-0.5">
                            <MessageSquare className="h-3 w-3" />
                            {pr.comments}
                          </span>
                          <span className="flex items-center gap-0.5 text-green-600 dark:text-green-400">
                            <Plus className="h-3 w-3" />
                            {pr.additions}
                          </span>
                          <span className="flex items-center gap-0.5 text-red-600 dark:text-red-400">
                            <Minus className="h-3 w-3" />
                            {pr.deletions}
                          </span>
                          <span className="text-[10px] text-muted-foreground ml-auto">
                            {pr.headBranch}
                          </span>
                        </div>
                      </div>
                    </div>
                  </a>
                </div>
              );
            })}
          </div>
          {lastFetched && (
            <p className="text-[10px] text-muted-foreground text-center mt-2 pb-1">
              Updated {new Date(lastFetched).toLocaleTimeString()}
            </p>
          )}
        </ScrollArea>
        </div>
      )}
    </WidgetWrapper>
  );
}
