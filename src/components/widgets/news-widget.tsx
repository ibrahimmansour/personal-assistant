"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  Newspaper,
  RefreshCw,
  Loader2,
  AlertCircle,
  ExternalLink,
  Settings2,
  Check,
  X,
  ArrowLeft,
  Filter,
  Calendar as CalendarIcon,
  User as UserIcon,
} from "lucide-react";
import { WidgetWrapper } from "@/components/widget-wrapper";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { useRefreshOnVisible } from "@/hooks/use-refresh-on-visible";
import { useIsMobile } from "@/hooks/use-swipe";
import { useBackHandler } from "@/hooks/use-back-handler";

// ─── Types (mirror the API) ──────────────────────────────────────────────────

type Genre =
  | "world"
  | "politics"
  | "business"
  | "technology"
  | "science"
  | "sports"
  | "entertainment"
  | "health"
  | "opinion"
  | "lifestyle";

interface NewsArticle {
  id: string;
  title: string;
  link: string;
  pubDate: string;
  source: string;
  sourceId: string;
  genre: Genre;
  description: string;
  thumbnail?: string;
  author?: string;
  dir?: "ltr" | "rtl";
  locale?: string;
}

interface NewsSource {
  id: string;
  name: string;
  feeds: Partial<Record<Genre | "all", string>>;
  genres: Genre[];
  locale?: string;
  dir?: "ltr" | "rtl";
}

interface GenreOption {
  id: Genre;
  label: string;
}

interface NewsSettings {
  sources: string[];
  genres: Genre[];
}

interface FailedSource {
  id: string;
  name: string;
  reason: string;
}

interface FullArticle {
  url: string;
  title: string;
  author: string;
  publishedAt: string;
  heroImage: string;
  content: string;
  fetchedAt: number;
}

// ─── Constants & helpers ─────────────────────────────────────────────────────

// Local labels so the genre chips still render when /api/news?action=settings
// hasn't answered (or failed) — the chips used to disappear entirely in that
// case even though the articles themselves had loaded.
const GENRE_LABELS: Record<Genre, string> = {
  world: "World",
  politics: "Politics",
  business: "Business",
  technology: "Technology",
  science: "Science",
  sports: "Sports",
  entertainment: "Entertainment",
  health: "Health",
  opinion: "Opinion",
  lifestyle: "Lifestyle",
};

const genreColors: Record<Genre, string> = {
  world: "text-rose-500 bg-rose-500/10 border-rose-500/20",
  politics: "text-amber-500 bg-amber-500/10 border-amber-500/20",
  business: "text-emerald-500 bg-emerald-500/10 border-emerald-500/20",
  technology: "text-blue-500 bg-blue-500/10 border-blue-500/20",
  science: "text-violet-500 bg-violet-500/10 border-violet-500/20",
  sports: "text-orange-500 bg-orange-500/10 border-orange-500/20",
  entertainment: "text-pink-500 bg-pink-500/10 border-pink-500/20",
  health: "text-teal-500 bg-teal-500/10 border-teal-500/20",
  opinion: "text-indigo-500 bg-indigo-500/10 border-indigo-500/20",
  lifestyle: "text-fuchsia-500 bg-fuchsia-500/10 border-fuchsia-500/20",
};

function timeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return "";
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatFullDate(dateStr: string): string {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// ─── Reader pane (rendered as sidePanel when expanded) ───────────────────────

interface ReaderPaneProps {
  article: NewsArticle;
  onClose: () => void;
  /**
   * Below `md` the reader replaces the list inside the expanded card instead of
   * sitting beside it, so it drops the border/rounding that make it read as a
   * separate pane.
   */
  fullWidth?: boolean;
}

function ReaderPane({ article, onClose, fullWidth }: ReaderPaneProps) {
  const [data, setData] = useState<FullArticle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [imagesFailed, setImagesFailed] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const fetchFull = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      setData(null);
      // ReaderPane isn't remounted between articles in the desktop side panel,
      // so a hero image that 404'd once would suppress every later one.
      setImagesFailed(false);
      const res = await fetch(`/api/news?action=article&url=${encodeURIComponent(article.link)}`);
      const json = await res.json();
      if (!res.ok || json.error) {
        setError(json.error || `Failed (${res.status})`);
        return;
      }
      setData(json as FullArticle);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load article");
    } finally {
      setLoading(false);
    }
  }, [article.link]);

  useEffect(() => {
    fetchFull();
    // Scroll to top when the article changes. The ref lands on ScrollArea's
    // Root, which never scrolls — the Viewport inside it is the scroller, so
    // setting scrollTop on the root was a no-op and a second article opened
    // mid-way down the previous one's scroll position.
    scrollRef.current
      ?.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]')
      ?.scrollTo({ top: 0 });
  }, [fetchFull]);

  return (
    <div
      className={cn(
        "flex flex-col h-full bg-card overflow-hidden",
        !fullWidth && "border rounded-lg"
      )}
    >
      {/* Reader header */}
      <div className="flex items-center gap-2 px-1 md:px-3 py-2 border-b bg-muted/30 shrink-0">
        <Button
          variant="ghost"
          size="icon"
          className="h-11 w-11 md:h-7 md:w-7 shrink-0"
          onClick={onClose}
          title="Back to list"
          aria-label="Back to list"
        >
          <ArrowLeft className="h-4 w-4 md:h-3.5 md:w-3.5" />
        </Button>
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <Badge
            variant="outline"
            className={cn("text-[0.625rem] h-5 px-1.5 font-normal shrink-0", genreColors[article.genre])}
          >
            {article.genre}
          </Badge>
          <span className="text-xs font-medium truncate">{article.source}</span>
        </div>
        <a
          href={article.link}
          target="_blank"
          rel="noopener noreferrer"
          className="text-muted-foreground hover:text-foreground inline-flex items-center justify-center h-11 w-11 md:h-auto md:w-auto md:p-1 rounded-md hover:bg-muted shrink-0"
          title="Open original"
          aria-label="Open original"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
        <Button
          variant="ghost"
          size="icon"
          className="h-11 w-11 md:h-7 md:w-7 shrink-0"
          onClick={fetchFull}
          disabled={loading}
          title="Refetch"
          aria-label="Refetch article"
        >
          <RefreshCw className={cn("h-4 w-4 md:h-3.5 md:w-3.5", loading && "animate-spin")} />
        </Button>
      </div>

      {/* Reader body */}
      <ScrollArea className="flex-1 min-h-0" ref={scrollRef}>
        <div
          className="px-1 py-4 md:px-6 md:py-5 max-w-3xl mx-auto"
          dir={article.dir || "ltr"}
        >
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin" />
              <span className="text-sm">Fetching article…</span>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
              <AlertCircle className="h-6 w-6 text-destructive" />
              <p className="text-sm text-muted-foreground max-w-md">{error}</p>
              <a
                href={article.link}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-flex items-center gap-1 h-11 md:h-7 px-3 md:px-2.5 text-[0.8rem] rounded-md border border-border bg-background hover:bg-muted hover:text-foreground transition-colors"
              >
                Open in browser
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          ) : data ? (
            <article className="space-y-4">
              {/* Article header */}
              <header className="space-y-3 pb-4 border-b">
                <h1 className="text-2xl md:text-3xl font-bold leading-tight tracking-tight">
                  {data.title || article.title}
                </h1>
                <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  {(data.author || article.author) && (
                    <span className="flex items-center gap-1.5">
                      <UserIcon className="h-3 w-3" />
                      {data.author || article.author}
                    </span>
                  )}
                  {(data.publishedAt || article.pubDate) && (
                    <span className="flex items-center gap-1.5">
                      <CalendarIcon className="h-3 w-3" />
                      {formatFullDate(data.publishedAt || article.pubDate)}
                    </span>
                  )}
                  <span>·</span>
                  <span>{article.source}</span>
                </div>
              </header>

              {/* Hero image */}
              {data.heroImage && !imagesFailed && (
                <figure className="-mx-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={data.heroImage}
                    alt={data.title}
                    className="w-full max-h-96 object-cover rounded-lg"
                    loading="lazy"
                    onError={() => setImagesFailed(true)}
                  />
                </figure>
              )}

              {/* Article body — sanitized HTML */}
              <div
                className={cn(
                  "text-[0.9375rem] leading-7 text-foreground/90",
                  // Paragraph spacing
                  "[&_p]:my-4",
                  // Headings
                  "[&_h1]:text-2xl [&_h1]:font-bold [&_h1]:mt-8 [&_h1]:mb-3",
                  "[&_h2]:text-xl [&_h2]:font-bold [&_h2]:mt-7 [&_h2]:mb-3",
                  "[&_h3]:text-lg [&_h3]:font-semibold [&_h3]:mt-6 [&_h3]:mb-2",
                  "[&_h4]:text-base [&_h4]:font-semibold [&_h4]:mt-5 [&_h4]:mb-2",
                  // Links
                  "[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2 hover:[&_a]:opacity-80",
                  // Lists — use logical properties so RTL flips correctly
                  "[&_ul]:list-disc [&_ul]:ps-6 [&_ul]:my-4",
                  "[&_ol]:list-decimal [&_ol]:ps-6 [&_ol]:my-4",
                  "[&_li]:my-1.5",
                  // Blockquotes — logical inline-start border
                  "[&_blockquote]:border-s-4 [&_blockquote]:border-primary/40 [&_blockquote]:ps-4 [&_blockquote]:my-4 [&_blockquote]:italic [&_blockquote]:text-muted-foreground",
                  // Inline code & pre
                  "[&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:bg-muted [&_code]:text-[0.8125rem] [&_code]:font-mono",
                  "[&_pre]:p-3 [&_pre]:rounded-lg [&_pre]:bg-muted [&_pre]:overflow-x-auto [&_pre]:my-4 [&_pre]:text-[0.8125rem]",
                  "[&_pre_code]:bg-transparent [&_pre_code]:p-0",
                  // Images
                  "[&_img]:rounded-lg [&_img]:my-4 [&_img]:max-w-full [&_img]:h-auto [&_img]:mx-auto",
                  // Figures
                  "[&_figure]:my-4",
                  "[&_figcaption]:text-xs [&_figcaption]:text-muted-foreground [&_figcaption]:text-center [&_figcaption]:mt-2",
                  // Tables — logical text-start
                  "[&_table]:w-full [&_table]:my-4 [&_table]:text-sm [&_table]:border-collapse",
                  "[&_th]:text-start [&_th]:font-semibold [&_th]:border [&_th]:border-border [&_th]:px-3 [&_th]:py-2 [&_th]:bg-muted/50",
                  "[&_td]:border [&_td]:border-border [&_td]:px-3 [&_td]:py-2",
                  // HR
                  "[&_hr]:my-6 [&_hr]:border-border",
                  // Strong / em
                  "[&_strong]:font-semibold",
                  "[&_em]:italic"
                )}
                dangerouslySetInnerHTML={{ __html: data.content }}
              />

              {/* Footer with original link */}
              <footer className="pt-6 mt-6 border-t flex items-center justify-between text-xs text-muted-foreground">
                <span>Cached from {article.source}</span>
                <a
                  href={article.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 hover:text-foreground transition-colors"
                >
                  Read on site
                  <ExternalLink className="h-3 w-3" />
                </a>
              </footer>
            </article>
          ) : null}
        </div>
      </ScrollArea>
    </div>
  );
}

