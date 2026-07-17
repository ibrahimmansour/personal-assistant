import { outlookFetch, outlookFetchUrl } from "@/lib/outlook-token";
import { type NextRequest } from "next/server";

export const dynamic = "force-dynamic";

const MAX_RESULTS = 500;
const PAGE_SIZE = 50;

function mapMessage(m: Record<string, unknown>) {
  return {
    id: m.Id,
    from:
      (m.From as Record<string, Record<string, string>> | undefined)?.EmailAddress?.Name ||
      (m.From as Record<string, Record<string, string>> | undefined)?.EmailAddress?.Address ||
      "Unknown",
    fromAddress: (m.From as Record<string, Record<string, string>> | undefined)?.EmailAddress?.Address || "",
    subject: (m.Subject as string) || "(no subject)",
    preview: (m.BodyPreview as string) || "",
    time: m.ReceivedDateTime,
    read: m.IsRead,
    hasAttachments: m.HasAttachments,
    webLink: (m.WebLink as string) || "",
    categories: ((m.Categories as string[]) || []) as string[],
    to: ((m.ToRecipients as Record<string, unknown>[]) || [])
      .map(
        (r) => (r.EmailAddress as Record<string, string> | undefined)?.Name || (r.EmailAddress as Record<string, string> | undefined)?.Address
      )
      .filter(Boolean),
    cc: ((m.CcRecipients as Record<string, unknown>[]) || [])
      .map(
        (r) => (r.EmailAddress as Record<string, string> | undefined)?.Name || (r.EmailAddress as Record<string, string> | undefined)?.Address
      )
      .filter(Boolean),
  };
}

/**
 * Server-side Outlook email search using $search.
 * Searches the ENTIRE mailbox (not just inbox), covering all time.
 * Paginates via @odata.nextLink to return up to 500 results.
 * Note: Outlook $search cannot be combined with $orderby or $skip.
 */
export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q")?.trim();
  if (!query) {
    return Response.json({ emails: [], total: 0 });
  }

  try {
    const allEmails: Record<string, unknown>[] = [];

    // First page uses outlookFetch with params
    const firstPage = await outlookFetch("/me/messages", {
      $search: `"${query}"`,
      $top: String(PAGE_SIZE),
      $select:
        "Id,Subject,From,ReceivedDateTime,IsRead,BodyPreview,HasAttachments,WebLink,ToRecipients,CcRecipients,Categories",
    });

    const firstMessages = firstPage.value || [];
    allEmails.push(...firstMessages.map(mapMessage));

    // Follow @odata.nextLink for subsequent pages
    let nextLink: string | undefined = firstPage["@odata.nextLink"];

    while (nextLink && allEmails.length < MAX_RESULTS) {
      const page = await outlookFetchUrl(nextLink);
      const messages = page.value || [];
      if (messages.length === 0) break;

      allEmails.push(...messages.map(mapMessage));
      nextLink = page["@odata.nextLink"];
    }

    return Response.json({
      emails: allEmails.slice(0, MAX_RESULTS),
      total: Math.min(allEmails.length, MAX_RESULTS),
    });
  } catch (error) {
    console.error("Outlook email search error:", error);
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to search emails",
        emails: [],
      },
      { status: 500 }
    );
  }
}
