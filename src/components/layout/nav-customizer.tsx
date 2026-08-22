"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { ArrowDown, ArrowUp, Check, X } from "lucide-react";
import { useWorkspace, NAV_SLOTS } from "@/components/workspace-context";
import { workspaceIcons, defaultWorkspaceIcon } from "@/components/layout/workspace-icons";
import { useBackHandler } from "@/hooks/use-back-handler";

/**
 * Window event that opens the customiser. The trigger lives in several places
 * (long-press on the nav, a button on the mobile launcher, a sidebar row), and
 * none of them own this component — same idiom as `widget-reorder-mode`.
 */
export const NAV_CUSTOMIZER_EVENT = "open-nav-customizer";

export function openNavCustomizer() {
  window.dispatchEvent(new CustomEvent(NAV_CUSTOMIZER_EVENT));
}

/**
 * Full-screen sheet for choosing which workspaces sit in the mobile bottom nav
 * and in what order. Editing is on a draft list so a half-finished arrangement
 * doesn't reshuffle the live nav under the user's thumb.
 */
export function NavCustomizer() {
  const { workspaces, navWorkspaceIds, setNavWorkspaceIds } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string[]>(navWorkspaceIds);

  useEffect(() => {
    const handler = () => {
      setDraft(navWorkspaceIds.filter((id) => workspaces.some((ws) => ws.id === id)));
      setOpen(true);
    };
    window.addEventListener(NAV_CUSTOMIZER_EVENT, handler);
    return () => window.removeEventListener(NAV_CUSTOMIZER_EVENT, handler);
  }, [navWorkspaceIds, workspaces]);

  const close = useCallback(() => setOpen(false), []);

  useBackHandler(open, close);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, close]);

  const toggle = useCallback((id: string) => {
    setDraft((prev) =>
      prev.includes(id)
        ? prev.filter((x) => x !== id)
        : prev.length >= NAV_SLOTS
          ? prev
          : [...prev, id]
    );
  }, []);

  const move = useCallback((id: string, direction: "up" | "down") => {
    setDraft((prev) => {
      const idx = prev.indexOf(id);
      const target = direction === "up" ? idx - 1 : idx + 1;
      if (idx < 0 || target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  }, []);

  const save = useCallback(() => {
    // An empty nav would leave a phone with no way to switch workspaces at
    // all, so the last tab can be reordered but not removed.
    if (draft.length > 0) setNavWorkspaceIds(draft);
    setOpen(false);
  }, [draft, setNavWorkspaceIds]);

  if (!open || typeof document === "undefined") return null;

  const selected = draft
    .map((id) => workspaces.find((ws) => ws.id === id))
    .filter((ws): ws is NonNullable<typeof ws> => !!ws);
  const unselected = workspaces.filter((ws) => !draft.includes(ws.id));

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Customize bottom navigation"
      className="fixed inset-0 z-[70] bg-background flex flex-col"
    >
      <div className="shrink-0 flex items-center gap-2 px-3 pb-2 pt-app-top border-b border-border/50">
        <button
          onClick={close}
          aria-label="Cancel"
          className="inline-flex items-center justify-center h-11 w-11 md:h-8 md:w-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted"
        >
          <X className="h-4 w-4" />
        </button>
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-semibold truncate">Bottom Nav</h2>
          <p className="text-xs text-muted-foreground truncate">
            {draft.length} of {NAV_SLOTS} slots used
          </p>
        </div>
        <button
          onClick={save}
          disabled={draft.length === 0}
          className="inline-flex items-center gap-1.5 min-h-11 md:min-h-8 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium active:opacity-80 disabled:opacity-40"
        >
          <Check className="h-4 w-4" /> Done
        </button>
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain px-3 py-3 safe-area-bottom">
        <SectionLabel>In the nav bar</SectionLabel>
        <div className="space-y-1.5 mb-5">
          {selected.map((ws, idx) => {
            const Icon = workspaceIcons[ws.icon] || defaultWorkspaceIcon;
            return (
              <div key={ws.id} className="flex items-center gap-1.5">
                <button
                  onClick={() => toggle(ws.id)}
                  disabled={selected.length === 1}
                  aria-label={`Remove ${ws.name} from the nav bar`}
                  className={cn(
                    "flex flex-1 min-w-0 items-center gap-2.5 min-h-11 px-3 rounded-lg border border-primary/40 bg-primary/5 text-left",
                    "active:bg-primary/10 disabled:opacity-60"
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0 text-primary" />
                  <span className="text-sm font-medium truncate flex-1">{ws.name}</span>
                  <span className="text-[0.625rem] text-muted-foreground shrink-0">
                    {idx + 1}
                  </span>
                </button>
                {/* Siblings, not children: a button inside a button is invalid. */}
                <button
                  onClick={() => move(ws.id, "up")}
                  disabled={idx === 0}
                  aria-label={`Move ${ws.name} left`}
                  className="inline-flex items-center justify-center h-11 w-11 md:h-8 md:w-8 rounded-md border border-border/50 text-muted-foreground active:bg-muted disabled:opacity-30"
                >
                  <ArrowUp className="h-4 w-4" />
                </button>
                <button
                  onClick={() => move(ws.id, "down")}
                  disabled={idx === selected.length - 1}
                  aria-label={`Move ${ws.name} right`}
                  className="inline-flex items-center justify-center h-11 w-11 md:h-8 md:w-8 rounded-md border border-border/50 text-muted-foreground active:bg-muted disabled:opacity-30"
                >
                  <ArrowDown className="h-4 w-4" />
                </button>
              </div>
            );
          })}
        </div>

        {unselected.length > 0 && (
          <>
            <SectionLabel>Available</SectionLabel>
            <div className="space-y-1.5">
              {unselected.map((ws) => {
                const Icon = workspaceIcons[ws.icon] || defaultWorkspaceIcon;
                const full = draft.length >= NAV_SLOTS;
                return (
                  <button
                    key={ws.id}
                    onClick={() => toggle(ws.id)}
                    disabled={full}
                    aria-label={`Add ${ws.name} to the nav bar`}
                    className="flex w-full min-w-0 items-center gap-2.5 min-h-11 px-3 rounded-lg border border-border/50 text-left active:bg-muted disabled:opacity-40"
                  >
                    <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="text-sm truncate flex-1">{ws.name}</span>
                  </button>
                );
              })}
            </div>
            {draft.length >= NAV_SLOTS && (
              <p className="text-xs text-muted-foreground mt-2 px-1">
                Remove one first — the bar holds {NAV_SLOTS}.
              </p>
            )}
          </>
        )}
      </div>
    </div>,
    document.body
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-2 px-1">
      <span className="text-[0.6875rem] font-medium uppercase tracking-wider text-muted-foreground/60">
        {children}
      </span>
      <div className="flex-1 h-px bg-border/40" />
    </div>
  );
}
