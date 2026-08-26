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
  TrendingUp,
  Flame,
  Clock,
  Trophy,
  Sparkles,
  Languages as LanguagesIcon,
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
import { useWidgetNavFor } from "@/components/widget-nav-context";

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
  | "lifestyle"
  /** Mixed-feed items no keyword evidence could classify */
  | "general";

type Language = "en" | "ar" | "de";

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
  language?: Language;
}

interface NewsSource {
  id: string;
  name: string;
  feeds: Partial<Record<Genre | "all", string>>;
  genres: Genre[];
  language: Language;
  dir?: "ltr" | "rtl";
}

interface GenreOption {
  id: Genre;
  label: string;
}

interface LanguageOption {
  id: Language;
  label: string;
}

interface NewsSettings {
  /** Subscription — owned by the settings panel. */
  sources: string[];
  genres: Genre[];
  languages?: Language[];
  /** Filter chips — single-valued, independent of the subscription above. */
  activeGenre?: Genre | null;
  activeLanguage?: Language | null;
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

// ─── X trends types (mirror /api/news/trends) ────────────────────────────────

interface TrendCountryOption {
  id: string;
  name: string;
  flag: string;
  dir: "ltr" | "rtl";
}

interface XTrend {
  id: string;
  name: string;
  url: string;
  rank: number;
  peakRank: number;
  hoursOnList: number;
  positions: (number | null)[];
  isNew: boolean;
  volume: string | null;
  countryId: string;
}

interface TrendArticle {
  title: string;
  link: string;
  source: string;
  pubDate: string;
  description: string;
  thumbnail: string | null;
}

interface TrendContext {
  trend: string;
  summary: string;
  articles: TrendArticle[];
  provider: "bing" | "google" | "none";
  fetchedAt: number;
}

type NewsMode = "news" | "trends";

const MODE_STORAGE_KEY = "news-widget-mode";
const TREND_COUNTRY_STORAGE_KEY = "news-widget-trend-country";

/** Fallback so the country chips render before /api/news/trends answers. */
const FALLBACK_COUNTRIES: TrendCountryOption[] = [
  { id: "eg", name: "Egypt", flag: "🇪🇬", dir: "rtl" },
  { id: "de", name: "Germany", flag: "🇩🇪", dir: "ltr" },
  { id: "us", name: "United States", flag: "🇺🇸", dir: "ltr" },
];

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
  general: "General",
};

/** Fallback so the language chips render before /api/news?action=settings answers. */
const LANGUAGE_OPTIONS: LanguageOption[] = [
  { id: "en", label: "English" },
  { id: "ar", label: "العربية" },
  { id: "de", label: "Deutsch" },
];

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
  general: "text-slate-500 bg-slate-500/10 border-slate-500/20",
};

function languageLabel(id: Language): string {
  return LANGUAGE_OPTIONS.find((l) => l.id === id)?.label || id;
}

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

      {/* Google-News proxy links are opaque redirects the extractor cannot
          follow — same limitation the trends pane labels for its fallbacks. */}
      {/news\.google\./.test(article.link) && (
        <p className="px-2 md:px-3 pt-1.5 text-[0.625rem] text-muted-foreground shrink-0">
          Via Google News — this link redirects, so the reader may fail. Use
          &quot;Open original&quot; if it does.
        </p>
      )}

      {/* Reader body */}
      <ScrollArea className="flex-1 min-h-0" ref={scrollRef}>
        <div
          className="px-1 py-4 md:px-6 md:py-5 max-w-3xl mx-auto"
          dir={article.dir || "ltr"}
          lang={article.language}
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

// ─── X trends: rank history sparkline ────────────────────────────────────────
// Ranks are inverted (#1 at the top) and gaps — hours the trend was off the
// list — break the line rather than being drawn through.

function TrendSparkline({
  positions,
  className,
  height = 24,
}: {
  positions: (number | null)[];
  className?: string;
  height?: number;
}) {
  const width = 100;
  const segments = useMemo(() => {
    const ranks = positions.filter((p): p is number => p !== null);
    if (ranks.length < 2) return [];
    const worst = Math.max(...ranks, 2);
    const stepX = positions.length > 1 ? width / (positions.length - 1) : width;
    const out: string[] = [];
    let current: string[] = [];
    positions.forEach((p, i) => {
      if (p === null) {
        if (current.length > 1) out.push(current.join(" "));
        current = [];
        return;
      }
      const y = ((p - 1) / (worst - 1)) * (height - 2) + 1;
      current.push(`${(i * stepX).toFixed(1)},${y.toFixed(1)}`);
    });
    if (current.length > 1) out.push(current.join(" "));
    return out;
  }, [positions, height]);

  if (segments.length === 0) return null;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={cn("text-primary/70", className)}
      aria-hidden
    >
      {segments.map((points, i) => (
        <polyline
          key={i}
          points={points}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}

// ─── X trends: list row ──────────────────────────────────────────────────────

function TrendListItem({
  trend,
  context,
  dir,
  active,
  onClick,
}: {
  trend: XTrend;
  context?: TrendContext;
  dir: "ltr" | "rtl";
  active: boolean;
  onClick: () => void;
}) {
  const headline = context?.articles[0]?.title || "";
  const summary = context?.summary || "";

  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-start flex items-start gap-2.5 p-2 min-h-11 md:min-h-0 rounded-lg transition-colors group",
        active ? "bg-primary/10 ring-1 ring-primary/30" : "hover:bg-muted/60 active:bg-muted"
      )}
    >
      <span
        className={cn(
          "shrink-0 w-7 text-center text-xs font-semibold tabular-nums pt-0.5",
          trend.rank <= 3 ? "text-primary" : "text-muted-foreground"
        )}
        aria-hidden
      >
        {trend.rank}
      </span>

      <span className="flex-1 min-w-0 flex flex-col gap-1">
        <span
          className={cn(
            "text-sm font-medium leading-snug line-clamp-2 transition-colors",
            active ? "text-primary" : "group-hover:text-primary"
          )}
          dir={dir}
        >
          {trend.name}
        </span>

        {(headline || summary) && (
          <span className="text-[0.6875rem] text-muted-foreground line-clamp-2 leading-snug" dir={dir}>
            {summary || headline}
          </span>
        )}

        <span className="flex items-center gap-1.5 flex-wrap" dir="ltr">
          {trend.isNew && (
            <Badge
              variant="outline"
              className="text-[0.5625rem] px-1 py-0 h-3.5 font-normal text-emerald-500 bg-emerald-500/10 border-emerald-500/20"
            >
              new
            </Badge>
          )}
          <span className="text-[0.625rem] text-muted-foreground">
            {trend.hoursOnList}h on list
          </span>
          <span className="text-[0.625rem] text-muted-foreground/60">·</span>
          <span className="text-[0.625rem] text-muted-foreground">peak #{trend.peakRank}</span>
          {trend.volume && (
            <>
              <span className="text-[0.625rem] text-muted-foreground/60">·</span>
              <span className="text-[0.625rem] text-muted-foreground">{trend.volume}</span>
            </>
          )}
        </span>
      </span>

      <TrendSparkline positions={trend.positions} className="w-14 h-6 shrink-0 mt-0.5" />
    </button>
  );
}

