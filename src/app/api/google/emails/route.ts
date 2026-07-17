import { googleFetch, isConfigured } from "@/lib/google-token";
import { type NextRequest } from "next/server";
import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { homedir } from "os";

export const dynamic = "force-dynamic";

const DATA_DIR = join(homedir(), ".personal-assistant");
const CACHE_FILE = join(DATA_DIR, "gmail-emails-cache.json");
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

interface GmailHeader {
  name: string;
  value: string;
}

interface GmailPart {
  mimeType?: string;
  filename?: string;
  body?: { data?: string };
  parts?: GmailPart[];
}

interface GmailMessage {
  id: string;
  labelIds?: string[];
  snippet?: string;
  internalDate: string;
  payload: GmailPart & { headers?: GmailHeader[] };
}

interface CachedEmails {
  emails: Record<string, unknown>[];
  fetchedAt: string;
  total: number;
}

async function readCache(): Promise<CachedEmails | null> {
  try {
    const raw = await readFile(CACHE_FILE, "utf-8");
    const data = JSON.parse(raw);
    const age = Date.now() - new Date(data.fetchedAt).getTime();
    if (age < CACHE_TTL) return data;
    return null;
  } catch {
    return null;
  }
}

async function writeCache(data: CachedEmails) {
  try {
    await mkdir(DATA_DIR, { recursive: true });
    await writeFile(CACHE_FILE, JSON.stringify(data));
  } catch {
    // ignore
  }
}

