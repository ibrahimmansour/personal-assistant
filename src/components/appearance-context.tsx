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

export interface AppearanceConfig {
  colorTheme: ColorTheme;
  fontFamily: FontFamily;
}

const defaultAppearance: AppearanceConfig = {
  colorTheme: "zinc",
  fontFamily: "geist",
};

interface AppearanceContextType {
  appearance: AppearanceConfig;
  setColorTheme: (theme: ColorTheme) => void;
  setFontFamily: (font: FontFamily) => void;
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

    // Remove old theme classes
    html.classList.forEach((cls) => {
      if (cls.startsWith("theme-") || cls.startsWith("font-choice-")) {
        html.classList.remove(cls);
      }
    });

    // Apply current theme
    if (appearance.colorTheme !== "zinc") {
      html.classList.add(`theme-${appearance.colorTheme}`);
    }
    html.classList.add(`font-choice-${appearance.fontFamily}`);
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

  return (
    <AppearanceContext.Provider value={{ appearance, setColorTheme, setFontFamily }}>
      {children}
    </AppearanceContext.Provider>
  );
}
