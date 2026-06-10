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
}

function ReaderPane({ article, onClose }: ReaderPaneProps) {
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
    // Scroll to top when article changes
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [fetchFull]);

  return (
    <div className="flex flex-col h-full bg-card border rounded-lg overflow-hidden">
      {/* Reader header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/30 shrink-0">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          onClick={onClose}
          title="Back to list"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
        </Button>
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <Badge
            variant="outline"
            className={cn("text-[10px] h-5 px-1.5 font-normal shrink-0", genreColors[article.genre])}
          >
            {article.genre}
          </Badge>
          <span className="text-xs font-medium truncate">{article.source}</span>
        </div>
        <a
          href={article.link}
          target="_blank"
          rel="noopener noreferrer"
          className="text-muted-foreground hover:text-foreground p-1 rounded-md hover:bg-muted shrink-0"
          title="Open original"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          onClick={fetchFull}
          disabled={loading}
          title="Refetch"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
        </Button>
      </div>

      {/* Reader body */}
      <ScrollArea className="flex-1 min-h-0" ref={scrollRef}>
        <div
          className="px-6 py-5 max-w-3xl mx-auto"
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
                className="mt-2 inline-flex items-center gap-1 h-7 px-2.5 text-[0.8rem] rounded-md border border-border bg-background hover:bg-muted hover:text-foreground transition-colors"
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
                  "text-[15px] leading-7 text-foreground/90",
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
                  "[&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:bg-muted [&_code]:text-[13px] [&_code]:font-mono",
                  "[&_pre]:p-3 [&_pre]:rounded-lg [&_pre]:bg-muted [&_pre]:overflow-x-auto [&_pre]:my-4 [&_pre]:text-[13px]",
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
            <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 mb-2">
              Genres
            </h4>
            <div className="flex flex-wrap gap-1.5">
              {availableGenres.map((g) => {
                const active = selectedGenres.includes(g.id);
                return (
                  <button
                    key={g.id}
                    onClick={() => onToggleGenre(g.id)}
                    className={cn(
                      "text-xs px-2.5 py-1 rounded-full border transition-colors",
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
            <p className="text-[10px] text-muted-foreground/60 mt-2">
              Empty = all genres
            </p>
          </section>

          {/* Sources */}
          <section>
            <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 mb-2">
              Sources
            </h4>
            <div className="space-y-0.5">
              {availableSources.map((source) => (
                <label
                  key={source.id}
                  className="flex items-center gap-2.5 py-1.5 px-2 rounded-md hover:bg-muted/50 cursor-pointer transition-colors"
                >
                  <Checkbox
                    checked={selectedSources.includes(source.id)}
                    onCheckedChange={() => onToggleSource(source.id)}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm">{source.name}</div>
                    <div className="text-[10px] text-muted-foreground">
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
      <div className="flex items-center justify-between pt-2 border-t">
        <span className="text-xs text-muted-foreground">
          {selectedSources.length} sources · {selectedGenres.length || "all"} genres
        </span>
        <div className="flex gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            onClick={onCancel}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={onSave}
            disabled={saving || selectedSources.length === 0}
            className="h-7 text-xs"
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
  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [settings, setSettings] = useState<NewsSettings>({ sources: [], genres: [] });
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

  const fetchNews = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/news");
      if (!res.ok) throw new Error("Failed to fetch news");
      const data = await res.json();
      setArticles(data.articles || []);
      if (data.settings) setSettings(data.settings);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch news");
    } finally {
      setLoading(false);
    }
  }, []);

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
  const thumbnailFetchedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const missing = articles
      .filter((a) => !a.thumbnail && !thumbnailFetchedRef.current.has(a.link))
      .map((a) => a.link);

    if (missing.length === 0) return;

    // Mark as in-flight so we don't refetch on re-render
    for (const link of missing) thumbnailFetchedRef.current.add(link);

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
          setArticles((prev) =>
            prev.map((a) => {
              if (a.thumbnail) return a;
              const t = data.results?.[a.link];
              return t ? { ...a, thumbnail: t } : a;
            })
          );
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
            className="h-7 w-7"
            onClick={handleCancelSettings}
          >
            <X className="h-3.5 w-3.5" />
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
      sidePanel={
        selectedArticle ? (
          <ReaderPane article={selectedArticle} onClose={handleCloseReader} />
        ) : undefined
      }
      headerAction={
        <div className="flex items-center gap-0.5">
          <button
            onClick={handleOpenSettings}
            className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded-md hover:bg-muted"
            title="Sources & genres"
          >
            <Settings2 className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={fetchNews}
            disabled={loading}
            className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded-md hover:bg-muted disabled:opacity-50"
            title="Refresh"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          </button>
        </div>
      }
    >
      <div className="flex flex-col h-full gap-2">
        {/* Genre filter chips */}
        {articles.length > 0 && genresInResults.length > 1 && (
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 -mx-1 px-1 shrink-0 scrollbar-thin">
            <Filter className="h-3 w-3 text-muted-foreground shrink-0" />
            <button
              onClick={() => setActiveGenreFilter("all")}
              className={cn(
                "text-[11px] px-2 py-0.5 rounded-full border transition-colors shrink-0",
                activeGenreFilter === "all"
                  ? "bg-primary text-primary-foreground border-primary font-medium"
                  : "border-border text-muted-foreground hover:bg-muted"
              )}
            >
              All
            </button>
            {availableGenres
              .filter((g) => genresInResults.includes(g.id))
              .map((g) => {
                const active = activeGenreFilter === g.id;
                return (
                  <button
                    key={g.id}
                    onClick={() => setActiveGenreFilter(g.id)}
                    className={cn(
                      "text-[11px] px-2 py-0.5 rounded-full border transition-colors shrink-0",
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
              className="h-7 text-xs"
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
        "w-full text-start flex gap-2.5 p-2 rounded-lg transition-colors group",
        active
          ? "bg-primary/10 ring-1 ring-primary/30"
          : "hover:bg-muted/60"
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
            className={cn("text-[9px] px-1 py-0 h-3.5 font-normal", genreColors[article.genre])}
          >
            {article.genre}
          </Badge>
          <span className="text-[10px] text-muted-foreground truncate" dir={article.dir || "ltr"}>
            {article.source}
          </span>
          <span className="text-[10px] text-muted-foreground/60">·</span>
          <span className="text-[10px] text-muted-foreground">
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
