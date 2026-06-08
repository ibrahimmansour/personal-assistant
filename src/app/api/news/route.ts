import { NextRequest } from "next/server";
import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import { createHash } from "crypto";

export const dynamic = "force-dynamic";

const DATA_DIR = join(homedir(), ".personal-assistant");
const SETTINGS_FILE = join(DATA_DIR, "news-sources.json");
const ARTICLE_CACHE_DIR = join(DATA_DIR, "news-article-cache");
const ARTICLE_TTL_MS = 30 * 60 * 1000; // 30 min

// ─── Genres ──────────────────────────────────────────────────────────────────

export type Genre =
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

// ─── Sources ─────────────────────────────────────────────────────────────────
// Each source has one or more RSS feeds keyed by genre. The widget can request
// articles filtered by genre.

export interface NewsSource {
  id: string;
  name: string;
  /** Per-genre RSS feeds. Use "all" if a single feed mixes everything. */
  feeds: Partial<Record<Genre | "all", string>>;
  /** Default genres this source covers (used when listing) */
  genres: Genre[];
  /** Locale hint for sorting/display */
  locale?: string;
}

const AVAILABLE_SOURCES: NewsSource[] = [
  {
    id: "aljazeera",
    name: "Al Jazeera",
    feeds: {
      all: "https://www.aljazeera.com/xml/rss/all.xml",
    },
    genres: ["world", "politics", "opinion"],
    locale: "en",
  },
  {
    id: "bbc",
    name: "BBC",
    feeds: {
      world: "https://feeds.bbci.co.uk/news/world/rss.xml",
      politics: "https://feeds.bbci.co.uk/news/politics/rss.xml",
      business: "https://feeds.bbci.co.uk/news/business/rss.xml",
      technology: "https://feeds.bbci.co.uk/news/technology/rss.xml",
      science: "https://feeds.bbci.co.uk/news/science_and_environment/rss.xml",
      health: "https://feeds.bbci.co.uk/news/health/rss.xml",
      entertainment: "https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml",
    },
    genres: ["world", "politics", "business", "technology", "science", "health", "entertainment"],
    locale: "en",
  },
  {
    id: "guardian",
    name: "The Guardian",
    feeds: {
      world: "https://www.theguardian.com/world/rss",
      politics: "https://www.theguardian.com/politics/rss",
      business: "https://www.theguardian.com/uk/business/rss",
      technology: "https://www.theguardian.com/uk/technology/rss",
      science: "https://www.theguardian.com/science/rss",
      sports: "https://www.theguardian.com/uk/sport/rss",
      opinion: "https://www.theguardian.com/uk/commentisfree/rss",
      lifestyle: "https://www.theguardian.com/uk/lifeandstyle/rss",
    },
    genres: ["world", "politics", "business", "technology", "science", "sports", "opinion", "lifestyle"],
    locale: "en",
  },
  {
    id: "nytimes",
    name: "NY Times",
    feeds: {
      world: "https://rss.nytimes.com/services/xml/rss/nyt/World.xml",
      politics: "https://rss.nytimes.com/services/xml/rss/nyt/Politics.xml",
      business: "https://rss.nytimes.com/services/xml/rss/nyt/Business.xml",
      technology: "https://rss.nytimes.com/services/xml/rss/nyt/Technology.xml",
      science: "https://rss.nytimes.com/services/xml/rss/nyt/Science.xml",
      sports: "https://rss.nytimes.com/services/xml/rss/nyt/Sports.xml",
      health: "https://rss.nytimes.com/services/xml/rss/nyt/Health.xml",
      opinion: "https://rss.nytimes.com/services/xml/rss/nyt/Opinion.xml",
    },
    genres: ["world", "politics", "business", "technology", "science", "sports", "health", "opinion"],
    locale: "en",
  },
  {
    id: "reuters",
    name: "Reuters",
    feeds: {
      all: "https://www.reutersagency.com/feed/",
    },
    genres: ["world", "business"],
    locale: "en",
  },
  {
    id: "techcrunch",
    name: "TechCrunch",
    feeds: {
      technology: "https://techcrunch.com/feed/",
    },
    genres: ["technology", "business"],
    locale: "en",
  },
  {
    id: "theverge",
    name: "The Verge",
    feeds: {
      technology: "https://www.theverge.com/rss/index.xml",
    },
    genres: ["technology"],
    locale: "en",
  },
  {
    id: "arstechnica",
    name: "Ars Technica",
    feeds: {
      technology: "https://feeds.arstechnica.com/arstechnica/index",
    },
    genres: ["technology", "science"],
    locale: "en",
  },
  {
    id: "wired",
    name: "Wired",
    feeds: {
      technology: "https://www.wired.com/feed/rss",
    },
    genres: ["technology", "science", "business"],
    locale: "en",
  },
  {
    id: "hackernews",
    name: "Hacker News",
    feeds: {
      technology: "https://hnrss.org/frontpage",
    },
    genres: ["technology"],
    locale: "en",
  },
  {
    id: "lobsters",
    name: "Lobsters",
    feeds: {
      technology: "https://lobste.rs/rss",
    },
    genres: ["technology"],
    locale: "en",
  },
  {
    id: "dev-to",
    name: "DEV Community",
    feeds: {
      technology: "https://dev.to/feed",
    },
    genres: ["technology"],
    locale: "en",
  },
  {
    id: "bloomberg",
    name: "Bloomberg",
    feeds: {
      technology: "https://feeds.bloomberg.com/technology/news.rss",
      business: "https://feeds.bloomberg.com/markets/news.rss",
      politics: "https://feeds.bloomberg.com/politics/news.rss",
    },
    genres: ["business", "technology", "politics"],
    locale: "en",
  },
  {
    id: "nature",
    name: "Nature",
    feeds: {
      science: "https://www.nature.com/nature.rss",
    },
    genres: ["science"],
    locale: "en",
  },
  {
    id: "espn",
    name: "ESPN",
    feeds: {
      sports: "https://www.espn.com/espn/rss/news",
    },
    genres: ["sports"],
    locale: "en",
  },
  {
    id: "spiegel",
    name: "Der Spiegel",
    feeds: {
      all: "https://www.spiegel.de/schlagzeilen/tops/index.rss",
    },
    genres: ["world", "politics", "business"],
    locale: "de",
  },
  {
    id: "tagesschau",
    name: "Tagesschau",
    feeds: {
      all: "https://www.tagesschau.de/index~rss2.xml",
    },
    genres: ["world", "politics"],
    locale: "de",
  },
];

