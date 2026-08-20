"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { WidgetConfig, WidgetType } from "@/types/widget";
import { useWidgetNav } from "@/components/widget-nav-context";
import { useCommandPalette } from "@/components/command-palette-context";
import { useDashboard } from "@/components/dashboard-context";
import { useProfile } from "@/components/profile-context";
import { useLongPress } from "@/hooks/use-swipe";
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
  Check,
} from "lucide-react";

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
      {reorderMode && (
        <div className="flex items-center justify-between mb-3 px-1">
          <span className="text-xs text-muted-foreground">Tap arrows to reorder</span>
          <button
            onClick={() =>
              window.dispatchEvent(new CustomEvent("widget-reorder-mode", { detail: { active: false } }))
            }
            className="flex items-center gap-1 text-xs font-medium text-primary p-1 -m-1"
          >
            <Check className="h-3.5 w-3.5" /> Done
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
      <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/60">{label}</span>
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

  const arrows = reorderMode && allowReorder ? (
    <div className={cn("flex items-center gap-1", compact ? "" : "absolute -top-2 -right-2 flex-col")}>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onMove("up");
        }}
        className="h-6 w-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow"
        aria-label={`Move ${widget.title} up`}
      >
        <ArrowUp className="h-3 w-3" />
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onMove("down");
        }}
        className="h-6 w-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow"
        aria-label={`Move ${widget.title} down`}
      >
        <ArrowDown className="h-3 w-3" />
      </button>
    </div>
  ) : null;

  return (
    <div
      ref={longPressRef}
      role="button"
      tabIndex={0}
      onClick={() => {
        if (!reorderMode) onOpen();
      }}
      onKeyDown={(e) => {
        if (!reorderMode && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onOpen();
        }
      }}
      className={cn(
        "select-none active:scale-95 transition-transform cursor-pointer",
        compact
          ? "relative flex items-center gap-2 shrink-0 rounded-full border border-border bg-muted/50 pl-2.5 pr-3.5 h-10"
          : "relative flex flex-col items-center gap-1.5 rounded-xl border border-border/50 bg-muted/40 p-3",
        reorderMode && allowReorder && "ring-2 ring-primary/40 animate-wiggle"
      )}
    >
      {compact ? (
        <>
          <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="text-sm font-medium truncate max-w-[120px]">{widget.title}</span>
        </>
      ) : (
        <>
          <div className="h-10 w-10 rounded-lg bg-background flex items-center justify-center">
            <Icon className="h-5 w-5 text-foreground" />
          </div>
          <span className="text-xs font-medium text-center leading-tight line-clamp-2">{widget.title}</span>
        </>
      )}
      {arrows}
    </div>
  );
}
