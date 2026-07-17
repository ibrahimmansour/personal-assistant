"use client";

import React, { createContext, useContext, useState, useCallback, useEffect } from "react";

export type ProfileId = "work" | "private";

export interface Profile {
  id: ProfileId;
  name: string;
  icon: string; // emoji or identifier
  description: string;
}

export const profiles: Profile[] = [
  { id: "work", name: "Work", icon: "briefcase", description: "SAP tools & Outlook" },
  { id: "private", name: "Private", icon: "home", description: "Gmail & GitHub.com" },
];

interface ProfileContextType {
  activeProfile: ProfileId;
  setActiveProfile: (id: ProfileId) => void;
  profile: Profile;
}

const ProfileContext = createContext<ProfileContextType | null>(null);

export function useProfile() {
  const ctx = useContext(ProfileContext);
  if (!ctx) throw new Error("useProfile must be used within ProfileProvider");
  return ctx;
}

const STORAGE_KEY = "assistant-profile";

export function ProfileProvider({ children }: { children: React.ReactNode }) {
  const [activeProfile, setActiveProfileState] = useState<ProfileId>("work");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === "work" || saved === "private") {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setActiveProfileState(saved);
      }
    } catch {}
    setLoaded(true);
  }, []);

  const setActiveProfile = useCallback((id: ProfileId) => {
    setActiveProfileState(id);
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {}
  }, []);

  const profile = profiles.find((p) => p.id === activeProfile) || profiles[0];

  // Don't render children until we've loaded the saved profile to avoid flicker
  if (!loaded) return null;

  return (
    <ProfileContext.Provider value={{ activeProfile, setActiveProfile, profile }}>
      {children}
    </ProfileContext.Provider>
  );
}
