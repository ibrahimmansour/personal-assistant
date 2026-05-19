"use client";

import {
  useAppearance,
  colorThemes,
  fontFamilies,
  type ColorTheme,
  type FontFamily,
} from "@/components/appearance-context";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { Paintbrush, Check } from "lucide-react";
import { cn } from "@/lib/utils";

export function AppearancePicker() {
  const { appearance, setColorTheme, setFontFamily } = useAppearance();

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
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
