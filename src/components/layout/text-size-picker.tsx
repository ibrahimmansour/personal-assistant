"use client";

import { useAppearance, fontSizes } from "@/components/appearance-context";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ALargeSmall, Check, AArrowDown, AArrowUp } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Text-size control, in the header at every breakpoint.
 *
 * This is the app's replacement for pinch/page zoom, which is disabled — so it
 * has to be reachable from anywhere, not buried in the appearance picker (which
 * is `hidden md:inline-flex`, i.e. absent on exactly the devices that used to
 * pinch). The same five steps are also in the appearance picker and the command
 * palette; all three write the one `fontSize` value in AppearanceContext.
 *
 * The per-row preview glyph is sized with static `text-*` utilities rather than
 * a computed style: the classes happen to line up with the five steps, and an
 * inline style would be the only one in the codebase.
 */

const previewClass = ["text-xs", "text-sm", "text-base", "text-lg", "text-xl"];

export function TextSizePicker() {
  const { appearance, setFontSize, increaseFontSize, decreaseFontSize } =
    useAppearance();

  const currentIdx = fontSizes.findIndex((s) => s.id === appearance.fontSize);
  const atMin = currentIdx <= 0;
  const atMax = currentIdx >= fontSizes.length - 1;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="inline-flex items-center justify-center h-10 w-10 md:h-8 md:w-8 p-0 rounded-md text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground active:bg-accent focus-visible:outline-none"
        title="Text size"
        aria-label="Text size"
      >
        <ALargeSmall className="h-4 w-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56 p-3">
        <div className="mb-2">
          <h3 className="text-sm font-semibold">Text Size</h3>
          <p className="text-xs text-muted-foreground">
            Scales text only — layout stays put
          </p>
        </div>

        {/* Step down / current / step up */}
        <div className="flex items-center gap-2 mb-2">
          <button
            onClick={decreaseFontSize}
            disabled={atMin}
            className={cn(
              "flex items-center justify-center h-11 w-11 md:h-8 md:w-8 rounded-md border transition-colors",
              atMin
                ? "border-border/50 text-muted-foreground/30 cursor-not-allowed"
                : "border-border text-foreground hover:bg-muted active:bg-muted"
            )}
            aria-label="Decrease text size"
          >
            <AArrowDown className="h-4 w-4" />
          </button>
          <span className="flex-1 text-center text-sm font-medium">
            {fontSizes[currentIdx]?.label ?? "Default"}
          </span>
          <button
            onClick={increaseFontSize}
            disabled={atMax}
            className={cn(
              "flex items-center justify-center h-11 w-11 md:h-8 md:w-8 rounded-md border transition-colors",
              atMax
                ? "border-border/50 text-muted-foreground/30 cursor-not-allowed"
                : "border-border text-foreground hover:bg-muted active:bg-muted"
            )}
            aria-label="Increase text size"
          >
            <AArrowUp className="h-4 w-4" />
          </button>
        </div>

        {/* The five steps */}
        <div className="space-y-1">
          {fontSizes.map((size, idx) => {
            const isActive = size.id === appearance.fontSize;
            return (
              <button
                key={size.id}
                onClick={() => setFontSize(size.id)}
                className={cn(
                  "w-full flex items-center gap-2.5 min-h-11 md:min-h-9 px-2.5 py-1.5 rounded-md text-sm transition-colors border text-left",
                  isActive
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-transparent hover:bg-muted active:bg-muted text-muted-foreground hover:text-foreground"
                )}
                aria-pressed={isActive}
              >
                <span
                  className={cn(
                    "w-7 shrink-0 text-center leading-none",
                    previewClass[idx]
                  )}
                  aria-hidden
                >
                  Aa
                </span>
                <span className="flex-1">{size.label}</span>
                {isActive && <Check className="h-4 w-4 shrink-0 text-primary" />}
              </button>
            );
          })}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