// ─── X trends: detail pane ───────────────────────────────────────────────────

interface TrendDetailPaneProps {
  trend: XTrend;
  country: TrendCountryOption;
  /** Context already fetched for the list, so the pane opens populated. */
  seedContext?: TrendContext;
  onClose: () => void;
  onOpenArticle: (article: TrendArticle) => void;
  fullWidth?: boolean;
}

function TrendDetailPane({
  trend,
  country,
  seedContext,
  onClose,
  onOpenArticle,
  fullWidth,
}: TrendDetailPaneProps) {
  const [context, setContext] = useState<TrendContext | null>(seedContext ?? null);
  const [loading, setLoading] = useState(!seedContext);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const fetchContext = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(
        `/api/news/trends?action=context&country=${encodeURIComponent(trend.countryId)}&trend=${encodeURIComponent(trend.name)}`
      );
      const json = await res.json();
      if (!res.ok || json.error) {
        setError(json.error || `Failed (${res.status})`);
        return;
      }
      setContext(json as TrendContext);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load coverage");
    } finally {
      setLoading(false);
    }
  }, [trend.countryId, trend.name]);

  useEffect(() => {
    // The pane is not remounted between trends in the desktop side panel, so
    // seed state has to be reapplied per trend rather than only at mount.
    setContext(seedContext ?? null);
    setError(null);
    if (!seedContext) fetchContext();
    else setLoading(false);
    scrollRef.current
      ?.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]')
      ?.scrollTo({ top: 0 });
    // `seedContext` is derived from the same trend; keying off the trend id
    // keeps a late list backfill from wiping a freshly fetched context.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trend.id]);

  const firstSeenIdx = trend.positions.findIndex((p) => p !== null);
  const hoursAgoFirstSeen =
    firstSeenIdx === -1 ? 0 : trend.positions.length - 1 - firstSeenIdx;

  return (
    <div
      className={cn(
        "flex flex-col h-full bg-card overflow-hidden",
        !fullWidth && "border rounded-lg"
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-1 md:px-3 py-2 border-b bg-muted/30 shrink-0">
        <Button
          variant="ghost"
          size="icon"
          className="h-11 w-11 md:h-7 md:w-7 shrink-0"
          onClick={onClose}
          title="Back to trends"
          aria-label="Back to trends"
        >
          <ArrowLeft className="h-4 w-4 md:h-3.5 md:w-3.5" />
        </Button>
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <Badge
            variant="outline"
            className="text-[0.625rem] h-5 px-1.5 font-normal text-sky-500 bg-sky-500/10 border-sky-500/20 shrink-0"
          >
            #{trend.rank}
          </Badge>
          <span className="text-xs font-medium truncate">
            {country.flag} {country.name}
          </span>
        </div>
        <a
          href={trend.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-muted-foreground hover:text-foreground inline-flex items-center justify-center h-11 w-11 md:h-auto md:w-auto md:p-1 rounded-md hover:bg-muted shrink-0"
          title="Open on X"
          aria-label="Open on X"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
        <Button
          variant="ghost"
          size="icon"
          className="h-11 w-11 md:h-7 md:w-7 shrink-0"
          onClick={fetchContext}
          disabled={loading}
          title="Refetch coverage"
          aria-label="Refetch coverage"
        >
          <RefreshCw className={cn("h-4 w-4 md:h-3.5 md:w-3.5", loading && "animate-spin")} />
        </Button>
      </div>

      {/* Body */}
      <ScrollArea className="flex-1 min-h-0" ref={scrollRef}>
        <div className="px-1 py-4 md:px-6 md:py-5 max-w-3xl mx-auto space-y-5">
          <header className="space-y-3 pb-4 border-b">
            <h1
              className="text-2xl md:text-3xl font-bold leading-tight tracking-tight"
              dir={country.dir}
            >
              {trend.name}
            </h1>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground" dir="ltr">
              <span className="flex items-center gap-1.5">
                <Flame className="h-3 w-3" />
                Rank #{trend.rank}
              </span>
              <span className="flex items-center gap-1.5">
                <Trophy className="h-3 w-3" />
                Peak #{trend.peakRank}
              </span>
              <span className="flex items-center gap-1.5">
                <Clock className="h-3 w-3" />
                {trend.hoursOnList}h on list
              </span>
              {firstSeenIdx !== -1 && (
                <span className="flex items-center gap-1.5">
                  <Sparkles className="h-3 w-3" />
                  {hoursAgoFirstSeen === 0
                    ? "first seen this hour"
                    : `first seen ${hoursAgoFirstSeen}h ago`}
                </span>
              )}
              {trend.volume && <span>{trend.volume}</span>}
            </div>
          </header>

          {/* Rank history over the last 24 hourly snapshots */}
          {trend.positions.length > 1 && (
            <section className="space-y-1.5">
              <h2 className="text-xs font-semibold text-muted-foreground">
                Rank over the last {trend.positions.length}h
              </h2>
              <div className="rounded-lg border bg-muted/20 p-3">
                <TrendSparkline positions={trend.positions} height={40} className="w-full h-16" />
                <div className="flex items-center justify-between text-[0.625rem] text-muted-foreground pt-1" dir="ltr">
                  <span>{trend.positions.length}h ago</span>
                  <span>now</span>
                </div>
              </div>
            </section>
          )}

          {/* News coverage — the "what is this actually about" */}
          <section className="space-y-2">
            <h2 className="text-xs font-semibold text-muted-foreground">
              Why it&apos;s trending
            </h2>

            {loading ? (
              <div className="flex flex-col items-center justify-center py-10 gap-3 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span className="text-sm">Looking for coverage…</span>
              </div>
            ) : error ? (
              <div className="flex flex-col items-center justify-center py-10 gap-2 text-center">
                <AlertCircle className="h-5 w-5 text-destructive" />
                <p className="text-xs text-muted-foreground max-w-md">{error}</p>
              </div>
            ) : context && context.articles.length > 0 ? (
              <>
                {context.summary && (
                  <p className="text-[0.9375rem] leading-7 text-foreground/90" dir={country.dir}>
                    {context.summary}
                  </p>
                )}
                <div className="space-y-1">
                  {context.articles.map((article) => (
                    <div key={article.link} className="flex items-start gap-1">
                      <button
                        onClick={() => onOpenArticle(article)}
                        className="flex-1 min-w-0 text-start flex items-start gap-2.5 p-2 min-h-11 md:min-h-0 rounded-lg hover:bg-muted/60 active:bg-muted transition-colors group"
                        dir={country.dir}
                      >
                        {article.thumbnail ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={article.thumbnail}
                            alt=""
                            className="w-12 h-12 rounded-md object-cover shrink-0 bg-muted"
                            loading="lazy"
                          />
                        ) : null}
                        <span className="flex-1 min-w-0 flex flex-col gap-1">
                          <span className="text-sm font-medium leading-snug line-clamp-2 group-hover:text-primary transition-colors">
                            {article.title}
                          </span>
                          {article.description && (
                            <span className="text-[0.6875rem] text-muted-foreground line-clamp-2 leading-snug">
                              {article.description}
                            </span>
                          )}
                          <span className="flex items-center gap-1.5 flex-wrap" dir="ltr">
                            {article.source && (
                              <span className="text-[0.625rem] text-muted-foreground truncate">
                                {article.source}
                              </span>
                            )}
                            {article.pubDate && (
                              <>
                                <span className="text-[0.625rem] text-muted-foreground/60">·</span>
                                <span className="text-[0.625rem] text-muted-foreground">
                                  {timeAgo(article.pubDate)}
                                </span>
                              </>
                            )}
                          </span>
                        </span>
                      </button>
                      {/* Sibling, not nested: a button inside a button is invalid. */}
                      <a
                        href={article.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-muted-foreground hover:text-foreground inline-flex items-center justify-center h-11 w-11 md:h-8 md:w-8 rounded-md hover:bg-muted shrink-0"
                        title="Open original"
                        aria-label={`Open "${article.title}" in a new tab`}
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    </div>
                  ))}
                </div>
                {context.provider === "google" && (
                  <p className="text-[0.625rem] text-muted-foreground pt-1">
                    Coverage via Google News — these links redirect, so the reader may
                    fall back to opening them in the browser.
                  </p>
                )}
              </>
            ) : (
              <div className="flex flex-col items-center justify-center py-10 gap-2 text-center text-muted-foreground">
                <Newspaper className="h-6 w-6 opacity-40" />
                <p className="text-xs max-w-xs">
                  No news coverage found for this trend. It may be a hashtag campaign,
                  a fandom topic, or slang rather than a news event.
                </p>
                <a
                  href={trend.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 inline-flex items-center gap-1 h-11 md:h-7 px-3 md:px-2.5 text-[0.8rem] rounded-md border border-border bg-background hover:bg-muted hover:text-foreground transition-colors"
                >
                  See posts on X
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            )}
          </section>
        </div>
      </ScrollArea>
    </div>
  );
}

// ─── Settings panel ──────────────────────────────────────────────────────────

interface SettingsPanelProps {
  availableSources: NewsSource[];
  availableGenres: GenreOption[];
  availableLanguages: LanguageOption[];
  selectedSources: string[];
  selectedGenres: Genre[];
  selectedLanguages: Language[];
  onToggleSource: (id: string) => void;
  onToggleGenre: (id: Genre) => void;
  onToggleLanguage: (id: Language) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
}

function SettingsPanel({
  availableSources,
  availableGenres,
  availableLanguages,
  selectedSources,
  selectedGenres,
  selectedLanguages,
  onToggleSource,
  onToggleGenre,
  onToggleLanguage,
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

          {/* Languages */}
          <section>
            <h4 className="text-[0.625rem] font-semibold uppercase tracking-wider text-muted-foreground/70 mb-2">
              Languages
            </h4>
            <div className="flex flex-wrap gap-1.5">
              {availableLanguages.map((l) => {
                const active = selectedLanguages.includes(l.id);
                return (
                  <button
                    key={l.id}
                    onClick={() => onToggleLanguage(l.id)}
                    aria-pressed={active}
                    className={cn(
                      "text-xs px-3 md:px-2.5 min-h-11 md:min-h-0 md:py-1 rounded-full border transition-colors",
                      active
                        ? "font-medium bg-primary text-primary-foreground border-primary"
                        : "border-border text-muted-foreground hover:bg-muted"
                    )}
                  >
                    {l.label}
                  </button>
                );
              })}
            </div>
            <p className="text-[0.625rem] text-muted-foreground/60 mt-2">
              Empty = all languages
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
                    <div className="flex items-center gap-2">
                      <span className="text-sm truncate" dir={source.dir}>
                        {source.name}
                      </span>
                      <span className="text-[0.5625rem] uppercase tracking-wide text-muted-foreground shrink-0">
                        {languageLabel(source.language)}
                      </span>
                    </div>
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
          {selectedSources.length} sources · {selectedGenres.length || "all"} genres ·{" "}
          {selectedLanguages.length || "all"} languages
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
  // Without this the widget ignores navigateTo("news") entirely: the mobile
  // launcher mounts the tapped widget inside a hidden container and relies on
  // the nav request to expand it, so a news tile tap opened nothing at all.
  const { expandRequested, onExpandHandled } = useWidgetNavFor("news");
  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [settings, setSettings] = useState<NewsSettings>({
    sources: [],
    genres: [],
    activeGenre: null,
    activeLanguage: null,
  });
  // The sources the current list actually came from, as reported by the API.
  // Under a language chip that is the catalog's sources for that language
  // rather than the subscription, so the genre row has to be built from this,
  // not from `settings.sources`.
  const [effectiveSources, setEffectiveSources] = useState<string[] | null>(null);
  const [failedSources, setFailedSources] = useState<FailedSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Settings UI state
  const [showSettings, setShowSettings] = useState(false);
  const [availableSources, setAvailableSources] = useState<NewsSource[]>([]);
  const [availableGenres, setAvailableGenres] = useState<GenreOption[]>([]);
  const [availableLanguages, setAvailableLanguages] = useState<LanguageOption[]>(LANGUAGE_OPTIONS);
  const [draftSources, setDraftSources] = useState<string[]>([]);
  const [draftGenres, setDraftGenres] = useState<Genre[]>([]);
  const [draftLanguages, setDraftLanguages] = useState<Language[]>([]);
  const [savingSettings, setSavingSettings] = useState(false);

  // Reader state
  const [selectedArticle, setSelectedArticle] = useState<NewsArticle | null>(null);

  // ─── X trends state ───────────────────────────────────────────────────────

  const [mode, setModeState] = useState<NewsMode>(() => {
    if (typeof window === "undefined") return "news";
    return localStorage.getItem(MODE_STORAGE_KEY) === "trends" ? "trends" : "news";
  });
  const setMode = useCallback((next: NewsMode) => {
    setModeState(next);
    try { localStorage.setItem(MODE_STORAGE_KEY, next); } catch {}
  }, []);

  const [trendCountries, setTrendCountries] = useState<TrendCountryOption[]>(FALLBACK_COUNTRIES);
  const [trendCountryId, setTrendCountryIdState] = useState<string>(() => {
    if (typeof window === "undefined") return FALLBACK_COUNTRIES[0].id;
    return localStorage.getItem(TREND_COUNTRY_STORAGE_KEY) || FALLBACK_COUNTRIES[0].id;
  });
  const setTrendCountryId = useCallback((id: string) => {
    setTrendCountryIdState(id);
    try { localStorage.setItem(TREND_COUNTRY_STORAGE_KEY, id); } catch {}
  }, []);

  const [trends, setTrends] = useState<XTrend[]>([]);
  const [trendsCapturedAt, setTrendsCapturedAt] = useState<string>("");
  const [trendsLoading, setTrendsLoading] = useState(false);
  const [trendsError, setTrendsError] = useState<string | null>(null);
  // Keyed `${countryId}:${trend name}` so switching countries doesn't collide.
  const [trendContexts, setTrendContexts] = useState<Record<string, TrendContext>>({});
  const [selectedTrend, setSelectedTrend] = useState<XTrend | null>(null);

  const trendCountry = useMemo(
    () => trendCountries.find((c) => c.id === trendCountryId) || trendCountries[0],
    [trendCountries, trendCountryId]
  );

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

  // Every chip click refetches, and a feed round-trip is seconds long, so two
  // quick clicks can land their responses out of order — the second click's
  // list is then overwritten by the first click's, and the filter looks like it
  // did nothing. Only the newest in-flight request may write.
  const newsRequestRef = useRef(0);
  // Same problem one layer up: the filter write itself. Without this an older
  // set-filter response could re-apply its (stale) settings over the newer
  // click's and trigger a fetch for the filter the user already moved off.
  const filterWriteRef = useRef(0);

  const fetchNews = useCallback(async () => {
    const requestId = ++newsRequestRef.current;
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/news");
      if (!res.ok) throw new Error("Failed to fetch news");
      const data = await res.json();
      if (requestId !== newsRequestRef.current) return;
      setArticles(applyCachedThumbnails(data.articles || []));
      setEffectiveSources(
        Array.isArray(data.effectiveSources) ? data.effectiveSources : null
      );
      setFailedSources(data.failedSources || []);
      if (data.settings) setSettings(data.settings);
    } catch (err) {
      if (requestId !== newsRequestRef.current) return;
      setError(err instanceof Error ? err.message : "Failed to fetch news");
    } finally {
      if (requestId === newsRequestRef.current) setLoading(false);
    }
  }, [applyCachedThumbnails]);

  const fetchSettingsMeta = useCallback(async () => {
    try {
      const res = await fetch("/api/news?action=settings");
      if (!res.ok) return;
      const data = await res.json();
      setAvailableSources(data.available || []);
      setAvailableGenres(data.genres || []);
      if (Array.isArray(data.languages) && data.languages.length > 0) {
        setAvailableLanguages(data.languages);
      }
      setSettings(data.selected || { sources: [], genres: [] });
      setDraftSources(data.selected?.sources || []);
      setDraftGenres(data.selected?.genres || []);
      setDraftLanguages(data.selected?.languages || []);
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

  // ─── Trend fetching ───────────────────────────────────────────────────────

  const fetchTrends = useCallback(
    async (countryId: string, { force = false }: { force?: boolean } = {}) => {
      try {
        setTrendsLoading(true);
        setTrendsError(null);
        const res = await fetch(
          `/api/news/trends?country=${encodeURIComponent(countryId)}${force ? "&refresh=1" : ""}`
        );
        const json = await res.json();
        if (Array.isArray(json.countries) && json.countries.length > 0) {
          setTrendCountries(json.countries as TrendCountryOption[]);
        }
        if (!res.ok || json.error) {
          setTrends([]);
          setTrendsError(json.error || `Failed (${res.status})`);
          return;
        }
        setTrends(json.trends || []);
        setTrendsCapturedAt(json.capturedAt || "");
      } catch (err) {
        setTrends([]);
        setTrendsError(err instanceof Error ? err.message : "Failed to fetch trends");
      } finally {
        setTrendsLoading(false);
      }
    },
    []
  );

  // Trends are only fetched once the tab is actually opened — the widget's
  // common case is the article list, and each country costs an outbound scrape.
  useEffect(() => {
    if (mode !== "trends") return;
    fetchTrends(trendCountryId);
  }, [mode, trendCountryId, fetchTrends]);

  // Backfill the news context that explains each trend, in small chunks, the
  // same way the article list backfills thumbnails. Only the top of the list is
  // covered: each entry is an outbound news search, cached server-side for 30
  // minutes, and the rest resolve on demand when a trend is opened.
  const CONTEXT_PREFETCH = 12;
  useEffect(() => {
    if (mode !== "trends" || trends.length === 0) return;
    const wanted = trends
      .slice(0, CONTEXT_PREFETCH)
      .map((t) => t.name)
      .filter((name) => !trendContexts[`${trendCountryId}:${name}`]);
    if (wanted.length === 0) return;

    let cancelled = false;
    (async () => {
      const CHUNK_SIZE = 4;
      for (let i = 0; i < wanted.length; i += CHUNK_SIZE) {
        if (cancelled) return;
        try {
          const res = await fetch("/api/news/trends", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "contexts",
              country: trendCountryId,
              trends: wanted.slice(i, i + CHUNK_SIZE),
            }),
          });
          if (!res.ok) continue;
          const json = (await res.json()) as { results?: Record<string, TrendContext> };
          if (cancelled || !json.results) continue;
          setTrendContexts((prev) => {
            const next = { ...prev };
            for (const [name, ctx] of Object.entries(json.results!)) {
              next[`${trendCountryId}:${name}`] = ctx;
            }
            return next;
          });
        } catch {
          // ignore — try the next chunk
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // `trendContexts` is written by this effect; re-running on it would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, trends, trendCountryId]);

  const refreshActive = useCallback(() => {
    if (mode === "trends") fetchTrends(trendCountryId, { force: true });
    else fetchNews();
  }, [mode, trendCountryId, fetchTrends, fetchNews]);

  useRefreshOnVisible(refreshActive);

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
    setDraftLanguages(settings.languages ?? []);
    setShowSettings(true);
  }, [fetchSettingsMeta, settings]);

  const handleCancelSettings = useCallback(() => {
    setDraftSources(settings.sources);
    setDraftGenres(settings.genres);
    setDraftLanguages(settings.languages ?? []);
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
          languages: draftLanguages,
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
  }, [draftSources, draftGenres, draftLanguages, fetchNews]);

  const toggleDraftSource = useCallback(
    (id: string) => {
      const adding = !draftSources.includes(id);
      setDraftSources(
        adding ? [...draftSources, id] : draftSources.filter((s) => s !== id)
      );
      // Toggling a source on also ticks its genres into the draft when none
      // of them were selected, so a sports-only Arabic source (Kooora,
      // Filgoal) starts returning articles instead of silently yielding
      // nothing under a genre subset it can't serve. Visible before Save,
      // reversible like any other chip.
      const source = availableSources.find((s) => s.id === id);
      if (adding && source && !source.genres.some((g) => draftGenres.includes(g))) {
        setDraftGenres((prev) => Array.from(new Set([...prev, ...source.genres])));
      }
    },
    [draftSources, draftGenres, availableSources]
  );

  const toggleDraftGenre = useCallback((id: Genre) => {
    setDraftGenres((prev) =>
      prev.includes(id) ? prev.filter((g) => g !== id) : [...prev, id]
    );
  }, []);

  const toggleDraftLanguage = useCallback((id: Language) => {
    setDraftLanguages((prev) =>
      prev.includes(id) ? prev.filter((l) => l !== id) : [...prev, id]
    );
  }, []);

  // ─── Filter axes ──────────────────────────────────────────────────────────
  // The chip rows are a FILTER, single-valued per axis: clicking "Sports" shows
  // sports and nothing else, and "All" clears back to the subscription. They do
  // not edit the subscription (`settings.genres` / `settings.languages`), which
  // the settings panel owns.
  //
  // Sharing one list between the two is what made the chips read as broken.
  // As a multi-select over the subscription, clicking an already-subscribed
  // genre *removed* it and clicking an unsubscribed one *added* it — so the
  // click either widened the list or trimmed one genre out of five, and either
  // way the list came back looking the same. No single click could ever say
  // "only this", which is the one thing a filter chip looks like it does.

  const activeGenre = settings.activeGenre ?? null;
  const activeLanguage = settings.activeLanguage ?? null;
  const subscribedGenres = useMemo(() => settings.genres ?? [], [settings]);

  /**
   * Single writer for the chip rows. `undefined` = leave that axis alone.
   *
   * It writes the filter axes only. A chip that also edited the subscription
   * (the language chip used to subscribe its language's sources so it couldn't
   * select a silent set) left those sources behind on the next switch, so the
   * new filter's list arrived on top of the old filter's sources. The server
   * now scopes a language chip to the catalog instead, which needs no lasting
   * state, so a filter change replaces rather than accumulates.
   */
  const setFilter = useCallback(
    (next: { genre?: Genre | null; language?: Language | null }) => {
      // Two chip clicks land two writes; the settings file and this state must
      // both end up on the newer one however the responses interleave.
      const writeId = ++filterWriteRef.current;
      // Optimistic; the POST response (or a meta refetch on failure) is truth.
      setSettings((prev) => ({
        ...prev,
        activeGenre: next.genre === undefined ? prev.activeGenre ?? null : next.genre,
        activeLanguage:
          next.language === undefined ? prev.activeLanguage ?? null : next.language,
      }));
      (async () => {
        try {
          const res = await fetch("/api/news", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "set-filter", ...next }),
          });
          if (!res.ok) throw new Error("Failed to save");
          const json = await res.json();
          if (writeId !== filterWriteRef.current) return;
          if (json.settings) setSettings(json.settings);
        } catch {
          if (writeId !== filterWriteRef.current) return;
          await fetchSettingsMeta();
        } finally {
          // The server re-selects feeds from the saved axes — reload either
          // way, but only for the click that is still the current filter.
          if (writeId === filterWriteRef.current) fetchNews();
        }
      })();
    },
    [fetchNews, fetchSettingsMeta]
  );

  // Genres the user's current sources can actually serve. Restricting the row
  // to this set keeps every chip clickable-into-results: a genre no subscribed
  // source publishes would only ever empty the list. "general" joins whenever a
  // mixed ("all") feed is subscribed, since that is the bucket its
  // unclassifiable items land in.
  const genreFilterOptions = useMemo<GenreOption[]>(() => {
    const catalog: GenreOption[] =
      availableGenres.length > 0
        ? availableGenres
        : (Object.entries(GENRE_LABELS) as [Genre, string][]).map(([id, label]) => ({ id, label }));
    // Before the meta fetch lands (or if it failed) there is nothing to narrow
    // by — offer the whole catalog rather than a row built from stale state.
    if (availableSources.length === 0) return catalog;
    const selectedSourceSet = new Set(effectiveSources ?? settings.sources);
    const servable = new Set<Genre>();
    for (const s of availableSources) {
      if (!selectedSourceSet.has(s.id)) continue;
      for (const g of s.genres) servable.add(g);
      if (s.feeds.all) servable.add("general");
    }
    // Never hide the genre that is currently doing the filtering, even if the
    // source that served it was since unticked — the row would then misreport
    // the state it is supposed to show.
    if (activeGenre) servable.add(activeGenre);
    if (servable.size === 0) return catalog;
    return catalog.filter((g) => servable.has(g.id));
  }, [availableGenres, availableSources, effectiveSources, settings.sources, activeGenre]);

  // Exclusive: a click filters to that genre, clicking the active one clears.
  const handleSelectGenre = useCallback(
    (id: Genre) => setFilter({ genre: activeGenre === id ? null : id }),
    [activeGenre, setFilter]
  );

  // Every language the catalog offers, not just the ones the subscribed sources
  // happen to publish in. Deriving the row from the current selection made
  // Arabic unreachable from the widget body: no Arabic source ships in the
  // defaults, so the language that had no source got no chip, and the chip that
  // would have pulled its sources in was the missing one.
  const languagesInPlay = useMemo(() => {
    const catalog = availableLanguages.length > 0 ? availableLanguages : LANGUAGE_OPTIONS;
    if (availableSources.length === 0) return catalog.map((l) => l.id);
    const offered = new Set<Language>();
    for (const s of availableSources) offered.add(s.language);
    if (activeLanguage) offered.add(activeLanguage);
    return catalog.filter((l) => offered.has(l.id)).map((l) => l.id);
  }, [availableLanguages, availableSources, activeLanguage]);

  // Exclusive, like the genre row, and — like it — a view and nothing else.
  // The server picks the language's sources out of the catalog when the
  // subscription can't serve it, so the chip no longer has to subscribe them
  // to avoid selecting a silent set, and switching language drops the previous
  // language's sources instead of keeping them subscribed forever.
  const handleSelectLanguage = useCallback(
    (lang: Language) => setFilter({ language: activeLanguage === lang ? null : lang }),
    [activeLanguage, setFilter]
  );

  // ─── Reader handlers ──────────────────────────────────────────────────────

  const handleArticleClick = useCallback((article: NewsArticle) => {
    setSelectedArticle(article);
  }, []);

  const handleCloseReader = useCallback(() => {
    setSelectedArticle(null);
  }, []);

  // ─── Trend handlers ───────────────────────────────────────────────────────

  const handleTrendClick = useCallback((trend: XTrend) => {
    setSelectedTrend(trend);
  }, []);

  const handleCloseTrend = useCallback(() => {
    setSelectedTrend(null);
  }, []);

  // A trend's coverage links are read in the same reader as the article list,
  // so they are adapted to a NewsArticle rather than given a second reader.
  const handleOpenTrendArticle = useCallback(
    (article: TrendArticle) => {
      setSelectedArticle({
        id: `trend-article-${article.link}`,
        title: article.title,
        link: article.link,
        pubDate: article.pubDate,
        source: article.source || "Coverage",
        sourceId: `x-trends-${trendCountryId}`,
        genre: "general",
        description: article.description,
        thumbnail: article.thumbnail || undefined,
        dir: trendCountry?.dir || "ltr",
      });
    },
    [trendCountryId, trendCountry]
  );

  const handleSwitchMode = useCallback(
    (next: NewsMode) => {
      setSelectedArticle(null);
      setSelectedTrend(null);
      setMode(next);
    },
    [setMode]
  );

  const handleSwitchCountry = useCallback(
    (id: string) => {
      setSelectedArticle(null);
      setSelectedTrend(null);
      setTrendCountryId(id);
    },
    [setTrendCountryId]
  );

  // Below `md` these panes take over the whole expanded card rather than
  // docking beside the list, so each is a dismissible full-viewport surface and
  // needs its own back layer. They stack above the WidgetWrapper's layer, so
  // back walks reader → trend → widget.
  const trendIsOverlay = isMobile && !!selectedTrend;
  const readerIsOverlay = isMobile && !!selectedArticle;
  useBackHandler(trendIsOverlay, handleCloseTrend);
  useBackHandler(readerIsOverlay, handleCloseReader);

  useEffect(() => {
    if (!readerIsOverlay && !trendIsOverlay) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        // Topmost surface first, matching the back-layer order.
        if (readerIsOverlay) handleCloseReader();
        else handleCloseTrend();
      }
    };
    document.addEventListener("keydown", handleKey, true);
    return () => document.removeEventListener("keydown", handleKey, true);
  }, [readerIsOverlay, trendIsOverlay, handleCloseReader, handleCloseTrend]);

  // ─── Render ───────────────────────────────────────────────────────────────

  // Settings view replaces the whole widget body when open (no expand needed)
  if (showSettings) {
    return (
      <WidgetWrapper
        title="News Settings"
        icon={<Settings2 className="h-4 w-4" />}
        widgetType="news"
        expandRequested={expandRequested}
        onExpandHandled={onExpandHandled}
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
          availableLanguages={availableLanguages}
          selectedSources={draftSources}
          selectedGenres={draftGenres}
          selectedLanguages={draftLanguages}
          onToggleSource={toggleDraftSource}
          onToggleGenre={toggleDraftGenre}
          onToggleLanguage={toggleDraftLanguage}
          onSave={handleSaveSettings}
          onCancel={handleCancelSettings}
          saving={savingSettings}
        />
      </WidgetWrapper>
    );
  }

  const isTrends = mode === "trends";

  const modeToggle = (
    <div className="flex items-center gap-1 shrink-0" role="group" aria-label="News mode">
      <button
        onClick={() => handleSwitchMode("news")}
        aria-pressed={!isTrends}
        className={cn(
          "flex items-center gap-1.5 text-[0.6875rem] px-3 md:px-2 min-h-11 md:min-h-0 md:py-0.5 rounded-full border transition-colors",
          !isTrends
            ? "bg-primary text-primary-foreground border-primary font-medium"
            : "border-border text-muted-foreground hover:bg-muted"
        )}
      >
        <Newspaper className="h-3 w-3" />
        Headlines
      </button>
      <button
        onClick={() => handleSwitchMode("trends")}
        aria-pressed={isTrends}
        className={cn(
          "flex items-center gap-1.5 text-[0.6875rem] px-3 md:px-2 min-h-11 md:min-h-0 md:py-0.5 rounded-full border transition-colors",
          isTrends
            ? "bg-primary text-primary-foreground border-primary font-medium"
            : "border-border text-muted-foreground hover:bg-muted"
        )}
      >
        <TrendingUp className="h-3 w-3" />
        X Trends
      </button>
    </div>
  );

  return (
    <WidgetWrapper
      title={isTrends ? "X Trends" : "News"}
      icon={isTrends ? <TrendingUp className="h-4 w-4" /> : <Newspaper className="h-4 w-4" />}
      widgetType="news"
      expandRequested={expandRequested}
      onExpandHandled={onExpandHandled}
      forceExpand={!!selectedArticle || !!selectedTrend}
      onExpandChange={(expanded) => {
        // When user collapses the widget, clear whatever detail pane was open
        if (!expanded) {
          setSelectedArticle(null);
          setSelectedTrend(null);
        }
      }}
      // WidgetWrapper renders sidePanel as `hidden md:block`, so on a phone the
      // reader never appeared at all — tapping an article expanded the widget
      // and left the same list on screen. Below `md` the reader is rendered as
      // the widget body instead (see below).
      sidePanel={
        isMobile ? undefined : selectedArticle ? (
          <ReaderPane article={selectedArticle} onClose={handleCloseReader} />
        ) : selectedTrend && trendCountry ? (
          <TrendDetailPane
            trend={selectedTrend}
            country={trendCountry}
            seedContext={trendContexts[`${trendCountryId}:${selectedTrend.name}`]}
            onClose={handleCloseTrend}
            onOpenArticle={handleOpenTrendArticle}
          />
        ) : undefined
      }
      headerAction={
        <div
          className={cn(
            "flex items-center gap-0.5",
            (readerIsOverlay || trendIsOverlay) && "hidden"
          )}
        >
          {!isTrends && (
            <button
              onClick={handleOpenSettings}
              className="text-muted-foreground hover:text-foreground transition-colors inline-flex items-center justify-center h-11 w-11 md:h-auto md:w-auto md:p-1 rounded-md hover:bg-muted"
              title="Sources & genres"
              aria-label="Sources & genres"
            >
              <Settings2 className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            onClick={refreshActive}
            disabled={isTrends ? trendsLoading : loading}
            className="text-muted-foreground hover:text-foreground transition-colors inline-flex items-center justify-center h-11 w-11 md:h-auto md:w-auto md:p-1 rounded-md hover:bg-muted disabled:opacity-50"
            title="Refresh"
            aria-label="Refresh"
          >
            <RefreshCw
              className={cn("h-3.5 w-3.5", (isTrends ? trendsLoading : loading) && "animate-spin")}
            />
          </button>
        </div>
      }
    >
      {readerIsOverlay && selectedArticle ? (
        <div className="h-full -mx-1">
          <ReaderPane article={selectedArticle} onClose={handleCloseReader} fullWidth />
        </div>
      ) : trendIsOverlay && selectedTrend && trendCountry ? (
        <div className="h-full -mx-1">
          <TrendDetailPane
            trend={selectedTrend}
            country={trendCountry}
            seedContext={trendContexts[`${trendCountryId}:${selectedTrend.name}`]}
            onClose={handleCloseTrend}
            onOpenArticle={handleOpenTrendArticle}
            fullWidth
          />
        </div>
      ) : isTrends ? (
        <div className="flex flex-col h-full gap-2">
          {/* Mode + country chips */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 -mx-1 px-1 shrink-0 scrollbar-thin">
            {modeToggle}
            <span className="w-px h-5 bg-border shrink-0 mx-0.5" aria-hidden />
            {trendCountries.map((c) => {
              const active = c.id === trendCountryId;
              return (
                <button
                  key={c.id}
                  onClick={() => handleSwitchCountry(c.id)}
                  aria-pressed={active}
                  className={cn(
                    "flex items-center gap-1.5 text-[0.6875rem] px-3 md:px-2 min-h-11 md:min-h-0 md:py-0.5 rounded-full border transition-colors shrink-0",
                    active
                      ? "font-medium text-sky-500 bg-sky-500/10 border-sky-500/20"
                      : "border-border text-muted-foreground hover:bg-muted"
                  )}
                >
                  <span aria-hidden>{c.flag}</span>
                  {c.name}
                </button>
              );
            })}
          </div>

          {trendsCapturedAt && trends.length > 0 && (
            <div className="text-[0.625rem] text-muted-foreground shrink-0">
              X trends in {trendCountry?.name} · updated {timeAgo(trendsCapturedAt)}
            </div>
          )}

          {trendsLoading && trends.length === 0 ? (
            <div className="flex items-center justify-center flex-1">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : trendsError ? (
            <div className="flex flex-col items-center justify-center flex-1 gap-2 text-center">
              <AlertCircle className="h-5 w-5 text-destructive" />
              <span className="text-xs text-muted-foreground max-w-xs">{trendsError}</span>
              <Button
                variant="outline"
                size="sm"
                className="h-11 md:h-7 text-xs"
                onClick={() => fetchTrends(trendCountryId, { force: true })}
              >
                Try again
              </Button>
            </div>
          ) : trends.length === 0 ? (
            <div className="flex flex-col items-center justify-center flex-1 gap-2 text-muted-foreground">
              <TrendingUp className="h-8 w-8 opacity-40" />
              <p className="text-xs">No trends right now.</p>
            </div>
          ) : (
            // A feed round-trip is seconds long, so between a chip click and
            // its response the list on screen belongs to the *previous*
            // filter. Dimming it says so; left at full strength the new
            // articles look like they arrived on top of the old ones.
            <ScrollArea
              className={cn(
                "flex-1 min-h-0 -mx-1 transition-opacity",
                loading && "opacity-40"
              )}
            >
              <div className="space-y-0.5 px-1">
                {trends.map((trend) => (
                  <TrendListItem
                    key={trend.id}
                    trend={trend}
                    context={trendContexts[`${trendCountryId}:${trend.name}`]}
                    dir={trendCountry?.dir || "ltr"}
                    active={selectedTrend?.id === trend.id}
                    onClick={() => handleTrendClick(trend)}
                  />
                ))}
              </div>
            </ScrollArea>
          )}
        </div>
      ) : (
        <div className="flex flex-col h-full gap-2">
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 -mx-1 px-1 shrink-0 scrollbar-thin">
            {modeToggle}
          </div>

          {/* Active-filter summary. The chip rows scroll horizontally, so an
              active chip can sit off-screen — and a second axis left on
              (e.g. العربية) silently empties most genre picks, which reads
              exactly like "the filter does nothing". This bar never scrolls
              away and clears either axis in one tap. */}
          {(activeGenre || activeLanguage) && (
            <div className="flex items-center gap-1.5 flex-wrap shrink-0 text-[0.6875rem]">
              <span className="text-muted-foreground shrink-0">Filtered:</span>
              {activeGenre && (
                <button
                  onClick={() => setFilter({ genre: null })}
                  className={cn(
                    "inline-flex items-center gap-1 px-2 py-0.5 rounded-full border font-medium",
                    genreColors[activeGenre]
                  )}
                  aria-label={`Clear genre filter ${GENRE_LABELS[activeGenre]}`}
                >
                  {GENRE_LABELS[activeGenre]}
                  <X className="h-3 w-3" aria-hidden />
                </button>
              )}
              {activeLanguage && (
                <button
                  onClick={() => setFilter({ language: null })}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border font-medium bg-primary text-primary-foreground border-primary"
                  aria-label={`Clear language filter ${languageLabel(activeLanguage)}`}
                >
                  {languageLabel(activeLanguage)}
                  <X className="h-3 w-3" aria-hidden />
                </button>
              )}
              <button
                onClick={() => setFilter({ genre: null, language: null })}
                className="px-2 py-0.5 rounded-full border border-border text-muted-foreground hover:bg-muted"
              >
                Clear all
              </button>
            </div>
          )}

          {/* Genre filter chips — one genre at a time, "All" clears */}
          {genreFilterOptions.length > 1 && (
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 -mx-1 px-1 shrink-0 scrollbar-thin">
              <Filter className="h-3 w-3 text-muted-foreground shrink-0" />
              <button
                onClick={() => {
                  if (activeGenre) setFilter({ genre: null });
                }}
                aria-pressed={activeGenre === null}
                className={cn(
                  "text-[0.6875rem] px-3 md:px-2 min-h-11 md:min-h-0 md:py-0.5 rounded-full border transition-colors shrink-0",
                  activeGenre === null
                    ? "bg-primary text-primary-foreground border-primary font-medium"
                    : "border-border text-muted-foreground hover:bg-muted"
                )}
              >
                All
              </button>
              {genreFilterOptions.map((g) => {
                const active = activeGenre === g.id;
                return (
                  <button
                    key={g.id}
                    onClick={() => handleSelectGenre(g.id)}
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

          {/* Language filter chips — one language at a time, "All" clears */}
          {languagesInPlay.length > 1 && (
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 -mx-1 px-1 shrink-0 scrollbar-thin">
              <LanguagesIcon className="h-3 w-3 text-muted-foreground shrink-0" />
              <button
                onClick={() => {
                  if (activeLanguage) setFilter({ language: null });
                }}
                aria-pressed={activeLanguage === null}
                className={cn(
                  "text-[0.6875rem] px-3 md:px-2 min-h-11 md:min-h-0 md:py-0.5 rounded-full border transition-colors shrink-0",
                  activeLanguage === null
                    ? "bg-primary text-primary-foreground border-primary font-medium"
                    : "border-border text-muted-foreground hover:bg-muted"
                )}
              >
                All
              </button>
              {languagesInPlay.map((langId) => {
                const active = activeLanguage === langId;
                return (
                  <button
                    key={langId}
                    onClick={() => handleSelectLanguage(langId)}
                    aria-pressed={active}
                    className={cn(
                      "text-[0.6875rem] px-3 md:px-2 min-h-11 md:min-h-0 md:py-0.5 rounded-full border transition-colors shrink-0",
                      active
                        ? "bg-primary text-primary-foreground border-primary font-medium"
                        : "border-border text-muted-foreground hover:bg-muted"
                    )}
                  >
                    {languageLabel(langId)}
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
          ) : articles.length === 0 ? (
            <div className="flex flex-col items-center justify-center flex-1 gap-2 text-muted-foreground">
              <Newspaper className="h-8 w-8 opacity-40" />
              {activeGenre || activeLanguage ? (
                <>
                  {/* Name the active axes — an empty result under a forgotten
                      second filter (e.g. Technology × العربية, which has no
                      source) is the filter working, but without naming the
                      combo it is indistinguishable from a dead filter. */}
                  <p className="text-xs text-center max-w-[16rem]">
                    No{" "}
                    {[
                      activeGenre && GENRE_LABELS[activeGenre],
                      activeLanguage && languageLabel(activeLanguage),
                    ]
                      .filter(Boolean)
                      .join(" · ")}{" "}
                    articles right now.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-11 md:h-7 text-xs"
                    onClick={() => setFilter({ genre: null, language: null })}
                  >
                    Clear filter
                  </Button>
                </>
              ) : (
                <p className="text-xs">
                  {subscribedGenres.length > 0
                    ? "No articles for the selected genres."
                    : "No articles."}
                </p>
              )}
              <Button
                variant={activeGenre || activeLanguage ? "ghost" : "outline"}
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
                {articles.map((article) => (
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
      lang={article.language}
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
