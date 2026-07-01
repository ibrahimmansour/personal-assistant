"use client";

import { useState, useEffect, useCallback, FormEvent } from "react";
import { Settings, Save, Eye, EyeOff, CheckCircle, GitBranch, Mail, Cloud, Brain, MapPin, TicketCheck, Shield, Download, RefreshCw, LayoutGrid, RotateCcw, Lock, LockOpen, Maximize } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDashboard } from "@/components/dashboard-context";
import { useAppearance } from "@/components/appearance-context";
import { Switch } from "@/components/ui/switch";

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

      <DisplaySection />

      <WidgetsSection />

      <ChangePasswordSection />
    </div>
  );
}

function DisplaySection() {
  const { appearance, setAutoFullscreen } = useAppearance();

  return (
    <div className="space-y-3 pt-4 border-t border-border">
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        <Maximize className="h-4 w-4" />
        Display
      </div>
      <div className="space-y-2 pl-6">
        <div className="flex items-center justify-between py-1 gap-4">
          <div>
            <div className="text-sm">Fullscreen on launch</div>
            <div className="text-xs text-muted-foreground">
              Enter fullscreen automatically on your first interaction after loading
            </div>
          </div>
          <Switch
            checked={appearance.autoFullscreen}
            onCheckedChange={setAutoFullscreen}
          />
        </div>
      </div>
    </div>
  );
}

function WidgetsSection() {
  const { widgets, toggleWidget, resetLayout, autoArrange, layoutLocked, toggleLayoutLock } = useDashboard();

  return (
    <div className="space-y-3 pt-4 border-t border-border">
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        <LayoutGrid className="h-4 w-4" />
        Widgets
      </div>
      <div className="space-y-2 pl-6">
        {widgets.map((widget) => (
          <div key={widget.id} className="flex items-center justify-between py-1">
            <span className="text-sm">{widget.title}</span>
            <Switch
              checked={widget.visible}
              onCheckedChange={() => toggleWidget(widget.id)}
            />
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 pl-6 pt-2">
        <button
          onClick={toggleLayoutLock}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border border-border hover:bg-muted transition-colors"
        >
          {layoutLocked ? <Lock className="h-3 w-3" /> : <LockOpen className="h-3 w-3" />}
          {layoutLocked ? "Unlock layout" : "Lock layout"}
        </button>
        <button
          onClick={autoArrange}
          disabled={layoutLocked}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border border-border hover:bg-muted transition-colors disabled:opacity-50"
        >
          <LayoutGrid className="h-3 w-3" />
          Auto-arrange
        </button>
        <button
          onClick={resetLayout}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border border-border hover:bg-muted transition-colors"
        >
          <RotateCcw className="h-3 w-3" />
          Reset
        </button>
      </div>
    </div>
  );
}

function ChangePasswordSection() {
  const [current, setCurrent] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSuccess(false);

    if (newPw.length < 4) {
      setError("New password must be at least 4 characters");
      return;
    }
    if (newPw !== confirm) {
      setError("Passwords do not match");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "change-password", password: current, newPassword: newPw }),
      });
      if (res.ok) {
        setSuccess(true);
        setCurrent("");
        setNewPw("");
        setConfirm("");
        setTimeout(() => setSuccess(false), 3000);
      } else {
        const data = await res.json();
        setError(data.error || "Failed to change password");
      }
    } catch {
      setError("Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3 pt-4 border-t border-border">
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        <Shield className="h-4 w-4" />
        Security
      </div>
      <form onSubmit={handleSubmit} className="space-y-2 pl-6">
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted-foreground w-28 shrink-0">Current</label>
          <input
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            className="flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted-foreground w-28 shrink-0">New password</label>
          <input
            type="password"
            value={newPw}
            onChange={(e) => setNewPw(e.target.value)}
            className="flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted-foreground w-28 shrink-0">Confirm</label>
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        {error && <p className="text-xs text-destructive pl-28 ml-2">{error}</p>}
        {success && <p className="text-xs text-green-600 dark:text-green-400 pl-28 ml-2">Password changed successfully</p>}
        <div className="pl-28 ml-2 pt-1">
          <button
            type="submit"
            disabled={loading || !current || !newPw || !confirm}
            className="px-4 py-1.5 rounded-md text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? "Changing..." : "Change Password"}
          </button>
        </div>
      </form>

      <UpdateSection />
    </div>
  );
}

function UpdateSection() {
  const [status, setStatus] = useState<{ current: string; latest: string | null; updateAvailable: boolean } | null>(null);
  const [updating, setUpdating] = useState(false);
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState("");

  const checkForUpdates = async () => {
    setChecking(true);
    try {
      const res = await fetch("/api/update");
      const data = await res.json();
      setStatus(data);
    } catch {
      setMessage("Failed to check for updates");
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => { checkForUpdates(); }, []);

  const handleUpdate = async () => {
    setUpdating(true);
    setMessage("");
    try {
      const res = await fetch("/api/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update" }),
      });
      const data = await res.json();
      if (data.success) {
        setMessage("Update installed! Restarting... page will reload in a few seconds.");
        setTimeout(() => window.location.reload(), 5000);
      } else {
        setMessage(`Update failed: ${data.error}`);
      }
    } catch {
      setMessage("Update failed. Check server logs.");
    } finally {
      setUpdating(false);
    }
  };

  return (
    <div className="space-y-3 border-t border-border pt-6">
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        <Download className="h-4 w-4" />
        Updates
      </div>
      <div className="pl-6 space-y-2">
        <div className="flex items-center gap-3 text-sm">
          <span className="text-muted-foreground">Current:</span>
          <span className="font-mono">{status?.current || "..."}</span>
          {status?.latest && (
            <>
              <span className="text-muted-foreground">Latest:</span>
              <span className="font-mono">{status.latest}</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={checkForUpdates}
            disabled={checking}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border border-border hover:bg-muted transition-colors disabled:opacity-50"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", checking && "animate-spin")} />
            {checking ? "Checking..." : "Check for updates"}
          </button>
          {status?.updateAvailable && (
            <button
              onClick={handleUpdate}
              disabled={updating}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              <Download className="h-3.5 w-3.5" />
              {updating ? "Updating..." : `Update to ${status.latest}`}
            </button>
          )}
          {status && !status.updateAvailable && status.latest && (
            <span className="text-xs text-green-600 dark:text-green-400">Up to date</span>
          )}
        </div>
        {message && <p className="text-xs text-muted-foreground">{message}</p>}
      </div>
    </div>
  );
}
