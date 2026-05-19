import { outlookFetch } from "@/lib/outlook-token";

export const dynamic = "force-dynamic";

/**
 * Fetch a single Outlook email by ID with full body content.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!id) {
    return Response.json({ error: "Missing email ID" }, { status: 400 });
  }

  try {
    const m = await outlookFetch(`/me/messages/${id}`, {
      $select:
        "Id,Subject,From,ReceivedDateTime,IsRead,BodyPreview,Body,HasAttachments,WebLink,ToRecipients,CcRecipients,Categories",
    });

    const email = {
      id: m.Id,
      from:
        m.From?.EmailAddress?.Name ||
        m.From?.EmailAddress?.Address ||
        "Unknown",
      fromAddress: m.From?.EmailAddress?.Address || "",
      subject: m.Subject || "(no subject)",
      preview: m.BodyPreview || "",
      bodyHtml: m.Body?.ContentType === "HTML" ? m.Body?.Content : null,
      bodyText:
        m.Body?.ContentType === "Text"
          ? m.Body?.Content
          : m.BodyPreview || "",
      time: m.ReceivedDateTime,
      read: m.IsRead,
      hasAttachments: m.HasAttachments,
      webLink: m.WebLink || "",
      categories: (m.Categories || []) as string[],
      to: (m.ToRecipients || [])
        .map(
          (r: any) => r.EmailAddress?.Name || r.EmailAddress?.Address
        )
        .filter(Boolean),
      cc: (m.CcRecipients || [])
        .map(
          (r: any) => r.EmailAddress?.Name || r.EmailAddress?.Address
        )
        .filter(Boolean),
    };

    return Response.json({ email });
  } catch (error) {
    console.error("Outlook fetch email by ID error:", error);
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
