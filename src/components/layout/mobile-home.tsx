"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { WidgetConfig, WidgetType } from "@/types/widget";
import { useWidgetNav } from "@/components/widget-nav-context";
import { useCommandPalette } from "@/components/command-palette-context";
import { useDashboard } from "@/components/dashboard-context";
import { useProfile } from "@/components/profile-context";
import { useLongPress } from "@/hooks/use-swipe";
import { openNavCustomizer } from "@/components/layout/nav-customizer";
import { widgetSections, sectionMeta, type WidgetSection } from "@/lib/dashboard-config";
import { cn } from "@/lib/utils";
import {
  Clock,
  CloudSun,
  Bell,
  Calendar,
  ListTodo,
  Mail,
  GitPullRequest,
  TicketCheck,
  StickyNote,
  TerminalSquare,
  Bookmark,
  FolderOpen,
  Bot,
  Activity,
  Newspaper,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  LayoutPanelTop,
  Check,
} from "lucide-react";

/** Reorder mode is global state broadcast on the window, so every mounted
 *  WidgetWrapper and the launcher stay in step. */
function setReorderModeGlobal(active: boolean) {
  window.dispatchEvent(new CustomEvent("widget-reorder-mode", { detail: { active } }));
}

const widgetIcons: Record<WidgetType, React.ComponentType<{ className?: string }>> = {
  clock: Clock,
  weather: CloudSun,
  reminders: Bell,
  calendar: Calendar,
  tasks: ListTodo,
  email: Mail,
  "github-prs": GitPullRequest,
  jira: TicketCheck,
  notes: StickyNote,
  terminal: TerminalSquare,
  bookmarks: Bookmark,
  files: FolderOpen,
  "claude-code": Bot,
  "system-monitor": Activity,
  news: Newspaper,
};

const RECENTS_LIMIT = 6;
const sectionOrder = (Object.keys(sectionMeta) as WidgetSection[]).sort(
  (a, b) => sectionMeta[a].order - sectionMeta[b].order
);

interface MobileHomeProps {
  visibleWidgets: WidgetConfig[];
  widgetComponents: Record<WidgetType, React.ComponentType>;
}

/**
 * Mobile default page: an icon launcher grouped by section instead of the
 * old flex stack of every widget rendered inline. Tapping a tile opens that
 * widget through the existing navigateTo()/WidgetWrapper expand machinery —
 * only the tapped widget ever mounts, everything else stays an icon.
 */
