"use client";

import { cn } from "@/lib/utils";
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
import { useWorkspace } from "@/components/workspace-context";

const workspaceIcons: Record<string, React.ComponentType<{ className?: string }>> = {
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

export function MobileBottomNav() {
  const {
    workspaces,
    activeWorkspace,
    setActiveWorkspace,
    activeFocusId,
    exitFocusMode,
  } = useWorkspace();

  // Show up to 5 workspaces in the bottom nav (the built-in ones)
  const navWorkspaces = workspaces.filter((ws) => ws.builtIn).slice(0, 5);

  return (
    <nav
      aria-label="Workspaces"
      className="fixed bottom-0 left-0 right-0 z-50 md:hidden border-t border-border/50 bg-background/95 backdrop-blur-xl safe-area-bottom"
    >
      <div className="flex items-stretch justify-around h-14 px-2">
        {navWorkspaces.map((ws) => {
          const Icon = workspaceIcons[ws.icon] || LayoutDashboard;
          const isActive = ws.id === activeWorkspace.id && !activeFocusId;
          return (
            <button
              key={ws.id}
              onClick={() => {
                if (activeFocusId) exitFocusMode();
                setActiveWorkspace(ws.id);
              }}
              // The nav is the primary way to move between workspaces on a
              // phone; `aria-current` is what tells a screen reader which one
              // is showing, since the only other signal is colour.
              aria-current={isActive ? "page" : undefined}
              className={cn(
                // items-stretch on the row + h-full here makes the whole 56px
                // strip tappable. Previously the button was only as tall as its
                // icon and label (~40px), leaving a dead band above and below.
                "flex h-full flex-col items-center justify-center gap-1 flex-1 min-w-0 py-1.5 rounded-lg transition-colors",
                isActive
                  ? "text-primary"
                  : "text-muted-foreground active:text-foreground"
              )}
            >
              <Icon className={cn("h-5 w-5 shrink-0 transition-transform", isActive && "scale-110")} />
              <span className="text-[0.625rem] font-medium leading-none truncate max-w-full px-0.5">
                {ws.name}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
