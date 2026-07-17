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
    <nav className="fixed bottom-0 left-0 right-0 z-50 md:hidden border-t border-border/50 bg-background/95 backdrop-blur-xl safe-area-bottom">
      <div className="flex items-center justify-around h-14 px-2">
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
              className={cn(
                "flex flex-col items-center justify-center gap-0.5 flex-1 py-1.5 rounded-lg transition-colors",
                isActive
                  ? "text-primary"
                  : "text-muted-foreground active:text-foreground"
              )}
            >
              <Icon className={cn("h-5 w-5", isActive && "scale-110")} />
              <span className="text-[9px] font-medium leading-none truncate max-w-[56px]">
                {ws.name}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