// ─── Settings persistence ────────────────────────────────────────────────────

interface NewsSettings {
  sources: string[];
  genres: Genre[];
}

const DEFAULT_SETTINGS: NewsSettings = {
  sources: ["aljazeera", "bbc", "guardian", "techcrunch", "hackernews"],
  genres: ["world", "politics", "technology", "business"],
};

async function loadSettings(): Promise<NewsSettings> {
  try {
    const data = await readFile(SETTINGS_FILE, "utf-8");
    const parsed = JSON.parse(data);
    return {
      sources: Array.isArray(parsed.sources) ? parsed.sources : DEFAULT_SETTINGS.sources,
      genres: Array.isArray(parsed.genres) ? parsed.genres : DEFAULT_SETTINGS.genres,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

async function saveSettings(settings: NewsSettings): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

// ─── RSS / Atom parsing ──────────────────────────────────────────────────────

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
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&nbsp;/g, " ");
}

function extractText(xml: string, tag: string): string {
  const cdataPattern = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`, "i");
  const cdataMatch = xml.match(cdataPattern);
  if (cdataMatch) return decodeEntities(cdataMatch[1].trim());

  const pattern = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  const match = xml.match(pattern);
  if (!match) return "";
  return decodeEntities(match[1].replace(/<[^>]+>/g, "").trim());
}

function extractAttr(xml: string, tag: string, attr: string): string {
  const pattern = new RegExp(`<${tag}[^>]*\\b${attr}=["']([^"']+)["'][^>]*\\/?>`, "i");
  const m = xml.match(pattern);
  return m ? m[1] : "";
}

function parseFeed(xml: string, source: NewsSource, genre: Genre): NewsArticle[] {
  const articles: NewsArticle[] = [];
  const itemMatches = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || [];
  const entryMatches = xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  const items = itemMatches.length > 0 ? itemMatches : entryMatches;
  const isAtom = entryMatches.length > 0 && itemMatches.length === 0;

  for (const item of items.slice(0, 12)) {
    const title = extractText(item, "title");
    let link = "";
    if (isAtom) {
      const linkMatch = item.match(/<link[^>]*href=["']([^"']+)["'][^>]*\/?>/i);
      link = linkMatch ? linkMatch[1] : "";
    } else {
      link = extractText(item, "link");
    }

    const pubDate = extractText(item, "pubDate")
      || extractText(item, "published")
      || extractText(item, "updated")
      || extractText(item, "dc:date");

    const description = extractText(item, "description")
      || extractText(item, "summary")
      || extractText(item, "content");

    const author = extractText(item, "author")
      || extractText(item, "dc:creator")
      || "";

    // Try to extract a thumbnail from media:thumbnail, media:content, or enclosure
    let thumbnail =
      extractAttr(item, "media:thumbnail", "url") ||
      extractAttr(item, "media:content", "url") ||
      extractAttr(item, "enclosure", "url");

    // Or from an <img> in the description
    if (!thumbnail) {
      const imgMatch = item.match(/<img[^>]*\bsrc=["']([^"']+)["']/i);
      if (imgMatch) thumbnail = imgMatch[1];
    }

    if (title && link) {
      articles.push({
        id: `${source.id}-${Buffer.from(link).toString("base64url").slice(0, 20)}`,
        title: title.slice(0, 250),
        link,
        pubDate: pubDate || new Date().toISOString(),
        source: source.name,
        sourceId: source.id,
        genre,
        description: description.slice(0, 400),
        thumbnail: thumbnail || undefined,
        author: author || undefined,
      });
    }
  }

  return articles;
}

async function fetchFeed(source: NewsSource, genre: Genre, url: string): Promise<NewsArticle[]> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (PersonalAssistant/1.0)" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const xml = await res.text();
    return parseFeed(xml, source, genre);
  } catch {
    return [];
  }
}

// ─── HTML sanitization & article extraction ──────────────────────────────────

const ALLOWED_TAGS = new Set([
  "p", "h1", "h2", "h3", "h4", "h5", "h6",
  "a", "img", "figure", "figcaption", "picture", "source",
  "ul", "ol", "li", "dl", "dt", "dd",
  "blockquote", "pre", "code", "kbd", "samp",
  "em", "strong", "i", "b", "u", "s", "small", "sub", "sup", "mark",
  "br", "hr",
  "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption",
  "div", "span", "section", "article", "aside",
]);

const ALLOWED_ATTRS: Record<string, Set<string>> = {
  a: new Set(["href", "title", "rel", "target"]),
  img: new Set(["src", "srcset", "alt", "title", "width", "height", "loading"]),
  source: new Set(["src", "srcset", "type", "media"]),
  picture: new Set([]),
  // Generic safe attrs allowed on most elements via the wildcard set below
};

const GLOBAL_SAFE_ATTRS = new Set(["title"]);

function sanitizeHtml(html: string, baseUrl: string): string {
  // Strip script, style, iframe, object, embed, link, meta, head, form, input
  // (case-insensitive, including their content where applicable)
  let cleaned = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
    .replace(/<svg[\s\S]*?<\/svg>/gi, "")
    .replace(/<head[\s\S]*?<\/head>/gi, "")
    .replace(/<form[\s\S]*?<\/form>/gi, "")
    .replace(/<button[\s\S]*?<\/button>/gi, "")
    .replace(/<(input|meta|link|object|embed|video|audio|source)\b[^>]*\/?>/gi, "")
    .replace(/<\/(html|body|head|main|nav|header|footer)>/gi, "")
    .replace(/<(html|body|main|nav|header|footer)\b[^>]*>/gi, "");

  // Remove on* event handlers and javascript: URLs from any remaining tag
  cleaned = cleaned.replace(/<([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g, (_, tagName: string, attrs: string) => {
    const tag = tagName.toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) return "";

    // Parse attributes
    const allowedForTag = ALLOWED_ATTRS[tag];
    const cleanedAttrs: string[] = [];
    const attrPattern = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*("([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
    let m;
    while ((m = attrPattern.exec(attrs)) !== null) {
      const name = m[1].toLowerCase();
      const value = m[3] ?? m[4] ?? m[5] ?? "";

      // Drop event handlers
      if (name.startsWith("on")) continue;
      // Drop dangerous protocols
      if ((name === "href" || name === "src") && /^\s*(javascript|data|vbscript):/i.test(value)) continue;

      const isAllowed =
        (allowedForTag && allowedForTag.has(name)) ||
        GLOBAL_SAFE_ATTRS.has(name);

      if (!isAllowed) continue;

      // Resolve relative URLs against baseUrl
      let finalValue = value;
      if ((name === "href" || name === "src") && finalValue) {
        try {
          finalValue = new URL(finalValue, baseUrl).toString();
        } catch {
          // leave as-is
        }
      }

      // For external links, force target=_blank rel=noopener
      if (tag === "a" && name === "href") {
        cleanedAttrs.push(`href="${finalValue.replace(/"/g, "&quot;")}"`);
        cleanedAttrs.push(`target="_blank"`);
        cleanedAttrs.push(`rel="noopener noreferrer"`);
        continue;
      }

      // For images, add lazy loading
      if (tag === "img" && name === "src") {
        cleanedAttrs.push(`src="${finalValue.replace(/"/g, "&quot;")}"`);
        continue;
      }

      cleanedAttrs.push(`${name}="${finalValue.replace(/"/g, "&quot;")}"`);
    }

    if (tag === "img" && !cleanedAttrs.some((a) => a.startsWith("loading="))) {
      cleanedAttrs.push(`loading="lazy"`);
    }
    if (tag === "a" && !cleanedAttrs.some((a) => a.startsWith("target="))) {
      cleanedAttrs.push(`target="_blank"`);
      cleanedAttrs.push(`rel="noopener noreferrer"`);
    }

    return `<${tag}${cleanedAttrs.length ? " " + cleanedAttrs.join(" ") : ""}>`;
  });

  // Strip closing tags for disallowed elements
  cleaned = cleaned.replace(/<\/([a-zA-Z][a-zA-Z0-9]*)>/g, (_, tagName: string) => {
    return ALLOWED_TAGS.has(tagName.toLowerCase()) ? `</${tagName.toLowerCase()}>` : "";
  });

  return cleaned;
}

