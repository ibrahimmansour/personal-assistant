import type { Layout, LayoutItem } from "react-grid-layout";
import { DashboardState, WidgetConfig } from "@/types/widget";
import type { ProfileId } from "@/components/profile-context";

// ─── Work profile: all widgets ───────────────────────────────────────────────

const workWidgets: WidgetConfig[] = [
  { id: "clock", type: "clock", title: "Clock", visible: true },
  { id: "weather", type: "weather", title: "Weather", visible: true },
  { id: "calendar", type: "calendar", title: "Today's Schedule", visible: true },
  { id: "tasks", type: "tasks", title: "Tasks", visible: true },
  { id: "email", type: "email", title: "Email", visible: true },
  { id: "reminders", type: "reminders", title: "Reminders", visible: true },
  { id: "github-prs", type: "github-prs", title: "Pull Requests", visible: true },
  { id: "jira", type: "jira", title: "Jira Issues", visible: true },
  { id: "notes", type: "notes", title: "Notes", visible: true },
  { id: "terminal", type: "terminal", title: "Terminal", visible: true },
  { id: "bookmarks", type: "bookmarks", title: "Bookmarks", visible: true },
  { id: "files", type: "files", title: "Files", visible: true },
];

const workLayouts: Layout = [
  // Row 0: clock + weather + calendar = 4+4+4 = 12
  { i: "clock",      x: 0, y: 0, w: 4, h: 2, minW: 3, minH: 2 },
  { i: "weather",    x: 4, y: 0, w: 4, h: 2, minW: 3, minH: 2 },
  { i: "calendar",   x: 8, y: 0, w: 4, h: 4, minW: 3, minH: 3 },
  // Row 2: reminders + tasks + (calendar continues) = 4+4+4 = 12
  { i: "reminders",  x: 0, y: 2, w: 4, h: 2, minW: 3, minH: 2 },
  { i: "tasks",      x: 4, y: 2, w: 4, h: 4, minW: 3, minH: 3 },
  // Row 4: email + (tasks continues) + jira = 4+4+4 = 12
  { i: "email",      x: 0, y: 4, w: 4, h: 4, minW: 3, minH: 3 },
  { i: "jira",       x: 8, y: 4, w: 4, h: 4, minW: 4, minH: 3 },
  // Row 6: github-prs spans remaining = 4+8 or similar
  // (email ends y=8, tasks ends y=6, jira ends y=8)
  // Actually at y=6: cols 4-7 are free (tasks ended). Fill with github-prs.
  { i: "github-prs", x: 4, y: 6, w: 4, h: 4, minW: 4, minH: 3 },
  // Row 8: terminal + notes + bookmarks = 4+4+4 = 12
  { i: "terminal",   x: 0, y: 8, w: 4, h: 4, minW: 4, minH: 3 },
  { i: "notes",      x: 4, y: 8, w: 4, h: 4, minW: 3, minH: 3 },
  { i: "bookmarks",  x: 8, y: 8, w: 4, h: 4, minW: 3, minH: 3 },
  // Row 12: files full width = 12
  { i: "files",      x: 0, y: 12, w: 12, h: 4, minW: 3, minH: 3 },
];

// ─── Private profile: no Jira, has GitHub.com, Gmail, Google Calendar ────────

const privateWidgets: WidgetConfig[] = [
  { id: "clock", type: "clock", title: "Clock", visible: true },
  { id: "weather", type: "weather", title: "Weather", visible: true },
  { id: "calendar", type: "calendar", title: "Today's Schedule", visible: true },
  { id: "tasks", type: "tasks", title: "Tasks", visible: true },
  { id: "email", type: "email", title: "Email", visible: true },
  { id: "reminders", type: "reminders", title: "Reminders", visible: true },
  { id: "github-prs", type: "github-prs", title: "Pull Requests", visible: true },
  { id: "notes", type: "notes", title: "Notes", visible: true },
  { id: "terminal", type: "terminal", title: "Terminal", visible: true },
  { id: "bookmarks", type: "bookmarks", title: "Bookmarks", visible: true },
  { id: "files", type: "files", title: "Files", visible: true },
];

const privateLayouts: Layout = [
  // Row 0: clock + weather + calendar = 4+4+4 = 12
  { i: "clock",      x: 0, y: 0, w: 4, h: 2, minW: 3, minH: 2 },
  { i: "weather",    x: 4, y: 0, w: 4, h: 2, minW: 3, minH: 2 },
  { i: "calendar",   x: 8, y: 0, w: 4, h: 4, minW: 3, minH: 3 },
  // Row 2: reminders + tasks + (calendar continues) = 4+4+4 = 12
  { i: "reminders",  x: 0, y: 2, w: 4, h: 2, minW: 3, minH: 2 },
  { i: "tasks",      x: 4, y: 2, w: 4, h: 4, minW: 3, minH: 3 },
  // Row 4: email + (tasks continues) + github-prs = 4+4+4 = 12
  { i: "email",      x: 0, y: 4, w: 4, h: 4, minW: 3, minH: 3 },
  { i: "github-prs", x: 8, y: 4, w: 4, h: 4, minW: 4, minH: 3 },
  // Row 6: notes fills cols 4-7 (tasks ended)
  { i: "notes",      x: 4, y: 6, w: 4, h: 4, minW: 3, minH: 3 },
  // Row 8: terminal + bookmarks + files = 4+4+4 = 12
  { i: "terminal",   x: 0, y: 8, w: 4, h: 4, minW: 4, minH: 3 },
  { i: "bookmarks",  x: 4, y: 8, w: 4, h: 4, minW: 3, minH: 3 },
  { i: "files",      x: 8, y: 8, w: 4, h: 4, minW: 3, minH: 3 },
];

// ─── Profile-aware getters ───────────────────────────────────────────────────

const profileDefaults: Record<ProfileId, { widgets: WidgetConfig[]; layouts: Layout }> = {
  work: { widgets: workWidgets, layouts: workLayouts },
  private: { widgets: privateWidgets, layouts: privateLayouts },
};

export function getDefaultWidgets(profile: ProfileId): WidgetConfig[] {
  return profileDefaults[profile].widgets;
}

export function getDefaultLayouts(profile: ProfileId): Layout {
  return profileDefaults[profile].layouts;
}

export function getDefaultDashboard(profile: ProfileId): DashboardState {
  return {
    widgets: getDefaultWidgets(profile),
    layouts: getDefaultLayouts(profile),
  };
}

// Legacy exports for backward compat (default to work)
export const defaultWidgets = workWidgets;
export const defaultLayouts = workLayouts;
export const defaultDashboard: DashboardState = {
  widgets: workWidgets,
  layouts: workLayouts,
};
