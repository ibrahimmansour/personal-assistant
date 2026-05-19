import { outlookPost } from "@/lib/outlook-token";

export const dynamic = "force-dynamic";

/**
 * Reply to an Outlook email.
 * Uses POST /me/messages/{id}/reply which sends the reply immediately.
 * Body: { comment: string } — the reply text (HTML supported).
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!id) {
    return Response.json({ error: "Missing email ID" }, { status: 400 });
  }

  try {
    const body = await request.json();
    const { comment, replyAll } = body;

    if (!comment || typeof comment !== "string" || !comment.trim()) {
      return Response.json({ error: "Reply comment is required" }, { status: 400 });
    }

    // Outlook API: POST /me/messages/{id}/reply or /replyAll
    // The Comment field supports HTML content
    const endpoint = replyAll
      ? `/me/messages/${id}/replyall`
      : `/me/messages/${id}/reply`;

    await outlookPost(endpoint, {
      Comment: comment,
    });

    return Response.json({ success: true });
  } catch (error) {
    console.error("Outlook reply error:", error);
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to send reply",
      },
      { status: 500 }
    );
  }
}
