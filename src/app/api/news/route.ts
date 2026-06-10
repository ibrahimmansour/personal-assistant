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
  /** Text direction: "rtl" for Arabic/Hebrew sources */
  dir?: "ltr" | "rtl";
}

const AVAILABLE_SOURCES: NewsSource[] = [
  {
    id: "aljazeera",
    name: "Al Jazeera",
    feeds: {
      all: "https://www.aljazeera.com/xml/rss/all.xml",
    },
    genres: ["world", "politics", "opinion", "business", "sports"],
    locale: "en",
  },
  {
    id: "aljazeera-ar",
    name: "الجزيرة",
    feeds: {
      all: "https://www.aljazeera.net/aljazeerarss/a7c186be-1baa-4bd4-9d80-a84db769f779/73d0e1b4-532f-45ef-b135-bfdff8b8cab9",
    },
    genres: ["world", "politics", "opinion", "sports"],
    locale: "ar",
    dir: "rtl",
  },
  {
    id: "kooora",
    name: "كووورة",
    feeds: {
      sports: "https://feeds.footballco.com/kooora/feed/6p5bsxot7te8yick",
    },
    genres: ["sports"],
    locale: "ar",
    dir: "rtl",
  },
  {
    id: "filgoal",
    name: "فيلجول",
    feeds: {
      // Filgoal has no native RSS — use Google News as a proxy
      sports: "https://news.google.com/rss/search?q=site:filgoal.com&hl=ar&gl=EG&ceid=EG:ar",
    },
    genres: ["sports"],
    locale: "ar",
    dir: "rtl",
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
    genres: ["world", "politics", "business", "sports", "science", "entertainment"],
    locale: "de",
  },
  {
    id: "tagesschau",
    name: "Tagesschau",
    feeds: {
      all: "https://www.tagesschau.de/index~rss2.xml",
    },
    genres: ["world", "politics", "business", "sports"],
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
  /** Text direction inherited from the source */
  dir?: "ltr" | "rtl";
  /** Locale (e.g. "ar", "en") inherited from the source */
  locale?: string;
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

// ─── Per-article genre detection ─────────────────────────────────────────────
// For sources with a single mixed-content feed (e.g. Al Jazeera, Spiegel),
// we need to figure out each article's genre from its <category> tags,
// URL path, or title. Keywords cover Arabic, German, French, English.

const GENRE_KEYWORDS: Record<Genre, RegExp> = {
  sports: /\b(sport|sports|sportsworld|football|soccer|tennis|cricket|nba|fifa|olympics?|wrestling|boxing|formula1|f1|premier|champions[- ]?league|world[- ]?cup|player|match|kick[- ]?off|playoff)\b|رياض(ة|ي)|كرة|فريق|مباراة|لاعب|ملعب|بطولة|كأس|دوري|هدف|لاعبين|أهداف|spielmann|wettkampf|fußball|liga|stade|équipe|sportlich|joueur|match/i,
  politics: /\b(politic|political|election|government|minister|parliament|senate|congress|president|prime[- ]?minister|policy|diplomatic|treaty|coup|protest|gaza|israel|palestin|ukrain|russia|geopolit)\b|سياس(ة|ي|ية)|انتخاب|حكومة|وزير|برلمان|رئيس|مفاوضات|اتفاقية|سلطة|احتلال|politik|wahl|regierung|minister|parlament|politique|gouvernement/i,
  business: /\b(business|economy|economic|finance|financial|market|stock|trade|trading|investor|invest|earnings|profit|loss|company|corporat|startup|merger|acquisition|crypto|bitcoin|wall[- ]?street|nasdaq|dow[- ]?jones|inflation|recession)\b|اقتصاد|سوق|بورصة|تجارة|استثمار|شركة|مال(ي|ية)|مصرف|أعمال|أرباح|wirtschaft|finanz|markt|économie|finance|entreprise/i,
  technology: /\b(tech|technolog|software|hardware|ai|artificial[- ]?intelligence|machine[- ]?learning|gadget|smartphone|iphone|android|google|apple|microsoft|meta|openai|chatgpt|crypto|cyber|silicon|app|developer|coding|computing)\b|تكنولوجيا|تقنية|رقمي|ذكاء[- ]اصطناعي|إنترنت|تطبيق|technologie|technologische|تقني|الذكاء/i,
  science: /\b(science|scientific|research|study|discover(y|ed)|physics|chemistry|biology|astronomy|nasa|space|astronaut|telescope|climate|environment|nature|species|fossil|genetic|nobel)\b|عل(م|وم|مي)|بحث|اكتشاف|فضاء|ناسا|كوكب|مناخ|بيئة|حيوان|نبات|wissenschaft|forschung|umwelt|klima|recherche|science/i,
  health: /\b(health|medical|medicine|doctor|hospital|disease|virus|covid|flu|vaccine|cancer|diabetes|mental[- ]?health|surgery|patient|drug|pharmaceutical)\b|صحة|طب|طبيب|مستشفى|مرض|فيروس|لقاح|سرطان|gesundheit|krankheit|santé|médical/i,
  entertainment: /\b(entertain|movie|film|cinema|hollywood|tv[- ]?show|streaming|netflix|disney|music|album|concert|celebrity|oscar|grammy|emmy|festival)\b|ترفيه|فن(ون|ي)|سينما|أفلام|موسيقى|فنان|نجم|unterhaltung|kino|musik|spectacle|cinéma|musique/i,
  opinion: /\b(opinion|editorial|commentary|column|op[- ]?ed|analysis)\b|رأي|تحليل|مقال|kommentar|meinung|opinion|tribune/i,
  lifestyle: /\b(lifestyle|life[- ]?and[- ]?style|food|travel|fashion|beauty|wellness|recipe|cooking|home|garden|relationship)\b|نمط[- ]حياة|سفر|طعام|موضة|أزياء|سياحة|lifestyle|reise|essen|mode/i,
  world: /\b(world|international|global|foreign|abroad|un[- ]general|united[- ]?nations|nato|asia|africa|europe|middle[- ]?east|americas?)\b|عالم|دولي|عالمي|welt|international|monde|étranger/i,
};

function detectGenre({
  categories,
  link,
  title,
  sourceGenres,
}: {
  categories: string[];
  link: string;
  title: string;
  sourceGenres: Genre[];
}): Genre | null {
  const haystack = [
    ...categories,
    link.toLowerCase(),
    title,
  ].join(" \n ");

  // Score each genre by counting keyword hits. Sports/politics/business win
  // over the broad "world" tag when both match.
  const scores: Partial<Record<Genre, number>> = {};
  for (const [g, re] of Object.entries(GENRE_KEYWORDS) as [Genre, RegExp][]) {
    const matches = haystack.match(re);
    if (matches) scores[g] = matches.length;
  }

  // Prefer specific genres over "world" when there's a tie or "world" wins
  // only marginally. The order here matches typical RSS specificity.
  const priority: Genre[] = [
    "sports",
    "technology",
    "business",
    "science",
    "health",
    "entertainment",
    "opinion",
    "lifestyle",
    "politics",
    "world",
  ];

  // Restrict to genres the source actually advertises so we don't tag a
  // BBC article as "lifestyle" when the source never claimed that.
  const allowed = new Set(sourceGenres);

  // Walk the priority list and return the first specific genre with any
  // matches. "world" is only chosen if no specific genre matched. This
  // means a story tagged ['World news', 'Football'] gets bucketed as
  // sports rather than world, which matches user intent for filter chips.
  for (const g of priority) {
    if (!allowed.has(g)) continue;
    if ((scores[g] ?? 0) > 0) return g;
  }

  return null;
}

function parseFeed(xml: string, source: NewsSource, genre: Genre): NewsArticle[] {
  const articles: NewsArticle[] = [];
  const itemMatches = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || [];
  const entryMatches = xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  const items = itemMatches.length > 0 ? itemMatches : entryMatches;
  const isAtom = entryMatches.length > 0 && itemMatches.length === 0;

  // For a feed labeled "all" we need to detect the genre per-article.
  // For per-genre feeds we trust the feed's label.
  const useDetection = source.feeds.all !== undefined && Object.keys(source.feeds).length === 1;

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

    // Try to extract a thumbnail from media:thumbnail, media:content, enclosure,
    // or any <img> in the item body (description/content:encoded)
    let thumbnail =
      extractAttr(item, "media:thumbnail", "url") ||
      extractAttr(item, "media:content", "url") ||
      extractAttr(item, "media:group media:thumbnail", "url") ||
      extractAttr(item, "enclosure", "url") ||
      extractAttr(item, "itunes:image", "href");

    if (!thumbnail) {
      // Search every <img> in the item — including those inside content:encoded
      // and description CDATA. Prefer images that look like real photos
      // (dimensions hint, not tracking pixels or 1x1 spacers).
      const imgMatches = Array.from(item.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi));
      for (const m of imgMatches) {
        const tag = m[0];
        const src = m[1];
        // Skip obvious tracking pixels and tiny icons
        if (/1x1|spacer|pixel|tracking|beacon|stat\?/i.test(src)) continue;
        if (/width=["']?[12]["']?/i.test(tag) && /height=["']?[12]["']?/i.test(tag)) continue;
        thumbnail = src;
        break;
      }
    }

    // Resolve relative thumbnail URLs against the article link
    if (thumbnail && link) {
      try {
        thumbnail = new URL(thumbnail, link).toString();
      } catch {
        // leave as-is
      }
    }

    // Determine the article's genre. For per-genre feeds (e.g. BBC Sports),
    // the feed itself dictates the genre. For mixed feeds we look at
    // <category> tags, URL path, and (as a last resort) the title.
    let articleGenre = genre;
    if (useDetection) {
      const categories = Array.from(item.matchAll(/<category[^>]*>(?:<!\[CDATA\[)?([^<\]]+)/gi))
        .map((m) => m[1].trim())
        .filter(Boolean);
      const detected = detectGenre({
        categories,
        link,
        title,
        sourceGenres: source.genres,
      });
      if (detected) articleGenre = detected;
    }

    if (title && link) {
      articles.push({
        id: `${source.id}-${Buffer.from(link).toString("base64url").slice(0, 20)}`,
        title: title.slice(0, 250),
        link,
        pubDate: pubDate || new Date().toISOString(),
        source: source.name,
        sourceId: source.id,
        genre: articleGenre,
        description: description.slice(0, 400),
        thumbnail: thumbnail || undefined,
        author: author || undefined,
        dir: source.dir,
        locale: source.locale,
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

// ─── Lazy thumbnail (og:image) fetch + cache ─────────────────────────────────

const THUMB_CACHE_DIR = join(DATA_DIR, "news-thumb-cache");
const THUMB_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface CachedThumb {
  fetchedAt: number;
  url: string;
  thumbnail: string | null;
}

async function readThumbCache(url: string): Promise<CachedThumb | null> {
  try {
    const file = join(THUMB_CACHE_DIR, `${cacheKey(url)}.json`);
    const data = await readFile(file, "utf-8");
    const parsed = JSON.parse(data) as CachedThumb;
    if (Date.now() - parsed.fetchedAt > THUMB_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function writeThumbCache(url: string, thumbnail: string | null): Promise<void> {
  try {
    await mkdir(THUMB_CACHE_DIR, { recursive: true });
    const file = join(THUMB_CACHE_DIR, `${cacheKey(url)}.json`);
    const payload: CachedThumb = { fetchedAt: Date.now(), url, thumbnail };
    await writeFile(file, JSON.stringify(payload));
  } catch {
    // ignore cache write failures
  }
}

async function fetchThumbnail(url: string): Promise<string | null> {
  // First check the article cache — if we already fetched the full article,
  // its heroImage is exactly what we want, with no extra network call.
  const article = await readArticleCache(url);
  if (article && article.heroImage) return article.heroImage;

  const cached = await readThumbCache(url);
  if (cached) return cached.thumbnail;

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(8000),
      redirect: "follow",
    });
    if (!res.ok) {
      await writeThumbCache(url, null);
      return null;
    }

    // Read only the first 256 KB — og:image is always in <head>
    const reader = res.body?.getReader();
    let html = "";
    if (reader) {
      const decoder = new TextDecoder();
      let totalBytes = 0;
      while (totalBytes < 256 * 1024) {
        const { done, value } = await reader.read();
        if (done) break;
        totalBytes += value.byteLength;
        html += decoder.decode(value, { stream: true });
        // Stop reading once </head> is seen
        if (html.includes("</head>") || html.includes("</HEAD>")) break;
      }
      try { await reader.cancel(); } catch { /* ignore */ }
    } else {
      html = await res.text();
    }

    const finalUrl = res.url || url;
    let img =
      extractAttrFromMeta(html, "og:image") ||
      extractAttrFromMeta(html, "twitter:image") ||
      extractAttrFromMeta(html, "og:image:secure_url") ||
      "";

    if (img) {
      try { img = new URL(img, finalUrl).toString(); } catch { /* leave as-is */ }
    }

    const result = img || null;
    await writeThumbCache(url, result);
    return result;
  } catch {
    await writeThumbCache(url, null);
    return null;
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

  // Fetch a single thumbnail (og:image) for an article URL
  if (action === "thumbnail") {
    const url = request.nextUrl.searchParams.get("url");
    if (!url) {
      return Response.json({ error: "Missing url parameter" }, { status: 400 });
    }
    try {
      new URL(url);
    } catch {
      return Response.json({ error: "Invalid URL" }, { status: 400 });
    }
    const thumbnail = await fetchThumbnail(url);
    return Response.json({ url, thumbnail });
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

  // After per-article genre detection, drop articles whose detected genre
  // is not in the user's selection. This is what makes the genre filter
  // actually filter when "all" feeds are involved.
  const genreFiltered =
    selectedGenreSet.size === 0
      ? deduped
      : deduped.filter((a) => selectedGenreSet.has(a.genre));

  // Sort by date (newest first)
  genreFiltered.sort((a, b) => {
    const dateA = new Date(a.pubDate).getTime() || 0;
    const dateB = new Date(b.pubDate).getTime() || 0;
    return dateB - dateA;
  });

  return Response.json({
    articles: genreFiltered.slice(0, 60),
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

  // Batch fetch thumbnails (og:image) for many articles at once.
  // Body: { action: "thumbnails", urls: string[] }
  // Returns: { results: Record<url, thumbnail | null> }
  if (action === "thumbnails") {
    const urls = (body.urls as string[] | undefined) ?? [];
    // Validate + dedupe + cap to a reasonable batch size
    const validUrls: string[] = [];
    const seen = new Set<string>();
    for (const u of urls) {
      if (typeof u !== "string" || seen.has(u)) continue;
      try { new URL(u); } catch { continue; }
      seen.add(u);
      validUrls.push(u);
      if (validUrls.length >= 30) break;
    }

    const entries = await Promise.all(
      validUrls.map(async (u) => [u, await fetchThumbnail(u)] as const)
    );

    const results: Record<string, string | null> = {};
    for (const [u, t] of entries) results[u] = t;
    return Response.json({ results });
  }

  return Response.json({ error: "Unknown action" }, { status: 400 });
}