function parseFrom(from: string) {
  const match = from.match(/^(.+?)\s*<(.+?)>$/);
  return {
    fromName: match ? match[1].replace(/"/g, "").trim() : from,
    fromAddress: match ? match[2] : from,
  };
}

function parseAddresses(raw: string) {
  return raw
    .split(",")
    .map((s) => {
      const m = s.trim().match(/^(.+?)\s*<.+?>$/);
      return m ? m[1].replace(/"/g, "").trim() : s.trim();
    })
    .filter(Boolean);
}

// System labels to exclude from user-facing categories
const GMAIL_SYSTEM_LABELS = new Set([
  "INBOX", "UNREAD", "SENT", "DRAFT", "TRASH", "SPAM",
  "STARRED", "IMPORTANT", "CHAT", "CATEGORY_PERSONAL",
]);

function mapGmailLabels(labelIds: string[]): string[] {
  return (labelIds || [])
    .filter((l) => !GMAIL_SYSTEM_LABELS.has(l))
    .map((l) => {
      // Convert CATEGORY_X labels to friendlier names
      if (l.startsWith("CATEGORY_")) {
        return l.replace("CATEGORY_", "").charAt(0) +
          l.replace("CATEGORY_", "").slice(1).toLowerCase();
      }
      // User-created labels come through as-is (or as label IDs)
      return l;
    });
}

export async function GET(request: NextRequest) {
  if (!isConfigured()) {
    return Response.json(
      { error: "Google OAuth not configured", emails: [] },
      { status: 500 }
    );
  }

  const limitParam = request.nextUrl.searchParams.get("limit");
  const limit = limitParam ? Math.min(parseInt(limitParam, 10) || 15, 500) : 15;
  const isFullFetch = limit > 50;

  try {
    // For large fetches, try cache first
    if (isFullFetch) {
      const cached = await readCache();
      if (cached && cached.emails.length > 0) {
        return Response.json({
          emails: cached.emails.slice(0, limit),
          total: cached.total,
          fetchedAt: cached.fetchedAt,
          cached: true,
        });
      }
    }

    // Fetch Gmail labels for resolving IDs to names
    const labelMap: Record<string, string> = {};
    try {
      const labelsData = await googleFetch(
        "https://gmail.googleapis.com/gmail/v1/users/me/labels"
      ) as { labels?: { id: string; name: string }[] };
      for (const label of labelsData.labels || []) {
        labelMap[label.id] = label.name;
      }
    } catch {
      // Non-critical — we'll show raw IDs as fallback
    }

    // Use metadata format for large fetches (much faster, no body content)
    const format = isFullFetch ? "metadata" : "full";
    const metadataHeaders = isFullFetch
      ? "&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=To&metadataHeaders=Cc"
      : "";

    // Paginate through message list
    const allMessageIds: string[] = [];
    let pageToken: string | undefined;

    while (allMessageIds.length < limit) {
      const pageSize = Math.min(100, limit - allMessageIds.length); // Gmail max is 100
      let url = `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${pageSize}&labelIds=INBOX`;
      if (pageToken) url += `&pageToken=${pageToken}`;

      const listData = await googleFetch(url) as { messages?: { id: string }[]; nextPageToken?: string };
      const ids: string[] = (listData.messages || []).map((m) => m.id);
      if (ids.length === 0) break;

      allMessageIds.push(...ids);
      pageToken = listData.nextPageToken;
      if (!pageToken) break;
    }

    if (allMessageIds.length === 0) {
      return Response.json({ emails: [], total: 0, fetchedAt: new Date().toISOString() });
    }

    // Fetch messages in parallel batches to avoid overwhelming the API
    const BATCH_SIZE = 25;
    const allEmails: Record<string, unknown>[] = [];

    for (let i = 0; i < allMessageIds.length; i += BATCH_SIZE) {
      const batch = allMessageIds.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map((id) =>
          googleFetch(
            `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=${format}${metadataHeaders}`
          ) as Promise<GmailMessage>
        )
      );

      for (const r of results) {
        if (r.status !== "fulfilled") continue;
        const msg = r.value;
        const headers = msg.payload?.headers || [];
        const getHeader = (name: string) =>
          headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || "";

        const from = getHeader("From");
        const { fromName, fromAddress } = parseFrom(from);
        const isRead = !(msg.labelIds || []).includes("UNREAD");

        if (isFullFetch) {
          // Light format for search
          const rawLabels = mapGmailLabels(msg.labelIds || []);
          const resolvedLabels = rawLabels.map((l) => labelMap[l] || l);
          allEmails.push({
            id: msg.id,
            from: fromName,
            fromAddress,
            subject: getHeader("Subject") || "(no subject)",
            preview: msg.snippet || "",
            time: new Date(parseInt(msg.internalDate)).toISOString(),
            read: isRead,
            hasAttachments: false,
            webLink: `https://mail.google.com/mail/u/0/#inbox/${msg.id}`,
            categories: resolvedLabels,
            to: parseAddresses(getHeader("To")),
            cc: parseAddresses(getHeader("Cc")),
          });
        } else {
          // Full format with body
          let bodyHtml: string | null = null;
          let bodyText = "";

          function extractParts(part: GmailPart) {
            if (part.mimeType === "text/html" && part.body?.data) {
              bodyHtml = Buffer.from(part.body.data, "base64url").toString("utf-8");
            }
            if (part.mimeType === "text/plain" && part.body?.data) {
              bodyText = Buffer.from(part.body.data, "base64url").toString("utf-8");
            }
            if (part.parts) part.parts.forEach(extractParts);
          }
          extractParts(msg.payload);

          const rawLabels2 = mapGmailLabels(msg.labelIds || []);
          const resolvedLabels2 = rawLabels2.map((l) => labelMap[l] || l);

          allEmails.push({
            id: msg.id,
            from: fromName,
            fromAddress,
            subject: getHeader("Subject") || "(no subject)",
            preview: msg.snippet || "",
            bodyHtml,
            bodyText: bodyText || msg.snippet || "",
            time: new Date(parseInt(msg.internalDate)).toISOString(),
            read: isRead,
            hasAttachments: (msg.payload?.parts || []).some(
              (p) => p.filename && p.filename.length > 0
            ),
            webLink: `https://mail.google.com/mail/u/0/#inbox/${msg.id}`,
            categories: resolvedLabels2,
            to: parseAddresses(getHeader("To")),
            cc: parseAddresses(getHeader("Cc")),
          });
        }
      }
    }

    const result = {
      emails: allEmails,
      total: allEmails.length,
      fetchedAt: new Date().toISOString(),
    };

    if (isFullFetch) {
      writeCache(result); // fire and forget
    }

    return Response.json(result);
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "GOOGLE_AUTH_REQUIRED") {
      return Response.json(
        {
          error: "Gmail authentication required. Click to connect your Google account.",
          authRequired: true,
          authUrl: "/api/google/auth",
          emails: [],
        },
        { status: 401 }
      );
    }

    // On error for large fetches, try returning stale cache
    if (isFullFetch) {
      try {
        const raw = await readFile(CACHE_FILE, "utf-8");
        const stale = JSON.parse(raw);
        if (stale.emails?.length > 0) {
          return Response.json({
            emails: stale.emails.slice(0, limit),
            total: stale.total,
            fetchedAt: stale.fetchedAt,
            cached: true,
            stale: true,
          });
        }
      } catch { /* no cache */ }
    }

    console.error("Gmail error:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to fetch Gmail", emails: [] },
      { status: 500 }
    );
  }
}
