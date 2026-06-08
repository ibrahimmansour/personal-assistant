"use client";

import {
  useAppearance,
  colorThemes,
  fontFamilies,
  fontSizes,
  densityOptions,
} from "@/components/appearance-context";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { Paintbrush, Check, Minus, Plus, LayoutGrid } from "lucide-react";
import { cn } from "@/lib/utils";

export function AppearancePicker() {
  const { appearance, setColorTheme, setFontFamily, setFontSize, setDensity, increaseFontSize, decreaseFontSize } = useAppearance();

  const currentSizeIdx = fontSizes.findIndex((s) => s.id === appearance.fontSize);
  const currentSizeLabel = fontSizes[currentSizeIdx]?.label ?? "Default";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="inline-flex items-center justify-center h-8 w-8 p-0 rounded-md text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none">
        <Paintbrush className="h-4 w-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64 p-3">
        {/* Color themes */}
        <div className="mb-2">
          <h3 className="text-sm font-semibold">Color Theme</h3>
          <p className="text-xs text-muted-foreground">Choose your accent color</p>
        </div>
        <div className="grid grid-cols-3 gap-2 mb-1">
          {colorThemes.map((theme) => (
            <button
              key={theme.id}
              onClick={() => setColorTheme(theme.id)}
              className={cn(
                "flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs transition-colors border",
                appearance.colorTheme === theme.id
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-transparent hover:bg-muted text-muted-foreground hover:text-foreground"
              )}
            >
              <span
                className="h-3 w-3 rounded-full shrink-0 ring-1 ring-black/10"
                style={{ backgroundColor: theme.preview }}
              />
              <span className="truncate">{theme.label}</span>
              {appearance.colorTheme === theme.id && (
                <Check className="h-3 w-3 ml-auto shrink-0 text-primary" />
              )}
            </button>
          ))}
        </div>

        <Separator className="my-3" />

        {/* Font families */}
        <div className="mb-2">
          <h3 className="text-sm font-semibold">Font</h3>
          <p className="text-xs text-muted-foreground">Choose your preferred font</p>
        </div>
        <div className="space-y-1">
          {fontFamilies.map((font) => (
            <button
              key={font.id}
              onClick={() => setFontFamily(font.id)}
              className={cn(
                "w-full flex items-center justify-between px-2.5 py-1.5 rounded-md text-sm transition-colors border",
                appearance.fontFamily === font.id
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-transparent hover:bg-muted text-muted-foreground hover:text-foreground"
              )}
            >
              <span
                className={cn(
                  font.id === "mono" && "font-mono",
                  font.id === "serif" && "font-serif",
                  font.id === "system" && "font-sans",
                )}
              >
                {font.label}
              </span>
              {appearance.fontFamily === font.id && (
                <Check className="h-3 w-3 text-primary" />
              )}
            </button>
          ))}
        </div>

        <Separator className="my-3" />

        {/* Font size */}
        <div className="mb-2">
          <h3 className="text-sm font-semibold">Font Size</h3>
          <p className="text-xs text-muted-foreground">Adjust text size across the app</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={decreaseFontSize}
            disabled={currentSizeIdx <= 0}
            className={cn(
              "flex items-center justify-center h-8 w-8 rounded-md border transition-colors",
              currentSizeIdx <= 0
                ? "border-border/50 text-muted-foreground/30 cursor-not-allowed"
                : "border-border text-foreground hover:bg-muted"
            )}
            title="Decrease font size"
          >
            <Minus className="h-3.5 w-3.5" />
          </button>
          <div className="flex-1 text-center">
            <span className="text-sm font-medium">{currentSizeLabel}</span>
          </div>
          <button
            onClick={increaseFontSize}
            disabled={currentSizeIdx >= fontSizes.length - 1}
            className={cn(
              "flex items-center justify-center h-8 w-8 rounded-md border transition-colors",
              currentSizeIdx >= fontSizes.length - 1
                ? "border-border/50 text-muted-foreground/30 cursor-not-allowed"
                : "border-border text-foreground hover:bg-muted"
            )}
            title="Increase font size"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
        {/* Size indicator dots */}
        <div className="flex items-center justify-center gap-1.5 mt-2">
          {fontSizes.map((size, idx) => (
            <button
              key={size.id}
              onClick={() => setFontSize(size.id)}
              className={cn(
                "rounded-full transition-all",
                idx === currentSizeIdx
                  ? "h-2 w-2 bg-primary"
                  : "h-1.5 w-1.5 bg-muted-foreground/30 hover:bg-muted-foreground/60"
              )}
              title={size.label}
            />
          ))}
        </div>

        <Separator className="my-3" />

        {/* Density */}
        <div className="mb-2">
          <h3 className="text-sm font-semibold">Density</h3>
          <p className="text-xs text-muted-foreground">Widget spacing & size</p>
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {densityOptions.map((opt) => (
            <button
              key={opt.id}
              onClick={() => setDensity(opt.id)}
              className={cn(
                "flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-md text-xs transition-colors border",
                appearance.density === opt.id
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-transparent hover:bg-muted text-muted-foreground hover:text-foreground"
              )}
            >
              <LayoutGrid className={cn(
                "h-3.5 w-3.5",
                opt.id === "compact" && "scale-75",
                opt.id === "spacious" && "scale-110",
              )} />
              <span>{opt.label}</span>
            </button>
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
