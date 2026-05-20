"use client";

import { useDashboard } from "@/components/dashboard-context";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Settings, RotateCcw, LayoutGrid, Lock, LockOpen } from "lucide-react";
import {
  ListTodo,
  Mail,
  Bell,
  Calendar,
  CloudSun,
  GitPullRequest,
  Clock,
  TicketCheck,
  StickyNote,
  TerminalSquare,
  Bookmark,
  FolderOpen,
} from "lucide-react";

const widgetIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  clock: Clock,
  tasks: ListTodo,
  email: Mail,
  reminders: Bell,
  calendar: Calendar,
  weather: CloudSun,
  "github-prs": GitPullRequest,
  jira: TicketCheck,
  notes: StickyNote,
  terminal: TerminalSquare,
  bookmarks: Bookmark,
  files: FolderOpen,
};

export function WidgetSettings() {
  const { widgets, toggleWidget, resetLayout, autoArrange, layoutLocked, toggleLayoutLock } = useDashboard();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="inline-flex items-center justify-center h-8 w-8 p-0 rounded-md text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none" title="Widgets">
        <LayoutGrid className="h-4 w-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64 p-3">
        <div className="mb-2">
          <h3 className="text-sm font-semibold">Widgets</h3>
          <p className="text-xs text-muted-foreground">Toggle widgets on/off</p>
        </div>
        <Separator className="my-2" />
        <div className="space-y-2">
          {widgets.map((widget) => {
            const Icon = widgetIcons[widget.type] || Settings;
            return (
              <div
                key={widget.id}
                className="flex items-center justify-between py-1"
              >
                <div className="flex items-center gap-2">
                  <Icon className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">{widget.title}</span>
                </div>
                <Switch
                  checked={widget.visible}
                  onCheckedChange={() => toggleWidget(widget.id)}
                />
              </div>
            );
          })}
        </div>
        <Separator className="my-2" />
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start text-xs"
          onClick={toggleLayoutLock}
        >
          {layoutLocked
            ? <><Lock className="h-3 w-3 mr-2" />Unlock layout</>
            : <><LockOpen className="h-3 w-3 mr-2" />Lock layout</>
          }
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start text-xs"
          onClick={autoArrange}
          disabled={layoutLocked}
        >
          <LayoutGrid className="h-3 w-3 mr-2" />
          Auto-arrange widgets
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start text-xs"
          onClick={resetLayout}
        >
          <RotateCcw className="h-3 w-3 mr-2" />
          Reset to default layout
        </Button>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
