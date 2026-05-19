import { outlookFetch } from "@/lib/outlook-token";
import { type NextRequest } from "next/server";
import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { homedir } from "os";

export const dynamic = "force-dynamic";

const DATA_DIR = join(homedir(), ".personal-assistant");
const CACHE_FILE = join(DATA_DIR, "outlook-emails-cache.json");
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

interface CachedEmails {
  emails: any[];
  fetchedAt: string;
  total: number;
}

async function readCache(): Promise<CachedEmails | null> {
  try {
    const raw = await readFile(CACHE_FILE, "utf-8");
    const data = JSON.parse(raw);
    const age = Date.now() - new Date(data.fetchedAt).getTime();
    if (age < CACHE_TTL) return data;
    return null; // expired
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

function mapMessage(m: any) {
  return {
    id: m.Id,
    from: m.From?.EmailAddress?.Name || m.From?.EmailAddress?.Address || "Unknown",
    fromAddress: m.From?.EmailAddress?.Address || "",
    subject: m.Subject || "(no subject)",
    preview: m.BodyPreview || "",
    bodyHtml: m.Body?.ContentType === "HTML" ? m.Body?.Content : null,
    bodyText: m.Body?.ContentType === "Text" ? m.Body?.Content : m.BodyPreview || "",
    time: m.ReceivedDateTime,
    read: m.IsRead,
    hasAttachments: m.HasAttachments,
    webLink: m.WebLink || "",
    categories: (m.Categories || []) as string[],
    to: (m.ToRecipients || []).map((r: any) => r.EmailAddress?.Name || r.EmailAddress?.Address).filter(Boolean),
    cc: (m.CcRecipients || []).map((r: any) => r.EmailAddress?.Name || r.EmailAddress?.Address).filter(Boolean),
  };
}

function mapMessageLight(m: any) {
  return {
    id: m.Id,
    from: m.From?.EmailAddress?.Name || m.From?.EmailAddress?.Address || "Unknown",
    fromAddress: m.From?.EmailAddress?.Address || "",
    subject: m.Subject || "(no subject)",
    preview: m.BodyPreview || "",
    time: m.ReceivedDateTime,
    read: m.IsRead,
    hasAttachments: m.HasAttachments,
    webLink: m.WebLink || "",
    categories: (m.Categories || []) as string[],
    to: (m.ToRecipients || []).map((r: any) => r.EmailAddress?.Name || r.EmailAddress?.Address).filter(Boolean),
    cc: (m.CcRecipients || []).map((r: any) => r.EmailAddress?.Name || r.EmailAddress?.Address).filter(Boolean),
  };
}

export async function GET(request: NextRequest) {
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

    // Determine fields to select based on request type
    const selectFields = isFullFetch
      ? "Id,Subject,From,ReceivedDateTime,IsRead,BodyPreview,HasAttachments,WebLink,ToRecipients,CcRecipients,Categories"
      : "Id,Subject,From,ReceivedDateTime,IsRead,BodyPreview,Body,HasAttachments,WebLink,ToRecipients,CcRecipients,Categories";

    const allEmails: any[] = [];
    const pageSize = 50;
    let skip = 0;

    while (allEmails.length < limit) {
      const batchSize = Math.min(pageSize, limit - allEmails.length);
      const data = await outlookFetch("/me/mailFolders/Inbox/messages", {
        $top: String(batchSize),
        $skip: String(skip),
        $orderby: "ReceivedDateTime desc",
        $select: selectFields,
      });

      const messages = data.value || [];
      if (messages.length === 0) break;

      const mapped = isFullFetch
        ? messages.map(mapMessageLight)
        : messages.map(mapMessage);
      allEmails.push(...mapped);
      skip += messages.length;

      // If we got fewer than requested, we've reached the end
      if (messages.length < batchSize) break;
    }

    const result = {
      emails: allEmails,
      total: allEmails.length,
      fetchedAt: new Date().toISOString(),
    };

    // Cache large fetches to disk
    if (isFullFetch) {
      writeCache(result); // fire and forget
    }

    return Response.json(result);
  } catch (error) {
    console.error("Outlook emails error:", error);
    
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

    return Response.json(
      {
        error: error instanceof Error ? error.message : "Failed to fetch emails",
        tokenExpired: error instanceof Error && (
          error.message.includes("token") ||
          error.message.includes("401") ||
          error.message.includes("auto-refresh")
        ),
        emails: [],
      },
      { status: 500 }
    );
  }
}