export function MobileHome({ visibleWidgets, widgetComponents }: MobileHomeProps) {
  const { navigateTo } = useWidgetNav();
  const { expandedWidget } = useCommandPalette();
  const { moveWidget } = useDashboard();
  const { activeProfile } = useProfile();

  const [openType, setOpenType] = useState<WidgetType | null>(null);
  const [recents, setRecents] = useState<WidgetType[]>([]);
  const [reorderMode, setReorderMode] = useState(false);
  // Tracks whether `openType` was actually confirmed live (WidgetWrapper
  // reported it expanded) so we don't unmount it during the brief window
  // between tapping a tile and the freshly-mounted widget registering itself.
  const openConfirmedRef = useRef<WidgetType | null>(null);

  const recentsKey = `mobile-recents-${activeProfile}`;

  useEffect(() => {
    try {
      const raw = localStorage.getItem(recentsKey);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRecents(raw ? (JSON.parse(raw) as WidgetType[]) : []);
    } catch {
      setRecents([]);
    }
  }, [recentsKey]);

  useEffect(() => {
    if (openType && expandedWidget === openType) {
      openConfirmedRef.current = openType;
    } else if (openType && openConfirmedRef.current === openType && expandedWidget === null) {
      openConfirmedRef.current = null;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOpenType(null);
    }
  }, [expandedWidget, openType]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ active: boolean }>).detail;
      setReorderMode(detail?.active ?? false);
    };
    window.addEventListener("widget-reorder-mode", handler);
    return () => window.removeEventListener("widget-reorder-mode", handler);
  }, []);

  const openWidget = useCallback(
    (type: WidgetType) => {
      setOpenType(type);
      navigateTo(type);
      setRecents((prev) => {
        const next = [type, ...prev.filter((t) => t !== type)].slice(0, RECENTS_LIMIT);
        try {
          localStorage.setItem(recentsKey, JSON.stringify(next));
        } catch {}
        return next;
      });
    },
    [navigateTo, recentsKey]
  );

  const byId = useMemo(() => new Map(visibleWidgets.map((w) => [w.id, w])), [visibleWidgets]);
  const recentWidgets = recents
    .map((id) => byId.get(id))
    .filter((w): w is WidgetConfig => !!w);

  const OpenComponent = openType ? widgetComponents[openType] : null;

  return (
    <div className="h-full overflow-y-auto overscroll-contain p-3">
      {/* Announces the mode flip. Entering reorder mode is otherwise signalled
          only by the tiles starting to wiggle. */}
      <p aria-live="polite" className="sr-only">
        {reorderMode ? "Reorder mode on. Use the arrows on each widget to move it." : ""}
      </p>

      {reorderMode && (
        <div className="flex items-center justify-between gap-2 mb-3 px-1">
          <span className="text-xs text-muted-foreground">Tap arrows to reorder</span>
          <button
            onClick={() => setReorderModeGlobal(false)}
            className="inline-flex items-center gap-1 min-h-11 px-3 -mr-2 rounded-md text-sm font-medium text-primary active:bg-primary/10"
          >
            <Check className="h-4 w-4" /> Done
          </button>
        </div>
      )}

      {recentWidgets.length > 0 && !reorderMode && (
        <div className="mb-4">
          <SectionHeader label="Recent" />
          <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
            {recentWidgets.map((widget) => (
              <WidgetTile
                key={`recent-${widget.id}`}
                widget={widget}
                Icon={widgetIcons[widget.type]}
                reorderMode={false}
                allowReorder={false}
                onOpen={() => openWidget(widget.type)}
                onMove={() => {}}
                compact
              />
            ))}
          </div>
        </div>
      )}

      {sectionOrder.map((section) => {
        const items = visibleWidgets.filter((w) => widgetSections[w.type] === section);
        if (items.length === 0) return null;
        const isGlance = section === "glance";
        return (
          <div key={section} className="mb-5">
            <SectionHeader label={sectionMeta[section].label} />
            <div className={isGlance ? "flex flex-wrap gap-2" : "grid grid-cols-3 gap-3"}>
              {items.map((widget) => (
                <WidgetTile
                  key={widget.id}
                  widget={widget}
                  Icon={widgetIcons[widget.type]}
                  reorderMode={reorderMode}
                  allowReorder
                  onOpen={() => openWidget(widget.type)}
                  onMove={(direction) => moveWidget(widget.id, direction)}
                  compact={isGlance}
                />
              ))}
            </div>
          </div>
        );
      })}

      {visibleWidgets.length === 0 && (
        <div className="flex items-center justify-center h-64 text-muted-foreground">
          <p className="text-sm">No widgets in this workspace.</p>
        </div>
      )}

      {/* Long-press is a pointer gesture with no keyboard equivalent, so both
          reorder mode and the nav customiser need a plain control too. */}
      {!reorderMode && (
        <div className="flex flex-wrap justify-center gap-2 pt-1 pb-4">
          {visibleWidgets.length > 0 && (
            <button
              onClick={() => setReorderModeGlobal(true)}
              className="inline-flex items-center gap-1.5 min-h-11 px-4 rounded-full border border-border/50 text-xs font-medium text-muted-foreground active:bg-muted"
            >
              <ArrowUpDown className="h-3.5 w-3.5" /> Reorder Widgets
            </button>
          )}
          <button
            onClick={openNavCustomizer}
            className="inline-flex items-center gap-1.5 min-h-11 px-4 rounded-full border border-border/50 text-xs font-medium text-muted-foreground active:bg-muted"
          >
            <LayoutPanelTop className="h-3.5 w-3.5" /> Customize Nav Bar
          </button>
        </div>
      )}

      {/* Mounted off-screen: WidgetWrapper portals its expanded overlay to
          document.body regardless of this container's display, so hiding it
          here doesn't hide the fullscreen view. */}
      {openType && OpenComponent && (
        <div className="hidden">
          <OpenComponent />
        </div>
      )}
    </div>
  );
}

