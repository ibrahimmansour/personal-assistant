"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from "react";

export type ColorTheme =
  | "zinc"
  | "slate"
  | "blue"
  | "rose"
  | "emerald"
  | "violet"
  | "amber"
  | "cyan"
  | "orange";

export type FontFamily = "geist" | "inter" | "mono" | "system" | "serif";

export type FontSize = "xs" | "sm" | "base" | "lg" | "xl";

export type Density = "compact" | "comfortable" | "spacious";

export interface AppearanceConfig {
  colorTheme: ColorTheme;
  fontFamily: FontFamily;
  fontSize: FontSize;
  density: Density;
  autoFullscreen: boolean;
}

const defaultAppearance: AppearanceConfig = {
  colorTheme: "zinc",
  fontFamily: "geist",
  fontSize: "base",
  density: "comfortable",
  autoFullscreen: true,
};

interface AppearanceContextType {
  appearance: AppearanceConfig;
  setColorTheme: (theme: ColorTheme) => void;
  setFontFamily: (font: FontFamily) => void;
  setFontSize: (size: FontSize) => void;
  setDensity: (density: Density) => void;
  setAutoFullscreen: (enabled: boolean) => void;
  increaseFontSize: () => void;
  decreaseFontSize: () => void;
}

const AppearanceContext = createContext<AppearanceContextType | null>(null);

export function useAppearance() {
  const ctx = useContext(AppearanceContext);
  if (!ctx) throw new Error("useAppearance must be used within AppearanceProvider");
  return ctx;
}

export const colorThemes: { id: ColorTheme; label: string; preview: string }[] = [
  { id: "zinc", label: "Zinc", preview: "#71717a" },
  { id: "slate", label: "Slate", preview: "#64748b" },
  { id: "blue", label: "Blue", preview: "#3b82f6" },
  { id: "rose", label: "Rose", preview: "#f43f5e" },
  { id: "emerald", label: "Emerald", preview: "#10b981" },
  { id: "violet", label: "Violet", preview: "#8b5cf6" },
  { id: "amber", label: "Amber", preview: "#f59e0b" },
  { id: "cyan", label: "Cyan", preview: "#06b6d4" },
  { id: "orange", label: "Orange", preview: "#f97316" },
];

export const fontFamilies: { id: FontFamily; label: string; className: string }[] = [
  { id: "geist", label: "Geist", className: "font-sans" },
  { id: "inter", label: "Inter", className: "font-inter" },
  { id: "mono", label: "Monospace", className: "font-mono" },
  { id: "system", label: "System", className: "font-system" },
  { id: "serif", label: "Serif", className: "font-serif" },
];

export const fontSizes: { id: FontSize; label: string; scale: number }[] = [
  { id: "xs", label: "Extra Small", scale: 0.85 },
  { id: "sm", label: "Small", scale: 0.92 },
  { id: "base", label: "Default", scale: 1 },
  { id: "lg", label: "Large", scale: 1.08 },
  { id: "xl", label: "Extra Large", scale: 1.18 },
];

const fontSizeOrder: FontSize[] = ["xs", "sm", "base", "lg", "xl"];

export const densityOptions: { id: Density; label: string; description: string }[] = [
  { id: "compact", label: "Compact", description: "More widgets, less spacing" },
  { id: "comfortable", label: "Comfortable", description: "Balanced density" },
  { id: "spacious", label: "Spacious", description: "Fewer widgets, more space" },
];

export function AppearanceProvider({ children }: { children: React.ReactNode }) {
  const [appearance, setAppearance] = useState<AppearanceConfig>(defaultAppearance);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("appearance");
      if (saved) {
        const parsed = JSON.parse(saved);
        setAppearance({ ...defaultAppearance, ...parsed });
      }
    } catch {}
    setMounted(true);
  }, []);

  // Apply classes to html element
  useEffect(() => {
    if (!mounted) return;
    const html = document.documentElement;

    // Remove old theme/font/size/density classes
    html.classList.forEach((cls) => {
      if (cls.startsWith("theme-") || cls.startsWith("font-choice-") || cls.startsWith("font-size-") || cls.startsWith("density-")) {
        html.classList.remove(cls);
      }
    });

    // Apply current theme
    if (appearance.colorTheme !== "zinc") {
      html.classList.add(`theme-${appearance.colorTheme}`);
    }
    html.classList.add(`font-choice-${appearance.fontFamily}`);
    if (appearance.fontSize !== "base") {
      html.classList.add(`font-size-${appearance.fontSize}`);
    }
    html.classList.add(`density-${appearance.density}`);
  }, [appearance, mounted]);

  const persist = useCallback((updated: AppearanceConfig) => {
    setAppearance(updated);
    localStorage.setItem("appearance", JSON.stringify(updated));
  }, []);

  const setColorTheme = useCallback(
    (theme: ColorTheme) => {
      persist({ ...appearance, colorTheme: theme });
    },
    [appearance, persist]
  );

  const setFontFamily = useCallback(
    (font: FontFamily) => {
      persist({ ...appearance, fontFamily: font });
    },
    [appearance, persist]
  );

  const setFontSize = useCallback(
    (size: FontSize) => {
      persist({ ...appearance, fontSize: size });
    },
    [appearance, persist]
  );

  const setDensity = useCallback(
    (density: Density) => {
      persist({ ...appearance, density });
    },
    [appearance, persist]
  );

  const setAutoFullscreen = useCallback(
    (enabled: boolean) => {
      persist({ ...appearance, autoFullscreen: enabled });
    },
    [appearance, persist]
  );

  const increaseFontSize = useCallback(() => {
    const idx = fontSizeOrder.indexOf(appearance.fontSize);
    if (idx < fontSizeOrder.length - 1) {
      persist({ ...appearance, fontSize: fontSizeOrder[idx + 1] });
    }
  }, [appearance, persist]);

  const decreaseFontSize = useCallback(() => {
    const idx = fontSizeOrder.indexOf(appearance.fontSize);
    if (idx > 0) {
      persist({ ...appearance, fontSize: fontSizeOrder[idx - 1] });
    }
  }, [appearance, persist]);

  return (
    <AppearanceContext.Provider value={{ appearance, setColorTheme, setFontFamily, setFontSize, setDensity, setAutoFullscreen, increaseFontSize, decreaseFontSize }}>
      {children}
    </AppearanceContext.Provider>
  );
}
