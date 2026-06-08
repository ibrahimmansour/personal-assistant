import type { Layout, LayoutItem } from "react-grid-layout";
import { DashboardState, WidgetConfig } from "@/types/widget";
import type { ProfileId } from "@/components/profile-context";

// ─── Section definitions (used for visual grouping in the grid) ──────────────

export type WidgetSection = "glance" | "productivity" | "devtools" | "more";

export const sectionMeta: Record<WidgetSection, { label: string; order: number }> = {
  glance: { label: "At a Glance", order: 0 },
  productivity: { label: "Productivity", order: 1 },
  devtools: { label: "Dev Tools", order: 2 },
  more: { label: "More", order: 3 },
};

export const widgetSections: Record<string, WidgetSection> = {
  clock: "glance",
  weather: "glance",
  calendar: "glance",
  reminders: "glance",
  email: "productivity",
  tasks: "productivity",
  jira: "productivity",
  notes: "productivity",
  "github-prs": "devtools",
  terminal: "devtools",
  "claude-code": "devtools",
  news: "more",
  bookmarks: "more",
  files: "more",
  "system-monitor": "more",
};

// ─── Work profile: all widgets ───────────────────────────────────────────────

const workWidgets: WidgetConfig[] = [
  { id: "clock", type: "clock", title: "Clock", visible: true },
  { id: "weather", type: "weather", title: "Weather", visible: true },
  { id: "calendar", type: "calendar", title: "Today's Schedule", visible: true },
  { id: "reminders", type: "reminders", title: "Reminders", visible: true },
  { id: "email", type: "email", title: "Email", visible: true },
  { id: "tasks", type: "tasks", title: "Tasks", visible: true },
  { id: "jira", type: "jira", title: "Jira Issues", visible: true },
  { id: "github-prs", type: "github-prs", title: "Pull Requests", visible: true },
  { id: "notes", type: "notes", title: "Notes", visible: true },
  { id: "terminal", type: "terminal", title: "Terminal", visible: true },
  { id: "claude-code", type: "claude-code", title: "Claude Code", visible: true },
  { id: "bookmarks", type: "bookmarks", title: "Bookmarks", visible: false },
  { id: "files", type: "files", title: "Files", visible: false },
  { id: "system-monitor", type: "system-monitor", title: "System Monitor", visible: false },
  { id: "news", type: "news", title: "News", visible: true },
];

// lg layout: 12 columns — clean 3-column grid with uniform row heights
const workLayouts: Layout = [
  // ─── At a Glance (y=0, h=3) ───────────────────────────
  { i: "clock",      x: 0, y: 0,  w: 4, h: 3, minW: 3, minH: 2 },
  { i: "weather",    x: 4, y: 0,  w: 4, h: 3, minW: 3, minH: 2 },
  { i: "calendar",   x: 8, y: 0,  w: 4, h: 3, minW: 3, minH: 3 },
  // ─── Productivity (y=3, h=4) ───────────────────────────
  { i: "email",      x: 0, y: 3,  w: 4, h: 4, minW: 3, minH: 3 },
  { i: "tasks",      x: 4, y: 3,  w: 4, h: 4, minW: 3, minH: 3 },
  { i: "jira",       x: 8, y: 3,  w: 4, h: 4, minW: 3, minH: 3 },
  // ─── Dev Tools (y=7, h=4) ─────────────────────────────
  { i: "github-prs", x: 0, y: 7,  w: 4, h: 4, minW: 3, minH: 3 },
  { i: "notes",      x: 4, y: 7,  w: 4, h: 4, minW: 3, minH: 3 },
  { i: "terminal",   x: 8, y: 7,  w: 4, h: 4, minW: 3, minH: 3 },
  // ─── Bottom row ───────────────────────────────────────
  { i: "reminders",  x: 0, y: 11, w: 4, h: 4, minW: 3, minH: 2 },
  { i: "claude-code",x: 4, y: 11, w: 8, h: 5, minW: 4, minH: 4 },
  // ─── More section ────────────────────────────────────
  { i: "news",       x: 0, y: 16, w: 4, h: 4, minW: 3, minH: 3 },
  { i: "bookmarks",  x: 4, y: 16, w: 4, h: 4, minW: 3, minH: 3 },
  { i: "files",      x: 8, y: 16, w: 4, h: 4, minW: 3, minH: 3 },
  { i: "system-monitor", x: 0, y: 20, w: 4, h: 4, minW: 3, minH: 3 },
];

