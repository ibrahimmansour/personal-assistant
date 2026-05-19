import { googleFetch, isConfigured } from "@/lib/google-token";
import { type NextRequest } from "next/server";

export const dynamic = "force-dynamic";

const MAX_RESULTS = 500;
const GMAIL_PAGE_SIZE = 100; // Gmail max per page
const FETCH_BATCH_SIZE = 25; // Parallel metadata fetches

// System labels to exclude from user-facing categories
const GMAIL_SYSTEM_LABELS = new Set([
  "INBOX", "UNREAD", "SENT", "DRAFT", "TRASH", "SPAM",
  "STARRED", "IMPORTANT", "CHAT", "CATEGORY_PERSONAL",
]);

function mapGmailLabels(labelIds: string[], labelMap: Record<string, string>): string[] {
  return (labelIds || [])
    .filter((l) => !GMAIL_SYSTEM_LABELS.has(l))
    .map((l) => {
      if (l.startsWith("CATEGORY_")) {
        return l.replace("CATEGORY_", "").charAt(0) +
          l.replace("CATEGORY_", "").slice(1).toLowerCase();
      }
      return labelMap[l] || l;
    });
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

/**
 * Server-side Gmail search using the q= parameter.
 * Searches the ENTIRE mailbox using Gmail's native search syntax.
 * Paginates to return up to 500 results.
 */
export async function GET(request: NextRequest) {
  if (!isConfigured()) {
    return Response.json(
      { error: "Google OAuth not configured", emails: [] },
      { status: 500 }
    );
  }

  const query = request.nextUrl.searchParams.get("q")?.trim();
  if (!query) {
    return Response.json({ emails: [], total: 0 });
  }

  try {
    // Step 1: Paginate through message IDs
    const allMessageIds: string[] = [];
    let pageToken: string | undefined;

    while (allMessageIds.length < MAX_RESULTS) {
      const pageSize = Math.min(GMAIL_PAGE_SIZE, MAX_RESULTS - allMessageIds.length);
      let url = `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${pageSize}&q=${encodeURIComponent(query)}`;
      if (pageToken) url += `&pageToken=${pageToken}`;

      const listData = await googleFetch(url);
      const ids: string[] = (listData.messages || []).map((m: any) => m.id);
      if (ids.length === 0) break;

      allMessageIds.push(...ids);
      pageToken = listData.nextPageToken;
      if (!pageToken) break;
    }

    if (allMessageIds.length === 0) {
      return Response.json({ emails: [], total: 0 });
    }

    // Fetch Gmail labels for resolving IDs to names
    let labelMap: Record<string, string> = {};
    try {
      const labelsData = await googleFetch(
        "https://gmail.googleapis.com/gmail/v1/users/me/labels"
      );
      for (const label of labelsData.labels || []) {
        labelMap[label.id] = label.name;
      }
    } catch {
      // Non-critical
    }

    // Step 2: Fetch message metadata in parallel batches
    const allEmails: any[] = [];

    for (let i = 0; i < allMessageIds.length; i += FETCH_BATCH_SIZE) {
      const batch = allMessageIds.slice(i, i + FETCH_BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map((id) =>
          googleFetch(
            `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=To&metadataHeaders=Cc`
          )
        )
      );

      for (const r of results) {
        if (r.status !== "fulfilled") continue;
        const msg = r.value;
        const headers = msg.payload?.headers || [];
        const getHeader = (name: string) =>
          headers.find(
            (h: any) => h.name.toLowerCase() === name.toLowerCase()
          )?.value || "";

        const from = getHeader("From");
        const { fromName, fromAddress } = parseFrom(from);
        const isRead = !(msg.labelIds || []).includes("UNREAD");

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
          categories: mapGmailLabels(msg.labelIds || [], labelMap),
          to: parseAddresses(getHeader("To")),
          cc: parseAddresses(getHeader("Cc")),
        });
      }
    }

    return Response.json({ emails: allEmails, total: allEmails.length });
  } catch (error: any) {
    if (error.message === "GOOGLE_AUTH_REQUIRED") {
      return Response.json(
        {
          error: "Gmail authentication required.",
          authRequired: true,
          authUrl: "/api/google/auth",
          emails: [],
        },
        { status: 401 }
      );
    }

    console.error("Gmail search error:", error);
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to search Gmail",
        emails: [],
      },
      { status: 500 }
    );
  }
}
