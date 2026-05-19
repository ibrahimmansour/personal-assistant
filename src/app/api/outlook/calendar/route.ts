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
      .filter((ev: any) => !ev.IsCancelled)
      .map((ev: any, index: number) => {
        const start = new Date(ev.Start?.DateTime + "Z");
        const end = new Date(ev.End?.DateTime + "Z");
        const isToday = start.toDateString() === now.toDateString();

        return {
          id: ev.Id,
          title: ev.Subject || "(no subject)",
          startRaw: ev.Start?.DateTime,
          endRaw: ev.End?.DateTime,
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
          location: ev.Location?.DisplayName || "",
          organizer:
            ev.Organizer?.EmailAddress?.Name ||
            ev.Organizer?.EmailAddress?.Address ||
            "",
          isAllDay: ev.IsAllDay,
          isToday,
          color: colors[index % colors.length],
          webLink: ev.WebLink || "",
          bodyPreview: ev.BodyPreview || "",
          bodyHtml: ev.Body?.ContentType === "HTML" ? ev.Body?.Content : null,
          onlineMeetingUrl: ev.OnlineMeetingUrl || "",
          attendees: (ev.Attendees || []).map((a: any) => ({
            name: a.EmailAddress?.Name || a.EmailAddress?.Address || "",
            status: a.Status?.Response || "none",
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
