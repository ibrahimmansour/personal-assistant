"use client";

import { Header } from "@/components/layout/header";
import { DashboardGrid } from "@/components/layout/dashboard-grid";
import { Sidebar } from "@/components/layout/sidebar";
import { MobileBottomNav } from "@/components/layout/mobile-bottom-nav";
import { FocusMode } from "@/components/focus-mode";
import { TodayView } from "@/components/views/today-view";
import { InboxView } from "@/components/views/inbox-view";
import { TimelineView } from "@/components/views/timeline-view";
import { StatusBoardView } from "@/components/views/status-board-view";
import { DashboardProvider } from "@/components/dashboard-context";
import { WorkspaceProvider, useWorkspace } from "@/components/workspace-context";
import { WidgetNavProvider } from "@/components/widget-nav-context";
import { TerminalProvider } from "@/components/terminal-context";
import { CommandPaletteProvider } from "@/components/command-palette-context";
import { CommandPalette } from "@/components/command-palette";
import { AIChatProvider } from "@/components/ai-chat-context";
import { AIChatPanel } from "@/components/ai-chat-panel";
import { useKeepAlive } from "@/hooks/use-keep-alive";

function MainContent() {
  const { activeFocusId, activeWorkspace } = useWorkspace();
  useKeepAlive();

  let content: React.ReactNode;
  if (activeFocusId) {
    content = <FocusMode />;
  } else if (activeWorkspace.viewType === "status-board") {
    content = <StatusBoardView />;
  } else if (activeWorkspace.viewType === "today") {
    content = <TodayView />;
  } else if (activeWorkspace.viewType === "inbox") {
    content = <InboxView />;
  } else if (activeWorkspace.viewType === "timeline") {
    content = <TimelineView />;
  } else {
    content = <DashboardGrid />;
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <Header />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-hidden pb-14 md:pb-0">
          {content}
        </main>
      </div>
      <MobileBottomNav />
    </div>
  );
}

export default function Home() {
  return (
    <DashboardProvider>
      <WorkspaceProvider>
        <WidgetNavProvider>
          <TerminalProvider>
            <CommandPaletteProvider>
              <AIChatProvider>
                <MainContent />
                <CommandPalette />
                <AIChatPanel />
              </AIChatProvider>
            </CommandPaletteProvider>
          </TerminalProvider>
        </WidgetNavProvider>
      </WorkspaceProvider>
    </DashboardProvider>
  );
}
