"use client";

import { cn } from "@/lib/utils";
import { useWorkspace } from "@/components/workspace-context";
import { workspaceIcons, defaultWorkspaceIcon } from "@/components/layout/workspace-icons";
import { NavCustomizer, openNavCustomizer } from "@/components/layout/nav-customizer";
import { useLongPress } from "@/hooks/use-swipe";
import { useRef } from "react";

export function MobileBottomNav() {
  const {
    workspaces,
    navWorkspaceIds,
    activeWorkspace,
    setActiveWorkspace,
    activeFocusId,
    exitFocusMode,
  } = useWorkspace();

  // The nav is user-chosen (see NavCustomizer); resolve the saved IDs against
  // the live workspace list so a stale entry drops out rather than rendering a
  // tab that switches to nothing.
  const navWorkspaces = navWorkspaceIds
    .map((id) => workspaces.find((ws) => ws.id === id))
    .filter((ws): ws is NonNullable<typeof ws> => !!ws);

  // Long-press anywhere on the strip to edit it. The launcher and the sidebar
  // both carry a plain button for the same thing, since a pointer gesture is
  // never the only path to a feature.
  // The long-press fires on hold, but the finger lifting still produces a
  // click on whichever tab it was over — which would switch workspace behind
  // the sheet. Swallow that one click.
  const longPressAt = useRef(0);
  const longPressRef = useLongPress<HTMLElement>({
    ms: 500,
    onLongPress: () => {
      longPressAt.current = Date.now();
      openNavCustomizer();
    },
  });

  return (
    <>
      <nav
        ref={longPressRef}
        aria-label="Workspaces"
        className="fixed bottom-0 left-0 right-0 z-50 md:hidden border-t border-border/50 bg-background/95 backdrop-blur-xl safe-area-bottom"
      >
        <div className="flex items-stretch justify-around h-14 px-2">
          {navWorkspaces.map((ws) => {
            const Icon = workspaceIcons[ws.icon] || defaultWorkspaceIcon;
            const isActive = ws.id === activeWorkspace.id && !activeFocusId;
            return (
              <button
                key={ws.id}
                onClick={() => {
                  if (Date.now() - longPressAt.current < 700) return;
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
      <NavCustomizer />
    </>
  );
}
