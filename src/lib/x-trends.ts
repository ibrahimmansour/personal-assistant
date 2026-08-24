/**
 * X (Twitter) trending topics per country, plus the news context that explains
 * each trend.
 *
 * X retired public access to its trends endpoint, so the trend list is scraped
 * from trends24.in, which publishes a 24-slot hourly timeline per country. That
 * timeline is what makes the detail view possible: a trend's rank history,
 * peak, and hours-on-list are all derived from the same page, not from a second
 * request.
 *
 * A trend name alone says nothing ("Enes", "Flachzangen"), so each trend is
 * paired with news coverage looked up in the country's own market and language.
 * Bing News RSS is primary because it returns a real snippet, the publisher's
 * direct URL (so the widget's reader can extract the article) and a thumbnail;
 * Google News RSS is the fallback for terms Bing has no coverage for, at the
 * cost of an opaque redirect link.
 */

import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import { createHash } from "crypto";

const DATA_DIR = join(homedir(), ".personal-assistant");
const TRENDS_CACHE_DIR = join(DATA_DIR, "x-trends-cache");
const CONTEXT_CACHE_DIR = join(DATA_DIR, "x-trends-context-cache");

/** trends24 publishes a new snapshot roughly hourly. */
const TRENDS_TTL_MS = 15 * 60 * 1000;
const CONTEXT_TTL_MS = 30 * 60 * 1000;

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

// ─── Countries ───────────────────────────────────────────────────────────────

export interface TrendCountry {
  id: string;
  name: string;
  flag: string;
  /** trends24.in path segment */
  slug: string;
  /** Bing market for the news lookup */
  mkt: string;
  /** Google News locale params (fallback lookup) */
  hl: string;
  gl: string;
  ceid: string;
  dir: "ltr" | "rtl";
}

export const TREND_COUNTRIES: TrendCountry[] = [
  {
    id: "eg",
    name: "Egypt",
    flag: "🇪🇬",
    slug: "egypt",
    mkt: "ar-EG",
    hl: "ar",
    gl: "EG",
    ceid: "EG:ar",
    dir: "rtl",
  },
  {
    id: "de",
    name: "Germany",
    flag: "🇩🇪",
    slug: "germany",
    mkt: "de-DE",
    hl: "de",
    gl: "DE",
    ceid: "DE:de",
    dir: "ltr",
  },
  {
    id: "us",
    name: "United States",
    flag: "🇺🇸",
    slug: "united-states",
    mkt: "en-US",
    hl: "en-US",
    gl: "US",
    ceid: "US:en",
    dir: "ltr",
  },
];

export function getCountry(id: string | null | undefined): TrendCountry | undefined {
  if (!id) return undefined;
  return TREND_COUNTRIES.find((c) => c.id === id);
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface XTrend {
  id: string;
  name: string;
  /** x.com search for the term */
  url: string;
  /** Rank in the newest snapshot, 1-based */
  rank: number;
  /** Best (lowest) rank across the 24h timeline */
  peakRank: number;
  /** How many hourly snapshots the trend appears in */
  hoursOnList: number;
  /**
   * Rank per snapshot, oldest → newest, `null` where the trend was off the
   * list. Length equals the number of snapshots on the page.
   */
  positions: (number | null)[];
  /** Only in the newest snapshot */
  isNew: boolean;
  /** Tweet volume, when trends24 still reports one */
  volume: string | null;
  countryId: string;
}

export interface TrendArticle {
  title: string;
  link: string;
  source: string;
  pubDate: string;
  description: string;
  thumbnail: string | null;
}

export interface TrendContext {
  trend: string;
  /** Snippet of the top match — the one-line "what is this about" */
  summary: string;
  articles: TrendArticle[];
  /** "bing" | "google" | "none" — surfaced so the UI can explain an empty result */
  provider: "bing" | "google" | "none";
  fetchedAt: number;
}

export interface CountryTrends {
  countryId: string;
  /** Timestamp of the newest snapshot */
  capturedAt: string;
  snapshotCount: number;
  trends: XTrend[];
  fetchedAt: number;
}

// ─── Small shared helpers ────────────────────────────────────────────────────

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)))
    .replace(/&amp;/g, "&");
}

function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
}

function extractTag(xml: string, tag: string): string {
  const match = xml.match(
    new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i")
  );
  if (!match) return "";
  const inner = match[1].replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/, "$1");
  return decodeEntities(inner).trim();
}

function hashKey(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 32);
}

