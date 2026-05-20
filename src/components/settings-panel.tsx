"use client";

import { useState, useEffect, useCallback, FormEvent } from "react";
import { Settings, Save, Eye, EyeOff, CheckCircle, GitBranch, Mail, Cloud, Brain, MapPin, TicketCheck, Shield } from "lucide-react";
import { cn } from "@/lib/utils";

interface AppConfig {
  github: { token: string; username: string; apiUrl: string };
  githubCom: { token: string; username: string };
  google: { clientId: string; clientSecret: string; redirectUri: string };
  jira: { baseUrl: string; cookies: string };
  ollama: { url: string; model: string };
  weather: { location: string };
}

const SECTIONS = [
  { key: "github", label: "GitHub Enterprise", icon: GitBranch, fields: [
    { key: "token", label: "Token", secret: true },
    { key: "username", label: "Username", secret: false },
    { key: "apiUrl", label: "API URL", secret: false },
  ]},
  { key: "githubCom", label: "GitHub.com", icon: GitBranch, fields: [
    { key: "token", label: "Token", secret: true },
    { key: "username", label: "Username", secret: false },
  ]},
  { key: "google", label: "Google OAuth", icon: Mail, fields: [
    { key: "clientId", label: "Client ID", secret: false },
    { key: "clientSecret", label: "Client Secret", secret: true },
    { key: "redirectUri", label: "Redirect URI", secret: false },
  ]},
  { key: "jira", label: "Jira", icon: TicketCheck, fields: [
    { key: "baseUrl", label: "Base URL", secret: false },
    { key: "cookies", label: "Cookies", secret: true },
  ]},
  { key: "ollama", label: "AI / Ollama", icon: Brain, fields: [
    { key: "url", label: "URL", secret: false },
    { key: "model", label: "Model", secret: false },
  ]},
  { key: "weather", label: "Weather", icon: MapPin, fields: [
    { key: "location", label: "Location", secret: false },
  ]},
] as const;

export default function SettingsPanel() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [visibleSecrets, setVisibleSecrets] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then(setConfig)
      .catch(console.error);
  }, []);

  const handleChange = useCallback((section: string, field: string, value: string) => {
    setConfig((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        [section]: { ...(prev as unknown as Record<string, Record<string, string>>)[section], [field]: value },
      };
    });
  }, []);

  const handleSave = async () => {
    if (!config) return;
    setSaving(true);
    try {
      await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      console.error("Failed to save settings:", e);
    } finally {
      setSaving(false);
    }
  };

  const toggleSecret = (key: string) => {
    setVisibleSecrets((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  if (!config) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        Loading settings...
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-6 space-y-8 max-w-2xl mx-auto">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Settings className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-lg font-semibold">Settings</h2>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className={cn(
            "flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors",
            saved
              ? "bg-green-500/10 text-green-600 dark:text-green-400"
              : "bg-primary text-primary-foreground hover:bg-primary/90"
          )}
        >
          {saved ? <CheckCircle className="h-4 w-4" /> : <Save className="h-4 w-4" />}
          {saved ? "Saved" : saving ? "Saving..." : "Save"}
        </button>
      </div>

      {SECTIONS.map((section) => {
        const Icon = section.icon;
        const sectionData = (config as unknown as Record<string, Record<string, string>>)[section.key] || {};
        return (
          <div key={section.key} className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <Icon className="h-4 w-4" />
              {section.label}
            </div>
            <div className="space-y-2 pl-6">
              {section.fields.map((field) => {
                const fieldKey = `${section.key}.${field.key}`;
                const isVisible = visibleSecrets.has(fieldKey);
                return (
                  <div key={field.key} className="flex items-center gap-2">
                    <label className="text-xs text-muted-foreground w-28 shrink-0">
                      {field.label}
                    </label>
                    <div className="relative flex-1">
                      <input
                        type={field.secret && !isVisible ? "password" : "text"}
                        value={sectionData[field.key] || ""}
                        onChange={(e) => handleChange(section.key, field.key, e.target.value)}
                        className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        placeholder={field.secret ? "••••••••" : ""}
                      />
                      {field.secret && (
                        <button
                          type="button"
                          onClick={() => toggleSecret(fieldKey)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        >
                          {isVisible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      <p className="text-xs text-muted-foreground">
        Settings are stored in ~/.personal-assistant/config.json
      </p>
    </div>
  );
}
