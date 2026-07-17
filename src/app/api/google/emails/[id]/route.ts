import { googleFetch, isConfigured } from "@/lib/google-token";

export const dynamic = "force-dynamic";

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
 * Fetch a single Gmail message by ID with full body content.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!isConfigured()) {
    return Response.json(
      { error: "Google OAuth not configured" },
      { status: 500 }
    );
  }

  if (!id) {
    return Response.json({ error: "Missing email ID" }, { status: 400 });
  }

  try {
    // Fetch labels for resolving IDs to names
    const labelMap: Record<string, string> = {};
    try {
      const labelsData = await googleFetch(
        "https://gmail.googleapis.com/gmail/v1/users/me/labels"
      ) as { labels?: { id: string; name: string }[] };
      for (const label of labelsData.labels || []) {
        labelMap[label.id] = label.name;
      }
    } catch {
      // Non-critical
    }

    const msg = await googleFetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`
    ) as GmailMessage;

    const headers = msg.payload?.headers || [];
    const getHeader = (name: string) =>
      headers.find(
        (h) => h.name.toLowerCase() === name.toLowerCase()
      )?.value || "";

    const from = getHeader("From");
    const { fromName, fromAddress } = parseFrom(from);
    const isRead = !(msg.labelIds || []).includes("UNREAD");

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

    const email = {
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
      categories: mapGmailLabels(msg.labelIds || [], labelMap),
      to: parseAddresses(getHeader("To")),
      cc: parseAddresses(getHeader("Cc")),
    };

    return Response.json({ email });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "GOOGLE_AUTH_REQUIRED") {
      return Response.json(
        { error: "Gmail authentication required.", authRequired: true },
        { status: 401 }
      );
    }

    console.error("Gmail fetch email by ID error:", error);
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to fetch email",
      },
      { status: 500 }
    );
  }
}