// ─── Settings panel ──────────────────────────────────────────────────────────

interface SettingsPanelProps {
  availableSources: NewsSource[];
  availableGenres: GenreOption[];
  selectedSources: string[];
  selectedGenres: Genre[];
  onToggleSource: (id: string) => void;
  onToggleGenre: (id: Genre) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
}

function SettingsPanel({
  availableSources,
  availableGenres,
  selectedSources,
  selectedGenres,
  onToggleSource,
  onToggleGenre,
  onSave,
  onCancel,
  saving,
}: SettingsPanelProps) {
  return (
    <div className="flex flex-col h-full gap-3">
      <ScrollArea className="flex-1 min-h-0 -mx-1">
        <div className="px-1 space-y-5">
          {/* Genres */}
          <section>
            <h4 className="text-[0.625rem] font-semibold uppercase tracking-wider text-muted-foreground/70 mb-2">
              Genres
            </h4>
            <div className="flex flex-wrap gap-1.5">
              {availableGenres.map((g) => {
                const active = selectedGenres.includes(g.id);
                return (
                  <button
                    key={g.id}
                    onClick={() => onToggleGenre(g.id)}
                    aria-pressed={active}
                    className={cn(
                      "text-xs px-3 md:px-2.5 min-h-11 md:min-h-0 md:py-1 rounded-full border transition-colors",
                      active
                        ? cn("font-medium", genreColors[g.id])
                        : "border-border text-muted-foreground hover:bg-muted"
                    )}
                  >
                    {g.label}
                  </button>
                );
              })}
            </div>
            <p className="text-[0.625rem] text-muted-foreground/60 mt-2">
              Empty = all genres
            </p>
          </section>

          {/* Sources */}
          <section>
            <h4 className="text-[0.625rem] font-semibold uppercase tracking-wider text-muted-foreground/70 mb-2">
              Sources
            </h4>
            <div className="space-y-0.5">
              {availableSources.map((source) => (
                <label
                  key={source.id}
                  className="flex items-center gap-2.5 min-h-11 md:min-h-0 md:py-1.5 px-2 rounded-md hover:bg-muted/50 cursor-pointer transition-colors"
                >
                  <Checkbox
                    checked={selectedSources.includes(source.id)}
                    onCheckedChange={() => onToggleSource(source.id)}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm">{source.name}</div>
                    <div className="text-[0.625rem] text-muted-foreground">
                      {source.genres.join(" · ")}
                    </div>
                  </div>
                </label>
              ))}
            </div>
          </section>
        </div>
      </ScrollArea>

      {/* Footer */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t">
        <span className="text-xs text-muted-foreground">
          {selectedSources.length} sources · {selectedGenres.length || "all"} genres
        </span>
        <div className="flex gap-1.5 ms-auto">
          <Button
            size="sm"
            variant="ghost"
            className="h-11 md:h-7 text-xs"
            onClick={onCancel}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={onSave}
            disabled={saving || selectedSources.length === 0}
            className="h-11 md:h-7 text-xs"
          >
            {saving ? (
              <Loader2 className="h-3 w-3 animate-spin mr-1" />
            ) : (
              <Check className="h-3 w-3 mr-1" />
            )}
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Main widget ─────────────────────────────────────────────────────────────

export function NewsWidget() {
  const isMobile = useIsMobile();
  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [settings, setSettings] = useState<NewsSettings>({ sources: [], genres: [] });
  const [failedSources, setFailedSources] = useState<FailedSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Active genre filter (client-side, on top of saved settings)
  const [activeGenreFilter, setActiveGenreFilter] = useState<Genre | "all">("all");

  // Settings UI state
  const [showSettings, setShowSettings] = useState(false);
  const [availableSources, setAvailableSources] = useState<NewsSource[]>([]);
  const [availableGenres, setAvailableGenres] = useState<GenreOption[]>([]);
  const [draftSources, setDraftSources] = useState<string[]>([]);
  const [draftGenres, setDraftGenres] = useState<Genre[]>([]);
  const [savingSettings, setSavingSettings] = useState(false);

  // Reader state
  const [selectedArticle, setSelectedArticle] = useState<NewsArticle | null>(null);

  // ─── Data fetching ────────────────────────────────────────────────────────

  // Thumbnails resolved by the lazy og:image backfill below, keyed by article
  // link. The five-minute auto-refresh returns the same thumbnail-less RSS rows,
  // so without replaying this map every backfilled image disappeared on the
  // first refresh and never came back (the "already fetched" guard suppressed a
  // second lookup for the rest of the session).
  const thumbnailCacheRef = useRef<Map<string, string | null>>(new Map());

  const applyCachedThumbnails = useCallback((list: NewsArticle[]): NewsArticle[] => {
    const cache = thumbnailCacheRef.current;
    if (cache.size === 0) return list;
    return list.map((a) => {
      if (a.thumbnail) return a;
      const cached = cache.get(a.link);
      return cached ? { ...a, thumbnail: cached } : a;
    });
  }, []);

  const fetchNews = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/news");
      if (!res.ok) throw new Error("Failed to fetch news");
      const data = await res.json();
      setArticles(applyCachedThumbnails(data.articles || []));
      setFailedSources(data.failedSources || []);
      if (data.settings) setSettings(data.settings);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch news");
    } finally {
      setLoading(false);
    }
  }, [applyCachedThumbnails]);

  const fetchSettingsMeta = useCallback(async () => {
    try {
      const res = await fetch("/api/news?action=settings");
      if (!res.ok) return;
      const data = await res.json();
      setAvailableSources(data.available || []);
      setAvailableGenres(data.genres || []);
      setSettings(data.selected || { sources: [], genres: [] });
      setDraftSources(data.selected?.sources || []);
      setDraftGenres(data.selected?.genres || []);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetchNews();
    fetchSettingsMeta();
    const interval = setInterval(fetchNews, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchNews, fetchSettingsMeta]);

  useRefreshOnVisible(fetchNews);

  // ─── Lazy thumbnail backfill ──────────────────────────────────────────────
  // Some sources (Al Jazeera Arabic, Filgoal via Google News, sparse RSS feeds)
  // ship articles without thumbnails. We fetch og:image for those in batches
  // after the list loads. Server caches results for 7 days.
  useEffect(() => {
    const cache = thumbnailCacheRef.current;
    const missing = articles
      .filter((a) => !a.thumbnail && !cache.has(a.link))
      .map((a) => a.link);

    if (missing.length === 0) return;

    // Mark as in-flight so we don't refetch on re-render. A null entry means
    // "looked up, no image" — it still counts as known, so the lookup isn't
    // repeated, and applyCachedThumbnails treats it as no-op.
    for (const link of missing) cache.set(link, null);

    let cancelled = false;

    async function fetchInBatches() {
      // Fetch in chunks of 8 to keep server work bounded
      const CHUNK_SIZE = 8;
      for (let i = 0; i < missing.length; i += CHUNK_SIZE) {
        if (cancelled) return;
        const chunk = missing.slice(i, i + CHUNK_SIZE);
        try {
          const res = await fetch("/api/news", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "thumbnails", urls: chunk }),
          });
          if (!res.ok) continue;
          const data = (await res.json()) as { results: Record<string, string | null> };
          if (cancelled) return;
          for (const [link, thumb] of Object.entries(data.results || {})) {
            if (thumb) cache.set(link, thumb);
          }
          setArticles((prev) => {
            let changed = false;
            const next = prev.map((a) => {
              if (a.thumbnail) return a;
              const t = data.results?.[a.link];
              if (!t) return a;
              changed = true;
              return { ...a, thumbnail: t };
            });
            // Returning `prev` unchanged matters: this effect keys off
            // `articles`, so handing back a fresh array every chunk would
            // re-run it once per batch for no reason.
            return changed ? next : prev;
          });
        } catch {
          // ignore — try next chunk
        }
      }
    }

    fetchInBatches();
    return () => {
      cancelled = true;
    };
  }, [articles]);

  // ─── Settings handlers ────────────────────────────────────────────────────

  const handleOpenSettings = useCallback(() => {
    fetchSettingsMeta(); // refresh available list
    setDraftSources(settings.sources);
    setDraftGenres(settings.genres);
    setShowSettings(true);
  }, [fetchSettingsMeta, settings]);

  const handleCancelSettings = useCallback(() => {
    setDraftSources(settings.sources);
    setDraftGenres(settings.genres);
    setShowSettings(false);
  }, [settings]);

  const handleSaveSettings = useCallback(async () => {
    try {
      setSavingSettings(true);
      const res = await fetch("/api/news", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update-settings",
          sources: draftSources,
          genres: draftGenres,
        }),
      });
      if (!res.ok) throw new Error("Failed to save");
      const json = await res.json();
      if (json.settings) setSettings(json.settings);
      setShowSettings(false);
      fetchNews();
    } catch {
      // ignore
    } finally {
      setSavingSettings(false);
    }
  }, [draftSources, draftGenres, fetchNews]);

  const toggleDraftSource = useCallback((id: string) => {
    setDraftSources((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    );
  }, []);

  const toggleDraftGenre = useCallback((id: Genre) => {
    setDraftGenres((prev) =>
      prev.includes(id) ? prev.filter((g) => g !== id) : [...prev, id]
    );
  }, []);

  // ─── Filtering ────────────────────────────────────────────────────────────

  // Build the list of genres present in the current article set, for chip filter
  const genresInResults = useMemo(() => {
    const set = new Set<Genre>();
    for (const a of articles) set.add(a.genre);
    return Array.from(set);
  }, [articles]);

  // If the active chip filter is no longer represented in the results
  // (e.g. user changed source/genre selection in settings), reset to "all".
  useEffect(() => {
    if (activeGenreFilter !== "all" && !genresInResults.includes(activeGenreFilter)) {
      setActiveGenreFilter("all");
    }
  }, [activeGenreFilter, genresInResults]);

  // Chip order follows the server's genre list when we have it, but falls back
  // to the local labels so the filter row survives a failed settings fetch.
  const genreFilterOptions = useMemo<GenreOption[]>(() => {
    const source: GenreOption[] =
      availableGenres.length > 0
        ? availableGenres
        : (Object.entries(GENRE_LABELS) as [Genre, string][]).map(([id, label]) => ({ id, label }));
    return source.filter((g) => genresInResults.includes(g.id));
  }, [availableGenres, genresInResults]);

  const filteredArticles = useMemo(() => {
    if (activeGenreFilter === "all") return articles;
    return articles.filter((a) => a.genre === activeGenreFilter);
  }, [articles, activeGenreFilter]);

  // ─── Reader handlers ──────────────────────────────────────────────────────

  const handleArticleClick = useCallback((article: NewsArticle) => {
    setSelectedArticle(article);
  }, []);

  const handleCloseReader = useCallback(() => {
    setSelectedArticle(null);
  }, []);

  // Below `md` the reader takes over the whole expanded card rather than
  // docking beside the list, so it is a dismissible full-viewport surface and
  // needs its own back layer. It stacks above the WidgetWrapper's layer, so the
  // first back closes the article and the second closes the widget.
  const readerIsOverlay = isMobile && !!selectedArticle;
  useBackHandler(readerIsOverlay, handleCloseReader);

  useEffect(() => {
    if (!readerIsOverlay) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        handleCloseReader();
      }
    };
    document.addEventListener("keydown", handleKey, true);
    return () => document.removeEventListener("keydown", handleKey, true);
  }, [readerIsOverlay, handleCloseReader]);

  // ─── Render ───────────────────────────────────────────────────────────────

  // Settings view replaces the whole widget body when open (no expand needed)
  if (showSettings) {
    return (
      <WidgetWrapper
        title="News Settings"
        icon={<Settings2 className="h-4 w-4" />}
        widgetType="news"
        headerAction={
          <Button
            variant="ghost"
            size="icon"
            className="h-11 w-11 md:h-7 md:w-7"
            onClick={handleCancelSettings}
            aria-label="Close news settings"
          >
            <X className="h-4 w-4 md:h-3.5 md:w-3.5" />
          </Button>
        }
      >
        <SettingsPanel
          availableSources={availableSources}
          availableGenres={availableGenres}
          selectedSources={draftSources}
          selectedGenres={draftGenres}
          onToggleSource={toggleDraftSource}
          onToggleGenre={toggleDraftGenre}
          onSave={handleSaveSettings}
          onCancel={handleCancelSettings}
          saving={savingSettings}
        />
      </WidgetWrapper>
    );
  }

  return (
    <WidgetWrapper
      title="News"
      icon={<Newspaper className="h-4 w-4" />}
      widgetType="news"
      forceExpand={!!selectedArticle}
      onExpandChange={(expanded) => {
        // When user collapses the widget, clear the selected article
        if (!expanded) setSelectedArticle(null);
      }}
      // WidgetWrapper renders sidePanel as `hidden md:block`, so on a phone the
      // reader never appeared at all — tapping an article expanded the widget
      // and left the same list on screen. Below `md` the reader is rendered as
      // the widget body instead (see below).
      sidePanel={
        selectedArticle && !isMobile ? (
          <ReaderPane article={selectedArticle} onClose={handleCloseReader} />
        ) : undefined
      }
      headerAction={
        <div className={cn("flex items-center gap-0.5", readerIsOverlay && "hidden")}>
          <button
            onClick={handleOpenSettings}
            className="text-muted-foreground hover:text-foreground transition-colors inline-flex items-center justify-center h-11 w-11 md:h-auto md:w-auto md:p-1 rounded-md hover:bg-muted"
            title="Sources & genres"
            aria-label="Sources & genres"
          >
            <Settings2 className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={fetchNews}
            disabled={loading}
            className="text-muted-foreground hover:text-foreground transition-colors inline-flex items-center justify-center h-11 w-11 md:h-auto md:w-auto md:p-1 rounded-md hover:bg-muted disabled:opacity-50"
            title="Refresh"
            aria-label="Refresh"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          </button>
        </div>
      }
    >
      {readerIsOverlay ? (
        <div className="h-full -mx-1">
          <ReaderPane article={selectedArticle} onClose={handleCloseReader} fullWidth />
        </div>
      ) : (
        <div className="flex flex-col h-full gap-2">
          {/* Genre filter chips */}
          {articles.length > 0 && genresInResults.length > 1 && (
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 -mx-1 px-1 shrink-0 scrollbar-thin">
              <Filter className="h-3 w-3 text-muted-foreground shrink-0" />
              <button
                onClick={() => setActiveGenreFilter("all")}
                aria-pressed={activeGenreFilter === "all"}
                className={cn(
                  "text-[0.6875rem] px-3 md:px-2 min-h-11 md:min-h-0 md:py-0.5 rounded-full border transition-colors shrink-0",
                  activeGenreFilter === "all"
                    ? "bg-primary text-primary-foreground border-primary font-medium"
                    : "border-border text-muted-foreground hover:bg-muted"
                )}
              >
                All
              </button>
              {genreFilterOptions.map((g) => {
                const active = activeGenreFilter === g.id;
                return (
                  <button
                    key={g.id}
                    onClick={() => setActiveGenreFilter(g.id)}
                    aria-pressed={active}
                    className={cn(
                      "text-[0.6875rem] px-3 md:px-2 min-h-11 md:min-h-0 md:py-0.5 rounded-full border transition-colors shrink-0",
                      active
                        ? cn("font-medium", genreColors[g.id])
                        : "border-border text-muted-foreground hover:bg-muted"
                    )}
                  >
                    {g.label}
                  </button>
                );
              })}
            </div>
          )}

          {/* Partial-failure notice — a source that returns nothing used to leave
              no trace, so a half-empty (or empty) list looked like a broken widget. */}
          {failedSources.length > 0 && (
            <div className="flex items-start gap-1.5 shrink-0 text-[0.6875rem] text-muted-foreground">
              <AlertCircle className="h-3 w-3 mt-0.5 shrink-0 text-amber-500" />
              <span>
                No articles from {failedSources.map((f) => f.name).join(", ")} (
                {failedSources[0].reason}
                {failedSources.length > 1 ? ", …" : ""})
              </span>
            </div>
          )}

          {/* Article list */}
          {loading && articles.length === 0 ? (
            <div className="flex items-center justify-center flex-1">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="flex items-center justify-center flex-1">
              <div className="flex flex-col items-center gap-2 text-muted-foreground text-center">
                <AlertCircle className="h-5 w-5 text-destructive" />
                <span className="text-xs">{error}</span>
              </div>
            </div>
          ) : filteredArticles.length === 0 ? (
            <div className="flex flex-col items-center justify-center flex-1 gap-2 text-muted-foreground">
              <Newspaper className="h-8 w-8 opacity-40" />
              <p className="text-xs">
                {articles.length === 0 ? "No articles." : "No articles in this genre."}
              </p>
              <Button
                variant="outline"
                size="sm"
                className="h-11 md:h-7 text-xs"
                onClick={handleOpenSettings}
              >
                Configure sources
              </Button>
            </div>
          ) : (
            <ScrollArea className="flex-1 min-h-0 -mx-1">
              <div className="space-y-0.5 px-1">
                {filteredArticles.map((article) => (
                  <ArticleListItem
                    key={article.id}
                    article={article}
                    active={selectedArticle?.id === article.id}
                    onClick={() => handleArticleClick(article)}
                  />
                ))}
              </div>
            </ScrollArea>
          )}
        </div>
      )}
    </WidgetWrapper>
  );
}

