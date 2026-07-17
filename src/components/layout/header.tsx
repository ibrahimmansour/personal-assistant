"use client";

import { useTheme } from "next-themes";
import { LayoutDashboard, Moon, Sun, Briefcase, Home, Search, Sparkles, Settings, Maximize, Minimize, Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AppearancePicker } from "@/components/layout/appearance-picker";
import { useProfile, profiles } from "@/components/profile-context";
import { useCommandPalette } from "@/components/command-palette-context";
import { useAIChat } from "@/components/ai-chat-context";
import { useAppearance } from "@/components/appearance-context";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import SettingsPanel from "@/components/settings-panel";

const profileIcons: Record<string, typeof Briefcase> = {
  briefcase: Briefcase,
  home: Home,
};

export function Header() {
  const { theme, setTheme } = useTheme();
  const { activeProfile, setActiveProfile, profile } = useProfile();
  const { openSearch } = useCommandPalette();
  const { toggle: toggleAI, isOpen: aiOpen } = useAIChat();
  const { appearance } = useAppearance();
  const [mounted, setMounted] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    function onFsChange() {
      setIsFullscreen(!!document.fullscreenElement);
    }
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  // Auto-enter fullscreen on launch. Browsers forbid requestFullscreen without
  // a user gesture, so we arm a one-shot listener that fires on the very first
  // interaction (click or keypress) after load. Runs once per page load and
  // only when the preference is enabled and we're not already fullscreen.
  const autoFsDone = useRef(false);
  useEffect(() => {
    if (!appearance.autoFullscreen) return;
    if (autoFsDone.current || document.fullscreenElement) return;

    const enter = () => {
      if (autoFsDone.current) return;
      autoFsDone.current = true;
      cleanup();
      try {
        document.documentElement.requestFullscreen?.();
      } catch {
        /* ignore patched/throwing fullscreen APIs (e.g. Windowed extension) */
      }
    };
    const cleanup = () => {
      window.removeEventListener("pointerdown", enter, true);
      window.removeEventListener("keydown", enter, true);
    };
    window.addEventListener("pointerdown", enter, true);
    window.addEventListener("keydown", enter, true);
    return cleanup;
  }, [appearance.autoFullscreen]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setMounted(true), []);

  // Keyboard shortcut: Cmd+I to toggle AI chat
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "i") {
        e.preventDefault();
        toggleAI();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [toggleAI]);

  return (
    <header className="sticky top-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-xl">
      <div className="flex items-center justify-between h-12 md:h-14 px-3 md:px-6">
        {/* Left side */}
        <div className="flex items-center gap-2 md:gap-3">
          {/* Mobile hamburger menu */}
          <button
            className="inline-flex items-center justify-center h-8 w-8 p-0 rounded-md text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground md:hidden"
            onClick={() => window.dispatchEvent(new Event("toggle-mobile-sidebar"))}
            title="Menu"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-primary text-primary-foreground">
            <LayoutDashboard className="h-4 w-4" />
          </div>
          <div className="hidden sm:block">
            <h1 className="text-sm font-semibold leading-none">
              Personal Assistant
            </h1>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {profile.description}
            </p>
          </div>
        </div>

        {/* Center - Profile switcher */}
        <div className="flex items-center gap-1 bg-muted/50 rounded-lg p-1">
          {profiles.map((p) => {
            const Icon = profileIcons[p.icon] || Briefcase;
            const isActive = p.id === activeProfile;
            return (
              <button
                key={p.id}
                onClick={() => setActiveProfile(p.id)}
                className={cn(
                  "flex items-center gap-1.5 px-2 md:px-3 py-1.5 rounded-md text-xs font-medium transition-all",
                  isActive
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
                title={p.description}
              >
                <Icon className="h-3.5 w-3.5" />
                <span className="hidden xs:inline">{p.name}</span>
              </button>
            );
          })}
        </div>

        {/* Right side */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => openSearch()}
            className="inline-flex items-center gap-2 h-8 px-2 md:px-3 rounded-md text-xs text-muted-foreground bg-muted/50 border border-border/50 hover:bg-muted hover:text-foreground transition-colors"
          >
            <Search className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Search...</span>
            <kbd className="pointer-events-none hidden md:inline-flex h-5 items-center gap-0.5 rounded border border-border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
              <span className="text-xs">⌘</span>P
            </kbd>
          </button>
          <button
            onClick={toggleAI}
            className={cn(
              "inline-flex items-center gap-1.5 h-8 px-2 md:px-2.5 rounded-md text-xs border transition-colors",
              aiOpen
                ? "text-primary bg-primary/10 border-primary/30 hover:bg-primary/15"
                : "text-muted-foreground bg-muted/50 border-border/50 hover:bg-muted hover:text-foreground"
            )}
            title="AI Chat (⌘I)"
          >
            <Sparkles className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">AI</span>
            <kbd className="pointer-events-none hidden md:inline-flex h-5 items-center gap-0.5 rounded border border-border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
              <span className="text-xs">⌘</span>I
            </kbd>
          </button>
          <span className="hidden md:inline-flex">
            <AppearancePicker />
          </span>
          <button
            className="hidden md:inline-flex items-center justify-center h-8 w-8 p-0 rounded-md text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
            onClick={() => {
              try {
                if (!document.fullscreenElement) {
                  document.documentElement.requestFullscreen?.();
                } else {
                  document.exitFullscreen?.();
                }
              } catch {
                /* ignore patched/throwing fullscreen APIs (e.g. Windowed extension) */
              }
            }}
            title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
          >
            {isFullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
          </button>
          <button
            className="inline-flex items-center justify-center h-8 w-8 p-0 rounded-md text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
            onClick={() => setSettingsOpen(true)}
            title="Settings"
          >
            <Settings className="h-4 w-4" />
          </button>
          {mounted && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            >
              {theme === "dark" ? (
                <Sun className="h-4 w-4" />
              ) : (
                <Moon className="h-4 w-4" />
              )}
            </Button>
          )}
        </div>
      </div>
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto p-0">
          <SettingsPanel />
        </DialogContent>
      </Dialog>
    </header>
  );
}