// md layout: 8 columns — 2-column grid
const workLayoutsMd: Layout = [
  // ─── At a Glance ──────────────────────────────────────
  { i: "clock",      x: 0, y: 0,  w: 4, h: 3, minW: 3, minH: 2 },
  { i: "weather",    x: 4, y: 0,  w: 4, h: 3, minW: 3, minH: 2 },
  { i: "calendar",   x: 0, y: 3,  w: 4, h: 3, minW: 3, minH: 3 },
  { i: "reminders",  x: 4, y: 3,  w: 4, h: 3, minW: 3, minH: 2 },
  // ─── Productivity ─────────────────────────────────────
  { i: "email",      x: 0, y: 6,  w: 4, h: 4, minW: 3, minH: 3 },
  { i: "tasks",      x: 4, y: 6,  w: 4, h: 4, minW: 3, minH: 3 },
  { i: "jira",       x: 0, y: 10, w: 4, h: 4, minW: 3, minH: 3 },
  { i: "github-prs", x: 4, y: 10, w: 4, h: 4, minW: 3, minH: 3 },
  // ─── Dev Tools ────────────────────────────────────────
  { i: "notes",      x: 0, y: 14, w: 4, h: 4, minW: 3, minH: 3 },
  { i: "terminal",   x: 4, y: 14, w: 4, h: 4, minW: 3, minH: 3 },
  { i: "claude-code",x: 0, y: 18, w: 8, h: 5, minW: 4, minH: 4 },
  // ─── More ─────────────────────────────────────────────
  { i: "news",       x: 0, y: 23, w: 4, h: 4, minW: 3, minH: 3 },
  { i: "bookmarks",  x: 4, y: 23, w: 4, h: 4, minW: 3, minH: 3 },
  { i: "files",      x: 0, y: 27, w: 4, h: 4, minW: 3, minH: 3 },
  { i: "system-monitor", x: 4, y: 27, w: 4, h: 4, minW: 3, minH: 3 },
];

// sm layout: 4 columns — single column, stacked
const workLayoutsSm: Layout = [
  { i: "clock",      x: 0, y: 0,  w: 4, h: 3, minW: 3, minH: 2 },
  { i: "weather",    x: 0, y: 3,  w: 4, h: 3, minW: 3, minH: 2 },
  { i: "calendar",   x: 0, y: 6,  w: 4, h: 4, minW: 3, minH: 3 },
  { i: "reminders",  x: 0, y: 10, w: 4, h: 3, minW: 3, minH: 2 },
  { i: "email",      x: 0, y: 13, w: 4, h: 4, minW: 3, minH: 3 },
  { i: "tasks",      x: 0, y: 17, w: 4, h: 4, minW: 3, minH: 3 },
  { i: "jira",       x: 0, y: 21, w: 4, h: 4, minW: 3, minH: 3 },
  { i: "github-prs", x: 0, y: 25, w: 4, h: 4, minW: 3, minH: 3 },
  { i: "notes",      x: 0, y: 29, w: 4, h: 4, minW: 3, minH: 3 },
  { i: "terminal",   x: 0, y: 33, w: 4, h: 4, minW: 3, minH: 3 },
  { i: "claude-code",x: 0, y: 37, w: 4, h: 5, minW: 3, minH: 4 },
  { i: "news",       x: 0, y: 42, w: 4, h: 4, minW: 3, minH: 3 },
  { i: "bookmarks",  x: 0, y: 46, w: 4, h: 4, minW: 3, minH: 3 },
  { i: "files",      x: 0, y: 50, w: 4, h: 4, minW: 3, minH: 3 },
  { i: "system-monitor", x: 0, y: 54, w: 4, h: 4, minW: 3, minH: 3 },
];

// ─── Private profile: no Jira, has GitHub.com, Gmail, Google Calendar ────────

const privateWidgets: WidgetConfig[] = [
  { id: "clock", type: "clock", title: "Clock", visible: true },
  { id: "weather", type: "weather", title: "Weather", visible: true },
  { id: "calendar", type: "calendar", title: "Today's Schedule", visible: true },
  { id: "reminders", type: "reminders", title: "Reminders", visible: true },
  { id: "email", type: "email", title: "Email", visible: true },
  { id: "tasks", type: "tasks", title: "Tasks", visible: true },
  { id: "github-prs", type: "github-prs", title: "Pull Requests", visible: true },
  { id: "notes", type: "notes", title: "Notes", visible: true },
  { id: "terminal", type: "terminal", title: "Terminal", visible: true },
  { id: "claude-code", type: "claude-code", title: "Claude Code", visible: true },
  { id: "bookmarks", type: "bookmarks", title: "Bookmarks", visible: false },
  { id: "files", type: "files", title: "Files", visible: false },
  { id: "system-monitor", type: "system-monitor", title: "System Monitor", visible: false },
  { id: "news", type: "news", title: "News", visible: true },
];

