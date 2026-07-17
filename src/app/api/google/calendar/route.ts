import { googleFetch, isConfigured } from "@/lib/google-token";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!isConfigured()) {
    return Response.json(
      { error: "Google OAuth not configured", events: [] },
      { status: 500 }
    );
  }

  try {
    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfTomorrow = new Date(now);
    endOfTomorrow.setDate(endOfTomorrow.getDate() + 1);
    endOfTomorrow.setHours(23, 59, 59, 999);

    const params = new URLSearchParams({
      timeMin: startOfDay.toISOString(),
      timeMax: endOfTomorrow.toISOString(),
      maxResults: "30",
      singleEvents: "true",
      orderBy: "startTime",
    });

    const data = await googleFetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`
    ) as { items?: Record<string, unknown>[] };

    const colors = [
      "bg-blue-500",
      "bg-purple-500",
      "bg-green-500",
      "bg-orange-500",
      "bg-pink-500",
      "bg-cyan-500",
      "bg-yellow-500",
      "bg-red-500",
    ];

    const events = (data.items || [])
      .filter((ev: Record<string, unknown>) => ev.status !== "cancelled")
      .map((ev: Record<string, unknown>, index: number) => {
        const evStart = ev.start as Record<string, string> | undefined;
        const evEnd = ev.end as Record<string, string> | undefined;
        const isAllDay = Boolean(evStart?.date);
        const startDate = isAllDay
          ? new Date(evStart!.date + "T00:00:00")
          : new Date(evStart?.dateTime || "");
        const endDate = isAllDay
          ? new Date(evEnd!.date + "T23:59:59")
          : new Date(evEnd?.dateTime || "");
        const isToday = startDate.toDateString() === now.toDateString();

        return {
          id: ev.id,
          title: (ev.summary as string) || "(no title)",
          startRaw: isAllDay ? evStart!.date : evStart?.dateTime,
          endRaw: isAllDay ? evEnd!.date : evEnd?.dateTime,
          start: startDate.toISOString(),
          end: endDate.toISOString(),
          startFormatted: isAllDay
            ? "All day"
            : startDate.toLocaleTimeString("en-US", {
                hour: "numeric",
                minute: "2-digit",
                hour12: true,
              }),
          endFormatted: isAllDay
            ? ""
            : endDate.toLocaleTimeString("en-US", {
                hour: "numeric",
                minute: "2-digit",
                hour12: true,
              }),
          location: (ev.location as string) || "",
          organizer: ((ev.organizer as Record<string, string> | undefined)?.displayName || (ev.organizer as Record<string, string> | undefined)?.email) || "",
          isAllDay,
          isToday,
          color: colors[index % colors.length],
          webLink: (ev.htmlLink as string) || "",
          bodyPreview: (ev.description as string)?.slice(0, 200) || "",
          bodyHtml: (ev.description as string) || null,
          onlineMeetingUrl:
            (ev.hangoutLink as string) ||
            ((ev.conferenceData as Record<string, unknown>)?.entryPoints as Record<string, unknown>[] | undefined)?.find((e) => e.entryPointType === "video")?.uri as string ||
            "",
          attendees: ((ev.attendees as Record<string, unknown>[] | undefined) || []).map((a) => ({
            name: (a.displayName as string) || (a.email as string) || "",
            status: (a.responseStatus as string) || "none",
          })),
        };
      });

    return Response.json({ events, fetchedAt: new Date().toISOString() });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "GOOGLE_AUTH_REQUIRED") {
      return Response.json(
        {
          error: "Google Calendar authentication required. Click to connect.",
          authRequired: true,
          authUrl: "/api/google/auth",
          events: [],
        },
        { status: 401 }
      );
    }
    console.error("Google Calendar error:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to fetch calendar", events: [] },
      { status: 500 }
    );
  }
}