/**
 * Heuristic article extractor — finds the densest container of <p> tags
 * (similar to Mozilla Readability's basic scoring).
 */
function extractArticle(html: string, baseUrl: string): {
  title: string;
  author: string;
  publishedAt: string;
  heroImage: string;
  content: string;
} {
  // Remove comments early
  const stripped = html.replace(/<!--[\s\S]*?-->/g, "");

  // Title from <title> or og:title
  let title =
    extractAttrFromMeta(stripped, "og:title") ||
    extractAttrFromMeta(stripped, "twitter:title") ||
    extractText(stripped, "title");
  title = title.replace(/\s+\|\s+.+$/, "").trim();

  const author =
    extractAttrFromMeta(stripped, "author") ||
    extractAttrFromMeta(stripped, "article:author") ||
    extractAttrFromMeta(stripped, "twitter:creator") ||
    "";

  const publishedAt =
    extractAttrFromMeta(stripped, "article:published_time") ||
    extractAttrFromMeta(stripped, "og:published_time") ||
    extractAttrFromMeta(stripped, "date") ||
    "";

  const heroImage =
    extractAttrFromMeta(stripped, "og:image") ||
    extractAttrFromMeta(stripped, "twitter:image") ||
    "";

  // Find <article>, <main>, or the densest <p>-container
  let content = "";
  const articleMatch = stripped.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i);
  if (articleMatch && countParagraphs(articleMatch[1]) >= 3) {
    content = articleMatch[1];
  } else {
    const mainMatch = stripped.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i);
    if (mainMatch && countParagraphs(mainMatch[1]) >= 3) {
      content = mainMatch[1];
    } else {
      content = pickDensestContainer(stripped);
    }
  }

  // Sanitize the chosen content
  const sanitized = sanitizeHtml(content, baseUrl);

  return {
    title,
    author,
    publishedAt,
    heroImage: heroImage ? resolveUrl(heroImage, baseUrl) : "",
    content: sanitized,
  };
}

