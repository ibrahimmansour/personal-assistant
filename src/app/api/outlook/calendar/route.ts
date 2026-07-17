import { outlookFetch } from "@/lib/outlook-token";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const now = new Date();
    // Get today's start and end in UTC
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(now);
    endOfDay.setHours(23, 59, 59, 999);

    // Also fetch tomorrow for reminders
    const endOfTomorrow = new Date(endOfDay);
    endOfTomorrow.setDate(endOfTomorrow.getDate() + 1);

    const data = await outlookFetch("/me/calendarView", {
      startDateTime: startOfDay.toISOString(),
      endDateTime: endOfTomorrow.toISOString(),
      $top: "30",
      $orderby: "Start/DateTime",
      $select: "Id,Subject,Start,End,Location,Organizer,IsAllDay,IsCancelled,WebLink,BodyPreview,Body,Attendees,OnlineMeetingUrl",
    });

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

    const events = (data.value || [])
      .filter((ev: Record<string, unknown>) => !ev.IsCancelled)
      .map((ev: Record<string, unknown>, index: number) => {
        const evStart = ev.Start as Record<string, string> | undefined;
        const evEnd = ev.End as Record<string, string> | undefined;
        const start = new Date((evStart?.DateTime || "") + "Z");
        const end = new Date((evEnd?.DateTime || "") + "Z");
        const isToday = start.toDateString() === now.toDateString();

        return {
          id: ev.Id,
          title: (ev.Subject as string) || "(no subject)",
          startRaw: evStart?.DateTime,
          endRaw: evEnd?.DateTime,
          start: start.toISOString(),
          end: end.toISOString(),
          startFormatted: start.toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit",
            hour12: true,
          }),
          endFormatted: end.toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit",
            hour12: true,
          }),
          location: (ev.Location as Record<string, string> | undefined)?.DisplayName || "",
          organizer:
            (ev.Organizer as Record<string, Record<string, string>> | undefined)?.EmailAddress?.Name ||
            (ev.Organizer as Record<string, Record<string, string>> | undefined)?.EmailAddress?.Address ||
            "",
          isAllDay: ev.IsAllDay,
          isToday,
          color: colors[index % colors.length],
          webLink: (ev.WebLink as string) || "",
          bodyPreview: (ev.BodyPreview as string) || "",
          bodyHtml: (ev.Body as Record<string, string> | undefined)?.ContentType === "HTML" ? (ev.Body as Record<string, string>)?.Content : null,
          onlineMeetingUrl: (ev.OnlineMeetingUrl as string) || "",
          attendees: ((ev.Attendees as Record<string, unknown>[] | undefined) || []).map((a) => ({
            name: (a.EmailAddress as Record<string, string> | undefined)?.Name || (a.EmailAddress as Record<string, string> | undefined)?.Address || "",
            status: (a.Status as Record<string, string> | undefined)?.Response || "none",
          })),
        };
      });

    return Response.json({
      events,
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Outlook calendar error:", error);
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Failed to fetch calendar",
        events: [],
      },
      { status: 500 }
    );
  }
}