// lg layout: 12 columns
const privateLayouts: Layout = [
  // ─── At a Glance ──────────────────────────────────────
  { i: "clock",      x: 0, y: 0,  w: 4, h: 3, minW: 3, minH: 2 },
  { i: "weather",    x: 4, y: 0,  w: 4, h: 3, minW: 3, minH: 2 },
  { i: "calendar",   x: 8, y: 0,  w: 4, h: 3, minW: 3, minH: 3 },
  // ─── Productivity ─────────────────────────────────────
  { i: "email",      x: 0, y: 3,  w: 4, h: 4, minW: 3, minH: 3 },
  { i: "tasks",      x: 4, y: 3,  w: 4, h: 4, minW: 3, minH: 3 },
  { i: "reminders",  x: 8, y: 3,  w: 4, h: 4, minW: 3, minH: 2 },
  // ─── Dev Tools ────────────────────────────────────────
  { i: "github-prs", x: 0, y: 7,  w: 4, h: 4, minW: 3, minH: 3 },
  { i: "notes",      x: 4, y: 7,  w: 4, h: 4, minW: 3, minH: 3 },
  { i: "terminal",   x: 8, y: 7,  w: 4, h: 4, minW: 3, minH: 3 },
  // ─── Bottom ───────────────────────────────────────────
  { i: "claude-code",x: 0, y: 11, w: 8, h: 5, minW: 4, minH: 4 },
  // ─── More section ────────────────────────────────────
  { i: "news",       x: 0, y: 16, w: 4, h: 4, minW: 3, minH: 3 },
  { i: "bookmarks",  x: 4, y: 16, w: 4, h: 4, minW: 3, minH: 3 },
  { i: "files",      x: 8, y: 16, w: 4, h: 4, minW: 3, minH: 3 },
  { i: "system-monitor", x: 0, y: 20, w: 4, h: 4, minW: 3, minH: 3 },
];

// md layout: 8 columns
const privateLayoutsMd: Layout = [
  { i: "clock",      x: 0, y: 0,  w: 4, h: 3, minW: 3, minH: 2 },
  { i: "weather",    x: 4, y: 0,  w: 4, h: 3, minW: 3, minH: 2 },
  { i: "calendar",   x: 0, y: 3,  w: 4, h: 3, minW: 3, minH: 3 },
  { i: "reminders",  x: 4, y: 3,  w: 4, h: 3, minW: 3, minH: 2 },
  { i: "email",      x: 0, y: 6,  w: 4, h: 4, minW: 3, minH: 3 },
  { i: "tasks",      x: 4, y: 6,  w: 4, h: 4, minW: 3, minH: 3 },
  { i: "github-prs", x: 0, y: 10, w: 4, h: 4, minW: 3, minH: 3 },
  { i: "notes",      x: 4, y: 10, w: 4, h: 4, minW: 3, minH: 3 },
  { i: "terminal",   x: 0, y: 14, w: 4, h: 4, minW: 3, minH: 3 },
  { i: "claude-code",x: 4, y: 14, w: 4, h: 5, minW: 4, minH: 4 },
  { i: "news",       x: 0, y: 19, w: 4, h: 4, minW: 3, minH: 3 },
  { i: "bookmarks",  x: 4, y: 19, w: 4, h: 4, minW: 3, minH: 3 },
  { i: "files",      x: 0, y: 23, w: 4, h: 4, minW: 3, minH: 3 },
  { i: "system-monitor", x: 4, y: 23, w: 4, h: 4, minW: 3, minH: 3 },
];