async function readCache<T>(dir: string, key: string, ttlMs: number): Promise<T | null> {
  try {
    const raw = await readFile(join(dir, `${key}.json`), "utf-8");
    const parsed = JSON.parse(raw) as T & { fetchedAt?: number };
    if (!parsed.fetchedAt || Date.now() - parsed.fetchedAt > ttlMs) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function writeCache(dir: string, key: string, value: unknown): Promise<void> {
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${key}.json`), JSON.stringify(value));
  } catch {
    // Cache is best-effort — a read-only home directory shouldn't break trends.
  }
}

// ─── Trend list (trends24.in timeline) ───────────────────────────────────────

interface Snapshot {
  at: number;
  names: string[];
  urls: Map<string, string>;
  volumes: Map<string, string>;
}

/**
 * Each timeline card is `<h3 class=title data-timestamp=…>` followed by
 * `<ol class=trend-card__list>`, newest card first. Attributes on the page are
 * unquoted in places, so the patterns accept both forms.
 */
function parseTimeline(html: string): Snapshot[] {
  const snapshots: Snapshot[] = [];
  const cardRe =
    /data-timestamp="?([0-9.]+)"?[^>]*>[\s\S]*?<ol[^>]*class="?trend-card__list"?[^>]*>([\s\S]*?)<\/ol>/g;

  let card: RegExpExecArray | null;
  while ((card = cardRe.exec(html)) !== null) {
    const at = Math.round(parseFloat(card[1]) * 1000);
    if (!Number.isFinite(at)) continue;

    const names: string[] = [];
    const urls = new Map<string, string>();
    const volumes = new Map<string, string>();

    // Split per `<li>` first: the tweet-count span is optional, and a regex
    // spanning the whole list would happily pair one trend with the next
    // trend's count.
    for (const li of card[2].split(/<li[^>]*>/).slice(1)) {
      const anchor = li.match(/<a([^>]*class="?trend-link"?[^>]*)>([\s\S]*?)<\/a>/);
      if (!anchor) continue;
      const name = stripTags(anchor[2]);
      if (!name || urls.has(name)) continue;
      names.push(name);
      const href = anchor[1].match(/href="?([^"\s>]+)"?/);
      // trends24 still links to twitter.com; x.com is where the click lands.
      urls.set(
        name,
        href
          ? decodeEntities(href[1]).replace("//twitter.com/", "//x.com/")
          : `https://x.com/search?q=${encodeURIComponent(name)}`
      );
      const volume = li.match(/data-count="([^"]*)"/);
      if (volume && volume[1].trim()) volumes.set(name, volume[1].trim());
    }

    if (names.length > 0) snapshots.push({ at, names, urls, volumes });
  }

  // Newest first on the page; the caller wants oldest → newest for history.
  return snapshots.sort((a, b) => a.at - b.at);
}

function buildTrends(snapshots: Snapshot[], country: TrendCountry): XTrend[] {
  if (snapshots.length === 0) return [];
  const latest = snapshots[snapshots.length - 1];

  return latest.names.map((name, i) => {
    const positions = snapshots.map((s) => {
      const idx = s.names.indexOf(name);
      return idx === -1 ? null : idx + 1;
    });
    const seen = positions.filter((p): p is number => p !== null);
    const firstSeenIdx = positions.findIndex((p) => p !== null);

    return {
      id: `${country.id}-${hashKey(name).slice(0, 12)}`,
      name,
      url:
        latest.urls.get(name) ||
        `https://x.com/search?q=${encodeURIComponent(name)}`,
      rank: i + 1,
      peakRank: seen.length > 0 ? Math.min(...seen) : i + 1,
      hoursOnList: seen.length,
      positions,
      isNew: firstSeenIdx === positions.length - 1,
      volume: latest.volumes.get(name) || null,
      countryId: country.id,
    };
  });
}