// ─── List item ───────────────────────────────────────────────────────────────

function ArticleListItem({
  article,
  active,
  onClick,
}: {
  article: NewsArticle;
  active: boolean;
  onClick: () => void;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const showImage = article.thumbnail && !imgFailed;

  return (
    <button
      onClick={onClick}
      dir={article.dir || "ltr"}
      className={cn(
        "w-full text-start flex items-center gap-2.5 p-2 min-h-11 md:min-h-0 rounded-lg transition-colors group",
        active
          ? "bg-primary/10 ring-1 ring-primary/30"
          : "hover:bg-muted/60 active:bg-muted"
      )}
    >
      {/* Thumbnail */}
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={article.thumbnail}
          alt=""
          className="w-14 h-14 rounded-md object-cover shrink-0 bg-muted"
          loading="lazy"
          onError={() => setImgFailed(true)}
        />
      ) : (
        <SourcePlaceholder article={article} />
      )}

      {/* Body */}
      <div className="flex-1 min-w-0 flex flex-col gap-1">
        <h4
          className={cn(
            "text-sm font-medium leading-snug line-clamp-2 transition-colors",
            active ? "text-primary" : "group-hover:text-primary"
          )}
        >
          {article.title}
        </h4>
        <div className="flex items-center gap-1.5 flex-wrap" dir="ltr">
          <Badge
            variant="outline"
            className={cn("text-[0.5625rem] px-1 py-0 h-3.5 font-normal", genreColors[article.genre])}
          >
            {article.genre}
          </Badge>
          <span className="text-[0.625rem] text-muted-foreground truncate" dir={article.dir || "ltr"}>
            {article.source}
          </span>
          <span className="text-[0.625rem] text-muted-foreground/60">·</span>
          <span className="text-[0.625rem] text-muted-foreground">
            {timeAgo(article.pubDate)}
          </span>
        </div>
      </div>
    </button>
  );
}

