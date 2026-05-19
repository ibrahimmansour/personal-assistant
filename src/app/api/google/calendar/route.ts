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
    );

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
      .filter((ev: any) => ev.status !== "cancelled")
      .map((ev: any, index: number) => {
        const isAllDay = Boolean(ev.start?.date);
        const startDate = isAllDay
          ? new Date(ev.start.date + "T00:00:00")
          : new Date(ev.start.dateTime);
        const endDate = isAllDay
          ? new Date(ev.end.date + "T23:59:59")
          : new Date(ev.end.dateTime);
        const isToday = startDate.toDateString() === now.toDateString();

        return {
          id: ev.id,
          title: ev.summary || "(no title)",
          startRaw: isAllDay ? ev.start.date : ev.start.dateTime,
          endRaw: isAllDay ? ev.end.date : ev.end.dateTime,
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
          location: ev.location || "",
          organizer: ev.organizer?.displayName || ev.organizer?.email || "",
          isAllDay,
          isToday,
          color: colors[index % colors.length],
          webLink: ev.htmlLink || "",
          bodyPreview: ev.description?.slice(0, 200) || "",
          bodyHtml: ev.description || null,
          onlineMeetingUrl:
            ev.hangoutLink ||
            ev.conferenceData?.entryPoints?.find((e: any) => e.entryPointType === "video")?.uri ||
            "",
          attendees: (ev.attendees || []).map((a: any) => ({
            name: a.displayName || a.email || "",
            status: a.responseStatus || "none",
          })),
        };
      });

    return Response.json({ events, fetchedAt: new Date().toISOString() });
  } catch (error: any) {
    if (error.message === "GOOGLE_AUTH_REQUIRED") {
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
