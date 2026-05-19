import { googleFetch, isConfigured } from "@/lib/google-token";

export const dynamic = "force-dynamic";

/**
 * Reply to a Gmail email.
 * Uses Gmail API to create and send a reply message with proper threading.
 * Body: { comment: string, replyAll?: boolean }
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!isConfigured()) {
    return Response.json({ error: "Google OAuth not configured" }, { status: 500 });
  }

  if (!id) {
    return Response.json({ error: "Missing email ID" }, { status: 400 });
  }

  try {
    const body = await request.json();
    const { comment, replyAll } = body;

    if (!comment || typeof comment !== "string" || !comment.trim()) {
      return Response.json({ error: "Reply comment is required" }, { status: 400 });
    }

    // Fetch the original message to get threading info and addresses
    const original = await googleFetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Subject&metadataHeaders=Message-ID&metadataHeaders=References&metadataHeaders=In-Reply-To`
    );

    const headers = original.payload?.headers || [];
    const getHeader = (name: string) =>
      headers.find((h: any) => h.name.toLowerCase() === name.toLowerCase())?.value || "";

    const originalFrom = getHeader("From");
    const originalTo = getHeader("To");
    const originalCc = getHeader("Cc");
    const originalSubject = getHeader("Subject");
    const messageId = getHeader("Message-ID");
    const references = getHeader("References");
    const threadId = original.threadId;

    // Build "To" for the reply
    // For reply: send to the original sender
    // For replyAll: send to original sender + all To/Cc (excluding ourselves)
    let toAddress = originalFrom;
    let ccAddress = "";

    if (replyAll) {
      // Get our own email address from the profile
      let myEmail = "";
      try {
        const profile = await googleFetch(
          "https://gmail.googleapis.com/gmail/v1/users/me/profile"
        );
        myEmail = profile.emailAddress?.toLowerCase() || "";
      } catch {
        // Fall back — we'll just include everyone
      }

      const allRecipients = [originalTo, originalCc]
        .filter(Boolean)
        .join(", ")
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s && !s.toLowerCase().includes(myEmail));

      // Original sender goes in To, others in Cc
      toAddress = originalFrom;
      ccAddress = allRecipients
        .filter((r) => r.toLowerCase() !== originalFrom.toLowerCase())
        .join(", ");
    }

    // Build the subject with Re: prefix
    const subject = originalSubject.startsWith("Re:")
      ? originalSubject
      : `Re: ${originalSubject}`;

    // Build RFC 2822 MIME message
    const referencesHeader = references
      ? `${references} ${messageId}`
      : messageId;

    const messageParts = [
      `From: me`,
      `To: ${toAddress}`,
      ...(ccAddress ? [`Cc: ${ccAddress}`] : []),
      `Subject: ${subject}`,
      `In-Reply-To: ${messageId}`,
      `References: ${referencesHeader}`,
      `Content-Type: text/html; charset=utf-8`,
      ``,
      comment,
    ];

    const rawMessage = messageParts.join("\r\n");
    // Gmail API requires base64url-encoded raw message
    const encodedMessage = Buffer.from(rawMessage)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    // Send the reply using Gmail API
    await googleFetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          raw: encodedMessage,
          threadId,
        }),
      }
    );

    return Response.json({ success: true });
  } catch (error: any) {
    if (error.message === "GOOGLE_AUTH_REQUIRED") {
      return Response.json(
        { error: "Gmail authentication required.", authRequired: true },
        { status: 401 }
      );
    }

    console.error("Gmail reply error:", error);
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
