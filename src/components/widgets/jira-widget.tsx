"use client";

import { WidgetWrapper } from "@/components/widget-wrapper";
import { HtmlContent } from "@/components/html-content";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Bug,
  CheckCircle2,
  Circle,
  Clock,
  ExternalLink,
  Loader2,
  AlertCircle,
  RefreshCw,
  Zap,
  Bookmark,
  ArrowUpCircle,
  ArrowDownCircle,
  MinusCircle,
  Lightbulb,
  ListTodo,
  ArrowLeft,
  User,
  Tag,
  MessageSquare,
  Calendar,
  KeyRound,
  Globe,
  ClipboardPaste,
  Search,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useEffect, useState, useCallback, useRef } from "react";
import { useWidgetNavFor } from "@/components/widget-nav-context";

interface JiraIssue {
  key: string;
  summary: string;
  status: string;
  priority: string;
  type: string;
  project: string;
  updated: string;
  url: string;
}

interface JiraComment {
  author: string;
  body: string;
  bodyHtml: string;
  created: string;
  updated: string;
}

interface JiraIssueDetail {
  key: string;
  summary: string;
  description: string | null;
  descriptionHtml: string | null;
  status: string;
  statusCategory: string;
  priority: string;
  type: string;
  project: string;
  projectName: string;
  assignee: string | null;
  reporter: string | null;
  created: string;
  updated: string;
  labels: string[];
  components: string[];
  fixVersions: string[];
  comments: JiraComment[];
  url: string;
}

interface APIResponse {
  issues: JiraIssue[];
  total: number;
  fetchedAt: string;
  error?: string;
  authRequired?: boolean;
}

const typeIcons: Record<string, typeof Bug> = {
  Bug: Bug,
  Task: ListTodo,
  Story: Bookmark,
  Improvement: Lightbulb,
  Epic: Zap,
  "Sub-task": ListTodo,
};

const priorityConfig: Record<string, { icon: typeof MinusCircle; color: string }> = {
  Highest: { icon: ArrowUpCircle, color: "text-red-600 dark:text-red-400" },
  High: { icon: ArrowUpCircle, color: "text-orange-500 dark:text-orange-400" },
  Medium: { icon: MinusCircle, color: "text-amber-500 dark:text-amber-400" },
  Low: { icon: ArrowDownCircle, color: "text-blue-500 dark:text-blue-400" },
  Lowest: { icon: ArrowDownCircle, color: "text-muted-foreground" },
};

function getStatusBadge(status: string) {
  const normalized = status.trim();
  if (normalized.toLowerCase().includes("progress")) {
    return { color: "bg-amber-500/15 text-amber-700 dark:text-amber-400", label: normalized };
  }
  if (normalized.toLowerCase().includes("review")) {
    return { color: "bg-violet-500/15 text-violet-700 dark:text-violet-400", label: normalized };
  }
  if (normalized.toLowerCase() === "open") {
    return { color: "bg-blue-500/15 text-blue-700 dark:text-blue-400", label: normalized };
  }
  if (normalized.toLowerCase() === "resolved" || normalized.toLowerCase() === "closed") {
    return { color: "bg-green-500/15 text-green-700 dark:text-green-400", label: normalized };
  }
  return { color: "bg-muted text-muted-foreground", label: normalized };
}

