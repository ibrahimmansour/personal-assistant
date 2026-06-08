"use client";

import { WidgetWrapper } from "@/components/widget-wrapper";
import { HtmlContent } from "@/components/html-content";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Mail,
  MailOpen,
  RefreshCw,
  Loader2,
  AlertCircle,
  Paperclip,
  ExternalLink,
  ArrowLeft,
  KeyRound,
  CheckCircle2,
  Search,
  X,
  Tag,
  Plus,
  Trash2,
  Settings2,
  ChevronRight,
  Reply,
  ReplyAll,
  SendHorizontal,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useProfile } from "@/components/profile-context";
import { useWidgetNavFor } from "@/components/widget-nav-context";
import { useRefreshOnVisible } from "@/hooks/use-refresh-on-visible";

// ─── Types ─────────────────────────────────────────────────────────────

interface EmailData {
  id: string;
  from: string;
  fromAddress: string;
  subject: string;
  preview: string;
  bodyHtml: string | null;
  bodyText: string;
  time: string;
  read: boolean;
  hasAttachments: boolean;
  webLink: string;
  categories: string[];
  to: string[];
  cc: string[];
}

interface EmailRule {
  field: "from" | "fromAddress" | "subject";
  operator: "contains" | "equals" | "matches";
  value: string;
}

interface EmailGroup {
  id: string;
  name: string;
  color: string;
  rules: EmailRule[];
}

// ─── Color palette for groups ──────────────────────────────────────────

const GROUP_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  purple: { bg: "bg-purple-500/10", text: "text-purple-600 dark:text-purple-400", dot: "bg-purple-500" },
  blue:   { bg: "bg-blue-500/10",   text: "text-blue-600 dark:text-blue-400",   dot: "bg-blue-500" },
  green:  { bg: "bg-green-500/10",  text: "text-green-600 dark:text-green-400",  dot: "bg-green-500" },
  orange: { bg: "bg-orange-500/10", text: "text-orange-600 dark:text-orange-400", dot: "bg-orange-500" },
  red:    { bg: "bg-red-500/10",    text: "text-red-600 dark:text-red-400",    dot: "bg-red-500" },
  pink:   { bg: "bg-pink-500/10",   text: "text-pink-600 dark:text-pink-400",   dot: "bg-pink-500" },
  yellow: { bg: "bg-yellow-500/10", text: "text-yellow-600 dark:text-yellow-400", dot: "bg-yellow-500" },
  gray:   { bg: "bg-muted",         text: "text-muted-foreground",              dot: "bg-muted-foreground" },
};
const COLOR_NAMES = Object.keys(GROUP_COLORS);

function getColor(color: string) {
  return GROUP_COLORS[color] || GROUP_COLORS.gray;
}

// ─── Classification engine ─────────────────────────────────────────────

function matchesRule(email: EmailData, rule: EmailRule): boolean {
  const fieldValue = email[rule.field]?.toLowerCase() || "";
  const ruleValue = rule.value.toLowerCase();
  switch (rule.operator) {
    case "contains":
      return fieldValue.includes(ruleValue);
    case "equals":
      return fieldValue === ruleValue;
    case "matches":
      try {
        return new RegExp(rule.value, "i").test(email[rule.field] || "");
      } catch {
        return false;
      }
    default:
      return false;
  }
}

function classifyEmail(email: EmailData, groups: EmailGroup[]): string | null {
  for (const group of groups) {
    // Email matches a group if ANY rule matches (OR logic)
    if (group.rules.some((rule) => matchesRule(email, rule))) {
      return group.id;
    }
  }
  return null; // uncategorized
}

// ─── Helpers ───────────────────────────────────────────────────────────

