"use client";

import { WidgetWrapper } from "@/components/widget-wrapper";
import { useProfile } from "@/components/profile-context";
import { useWidgetNavFor } from "@/components/widget-nav-context";
import { cn } from "@/lib/utils";
import {
  Bookmark,
  Plus,
  Trash2,
  ExternalLink,
  Pencil,
  FolderOpen,
  X,
  Check,
  Search,
} from "lucide-react";
import { useState, useEffect, useCallback, useRef } from "react";

// ─── Types ───────────────────────────────────────────────────────────────────

interface BookmarkItem {
  id: string;
  title: string;
  url: string;
  category: string;
  favicon?: string;
}

// ─── Default bookmarks per profile ───────────────────────────────────────────

const defaultWorkBookmarks: BookmarkItem[] = [
  { id: "w1", title: "SAP GitHub", url: "https://github.wdf.sap.corp", category: "Dev" },
  { id: "w2", title: "SAP Jira", url: "https://jira.tools.sap", category: "Dev" },
  { id: "w3", title: "SAP Wiki", url: "https://wiki.one.int.sap", category: "Dev" },
  { id: "w4", title: "SAP Fiori Launchpad", url: "https://fiorilaunchpad.sap.com", category: "Work" },
  { id: "w5", title: "Outlook Web", url: "https://outlook.office.com", category: "Work" },
  { id: "w6", title: "SAP for Me", url: "https://me.sap.com", category: "Work" },
  { id: "w7", title: "Stack Overflow", url: "https://stackoverflow.com", category: "Reference" },
  { id: "w8", title: "MDN Web Docs", url: "https://developer.mozilla.org", category: "Reference" },
];