// sm layout: 4 columns — stacked
const privateLayoutsSm: Layout = [
  { i: "clock",      x: 0, y: 0,  w: 4, h: 3, minW: 3, minH: 2 },
  { i: "weather",    x: 0, y: 3,  w: 4, h: 3, minW: 3, minH: 2 },
  { i: "calendar",   x: 0, y: 6,  w: 4, h: 4, minW: 3, minH: 3 },
  { i: "reminders",  x: 0, y: 10, w: 4, h: 3, minW: 3, minH: 2 },
  { i: "email",      x: 0, y: 13, w: 4, h: 4, minW: 3, minH: 3 },
  { i: "tasks",      x: 0, y: 17, w: 4, h: 4, minW: 3, minH: 3 },
  { i: "github-prs", x: 0, y: 21, w: 4, h: 4, minW: 3, minH: 3 },
  { i: "notes",      x: 0, y: 25, w: 4, h: 4, minW: 3, minH: 3 },
  { i: "terminal",   x: 0, y: 29, w: 4, h: 4, minW: 3, minH: 3 },
  { i: "claude-code",x: 0, y: 33, w: 4, h: 5, minW: 3, minH: 4 },
  { i: "news",       x: 0, y: 38, w: 4, h: 4, minW: 3, minH: 3 },
  { i: "bookmarks",  x: 0, y: 42, w: 4, h: 4, minW: 3, minH: 3 },
  { i: "files",      x: 0, y: 46, w: 4, h: 4, minW: 3, minH: 3 },
  { i: "system-monitor", x: 0, y: 50, w: 4, h: 4, minW: 3, minH: 3 },
];

// ─── Responsive layout helper ────────────────────────────────────────────────

export interface ResponsiveLayoutSet {
  lg: Layout;
  md: Layout;
  sm: Layout;
}

// ─── Profile-aware getters ───────────────────────────────────────────────────

const profileDefaults: Record<ProfileId, {
  widgets: WidgetConfig[];
  layouts: Layout;
  responsiveLayouts: ResponsiveLayoutSet;
}> = {
  work: {
    widgets: workWidgets,
    layouts: workLayouts,
    responsiveLayouts: { lg: workLayouts, md: workLayoutsMd, sm: workLayoutsSm },
  },
  private: {
    widgets: privateWidgets,
    layouts: privateLayouts,
    responsiveLayouts: { lg: privateLayouts, md: privateLayoutsMd, sm: privateLayoutsSm },
  },
};

export function getDefaultWidgets(profile: ProfileId): WidgetConfig[] {
  return profileDefaults[profile].widgets;
}

export function getDefaultLayouts(profile: ProfileId): Layout {
  return profileDefaults[profile].layouts;
}

export function getDefaultResponsiveLayouts(profile: ProfileId): ResponsiveLayoutSet {
  return profileDefaults[profile].responsiveLayouts;
}

export function getDefaultDashboard(profile: ProfileId): DashboardState {
  return {
    widgets: getDefaultWidgets(profile),
    layouts: getDefaultLayouts(profile),
  };
}

/**
 * Derive md/sm layouts from a user-modified lg layout.
 * This is used when the user rearranges widgets on desktop —
 * we recalculate tablet/mobile layouts to maintain order.
 */
export function deriveResponsiveLayouts(lgLayout: Layout, _profile: ProfileId): ResponsiveLayoutSet {
  // For md: reflow into 2 columns of width 4 each (8 total)
  const sorted = [...lgLayout].sort((a, b) => a.y - b.y || a.x - b.x);
  const mdItems: LayoutItem[] = [];
  let mdX = 0;
  let mdY = 0;
  let mdRowMaxH = 0;

  for (const item of sorted) {
    const w = Math.min(item.w, 8); // clamp to max cols
    const effectiveW = w > 4 ? 8 : 4; // either half or full width

    if (mdX + effectiveW > 8) {
      mdX = 0;
      mdY += mdRowMaxH;
      mdRowMaxH = 0;
    }

    mdItems.push({ ...item, x: mdX, y: mdY, w: effectiveW });
    mdRowMaxH = Math.max(mdRowMaxH, item.h);
    mdX += effectiveW;
  }

  // For sm: stack everything full-width
  const smItems: LayoutItem[] = [];
  let smY = 0;
  for (const item of sorted) {
    smItems.push({ ...item, x: 0, y: smY, w: 4 });
    smY += item.h;
  }

  return {
    lg: lgLayout,
    md: mdItems as Layout,
    sm: smItems as Layout,
  };
}

// Legacy exports for backward compat (default to work)
export const defaultWidgets = workWidgets;
export const defaultLayouts = workLayouts;
export const defaultDashboard: DashboardState = {
  widgets: workWidgets,
  layouts: workLayouts,
};