function formatTime(isoStr: string): string {
  const date = new Date(isoStr);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  if (isToday) {
    return date.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  }
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) {
    return "Yesterday";
  }
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatFullDate(isoStr: string): string {
  const date = new Date(isoStr);
  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

// ─── Rule Management Panel ─────────────────────────────────────────────

function RulesPanel({
  groups,
  onSave,
  onClose,
}: {
  groups: EmailGroup[];
  onSave: (groups: EmailGroup[]) => void;
  onClose: () => void;
}) {
  const [localGroups, setLocalGroups] = useState<EmailGroup[]>(
    JSON.parse(JSON.stringify(groups))
  );
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupColor, setNewGroupColor] = useState("gray");

  function addGroup() {
    const name = newGroupName.trim();
    if (!name) return;
    const id =
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || `group-${Date.now()}`;
    const existingIds = new Set(localGroups.map((g) => g.id));
    const uniqueId = existingIds.has(id) ? `${id}-${Date.now()}` : id;
    setLocalGroups([
      ...localGroups,
      { id: uniqueId, name, color: newGroupColor, rules: [] },
    ]);
    setNewGroupName("");
    setNewGroupColor("gray");
    setExpandedGroup(uniqueId);
  }

  function removeGroup(id: string) {
    setLocalGroups(localGroups.filter((g) => g.id !== id));
  }

  function addRule(groupId: string) {
    setLocalGroups(
      localGroups.map((g) =>
        g.id === groupId
          ? { ...g, rules: [...g.rules, { field: "fromAddress", operator: "contains", value: "" }] }
          : g
      )
    );
  }

  function updateRule(groupId: string, ruleIdx: number, patch: Partial<EmailRule>) {
    setLocalGroups(
      localGroups.map((g) =>
        g.id === groupId
          ? {
              ...g,
              rules: g.rules.map((r, i) => (i === ruleIdx ? { ...r, ...patch } : r)),
            }
          : g
      )
    );
  }

  function removeRule(groupId: string, ruleIdx: number) {
    setLocalGroups(
      localGroups.map((g) =>
        g.id === groupId
          ? { ...g, rules: g.rules.filter((_, i) => i !== ruleIdx) }
          : g
      )
    );
  }

  function updateGroupColor(groupId: string, color: string) {
    setLocalGroups(
      localGroups.map((g) => (g.id === groupId ? { ...g, color } : g))
    );
  }

  function updateGroupName(groupId: string, name: string) {
    setLocalGroups(
      localGroups.map((g) => (g.id === groupId ? { ...g, name } : g))
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-3 shrink-0">
        <h3 className="text-sm font-semibold">Email Groups & Rules</h3>
        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground p-1 rounded-md hover:bg-muted"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <ScrollArea className="flex-1 -mx-1 px-1">
        <div className="space-y-2">
          {localGroups.map((group) => {
            const colors = getColor(group.color);
            const isExpanded = expandedGroup === group.id;
            return (
              <div
                key={group.id}
                className="rounded-lg border border-border/50 overflow-hidden"
              >
                {/* Group header */}
                <div
                  className="flex items-center gap-2 px-2.5 py-2 cursor-pointer hover:bg-muted/30"
                  onClick={() => setExpandedGroup(isExpanded ? null : group.id)}
                >
                  <div className={cn("h-2.5 w-2.5 rounded-full shrink-0", colors.dot)} />
                  {isExpanded ? (
                    <input
                      value={group.name}
                      onChange={(e) => updateGroupName(group.id, e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      className="text-xs font-medium bg-transparent border-none outline-none flex-1 min-w-0"
                    />
                  ) : (
                    <span className="text-xs font-medium flex-1 truncate">{group.name}</span>
                  )}
                  <span className="text-[10px] text-muted-foreground shrink-0">
                    {group.rules.length} rule{group.rules.length !== 1 ? "s" : ""}
                  </span>
                  <ChevronRight
                    className={cn(
                      "h-3 w-3 text-muted-foreground transition-transform shrink-0",
                      isExpanded && "rotate-90"
                    )}
                  />
                </div>

                {/* Expanded: rules + color picker */}
                {isExpanded && (
                  <div className="px-2.5 pb-2.5 space-y-2 border-t border-border/30 pt-2">
                    {/* Color picker */}
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] text-muted-foreground mr-1">Color:</span>
                      {COLOR_NAMES.map((c) => (
                        <button
                          key={c}
                          onClick={() => updateGroupColor(group.id, c)}
                          className={cn(
                            "h-4 w-4 rounded-full border-2 transition-all",
                            getColor(c).dot,
                            group.color === c
                              ? "border-foreground scale-110"
                              : "border-transparent opacity-60 hover:opacity-100"
                          )}
                        />
                      ))}
                    </div>

                    {/* Rules */}
                    {group.rules.map((rule, rIdx) => (
                      <div key={rIdx} className="flex items-center gap-1.5">
                        <select
                          value={rule.field}
                          onChange={(e) =>
                            updateRule(group.id, rIdx, {
                              field: e.target.value as EmailRule["field"],
                            })
                          }
                          className="h-6 text-[10px] rounded border border-border/50 bg-muted/30 px-1 min-w-0"
                        >
                          <option value="fromAddress">From address</option>
                          <option value="from">From name</option>
                          <option value="subject">Subject</option>
                        </select>
                        <select
                          value={rule.operator}
                          onChange={(e) =>
                            updateRule(group.id, rIdx, {
                              operator: e.target.value as EmailRule["operator"],
                            })
                          }
                          className="h-6 text-[10px] rounded border border-border/50 bg-muted/30 px-1"
                        >
                          <option value="contains">contains</option>
                          <option value="equals">equals</option>
                          <option value="matches">regex</option>
                        </select>
                        <input
                          value={rule.value}
                          onChange={(e) =>
                            updateRule(group.id, rIdx, { value: e.target.value })
                          }
                          placeholder="value..."
                          className="h-6 text-[10px] rounded border border-border/50 bg-muted/30 px-1.5 flex-1 min-w-0 focus:outline-none focus:ring-1 focus:ring-primary/30"
                        />
                        <button
                          onClick={() => removeRule(group.id, rIdx)}
                          className="text-muted-foreground hover:text-destructive p-0.5 shrink-0"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => addRule(group.id)}
                        className="flex items-center gap-1 text-[10px] text-primary hover:underline"
                      >
                        <Plus className="h-2.5 w-2.5" /> Add rule
                      </button>
                      <button
                        onClick={() => removeGroup(group.id)}
                        className="flex items-center gap-1 text-[10px] text-destructive hover:underline ml-auto"
                      >
                        <Trash2 className="h-2.5 w-2.5" /> Delete group
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Add new group */}
        <div className="mt-3 space-y-2">
          <Separator />
          <div className="flex items-center gap-1.5">
            <div className="flex items-center gap-1 shrink-0">
              {COLOR_NAMES.slice(0, 5).map((c) => (
                <button
                  key={c}
                  onClick={() => setNewGroupColor(c)}
                  className={cn(
                    "h-3.5 w-3.5 rounded-full border-2 transition-all",
                    getColor(c).dot,
                    newGroupColor === c
                      ? "border-foreground scale-110"
                      : "border-transparent opacity-50 hover:opacity-100"
                  )}
                />
              ))}
            </div>
            <input
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addGroup()}
              placeholder="New group name..."
              className="h-6 text-[10px] rounded border border-border/50 bg-muted/30 px-1.5 flex-1 min-w-0 focus:outline-none focus:ring-1 focus:ring-primary/30"
            />
            <button
              onClick={addGroup}
              disabled={!newGroupName.trim()}
              className="flex items-center gap-1 text-[10px] text-primary hover:underline disabled:opacity-30 disabled:no-underline shrink-0"
            >
              <Plus className="h-3 w-3" /> Add
            </button>
          </div>
        </div>
      </ScrollArea>

      {/* Save / Cancel */}
      <div className="flex items-center gap-2 mt-3 pt-2 border-t border-border/50 shrink-0">
        <button
          onClick={onClose}
          className="flex-1 h-7 text-xs rounded-md border border-border/50 text-muted-foreground hover:bg-muted transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={() => onSave(localGroups)}
          className="flex-1 h-7 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors font-medium"
        >
          Save Rules
        </button>
      </div>
    </div>
  );
}

// ─── Quick Rule Dialog (from email context) ────────────────────────────

function QuickRuleDialog({
  email,
  groups,
  onAdd,
  onClose,
}: {
  email: EmailData;
  groups: EmailGroup[];
  onAdd: (groupId: string, rule: EmailRule) => void;
  onClose: () => void;
}) {
  const [selectedGroupId, setSelectedGroupId] = useState(groups[0]?.id || "");
  const [field, setField] = useState<EmailRule["field"]>("fromAddress");
  const [operator] = useState<EmailRule["operator"]>("contains");
  const [value, setValue] = useState(
    email.fromAddress.split("@")[1] || email.fromAddress
  );

  return (
    <div className="absolute inset-0 z-50 bg-background/95 backdrop-blur-sm rounded-lg flex flex-col p-3">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-xs font-semibold">Add to Group</h4>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-0.5">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="space-y-2 text-[11px]">
        <div>
          <span className="text-muted-foreground">Group:</span>
          <select
            value={selectedGroupId}
            onChange={(e) => setSelectedGroupId(e.target.value)}
            className="ml-2 h-6 text-[11px] rounded border border-border/50 bg-muted/30 px-1"
          >
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-1.5">
          <select
            value={field}
            onChange={(e) => {
              const f = e.target.value as EmailRule["field"];
              setField(f);
              if (f === "fromAddress") setValue(email.fromAddress.split("@")[1] || email.fromAddress);
              else if (f === "from") setValue(email.from);
              else setValue("");
            }}
            className="h-6 text-[10px] rounded border border-border/50 bg-muted/30 px-1"
          >
            <option value="fromAddress">From address</option>
            <option value="from">From name</option>
            <option value="subject">Subject</option>
          </select>
          <span className="text-muted-foreground">contains</span>
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="h-6 text-[10px] rounded border border-border/50 bg-muted/30 px-1.5 flex-1 min-w-0 focus:outline-none focus:ring-1 focus:ring-primary/30"
          />
        </div>

        <div className="text-[10px] text-muted-foreground">
          Emails where <strong>{field}</strong> contains &quot;<strong>{value}</strong>&quot;
          will go into <strong>{groups.find((g) => g.id === selectedGroupId)?.name}</strong>
        </div>
      </div>

      <div className="flex items-center gap-2 mt-3 pt-2 border-t border-border/50">
        <button
          onClick={onClose}
          className="flex-1 h-7 text-xs rounded-md border border-border/50 text-muted-foreground hover:bg-muted"
        >
          Cancel
        </button>
        <button
          onClick={() => {
            if (value.trim() && selectedGroupId) {
              onAdd(selectedGroupId, { field, operator, value: value.trim() });
            }
          }}
          disabled={!value.trim() || !selectedGroupId}
          className="flex-1 h-7 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90 font-medium disabled:opacity-40"
        >
          Add Rule
        </button>
      </div>
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════════
// Main Widget
// ═══════════════════════════════════════════════════════════════════════

export function EmailWidget() {
  const [emails, setEmails] = useState<EmailData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [fetchedEmail, setFetchedEmail] = useState<EmailData | null>(null);
  const [fetchingEmail, setFetchingEmail] = useState(false);
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [tokenExpired, setTokenExpired] = useState(false);
  const [refreshingToken, setRefreshingToken] = useState(false);
  const [refreshStatus, setRefreshStatus] = useState<string | null>(null);
  const { activeProfile } = useProfile();
  const { expandRequested, onExpandHandled, pendingItemId, clearPendingItem, pendingSearchQuery, clearPendingSearch } =
    useWidgetNavFor("email");

  // ─── Search state ───────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<EmailData[] | null>(null);
  const [searching, setSearching] = useState(false);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // ─── Classification groups state ───────────────────────────────────
  const [groups, setGroups] = useState<EmailGroup[]>([]);
  const [activeGroupTab, setActiveGroupTab] = useState<string | null>("__focused__"); // default to Focused
  const [showRulesPanel, setShowRulesPanel] = useState(false);
  const [quickRuleEmail, setQuickRuleEmail] = useState<EmailData | null>(null);
  const [draggedTabId, setDraggedTabId] = useState<string | null>(null);
  const [dragOverTabId, setDragOverTabId] = useState<string | null>(null);

  // ─── Reply state ───────────────────────────────────────────────────
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyAll, setReplyAll] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sendSuccess, setSendSuccess] = useState(false);
  const replyTextareaRef = useRef<HTMLTextAreaElement>(null);

  // Fetch classification rules
  const fetchRules = useCallback(async () => {
    try {
      const res = await fetch(`/api/email-rules?profile=${activeProfile}`);
      const data = await res.json();
      setGroups(data.groups || []);
    } catch {
      // silently fail — will just show no groups
    }
  }, [activeProfile]);

  // Save rules to server
  const saveRules = useCallback(
    async (updatedGroups: EmailGroup[]) => {
      setGroups(updatedGroups);
      setShowRulesPanel(false);
      try {
        await fetch(`/api/email-rules?profile=${activeProfile}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "save-all", groups: updatedGroups }),
        });
      } catch {
        // Ignore — local state is already updated
      }
    },
    [activeProfile]
  );

  // Reorder groups (from tab drag)
  const reorderGroups = useCallback(
    async (fromId: string, toId: string) => {
      const fromIdx = groups.findIndex((g) => g.id === fromId);
      const toIdx = groups.findIndex((g) => g.id === toId);
      if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return;
      const reordered = [...groups];
      const [moved] = reordered.splice(fromIdx, 1);
      reordered.splice(toIdx, 0, moved);
      setGroups(reordered);
      try {
        await fetch(`/api/email-rules?profile=${activeProfile}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "reorder-groups",
            groupIds: reordered.map((g) => g.id),
          }),
        });
      } catch {
        // Ignore
      }
    },
    [groups, activeProfile]
  );

  // Add a single rule via quick dialog
  const addQuickRule = useCallback(
    async (groupId: string, rule: EmailRule) => {
      setQuickRuleEmail(null);
      try {
        const res = await fetch(`/api/email-rules?profile=${activeProfile}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "add-rule", groupId, rule }),
        });
        const data = await res.json();
        if (data.groups) setGroups(data.groups);
      } catch {
        // Ignore
      }
    },
    [activeProfile]
  );

  // Send reply
  const sendReply = useCallback(
    async (emailId: string, comment: string, isReplyAll: boolean) => {
      setSending(true);
      setSendError(null);
      setSendSuccess(false);
      try {
        const endpoint = activeProfile === "private"
          ? `/api/google/emails/${encodeURIComponent(emailId)}/reply`
          : `/api/outlook/emails/${encodeURIComponent(emailId)}/reply`;
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ comment, replyAll: isReplyAll }),
        });
        const data = await res.json();
        if (!res.ok) {
          setSendError(data.error || "Failed to send reply");
          return;
        }
        setSendSuccess(true);
        setReplyText("");
        // Auto-close after success
        setTimeout(() => {
          setReplyOpen(false);
          setSendSuccess(false);
        }, 2000);
      } catch (err) {
        setSendError(err instanceof Error ? err.message : "Failed to send reply");
      } finally {
        setSending(false);
      }
    },
    [activeProfile]
  );

  // Classify all emails against groups
  const emailClassification = useMemo(() => {
    const map = new Map<string, string | null>(); // emailId -> groupId | null
    for (const email of emails) {
      map.set(email.id, classifyEmail(email, groups));
    }
    return map;
  }, [emails, groups]);

  // Count emails per group
  const groupCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const groupId of emailClassification.values()) {
      if (groupId) {
        counts[groupId] = (counts[groupId] || 0) + 1;
      }
    }
    return counts;
  }, [emailClassification]);

  const uncategorizedCount = useMemo(() => {
    let count = 0;
    for (const groupId of emailClassification.values()) {
      if (!groupId) count++;
    }
    return count;
  }, [emailClassification]);

  // Filter emails based on active tab
  const filteredEmails = useMemo(() => {
    const source = searchResults ?? emails;
    if (activeGroupTab === null) return source; // "All"
    if (activeGroupTab === "__focused__") {
      return source.filter((e) => !emailClassification.get(e.id));
    }
    return source.filter((e) => emailClassification.get(e.id) === activeGroupTab);
  }, [searchResults, emails, activeGroupTab, emailClassification]);

  // Handle search query from AI / command palette navigation
  useEffect(() => {
    if (pendingSearchQuery) {
      setSearchQuery(pendingSearchQuery);
      clearPendingSearch();
      setTimeout(() => searchInputRef.current?.focus(), 200);
    }
  }, [pendingSearchQuery, clearPendingSearch]);

  // Debounced server-side search
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);

    const q = searchQuery.trim();
    if (q.length < 2) {
      setSearchResults(null);
      setSearching(false);
      return;
    }

    setSearching(true);
    searchTimerRef.current = setTimeout(async () => {
      try {
        const endpoint = activeProfile === "work"
          ? "/api/outlook/emails/search"
          : "/api/google/emails/search";
        const res = await fetch(`${endpoint}?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        if (data.emails) {
          setSearchResults(data.emails);
        }
      } catch {
        const lower = q.toLowerCase();
        setSearchResults(
          emails.filter(
            (e) =>
              e.subject.toLowerCase().includes(lower) ||
              e.from.toLowerCase().includes(lower) ||
              e.fromAddress.toLowerCase().includes(lower) ||
              e.preview.toLowerCase().includes(lower)
          )
        );
      }
      setSearching(false);
    }, 400);

    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, [searchQuery, activeProfile, emails]);

  // Handle navigation from command palette
  useEffect(() => {
    if (pendingItemId) {
      setSelectedId(pendingItemId);
      const exists = emails.some((e) => e.id === pendingItemId);
      if (!exists) {
        setFetchingEmail(true);
        const endpoint =
          activeProfile === "private"
            ? `/api/google/emails/${encodeURIComponent(pendingItemId)}`
            : `/api/outlook/emails/${encodeURIComponent(pendingItemId)}`;
        fetch(endpoint)
          .then((res) => res.json())
          .then((data) => {
            if (data.email) {
              setFetchedEmail(data.email);
            }
          })
          .catch(() => {})
          .finally(() => setFetchingEmail(false));
      }
      clearPendingItem();
    }
  }, [pendingItemId, clearPendingItem, emails, activeProfile]);

  const fetchEmails = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      setAuthUrl(null);
      setTokenExpired(false);
      const endpoint = activeProfile === "private"
        ? "/api/google/emails?limit=500"
        : "/api/outlook/emails?limit=500";
      const res = await fetch(endpoint);
      const data = await res.json();
      if (data.authRequired && data.authUrl) {
        setAuthUrl(data.authUrl);
        setError(data.error);
        return;
      }
      if (data.error) {
        setError(data.error);
        if (data.tokenExpired) setTokenExpired(true);
        return;
      }
      setEmails(data.emails);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch emails");
    } finally {
      setLoading(false);
    }
  }, [activeProfile]);

  const handleRefreshToken = useCallback(async () => {
    if (activeProfile !== "work") return;
    setRefreshingToken(true);
    setRefreshStatus("Opening Safari...");
    try {
      const res = await fetch("/api/outlook/refresh-token", { method: "POST" });
      const data = await res.json();
      if (data.success) {
        setRefreshStatus("Token refreshed!");
        setTokenExpired(false);
        setError(null);
        setTimeout(() => {
          setRefreshingToken(false);
          setRefreshStatus(null);
          fetchEmails();
        }, 1500);
        return;
      } else if (data.needsLogin) {
        setRefreshStatus(data.message || "Please sign in to Outlook in Safari, then try again.");
      } else {
        setRefreshStatus(data.error || "Failed to refresh token.");
      }
    } catch {
      setRefreshStatus("Failed to connect to refresh endpoint.");
    }
    setRefreshingToken(false);
  }, [activeProfile, fetchEmails]);

  useEffect(() => {
    setSelectedId(null);
    setFetchedEmail(null);
    setActiveGroupTab("__focused__");
    setReplyOpen(false);
    setReplyText("");
    fetchEmails();
    fetchRules();
    const interval = setInterval(fetchEmails, 3 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchEmails, fetchRules]);

  // Refresh emails when tab becomes visible after being hidden 30s+
  useRefreshOnVisible(fetchEmails);

  const unreadCount = emails.filter((e) => !e.read).length;
  const selectedEmail = selectedId
    ? emails.find((e) => e.id === selectedId) ||
      (fetchedEmail?.id === selectedId ? fetchedEmail : null)
    : null;

  // ─── Rules panel view ─────────────────────────────────────────────
  if (showRulesPanel) {
    return (
      <WidgetWrapper
        title="Email"
        widgetType="email"
        icon={<Mail className="h-4 w-4" />}
        expandRequested={expandRequested}
        onExpandHandled={onExpandHandled}
      >
        <RulesPanel
          groups={groups}
          onSave={saveRules}
          onClose={() => setShowRulesPanel(false)}
        />
      </WidgetWrapper>
    );
  }

  // ─── Detail view ──────────────────────────────────────────────────
  if (selectedId && (selectedEmail || fetchingEmail)) {
    const emailGroupId = selectedEmail ? emailClassification.get(selectedEmail.id) : null;
    const emailGroup = emailGroupId ? groups.find((g) => g.id === emailGroupId) : null;

    return (
      <WidgetWrapper
        title="Email"
        widgetType="email"
        icon={<Mail className="h-4 w-4" />}
        expandRequested={expandRequested}
        onExpandHandled={onExpandHandled}
        headerAction={
          <div className="flex items-center gap-1">
            <button
              onClick={() => { setSelectedId(null); setFetchedEmail(null); setReplyOpen(false); setReplyText(""); setSendError(null); setSendSuccess(false); }}
              className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded-md hover:bg-muted"
              title="Back to inbox"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
            </button>
            {selectedEmail?.webLink && (
              <a
                href={selectedEmail.webLink}
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
        {fetchingEmail && !selectedEmail ? (
          <div className="flex items-center justify-center h-full">
            <div className="flex flex-col items-center gap-2 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-xs">Loading email...</span>
            </div>
          </div>
        ) : selectedEmail ? (
        <div className="flex flex-col h-full relative">
          {/* Quick rule dialog overlay */}
          {quickRuleEmail && groups.length > 0 && (
            <QuickRuleDialog
              email={quickRuleEmail}
              groups={groups}
              onAdd={addQuickRule}
              onClose={() => setQuickRuleEmail(null)}
            />
          )}

          {/* Subject */}
          <h3 className="text-sm font-semibold leading-snug mb-2">
            {selectedEmail.subject}
          </h3>

          {/* Metadata */}
          <div className="space-y-1 mb-3">
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground shrink-0">From</span>
              <span className="font-medium truncate">{selectedEmail.from}</span>
              <span className="text-muted-foreground truncate text-[10px]">
                &lt;{selectedEmail.fromAddress}&gt;
              </span>
            </div>
            {selectedEmail.to.length > 0 && (
              <div className="flex items-start gap-2 text-xs">
                <span className="text-muted-foreground shrink-0">To</span>
                <span className="truncate">{selectedEmail.to.join(", ")}</span>
              </div>
            )}
            {selectedEmail.cc.length > 0 && (
              <div className="flex items-start gap-2 text-xs">
                <span className="text-muted-foreground shrink-0">Cc</span>
                <span className="truncate">{selectedEmail.cc.join(", ")}</span>
              </div>
            )}
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
              <span>{formatFullDate(selectedEmail.time)}</span>
              {selectedEmail.hasAttachments && (
                <span className="inline-flex items-center gap-0.5">
                  <Paperclip className="h-2.5 w-2.5" /> Attachments
                </span>
              )}
              {emailGroup && (
                <span className={cn(
                  "inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] leading-none",
                  getColor(emailGroup.color).bg,
                  getColor(emailGroup.color).text
                )}>
                  <span className={cn("h-1.5 w-1.5 rounded-full", getColor(emailGroup.color).dot)} />
                  {emailGroup.name}
                </span>
              )}
              {!emailGroup && groups.length > 0 && (
                <button
                  onClick={() => setQuickRuleEmail(selectedEmail)}
                  className="inline-flex items-center gap-0.5 text-primary hover:underline"
                >
                  <Tag className="h-2.5 w-2.5" /> Classify
                </button>
              )}
            </div>
          </div>

          <Separator className="mb-3" />

          <ScrollArea className="flex-1 -mx-1 px-1">
            <HtmlContent
              html={selectedEmail.bodyHtml || ""}
              fallbackText={selectedEmail.bodyText || selectedEmail.preview}
            />
          </ScrollArea>

          {/* Reply bar */}
          {!replyOpen ? (
            <div className="flex items-center gap-1.5 pt-2 mt-2 border-t border-border/50 shrink-0">
              <button
                onClick={() => { setReplyOpen(true); setReplyAll(false); setTimeout(() => replyTextareaRef.current?.focus(), 100); }}
                className="flex items-center gap-1.5 h-7 px-3 text-xs rounded-md border border-border/50 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
              >
                <Reply className="h-3.5 w-3.5" />
                Reply
              </button>
              <button
                onClick={() => { setReplyOpen(true); setReplyAll(true); setTimeout(() => replyTextareaRef.current?.focus(), 100); }}
                className="flex items-center gap-1.5 h-7 px-3 text-xs rounded-md border border-border/50 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
              >
                <ReplyAll className="h-3.5 w-3.5" />
                Reply All
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-2 pt-2 mt-2 border-t border-border/50 shrink-0">
              {/* Reply header */}
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-muted-foreground">
                  {replyAll ? "Reply All" : "Reply"} to{" "}
                  <span className="text-foreground font-medium">{selectedEmail.from}</span>
                  {replyAll && selectedEmail.cc.length > 0 && (
                    <span> + {selectedEmail.to.length + selectedEmail.cc.length - 1} others</span>
                  )}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setReplyAll(!replyAll)}
                    className={cn(
                      "p-1 rounded-md transition-colors",
                      replyAll
                        ? "text-primary bg-primary/10"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted"
                    )}
                    title={replyAll ? "Switch to Reply" : "Switch to Reply All"}
                  >
                    {replyAll ? <ReplyAll className="h-3 w-3" /> : <Reply className="h-3 w-3" />}
                  </button>
                  <button
                    onClick={() => { setReplyOpen(false); setReplyText(""); setSendError(null); setSendSuccess(false); }}
                    className="text-muted-foreground hover:text-foreground p-1 rounded-md hover:bg-muted"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              </div>

              {/* Reply textarea */}
              <textarea
                ref={replyTextareaRef}
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                placeholder="Write your reply..."
                rows={3}
                className="w-full text-xs rounded-md border border-border/50 bg-muted/30 p-2 placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/30 resize-none"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && replyText.trim() && !sending) {
                    sendReply(selectedEmail.id, replyText.trim(), replyAll);
                  }
                }}
              />

              {/* Send error */}
              {sendError && (
                <div className="flex items-center gap-1.5 text-[10px] text-destructive">
                  <AlertCircle className="h-3 w-3 shrink-0" />
                  <span className="truncate">{sendError}</span>
                </div>
              )}

              {/* Send success */}
              {sendSuccess && (
                <div className="flex items-center gap-1.5 text-[10px] text-green-600 dark:text-green-400">
                  <CheckCircle2 className="h-3 w-3 shrink-0" />
                  <span>Reply sent!</span>
                </div>
              )}

              {/* Send button */}
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-muted-foreground/50">
                  {navigator?.platform?.includes("Mac") ? "\u2318" : "Ctrl"}+Enter to send
                </span>
                <button
                  onClick={() => sendReply(selectedEmail.id, replyText.trim(), replyAll)}
                  disabled={!replyText.trim() || sending}
                  className="flex items-center gap-1.5 h-7 px-3 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors font-medium disabled:opacity-40"
                >
                  {sending ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <SendHorizontal className="h-3 w-3" />
                  )}
                  {sending ? "Sending..." : "Send"}
                </button>
              </div>
            </div>
          )}
        </div>
        ) : null}
      </WidgetWrapper>
    );
  }

  // ─── List view ────────────────────────────────────────────────────
  return (
    <WidgetWrapper
      title="Email"
      widgetType="email"
      icon={<Mail className="h-4 w-4" />}
      expandRequested={expandRequested}
      onExpandHandled={onExpandHandled}
      headerAction={
        <div className="flex items-center gap-2">
          {!loading && !error && unreadCount > 0 && (
            <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">
              {unreadCount} new
            </span>
          )}
          <button
            onClick={() => setShowRulesPanel(true)}
            className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded-md hover:bg-muted"
            title="Manage email groups & rules"
          >
            <Settings2 className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={fetchEmails}
            disabled={loading}
            className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded-md hover:bg-muted disabled:opacity-50"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          </button>
        </div>
      }
    >
      {loading && emails.length === 0 ? (
        <div className="flex items-center justify-center h-full">
          <div className="flex flex-col items-center gap-2 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-xs">Loading emails...</span>
          </div>
        </div>
      ) : error ? (
        <div className="flex items-center justify-center h-full">
          <div className="flex flex-col items-center gap-2 text-muted-foreground text-center px-4">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-xs max-w-[220px] leading-relaxed">{error}</span>
            {authUrl ? (
              <a
                href={authUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-primary hover:underline mt-1"
              >
                Connect Google Account
              </a>
            ) : tokenExpired && activeProfile === "work" ? (
              <div className="flex flex-col items-center gap-2 mt-2">
                {refreshingToken ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin text-primary" />
                    <span className="text-[11px] text-muted-foreground max-w-[200px] leading-relaxed">
                      {refreshStatus}
                    </span>
                  </>
                ) : refreshStatus && !refreshingToken ? (
                  <>
                    <span className="text-[11px] text-muted-foreground max-w-[220px] leading-relaxed">
                      {refreshStatus}
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={handleRefreshToken}
                        className="text-xs text-primary hover:underline flex items-center gap-1"
                      >
                        <KeyRound className="h-3 w-3" />
                        Try again
                      </button>
                      <button
                        onClick={fetchEmails}
                        className="text-xs text-muted-foreground hover:underline"
                      >
                        Retry fetch
                      </button>
                    </div>
                  </>
                ) : (
                  <button
                    onClick={handleRefreshToken}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary/10 text-primary text-xs font-medium hover:bg-primary/20 transition-colors"
                  >
                    <KeyRound className="h-3.5 w-3.5" />
                    Refresh Token
                  </button>
                )}
                <span className="text-[10px] text-muted-foreground/60">
                  Opens Outlook in Chrome to renew the session
                </span>
              </div>
            ) : (
              <button onClick={fetchEmails} className="text-xs text-primary hover:underline mt-1">
                Try again
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="flex flex-col h-full gap-2">
          {/* Search bar */}
          <div className="relative shrink-0">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Search emails..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full h-7 pl-7 pr-7 text-xs rounded-md border border-border/50 bg-muted/30 placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
            />
            {searchQuery && (
              <button
                onClick={() => { setSearchQuery(""); setSearchResults(null); }}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            )}
            {searching && (
              <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 animate-spin text-muted-foreground" />
            )}
          </div>

          {/* Group tabs */}
          {groups.length > 0 && (
            <div className="flex items-center gap-1 shrink-0 overflow-x-auto no-scrollbar">
              <button
                onClick={() => setActiveGroupTab(null)}
                className={cn(
                  "shrink-0 h-6 px-2 text-[10px] rounded-md transition-colors font-medium",
                  activeGroupTab === null
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                )}
              >
                All
                <span className="ml-1 opacity-60">{emails.length}</span>
              </button>
              <button
                onClick={() =>
                  setActiveGroupTab(activeGroupTab === "__focused__" ? null : "__focused__")
                }
                className={cn(
                  "shrink-0 h-6 px-2 text-[10px] rounded-md transition-colors font-medium",
                  activeGroupTab === "__focused__"
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                )}
              >
                Focused
                <span className="ml-1 opacity-60">{uncategorizedCount}</span>
              </button>
              {groups.map((group) => {
                const colors = getColor(group.color);
                const count = groupCounts[group.id] || 0;
                if (count === 0) return null;
                return (
                  <button
                    key={group.id}
                    draggable
                    onDragStart={(e) => {
                      setDraggedTabId(group.id);
                      e.dataTransfer.effectAllowed = "move";
                      if (e.currentTarget instanceof HTMLElement) {
                        e.dataTransfer.setDragImage(e.currentTarget, 0, 0);
                      }
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                      if (draggedTabId && draggedTabId !== group.id) {
                        setDragOverTabId(group.id);
                      }
                    }}
                    onDragLeave={() => {
                      if (dragOverTabId === group.id) setDragOverTabId(null);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (draggedTabId && draggedTabId !== group.id) {
                        reorderGroups(draggedTabId, group.id);
                      }
                      setDraggedTabId(null);
                      setDragOverTabId(null);
                    }}
                    onDragEnd={() => {
                      setDraggedTabId(null);
                      setDragOverTabId(null);
                    }}
                    onClick={() =>
                      setActiveGroupTab(activeGroupTab === group.id ? null : group.id)
                    }
                    className={cn(
                      "shrink-0 h-6 px-2 text-[10px] rounded-md transition-colors font-medium inline-flex items-center gap-1 cursor-grab active:cursor-grabbing",
                      activeGroupTab === group.id
                        ? cn(colors.bg, colors.text)
                        : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
                      draggedTabId === group.id && "opacity-40",
                      dragOverTabId === group.id && "ring-1 ring-primary/50"
                    )}
                  >
                    <span
                      className={cn("h-1.5 w-1.5 rounded-full shrink-0", colors.dot)}
                    />
                    {group.name}
                    <span className="opacity-60">{count}</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Search results indicator */}
          {searchResults !== null && (
            <div className="text-[10px] text-muted-foreground px-1 shrink-0">
              {searchResults.length} result{searchResults.length !== 1 ? "s" : ""} for &quot;{searchQuery}&quot;
            </div>
          )}

          {/* Email list */}
          <ScrollArea className="flex-1 -mx-1 px-1">
            <div className="space-y-1">
              {filteredEmails.map((email) => {
                const groupId = emailClassification.get(email.id);
                const group = groupId ? groups.find((g) => g.id === groupId) : null;
                return (
                  <div
                    key={email.id}
                    onClick={() => setSelectedId(email.id)}
                    className={cn(
                      "p-2.5 rounded-lg hover:bg-muted/50 transition-colors cursor-pointer group",
                      !email.read && "bg-primary/5"
                    )}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      {email.read ? (
                        <MailOpen className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      ) : (
                        <div className="h-2 w-2 rounded-full bg-primary shrink-0" />
                      )}
                      <span className={cn("text-sm truncate", !email.read && "font-semibold")}>
                        {email.from}
                      </span>
                      <div className="flex items-center gap-1 ml-auto shrink-0">
                        {group && (
                          <span className={cn(
                            "text-[9px] px-1.5 py-0.5 rounded-full leading-none inline-flex items-center gap-0.5",
                            getColor(group.color).bg,
                            getColor(group.color).text
                          )}>
                            <span className={cn("h-1 w-1 rounded-full", getColor(group.color).dot)} />
                            {group.name}
                          </span>
                        )}
                        {email.hasAttachments && (
                          <Paperclip className="h-3 w-3 text-muted-foreground" />
                        )}
                        <span className="text-[10px] text-muted-foreground">
                          {formatTime(email.time)}
                        </span>
                      </div>
                    </div>
                    <p className={cn("text-sm truncate ml-5", !email.read ? "font-medium" : "text-muted-foreground")}>
                      {email.subject}
                    </p>
                    <p className="text-xs text-muted-foreground truncate ml-5 mt-0.5">
                      {email.preview}
                    </p>
                  </div>
                );
              })}
              {filteredEmails.length === 0 && !searching && (
                <div className="flex flex-col items-center justify-center py-8 text-muted-foreground text-xs gap-1">
                  <Mail className="h-5 w-5 text-muted-foreground/40" />
                  <span>
                    {searchResults !== null
                      ? <>No emails match &quot;{searchQuery}&quot;</>
                      : activeGroupTab
                        ? "No emails in this group"
                        : "No emails"
                    }
                  </span>
                </div>
              )}
            </div>
          </ScrollArea>
        </div>
      )}
    </WidgetWrapper>
  );
}