function SectionHeader({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 mb-2 px-1">
      <span className="text-[0.6875rem] font-medium uppercase tracking-wider text-muted-foreground/60">{label}</span>
      <div className="flex-1 h-px bg-border/40" />
    </div>
  );
}

interface WidgetTileProps {
  widget: WidgetConfig;
  Icon: React.ComponentType<{ className?: string }>;
  reorderMode: boolean;
  allowReorder: boolean;
  onOpen: () => void;
  onMove: (direction: "up" | "down") => void;
  compact?: boolean;
}

function WidgetTile({ widget, Icon, reorderMode, allowReorder, onOpen, onMove, compact }: WidgetTileProps) {
  const longPressRef = useLongPress<HTMLDivElement>({
    disabled: reorderMode || !allowReorder,
    ms: 500,
    onLongPress: () => {
      window.dispatchEvent(new CustomEvent("widget-reorder-mode", { detail: { active: true } }));
    },
  });

  const showArrows = reorderMode && allowReorder;

  const arrows = showArrows ? (
    <div
      className={cn(
        "flex items-center gap-1",
        // Grid tiles get a vertical pair clipped to the top-right corner; the
        // pill-shaped Glance tiles are only 44px tall, so a stacked pair would
        // overflow them — those sit alongside instead.
        compact ? "shrink-0" : "absolute -top-2 -right-2 flex-col"
      )}
    >
      <button
        onClick={(e) => {
          e.stopPropagation();
          onMove("up");
        }}
        className="h-8 w-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow"
        aria-label={`Move ${widget.title} up`}
      >
        <ArrowUp className="h-4 w-4" />
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onMove("down");
        }}
        className="h-8 w-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow"
        aria-label={`Move ${widget.title} down`}
      >
        <ArrowDown className="h-4 w-4" />
      </button>
    </div>
  ) : null;

  return (
    // The tile itself is a real <button>. The reorder arrows are siblings
    // rather than children because a <button> inside a <button> is invalid and
    // browsers drop the inner one — which is what forced the old
    // `div role="button"` and cost the tile its native semantics and its
    // Enter/Space handling.
    <div
      ref={longPressRef}
      className={cn("relative", compact && "flex items-center gap-1 shrink-0")}
    >
      <button
        type="button"
        onClick={() => {
          if (!reorderMode) onOpen();
        }}
        // While reordering, the tile is a drag handle, not a launcher — say so
        // rather than leaving a button that silently does nothing on tap.
        disabled={showArrows}
        aria-label={`Open ${widget.title}`}
        className={cn(
          "select-none active:scale-95 transition-transform disabled:opacity-100",
          compact
            ? "flex items-center gap-2 min-w-0 rounded-full border border-border bg-muted/50 pl-3 pr-4 h-11"
            : "w-full flex flex-col items-center justify-center gap-1.5 rounded-xl border border-border/50 bg-muted/40 p-3 min-h-[5.5rem]",
          showArrows && "ring-2 ring-primary/40 animate-wiggle"
        )}
      >
        {compact ? (
          <>
            <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="text-sm font-medium truncate max-w-[120px]">{widget.title}</span>
          </>
        ) : (
          <>
            <div className="h-10 w-10 rounded-lg bg-background flex items-center justify-center shrink-0">
              <Icon className="h-5 w-5 text-foreground" />
            </div>
            <span className="text-xs font-medium text-center leading-tight line-clamp-2">{widget.title}</span>
          </>
        )}
      </button>
      {arrows}
    </div>
  );
}
