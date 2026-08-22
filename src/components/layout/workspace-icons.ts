import {
  LayoutDashboard,
  Code,
  Mail,
  StickyNote,
  Monitor,
  Sunrise,
  Inbox,
  Activity,
  Layers,
  Focus,
  Bookmark,
  ListTodo,
  Calendar,
  TerminalSquare,
  GitPullRequest,
  Home,
  Briefcase,
} from "lucide-react";

/**
 * Workspace icon-name → component. Shared by the sidebar, the mobile bottom
 * nav and the nav customiser, which each used to keep their own copy and had
 * already drifted apart on which names they knew about.
 */
export const workspaceIcons: Record<
  string,
  React.ComponentType<{ className?: string }>
> = {
  monitor: Monitor,
  "layout-dashboard": LayoutDashboard,
  code: Code,
  mail: Mail,
  "sticky-note": StickyNote,
  sunrise: Sunrise,
  inbox: Inbox,
  activity: Activity,
  layers: Layers,
  focus: Focus,
  bookmark: Bookmark,
  "list-todo": ListTodo,
  calendar: Calendar,
  "terminal-square": TerminalSquare,
  "git-pull-request": GitPullRequest,
  home: Home,
  briefcase: Briefcase,
};

/** Fallback for a workspace whose saved icon name isn't in the registry. */
export const defaultWorkspaceIcon = LayoutDashboard;