// ─── Source placeholder tile ─────────────────────────────────────────────────
// Shown while the real thumbnail is being lazy-fetched, or as a permanent
// fallback when no og:image can be retrieved. Uses a deterministic color
// derived from the source id so the same source always looks consistent.

const PLACEHOLDER_GRADIENTS = [
  "from-rose-500 to-pink-600",
  "from-amber-500 to-orange-600",
  "from-emerald-500 to-teal-600",
  "from-blue-500 to-cyan-600",
  "from-violet-500 to-purple-600",
  "from-fuchsia-500 to-pink-600",
  "from-sky-500 to-indigo-600",
  "from-orange-500 to-red-600",
];

function gradientForSource(sourceId: string): string {
  let hash = 0;
  for (let i = 0; i < sourceId.length; i++) hash = (hash * 31 + sourceId.charCodeAt(i)) | 0;
  return PLACEHOLDER_GRADIENTS[Math.abs(hash) % PLACEHOLDER_GRADIENTS.length];
}

function SourcePlaceholder({ article }: { article: NewsArticle }) {
  const initial = (article.source || "?").trim().charAt(0).toUpperCase();
  const gradient = gradientForSource(article.sourceId);
  return (
    <div
      className={cn(
        "w-14 h-14 rounded-md shrink-0 flex items-center justify-center bg-gradient-to-br text-white shadow-sm",
        gradient
      )}
      aria-hidden
    >
      <span className="text-lg font-bold drop-shadow-sm">{initial}</span>
    </div>
  );
}
