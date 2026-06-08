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
import { useSwipe } from "@/hooks/use-swipe";
import { useCallback } from "react";

function MainContent() {
  const {
    activeFocusId,
    activeWorkspace,
    workspaces,
    setActiveWorkspace,
    exitFocusMode,
  } = useWorkspace();
  useKeepAlive();

  // ─── Mobile gesture: horizontal swipe across <main> cycles workspaces ───
  // Restricted to built-in workspaces so the navigation order matches the
  // bottom nav. Edge zones (40px each side) are excluded so we don't conflict
  // with sidebar/AI panel edge-swipes.
  const cycleWorkspace = useCallback(
    (direction: 1 | -1) => {
      const builtIns = workspaces.filter((ws) => ws.builtIn);
      if (builtIns.length === 0) return;
      const currentIdx = builtIns.findIndex((ws) => ws.id === activeWorkspace.id);
      const nextIdx =
        currentIdx < 0
          ? 0
          : (currentIdx + direction + builtIns.length) % builtIns.length;
      if (activeFocusId) exitFocusMode();
      setActiveWorkspace(builtIns[nextIdx].id);
    },
    [workspaces, activeWorkspace.id, activeFocusId, exitFocusMode, setActiveWorkspace]
  );

  const mainSwipeRef = useSwipe<HTMLElement>({
    axis: "horizontal",
    threshold: 80,
    velocityThreshold: 0.5,
    edgeExclusion: 40, // leave edges for sidebar/AI-panel gestures
    ignoreOnScrollers: true,
    onSwipeLeft: () => cycleWorkspace(1),
    onSwipeRight: () => cycleWorkspace(-1),
  });

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
        <main
          ref={mainSwipeRef}
          className="flex-1 overflow-hidden pb-14 md:pb-0"
        >
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