function extractAttrFromMeta(html: string, prop: string): string {
  // <meta property="og:title" content="..."> OR <meta name="..." content="...">
  const patterns = [
    new RegExp(`<meta[^>]*property=["']${escapeRegex(prop)}["'][^>]*content=["']([^"']+)["']`, "i"),
    new RegExp(`<meta[^>]*name=["']${escapeRegex(prop)}["'][^>]*content=["']([^"']+)["']`, "i"),
    new RegExp(`<meta[^>]*content=["']([^"']+)["'][^>]*property=["']${escapeRegex(prop)}["']`, "i"),
    new RegExp(`<meta[^>]*content=["']([^"']+)["'][^>]*name=["']${escapeRegex(prop)}["']`, "i"),
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m) return decodeEntities(m[1]);
  }
  return "";
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function countParagraphs(html: string): number {
  return (html.match(/<p[\s>]/gi) || []).length;
}

function pickDensestContainer(html: string): string {
  // Find all top-level <div> blocks and score by paragraph density / text length
  const candidates: { html: string; score: number }[] = [];
  const divPattern = /<(div|section)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = divPattern.exec(html)) !== null) {
    const inner = m[2];
    const pCount = countParagraphs(inner);
    const textLength = inner.replace(/<[^>]+>/g, "").length;
    const score = pCount * 25 + textLength / 100;
    if (score > 30) candidates.push({ html: m[0], score });
  }
  candidates.sort((a, b) => b.score - a.score);
  if (candidates.length > 0) return candidates[0].html;
  // Fallback: just join all <p> tags
  const paras = html.match(/<p[\s>][\s\S]*?<\/p>/gi) || [];
  return paras.join("\n");
}

