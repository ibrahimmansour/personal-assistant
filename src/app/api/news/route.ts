import { NextRequest } from "next/server";
import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { homedir } from "os";

export const dynamic = "force-dynamic";

const DATA_DIR = join(homedir(), ".personal-assistant");
const SOURCES_FILE = join(DATA_DIR, "news-sources.json");

// ─── Available news sources (RSS feeds) ──────────────────────────────────────

export interface NewsSource {
  id: string;
  name: string;
  url: string;
  category: "tech" | "general" | "business" | "science" | "world";
}

const AVAILABLE_SOURCES: NewsSource[] = [
  { id: "hackernews", name: "Hacker News", url: "https://hnrss.org/frontpage", category: "tech" },
  { id: "techcrunch", name: "TechCrunch", url: "https://techcrunch.com/feed/", category: "tech" },
  { id: "theverge", name: "The Verge", url: "https://www.theverge.com/rss/index.xml", category: "tech" },
  { id: "arstechnica", name: "Ars Technica", url: "https://feeds.arstechnica.com/arstechnica/index", category: "tech" },
  { id: "bbc-world", name: "BBC World", url: "https://feeds.bbci.co.uk/news/world/rss.xml", category: "world" },
  { id: "bbc-tech", name: "BBC Technology", url: "https://feeds.bbci.co.uk/news/technology/rss.xml", category: "tech" },
  { id: "reuters", name: "Reuters", url: "https://www.reutersagency.com/feed/", category: "world" },
  { id: "nytimes", name: "NY Times", url: "https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml", category: "general" },
  { id: "guardian", name: "The Guardian", url: "https://www.theguardian.com/world/rss", category: "world" },
  { id: "wired", name: "Wired", url: "https://www.wired.com/feed/rss", category: "tech" },
  { id: "bloomberg", name: "Bloomberg", url: "https://feeds.bloomberg.com/technology/news.rss", category: "business" },
  { id: "nature", name: "Nature", url: "https://www.nature.com/nature.rss", category: "science" },
  { id: "dev-to", name: "DEV Community", url: "https://dev.to/feed", category: "tech" },
  { id: "lobsters", name: "Lobsters", url: "https://lobste.rs/rss", category: "tech" },
  { id: "spiegel", name: "Der Spiegel", url: "https://www.spiegel.de/schlagzeilen/tops/index.rss", category: "general" },
  { id: "tagesschau", name: "Tagesschau", url: "https://www.tagesschau.de/index~rss2.xml", category: "general" },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface NewsArticle {
  id: string;
  title: string;
  link: string;
  pubDate: string;
  source: string;
  sourceId: string;
  description: string;
}

async function getSelectedSourceIds(): Promise<string[]> {
  try {
    const data = await readFile(SOURCES_FILE, "utf-8");
    const parsed = JSON.parse(data);
    return parsed.sources || [];
  } catch {
    // Default sources if no file exists
    return ["hackernews", "techcrunch", "bbc-world"];
  }
}

async function saveSelectedSourceIds(sources: string[]): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(SOURCES_FILE, JSON.stringify({ sources }, null, 2));
}

function extractText(xml: string, tag: string): string {
  // Handle CDATA sections
  const cdataPattern = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`, "i");
  const cdataMatch = xml.match(cdataPattern);
  if (cdataMatch) return cdataMatch[1].trim();

  // Handle regular text content
  const pattern = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  const match = xml.match(pattern);
  if (!match) return "";
  // Strip any HTML tags from the content
  return match[1].replace(/<[^>]+>/g, "").trim();
}

function parseRSSFeed(xml: string, source: NewsSource): NewsArticle[] {
  const articles: NewsArticle[] = [];

  // Try RSS 2.0 <item> format
  const itemMatches = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || [];
  // Try Atom <entry> format
  const entryMatches = xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];

  const items = itemMatches.length > 0 ? itemMatches : entryMatches;
  const isAtom = entryMatches.length > 0 && itemMatches.length === 0;

  for (const item of items.slice(0, 10)) {
    const title = extractText(item, "title");
    let link = "";
    if (isAtom) {
      // Atom uses <link href="..."/>
      const linkMatch = item.match(/<link[^>]*href=["']([^"']+)["'][^>]*\/?>/i);
      link = linkMatch ? linkMatch[1] : "";
    } else {
      link = extractText(item, "link");
    }

    // pubDate (RSS) or published/updated (Atom)
    const pubDate = extractText(item, "pubDate")
      || extractText(item, "published")
      || extractText(item, "updated")
      || extractText(item, "dc:date");

    const description = extractText(item, "description")
      || extractText(item, "summary")
      || extractText(item, "content");

    if (title && link) {
      articles.push({
        id: `${source.id}-${Buffer.from(link).toString("base64url").slice(0, 16)}`,
        title: title.slice(0, 200),
        link,
        pubDate: pubDate || new Date().toISOString(),
        source: source.name,
        sourceId: source.id,
        description: description.slice(0, 300),
      });
    }
  }

  return articles;
}

async function fetchFeed(source: NewsSource): Promise<NewsArticle[]> {
  try {
    const res = await fetch(source.url, {
      headers: { "User-Agent": "PersonalAssistant/1.0" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const xml = await res.text();
    return parseRSSFeed(xml, source);
  } catch {
    return [];
  }
}

// ─── Route handlers ──────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const action = request.nextUrl.searchParams.get("action");

  // Return available sources and the user's selection
  if (action === "sources") {
    const selectedIds = await getSelectedSourceIds();
    return Response.json({
      available: AVAILABLE_SOURCES,
      selected: selectedIds,
    });
  }

  // Fetch news from selected sources
  const selectedIds = await getSelectedSourceIds();
  const selectedSources = AVAILABLE_SOURCES.filter((s) => selectedIds.includes(s.id));

  if (selectedSources.length === 0) {
    return Response.json({ articles: [], sources: [] });
  }

  // Fetch all feeds in parallel
  const results = await Promise.all(selectedSources.map(fetchFeed));
  const allArticles = results.flat();

  // Sort by date (newest first)
  allArticles.sort((a, b) => {
    const dateA = new Date(a.pubDate).getTime() || 0;
    const dateB = new Date(b.pubDate).getTime() || 0;
    return dateB - dateA;
  });

  return Response.json({
    articles: allArticles.slice(0, 50),
    sources: selectedIds,
    fetchedAt: new Date().toISOString(),
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { action } = body;

  if (action === "update-sources") {
    const { sources } = body as { sources: string[] };
    // Validate all source ids
    const validIds = AVAILABLE_SOURCES.map((s) => s.id);
    const filtered = (sources || []).filter((id: string) => validIds.includes(id));
    await saveSelectedSourceIds(filtered);
    return Response.json({ success: true, sources: filtered });
  }

  return Response.json({ error: "Unknown action" }, { status: 400 });
}