function formatDate(isoStr: string): string {
  if (!isoStr) return "";
  const date = new Date(isoStr);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function formatRelative(isoStr: string): string {
  if (!isoStr) return "";
  const date = new Date(isoStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 7) return `${diffD}d ago`;
  return formatDate(isoStr);
}

const jiraIcon = (
  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
    <path d="M11.53 2c0 2.4 1.97 4.35 4.35 4.35h1.78v1.7c0 2.4 1.94 4.34 4.34 4.35V2.84a.84.84 0 00-.84-.84H11.53zM6.77 6.8a4.36 4.36 0 004.34 4.34h1.8v1.72a4.36 4.36 0 004.34 4.34V7.63a.84.84 0 00-.84-.84H6.77zM2 11.6c0 2.4 1.95 4.34 4.35 4.34h1.78v1.72c0 2.4 1.95 4.35 4.35 4.35V12.44a.84.84 0 00-.84-.84H2z" />
  </svg>
);

export function JiraWidget() {
  const [issues, setIssues] = useState<JiraIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [authRequired, setAuthRequired] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const [showCookieInput, setShowCookieInput] = useState(false);
  const [cookieInput, setCookieInput] = useState("");
  const [lastFetched, setLastFetched] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [detail, setDetail] = useState<JiraIssueDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [filterQuery, setFilterQuery] = useState("");
  const [showFilter, setShowFilter] = useState(false);
  const filterInputRef = useRef<HTMLInputElement>(null);
  const { expandRequested, onExpandHandled, pendingItemId, clearPendingItem, pendingSearchQuery, clearPendingSearch } =
    useWidgetNavFor("jira");

  const fetchIssues = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      setAuthRequired(false);
      const res = await fetch("/api/jira");
      const data: APIResponse = await res.json();

      if (data.authRequired) {
        setAuthRequired(true);
        setError(null);
        return;
      }

      if (data.error) {
        setError(data.error);
        return;
      }

      setIssues(data.issues);
      setLastFetched(data.fetchedAt);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch Jira issues");
    } finally {
      setLoading(false);
    }
  }, []);

  const tryExtractAuth = useCallback(async () => {
    setAuthLoading(true);
    setAuthMessage(null);
    try {
      const res = await fetch("/api/jira/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "extract" }),
      });
      const data = await res.json();
      if (data.authenticated) {
        setAuthMessage(`Authenticated as ${data.user}`);
        setAuthRequired(false);
        setShowCookieInput(false);
        setCookieInput("");
        fetchIssues();
      } else {
        setAuthMessage(data.error || "Chrome extraction failed");
      }
    } catch {
      setAuthMessage("Failed to extract cookies");
    } finally {
      setAuthLoading(false);
    }
  }, [fetchIssues]);

  const submitCookies = useCallback(async () => {
    if (!cookieInput.trim()) return;
    setAuthLoading(true);
    setAuthMessage(null);
    try {
      const res = await fetch("/api/jira/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cookies: cookieInput.trim() }),
      });
      const data = await res.json();
      if (data.authenticated) {
        setAuthMessage(`Authenticated as ${data.user}`);
        setAuthRequired(false);
        setShowCookieInput(false);
        setCookieInput("");
        fetchIssues();
      } else {
        setAuthMessage(data.error || "Invalid cookies");
      }
    } catch {
      setAuthMessage("Failed to authenticate");
    } finally {
      setAuthLoading(false);
    }
  }, [cookieInput, fetchIssues]);

  const fetchDetail = useCallback(async (key: string) => {
    try {
      setDetailLoading(true);
      setDetailError(null);
      setSelectedKey(key);
      const res = await fetch(`/api/jira/${encodeURIComponent(key)}`);
      const data = await res.json();
      if (data.error) {
        setDetailError(data.error);
        return;
      }
      setDetail(data.issue);
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : "Failed to fetch issue");
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const closeDetail = useCallback(() => {
    setSelectedKey(null);
    setDetail(null);
    setDetailError(null);
  }, []);

  useEffect(() => {
    fetchIssues();
    const interval = setInterval(fetchIssues, 3 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchIssues]);

  // Handle navigation from command palette
  useEffect(() => {
    if (pendingItemId) {
      fetchDetail(pendingItemId);
      clearPendingItem();
    }
  }, [pendingItemId, clearPendingItem, fetchDetail]);

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

  // Client-side filter
  const filteredIssues = filterQuery
    ? issues.filter((i) => {
        const q = filterQuery.toLowerCase();
        return (
          i.key.toLowerCase().includes(q) ||
          i.summary.toLowerCase().includes(q) ||
          i.status.toLowerCase().includes(q) ||
          i.priority.toLowerCase().includes(q) ||
          i.type.toLowerCase().includes(q) ||
          (i.project && i.project.toLowerCase().includes(q))
        );
      })
    : issues;

  // Detail view
  if (selectedKey) {
    const listIssue = issues.find((i) => i.key === selectedKey);
    const TypeIcon = typeIcons[detail?.type || listIssue?.type || ""] || ListTodo;
    const priorityCfg = priorityConfig[detail?.priority || listIssue?.priority || ""] || priorityConfig.Medium;
    const PriorityIcon = priorityCfg.icon;
    const statusBadge = getStatusBadge(detail?.status || listIssue?.status || "");
    const issueUrl = detail?.url || listIssue?.url || `https://jira.tools.sap/browse/${selectedKey}`;

    return (
      <WidgetWrapper
        title="Jira Issues"
        widgetType="jira"
        icon={jiraIcon}
        expandRequested={expandRequested}
        onExpandHandled={onExpandHandled}
        headerAction={
          <div className="flex items-center gap-1">
            <button
              onClick={closeDetail}
              className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded-md hover:bg-muted"
              title="Back to list"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
            </button>
            <a
              href={issueUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded-md hover:bg-muted"
              title="Open in Jira"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
        }
      >
        {detailLoading ? (
          <div className="flex items-center justify-center h-full">
            <div className="flex flex-col items-center gap-2 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-xs">Loading {selectedKey}...</span>
            </div>
          </div>
        ) : detailError ? (
          <div className="flex items-center justify-center h-full">
            <div className="flex flex-col items-center gap-2 text-muted-foreground text-center px-4">
              <AlertCircle className="h-5 w-5 text-destructive" />
              <span className="text-xs">{detailError}</span>
              <button
                onClick={() => fetchDetail(selectedKey)}
                className="text-xs text-primary hover:underline mt-1"
              >
                Try again
              </button>
            </div>
          </div>
        ) : detail ? (
          <div className="flex flex-col h-full">
            {/* Title with type icon */}
            <div className="flex items-start gap-2 mb-2">
              <TypeIcon className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
              <h3 className="text-sm font-semibold leading-snug">
                {detail.summary}
              </h3>
            </div>

            {/* Key + Status + Priority badges */}
            <div className="flex items-center gap-2 flex-wrap mb-3">
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 font-mono">
                {detail.key}
              </Badge>
              <Badge variant="secondary" className={cn("text-[10px] px-1.5 py-0", statusBadge.color)}>
                {statusBadge.label}
              </Badge>
              <span className="flex items-center gap-0.5">
                <PriorityIcon className={cn("h-3 w-3", priorityCfg.color)} />
                <span className="text-[10px] text-muted-foreground">{detail.priority}</span>
              </span>
              <span className="text-[10px] text-muted-foreground">
                {detail.type}
              </span>
            </div>

            {/* Metadata fields */}
            <div className="space-y-1.5 mb-3">
              <div className="flex items-center gap-2 text-xs">
                <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="text-muted-foreground shrink-0">Assignee</span>
                <span className="truncate">{detail.assignee || "Unassigned"}</span>
              </div>
              {detail.reporter && (
                <div className="flex items-center gap-2 text-xs">
                  <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="text-muted-foreground shrink-0">Reporter</span>
                  <span className="truncate">{detail.reporter}</span>
                </div>
              )}
              <div className="flex items-center gap-2 text-xs">
                <Calendar className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="text-muted-foreground shrink-0">Created</span>
                <span>{formatDate(detail.created)}</span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <Clock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="text-muted-foreground shrink-0">Updated</span>
                <span>{formatDate(detail.updated)}</span>
              </div>
              {detail.projectName && (
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-muted-foreground shrink-0 ml-5">Project</span>
                  <span className="truncate">{detail.projectName}</span>
                </div>
              )}
              {detail.labels.length > 0 && (
                <div className="flex items-center gap-2 text-xs">
                  <Tag className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <div className="flex flex-wrap gap-1">
                    {detail.labels.map((l) => (
                      <Badge key={l} variant="secondary" className="text-[10px] px-1.5 py-0">
                        {l}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              {detail.components.length > 0 && (
                <div className="flex items-start gap-2 text-xs">
                  <span className="text-muted-foreground shrink-0 ml-5">Components</span>
                  <span className="truncate">{detail.components.join(", ")}</span>
                </div>
              )}
            </div>

            {/* Description */}
            {(detail.descriptionHtml || detail.description) && (
              <>
                <Separator className="mb-2" />
                <div className="mb-2">
                  <span className="text-xs font-medium text-muted-foreground mb-1 block">Description</span>
                  <HtmlContent
                    html={detail.descriptionHtml || ""}
                    fallbackText={detail.description || undefined}
                  />
                </div>
              </>
            )}

            {/* Comments */}
            {detail.comments.length > 0 && (
              <>
                <Separator className="mb-2" />
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2">
                  <MessageSquare className="h-3.5 w-3.5" />
                  <span className="font-medium">{detail.comments.length} comment{detail.comments.length !== 1 ? "s" : ""}</span>
                </div>
                <ScrollArea className="flex-1 -mx-1 px-1">
                  <div className="space-y-3">
                    {detail.comments.map((comment, i) => (
                      <div key={i} className="text-xs">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-medium">{comment.author}</span>
                          <span className="text-[10px] text-muted-foreground">
                            {formatRelative(comment.created)}
                          </span>
                        </div>
                        <div className="ml-0.5 pl-2 border-l-2 border-border">
                          <HtmlContent
                            html={comment.bodyHtml || ""}
                            fallbackText={comment.body}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </>
            )}

            {/* Fallback scrollable area if no description or comments */}
            {!detail.descriptionHtml && !detail.description && detail.comments.length === 0 && (
              <>
                <Separator className="mb-2" />
                <p className="text-xs text-muted-foreground italic">No description or comments.</p>
              </>
            )}
          </div>
        ) : null}
      </WidgetWrapper>
    );
  }

  // List view
  return (
    <WidgetWrapper
      title="Jira Issues"
      widgetType="jira"
      icon={jiraIcon}
      expandRequested={expandRequested}
      onExpandHandled={onExpandHandled}
      headerAction={
        <div className="flex items-center gap-2">
          {!loading && !error && !authRequired && (
            <span className="text-xs text-muted-foreground">
              {issues.length} open
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
            onClick={fetchIssues}
            disabled={loading}
            className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded-md hover:bg-muted disabled:opacity-50"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          </button>
        </div>
      }
    >
      {loading && issues.length === 0 ? (
        <div className="flex items-center justify-center h-full">
          <div className="flex flex-col items-center gap-2 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-xs">Loading Jira issues...</span>
          </div>
        </div>
      ) : authRequired ? (
        <div className="flex items-center justify-center h-full">
          <div className="flex flex-col items-center gap-3 text-center px-4 max-w-sm">
            <KeyRound className="h-6 w-6 text-amber-500" />
            <div>
              <p className="text-sm font-medium mb-1">Jira Authentication Required</p>
              <p className="text-xs text-muted-foreground">
                Session expired. Try extracting cookies from Chrome or paste them manually.
              </p>
            </div>

            {authMessage && (
              <p className={cn(
                "text-xs px-2 py-1 rounded",
                authMessage.startsWith("Authenticated")
                  ? "text-green-700 dark:text-green-400 bg-green-500/10"
                  : "text-amber-700 dark:text-amber-400 bg-amber-500/10"
              )}>
                {authMessage}
              </p>
            )}

            <div className="flex flex-col gap-2 w-full">
              <Button
                size="sm"
                variant="outline"
                className="w-full text-xs gap-2"
                onClick={tryExtractAuth}
                disabled={authLoading}
              >
                {authLoading ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Globe className="h-3 w-3" />
                )}
                Extract from Chrome
              </Button>

              {!showCookieInput ? (
                <Button
                  size="sm"
                  variant="ghost"
                  className="w-full text-xs gap-2"
                  onClick={() => setShowCookieInput(true)}
                >
                  <ClipboardPaste className="h-3 w-3" />
                  Paste cookies manually
                </Button>
              ) : (
                <div className="flex flex-col gap-1.5">
                  <Input
                    placeholder="Paste cookie string from DevTools..."
                    value={cookieInput}
                    onChange={(e) => setCookieInput(e.target.value)}
                    className="text-xs h-7"
                  />
                  <div className="flex gap-1.5">
                    <Button
                      size="sm"
                      className="flex-1 text-xs h-7"
                      onClick={submitCookies}
                      disabled={authLoading || !cookieInput.trim()}
                    >
                      {authLoading ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        "Authenticate"
                      )}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-xs h-7"
                      onClick={() => {
                        setShowCookieInput(false);
                        setCookieInput("");
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    Open jira.tools.sap in Chrome, press F12, go to Console, run:{" "}
                    <code className="bg-muted px-1 rounded">document.cookie</code>
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : error ? (
        <div className="flex items-center justify-center h-full">
          <div className="flex flex-col items-center gap-2 text-muted-foreground text-center px-4">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-xs">{error}</span>
            <button
              onClick={fetchIssues}
              className="text-xs text-primary hover:underline mt-1"
            >
              Try again
            </button>
          </div>
        </div>
      ) : issues.length === 0 ? (
        <div className="flex items-center justify-center h-full text-muted-foreground">
          <span className="text-xs">No open Jira issues</span>
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
                  placeholder="Filter issues..."
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
              <span className="text-[10px] text-muted-foreground shrink-0">{filteredIssues.length}/{issues.length}</span>
            </div>
          )}
          <ScrollArea className="flex-1 -mx-1 px-1">
          <div className="space-y-1">
            {filteredIssues.map((issue) => {
              const statusBadge = getStatusBadge(issue.status);
              const TypeIcon = typeIcons[issue.type] || ListTodo;
              const priorityCfg = priorityConfig[issue.priority] || priorityConfig.Medium;
              const PriorityIcon = priorityCfg.icon;

              return (
                <div
                  key={issue.key}
                  onClick={() => fetchDetail(issue.key)}
                  className="block p-2.5 rounded-lg hover:bg-muted/50 transition-colors cursor-pointer group"
                >
                  <div className="flex items-start gap-2.5">
                    <TypeIcon className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start gap-1">
                        <p className="text-sm font-medium truncate group-hover:text-primary transition-colors flex-1">
                          {issue.summary}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <Badge
                          variant="secondary"
                          className="text-[10px] px-1.5 py-0 font-mono"
                        >
                          {issue.key}
                        </Badge>
                        <Badge
                          variant="secondary"
                          className={cn("text-[10px] px-1.5 py-0", statusBadge.color)}
                        >
                          {statusBadge.label}
                        </Badge>
                        <span className="flex items-center gap-0.5">
                          <PriorityIcon
                            className={cn("h-3 w-3", priorityCfg.color)}
                          />
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {issue.project} &middot; {issue.updated}
                        </span>
                      </div>
                    </div>
                  </div>
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