export async function fetchCountryTrends(
  country: TrendCountry,
  { force = false }: { force?: boolean } = {}
): Promise<CountryTrends | { error: string }> {
  if (!force) {
    const cached = await readCache<CountryTrends>(TRENDS_CACHE_DIR, country.id, TRENDS_TTL_MS);
    if (cached) return cached;
  }

  try {
    const res = await fetch(`https://trends24.in/${country.slug}/`, {
      headers: {
        "User-Agent": BROWSER_UA,
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return { error: `Trend source returned ${res.status}` };

    const html = await res.text();
    const snapshots = parseTimeline(html);
    if (snapshots.length === 0) return { error: "No trend snapshots found" };

    const trends = buildTrends(snapshots, country);
    if (trends.length === 0) return { error: "No trends in the latest snapshot" };

    const result: CountryTrends = {
      countryId: country.id,
      capturedAt: new Date(snapshots[snapshots.length - 1].at).toISOString(),
      snapshotCount: snapshots.length,
      trends,
      fetchedAt: Date.now(),
    };
    await writeCache(TRENDS_CACHE_DIR, country.id, result);
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : "fetch failed";
    return { error: /timeout|abort/i.test(message) ? "Trend source timed out" : message };
  }
}

// ─── Trend context (what the trend is actually about) ────────────────────────

/**
 * `#Sommerinterview` and `الامارات_تصنع_الاستدامه` are hashtags, not queries:
 * the `#` finds nothing and the underscores are word separators.
 */
function searchQuery(name: string): string {
  return name.replace(/^#/, "").replace(/_/g, " ").trim() || name;
}

/** Bing wraps every link in an apiclick redirect that carries the real URL. */
function unwrapBingLink(link: string): string {
  try {
    const url = new URL(link);
    const target = url.searchParams.get("url");
    if (target) return target;
  } catch {
    // fall through to the original
  }
  return link;
}

function parseRssItems(xml: string): string[] {
  return xml.match(/<item>[\s\S]*?<\/item>/g) || [];
}

function parseBing(xml: string): TrendArticle[] {
  return parseRssItems(xml)
    .map((item): TrendArticle | null => {
      const title = stripTags(extractTag(item, "title"));
      const link = unwrapBingLink(extractTag(item, "link"));
      if (!title || !link) return null;
      return {
        title,
        link,
        source: stripTags(extractTag(item, "News:Source")),
        pubDate: extractTag(item, "pubDate"),
        description: stripTags(extractTag(item, "description")),
        thumbnail: extractTag(item, "News:Image") || null,
      };
    })
    .filter((a): a is TrendArticle => a !== null);
}

function parseGoogle(xml: string): TrendArticle[] {
  return parseRssItems(xml)
    .map((item): TrendArticle | null => {
      const rawTitle = stripTags(extractTag(item, "title"));
      const link = extractTag(item, "link");
      if (!rawTitle || !link) return null;
      // Google appends " - Publisher" to every headline.
      const sourceTag = stripTags(extractTag(item, "source"));
      const split = rawTitle.lastIndexOf(" - ");
      const title = sourceTag && split > 0 ? rawTitle.slice(0, split) : rawTitle;
      return {
        title,
        link,
        source: sourceTag,
        pubDate: extractTag(item, "pubDate"),
        // Google's description is a list of anchors, not prose — nothing to show.
        description: "",
        thumbnail: null,
      };
    })
    .filter((a): a is TrendArticle => a !== null);
}

async function fetchRss(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": BROWSER_UA,
        Accept: "application/rss+xml,application/xml,text/xml",
      },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

const MAX_CONTEXT_ARTICLES = 6;

export async function fetchTrendContext(
  country: TrendCountry,
  trend: string
): Promise<TrendContext> {
  const key = `${country.id}-${hashKey(trend)}`;
  const cached = await readCache<TrendContext>(CONTEXT_CACHE_DIR, key, CONTEXT_TTL_MS);
  if (cached) return cached;

  const query = searchQuery(trend);
  let articles: TrendArticle[] = [];
  let provider: TrendContext["provider"] = "none";

  const bing = await fetchRss(
    `https://www.bing.com/news/search?q=${encodeURIComponent(query)}&format=RSS&mkt=${country.mkt}`
  );
  if (bing) {
    articles = parseBing(bing);
    if (articles.length > 0) provider = "bing";
  }

  if (articles.length === 0) {
    const google = await fetchRss(
      `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=${country.hl}&gl=${country.gl}&ceid=${encodeURIComponent(country.ceid)}`
    );
    if (google) {
      articles = parseGoogle(google);
      if (articles.length > 0) provider = "google";
    }
  }

  // De-duplicate by headline — syndicated wire copy repeats verbatim.
  const seen = new Set<string>();
  articles = articles
    .filter((a) => {
      const k = a.title.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, MAX_CONTEXT_ARTICLES);

  const context: TrendContext = {
    trend,
    summary: articles.find((a) => a.description)?.description || "",
    articles,
    provider,
    fetchedAt: Date.now(),
  };
  await writeCache(CONTEXT_CACHE_DIR, key, context);
  return context;
}