function resolveUrl(url: string, base: string): string {
  try {
    return new URL(url, base).toString();
  } catch {
    return url;
  }
}

// ─── Article fetch with disk cache ───────────────────────────────────────────

interface CachedArticle {
  fetchedAt: number;
  url: string;
  title: string;
  author: string;
  publishedAt: string;
  heroImage: string;
  content: string;
}

function cacheKey(url: string): string {
  return createHash("sha1").update(url).digest("hex");
}

async function readArticleCache(url: string): Promise<CachedArticle | null> {
  try {
    const file = join(ARTICLE_CACHE_DIR, `${cacheKey(url)}.json`);
    const data = await readFile(file, "utf-8");
    const parsed = JSON.parse(data) as CachedArticle;
    if (Date.now() - parsed.fetchedAt > ARTICLE_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function writeArticleCache(url: string, article: Omit<CachedArticle, "fetchedAt" | "url">): Promise<void> {
  await mkdir(ARTICLE_CACHE_DIR, { recursive: true });
  const file = join(ARTICLE_CACHE_DIR, `${cacheKey(url)}.json`);
  const payload: CachedArticle = { fetchedAt: Date.now(), url, ...article };
  await writeFile(file, JSON.stringify(payload));
}

async function fetchArticle(url: string): Promise<CachedArticle | { error: string }> {
  // Check cache
  const cached = await readArticleCache(url);
  if (cached) return cached;

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(15000),
      redirect: "follow",
    });
    if (!res.ok) {
      return { error: `Source returned ${res.status}` };
    }
    const html = await res.text();
    const finalUrl = res.url || url;
    const extracted = extractArticle(html, finalUrl);

    if (!extracted.content || extracted.content.length < 200) {
      return { error: "Could not extract article content. Try opening in browser." };
    }

    await writeArticleCache(url, extracted);
    return {
      fetchedAt: Date.now(),
      url,
      ...extracted,
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to fetch article" };
  }
}

// ─── Route handlers ──────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const action = request.nextUrl.searchParams.get("action");

  // Return available sources, genres, and the user's selection
  if (action === "settings") {
    const settings = await loadSettings();
    return Response.json({
      available: AVAILABLE_SOURCES,
      genres: Object.entries(GENRE_LABELS).map(([id, label]) => ({ id, label })),
      selected: settings,
    });
  }

  // Fetch full article
  if (action === "article") {
    const url = request.nextUrl.searchParams.get("url");
    if (!url) {
      return Response.json({ error: "Missing url parameter" }, { status: 400 });
    }
    try {
      new URL(url); // validate
    } catch {
      return Response.json({ error: "Invalid URL" }, { status: 400 });
    }
    const result = await fetchArticle(url);
    if ("error" in result) {
      return Response.json(result, { status: 502 });
    }
    return Response.json(result);
  }

  // Default: list articles from selected sources & genres
  const settings = await loadSettings();
  const selectedSources = AVAILABLE_SOURCES.filter((s) => settings.sources.includes(s.id));
  const selectedGenreSet = new Set(settings.genres);

  // Build list of (source, genre, url) tuples to fetch
  const tasks: Array<{ source: NewsSource; genre: Genre; url: string }> = [];
  for (const source of selectedSources) {
    // If source has per-genre feeds, fetch only the ones in selectedGenreSet
    const perGenreFeeds = Object.entries(source.feeds).filter(([k]) => k !== "all") as [Genre, string][];
    if (perGenreFeeds.length > 0) {
      for (const [genre, url] of perGenreFeeds) {
        if (selectedGenreSet.size === 0 || selectedGenreSet.has(genre)) {
          tasks.push({ source, genre, url });
        }
      }
    } else if (source.feeds.all) {
      // For "all" feeds, only include if at least one of the source's genres is selected
      const hasMatchingGenre =
        selectedGenreSet.size === 0 || source.genres.some((g) => selectedGenreSet.has(g));
      if (hasMatchingGenre) {
        // Tag the article with the source's primary genre
        tasks.push({ source, genre: source.genres[0], url: source.feeds.all });
      }
    }
  }

  if (tasks.length === 0) {
    return Response.json({
      articles: [],
      settings,
    });
  }

  const results = await Promise.all(tasks.map((t) => fetchFeed(t.source, t.genre, t.url)));
  const allArticles = results.flat();

  // De-duplicate by link
  const seen = new Set<string>();
  const deduped = allArticles.filter((a) => {
    if (seen.has(a.link)) return false;
    seen.add(a.link);
    return true;
  });

  // Sort by date (newest first)
  deduped.sort((a, b) => {
    const dateA = new Date(a.pubDate).getTime() || 0;
    const dateB = new Date(b.pubDate).getTime() || 0;
    return dateB - dateA;
  });

  return Response.json({
    articles: deduped.slice(0, 60),
    settings,
    fetchedAt: new Date().toISOString(),
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { action } = body;

  if (action === "update-settings") {
    const validSourceIds = new Set(AVAILABLE_SOURCES.map((s) => s.id));
    const validGenres = new Set(Object.keys(GENRE_LABELS) as Genre[]);

    const sources = (body.sources as string[] | undefined) ?? [];
    const genres = (body.genres as Genre[] | undefined) ?? [];

    const filtered: NewsSettings = {
      sources: sources.filter((id) => validSourceIds.has(id)),
      genres: genres.filter((g) => validGenres.has(g)),
    };

    await saveSettings(filtered);
    return Response.json({ success: true, settings: filtered });
  }

  return Response.json({ error: "Unknown action" }, { status: 400 });
}