const defaultPrivateBookmarks: BookmarkItem[] = [
  { id: "p1", title: "GitHub", url: "https://github.com", category: "Dev" },
  { id: "p2", title: "Stack Overflow", url: "https://stackoverflow.com", category: "Dev" },
  { id: "p3", title: "Gmail", url: "https://mail.google.com", category: "Google" },
  { id: "p4", title: "Google Calendar", url: "https://calendar.google.com", category: "Google" },
  { id: "p5", title: "YouTube", url: "https://youtube.com", category: "Media" },
  { id: "p6", title: "Reddit", url: "https://reddit.com", category: "Media" },
  { id: "p7", title: "Twitter / X", url: "https://x.com", category: "Media" },
  { id: "p8", title: "MDN Web Docs", url: "https://developer.mozilla.org", category: "Reference" },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function faviconUrl(url: string): string {
  try {
    const u = new URL(url);
    return `https://www.google.com/s2/favicons?domain=${u.hostname}&sz=32`;
  } catch {
    return "";
  }
}

function generateId(): string {
  return `bm-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function BookmarksWidget() {
  const { activeProfile } = useProfile();
  const { expandRequested, onExpandHandled, pendingSearchQuery, clearPendingSearch } = useWidgetNavFor("bookmarks");
  const [bookmarks, setBookmarks] = useState<BookmarkItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [formTitle, setFormTitle] = useState("");
  const [formUrl, setFormUrl] = useState("");
  const [formCategory, setFormCategory] = useState("");
  const [filterQuery, setFilterQuery] = useState("");
  const [showFilter, setShowFilter] = useState(false);

  const titleInputRef = useRef<HTMLInputElement>(null);
  const filterInputRef = useRef<HTMLInputElement>(null);

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

  // ─── Load bookmarks ──────────────────────────────────────────────────────

  const loadBookmarks = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/browser?type=bookmarks&profile=${activeProfile}`
      );
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        setBookmarks(data);
      } else {
        const defaults =
          activeProfile === "work"
            ? defaultWorkBookmarks
            : defaultPrivateBookmarks;
        setBookmarks(defaults);
        await fetch("/api/browser", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "bookmarks",
            profile: activeProfile,
            data: defaults,
          }),
        });
      }
    } catch {
      const defaults =
        activeProfile === "work"
          ? defaultWorkBookmarks
          : defaultPrivateBookmarks;
      setBookmarks(defaults);
    }
    setLoading(false);
  }, [activeProfile]);

  useEffect(() => {
    setLoading(true);
    setActiveCategory(null);
    loadBookmarks();
  }, [loadBookmarks]);

  // ─── Save bookmarks ─────────────────────────────────────────────────────

  const saveBookmarks = useCallback(
    async (items: BookmarkItem[]) => {
      setBookmarks(items);
      await fetch("/api/browser", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "bookmarks",
          profile: activeProfile,
          data: items,
        }),
      }).catch(() => {});
    },
    [activeProfile]
  );

  // ─── CRUD handlers ──────────────────────────────────────────────────────

  const handleAdd = useCallback(() => {
    setAdding(true);
    setFormTitle("");
    setFormUrl("https://");
    setFormCategory(activeCategory || "");
    setTimeout(() => titleInputRef.current?.focus(), 50);
  }, [activeCategory]);

  const handleSaveNew = useCallback(() => {
    if (!formTitle.trim() || !formUrl.trim()) return;
    const newItem: BookmarkItem = {
      id: generateId(),
      title: formTitle.trim(),
      url: formUrl.trim(),
      category: formCategory.trim() || "Uncategorized",
    };
    saveBookmarks([...bookmarks, newItem]);
    setAdding(false);
  }, [formTitle, formUrl, formCategory, bookmarks, saveBookmarks]);

  const handleStartEdit = useCallback((item: BookmarkItem) => {
    setEditing(item.id);
    setFormTitle(item.title);
    setFormUrl(item.url);
    setFormCategory(item.category);
    setTimeout(() => titleInputRef.current?.focus(), 50);
  }, []);

  const handleSaveEdit = useCallback(() => {
    if (!editing || !formTitle.trim() || !formUrl.trim()) return;
    const updated = bookmarks.map((b) =>
      b.id === editing
        ? {
            ...b,
            title: formTitle.trim(),
            url: formUrl.trim(),
            category: formCategory.trim() || "Uncategorized",
          }
        : b
    );
    saveBookmarks(updated);
    setEditing(null);
  }, [editing, formTitle, formUrl, formCategory, bookmarks, saveBookmarks]);

  const handleDelete = useCallback(
    (id: string) => {
      saveBookmarks(bookmarks.filter((b) => b.id !== id));
      if (editing === id) setEditing(null);
    },
    [bookmarks, saveBookmarks, editing]
  );

  const handleCancel = useCallback(() => {
    setAdding(false);
    setEditing(null);
  }, []);

  // ─── Derived data ────────────────────────────────────────────────────────

  const categories = Array.from(new Set(bookmarks.map((b) => b.category)));
  const filtered = (() => {
    let result = activeCategory
      ? bookmarks.filter((b) => b.category === activeCategory)
      : bookmarks;
    if (filterQuery) {
      const q = filterQuery.toLowerCase();
      result = result.filter((b) =>
        b.title.toLowerCase().includes(q) ||
        b.url.toLowerCase().includes(q) ||
        b.category.toLowerCase().includes(q)
      );
    }
    return result;
  })();

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <WidgetWrapper
      title="Bookmarks"
      widgetType="bookmarks"
      icon={<Bookmark className="h-4 w-4" />}
      expandRequested={expandRequested}
      onExpandHandled={onExpandHandled}
      headerAction={loading ? undefined : (
        <div className="flex items-center gap-1">
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
            onClick={handleAdd}
            className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded-md hover:bg-muted"
            title="Add bookmark"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    >
      {loading ? (
        <div className="flex items-center justify-center h-full text-muted-foreground">
          <div className="h-4 w-4 border-2 border-muted-foreground/30 border-t-primary rounded-full animate-spin" />
        </div>
      ) : (
      <div className="flex flex-col h-full gap-2">
        {showFilter && (
          <div className="flex items-center gap-2 shrink-0">
            <div className="relative flex-1">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
              <input
                ref={filterInputRef}
                value={filterQuery}
                onChange={(e) => setFilterQuery(e.target.value)}
                placeholder="Filter bookmarks..."
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
          </div>
        )}
        {/* Category tabs */}
        {categories.length > 1 && (
          <div className="flex gap-1 shrink-0 flex-wrap">
            <button
              onClick={() => setActiveCategory(null)}
              className={cn(
                "px-2 py-0.5 text-[10px] font-medium rounded-full transition-colors",
                activeCategory === null
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              )}
            >
              All
            </button>
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() =>
                  setActiveCategory(activeCategory === cat ? null : cat)
                }
                className={cn(
                  "px-2 py-0.5 text-[10px] font-medium rounded-full transition-colors",
                  activeCategory === cat
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                )}
              >
                {cat}
              </button>
            ))}
          </div>
        )}

        {/* Add / Edit form */}
        {(adding || editing) && (
          <div className="shrink-0 border border-border rounded-lg p-2 bg-muted/30 space-y-1.5">
            <input
              ref={titleInputRef}
              type="text"
              value={formTitle}
              onChange={(e) => setFormTitle(e.target.value)}
              placeholder="Title"
              className="w-full text-xs bg-background border border-border rounded px-2 py-1 outline-none focus:border-primary/50"
              onKeyDown={(e) => {
                if (e.key === "Enter")
                  editing ? handleSaveEdit() : handleSaveNew();
                if (e.key === "Escape") handleCancel();
              }}
            />
            <input
              type="text"
              value={formUrl}
              onChange={(e) => setFormUrl(e.target.value)}
              placeholder="URL"
              className="w-full text-xs bg-background border border-border rounded px-2 py-1 outline-none focus:border-primary/50"
              onKeyDown={(e) => {
                if (e.key === "Enter")
                  editing ? handleSaveEdit() : handleSaveNew();
                if (e.key === "Escape") handleCancel();
              }}
            />
            <input
              type="text"
              value={formCategory}
              onChange={(e) => setFormCategory(e.target.value)}
              placeholder="Category (optional)"
              className="w-full text-xs bg-background border border-border rounded px-2 py-1 outline-none focus:border-primary/50"
              onKeyDown={(e) => {
                if (e.key === "Enter")
                  editing ? handleSaveEdit() : handleSaveNew();
                if (e.key === "Escape") handleCancel();
              }}
            />
            <div className="flex gap-1 justify-end">
              <button
                onClick={handleCancel}
                className="text-xs text-muted-foreground hover:text-foreground px-2 py-0.5 rounded hover:bg-muted transition-colors"
              >
                <X className="h-3 w-3" />
              </button>
              <button
                onClick={editing ? handleSaveEdit : handleSaveNew}
                className="text-xs text-primary hover:text-primary/80 px-2 py-0.5 rounded hover:bg-primary/10 transition-colors"
              >
                <Check className="h-3 w-3" />
              </button>
            </div>
          </div>
        )}

        {/* Bookmarks list */}
        <div className="flex-1 min-h-0 overflow-y-auto space-y-0.5 scrollbar-thin">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground">
              <FolderOpen className="h-5 w-5" />
              <span className="text-xs">No bookmarks yet</span>
              <button
                onClick={handleAdd}
                className="text-xs text-primary hover:underline"
              >
                Add one
              </button>
            </div>
          ) : (
            filtered.map((item) => (
              <a
                key={item.id}
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted/60 transition-colors"
              >
                {/* Favicon */}
                <img
                  src={item.favicon || faviconUrl(item.url)}
                  alt=""
                  className="h-4 w-4 rounded-sm shrink-0"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = "none";
                  }}
                />

                {/* Title + URL */}
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium truncate leading-tight">
                    {item.title}
                  </div>
                  <div className="text-[10px] text-muted-foreground truncate leading-tight">
                    {item.url.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                  </div>
                </div>

                {/* Actions (visible on hover) */}
                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleStartEdit(item);
                    }}
                    className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                    title="Edit"
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleDelete(item.id);
                    }}
                    className="p-0.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                    title="Delete"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                  <ExternalLink className="h-3 w-3 text-muted-foreground/50" />
                </div>
              </a>
            ))
          )}
        </div>
      </div>
      )}
    </WidgetWrapper>
  );
}
