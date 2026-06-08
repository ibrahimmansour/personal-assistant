"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Newspaper,
  RefreshCw,
  Loader2,
  AlertCircle,
  ExternalLink,
  Settings2,
  Check,
  X,
} from "lucide-react";
import { WidgetWrapper } from "@/components/widget-wrapper";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { useRefreshOnVisible } from "@/hooks/use-refresh-on-visible";

interface NewsArticle {
  id: string;
  title: string;
  link: string;
  pubDate: string;
  source: string;
  sourceId: string;
  description: string;
}

interface NewsSource {
  id: string;
  name: string;
  url: string;
  category: "tech" | "general" | "business" | "science" | "world";
}

const categoryColors: Record<string, string> = {
  tech: "text-blue-500 bg-blue-500/10",
  general: "text-emerald-500 bg-emerald-500/10",
  business: "text-amber-500 bg-amber-500/10",
  science: "text-violet-500 bg-violet-500/10",
  world: "text-rose-500 bg-rose-500/10",
};

function timeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);

  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  if (diffDays === 1) return "yesterday";
  return `${diffDays}d ago`;
}

export function NewsWidget() {
  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [availableSources, setAvailableSources] = useState<NewsSource[]>([]);
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);
  const [savingSettings, setSavingSettings] = useState(false);

  const fetchNews = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/news");
      if (!res.ok) throw new Error("Failed to fetch news");
      const data = await res.json();
      setArticles(data.articles || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch news");
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchSources = useCallback(async () => {
    try {
      const res = await fetch("/api/news?action=sources");
      if (!res.ok) return;
      const data = await res.json();
      setAvailableSources(data.available || []);
      setSelectedSourceIds(data.selected || []);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetchNews();
    const interval = setInterval(fetchNews, 5 * 60 * 1000); // Refresh every 5 min
    return () => clearInterval(interval);
  }, [fetchNews]);

  useRefreshOnVisible(fetchNews);

  const handleOpenSettings = useCallback(() => {
    fetchSources();
    setShowSettings(true);
  }, [fetchSources]);

  const handleSaveSources = useCallback(async () => {
    try {
      setSavingSettings(true);
      const res = await fetch("/api/news", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update-sources", sources: selectedSourceIds }),
      });
      if (!res.ok) throw new Error("Failed to save");
      setShowSettings(false);
      // Refetch news with new sources
      fetchNews();
    } catch {
      // ignore
    } finally {
      setSavingSettings(false);
    }
  }, [selectedSourceIds, fetchNews]);

  const toggleSource = useCallback((sourceId: string) => {
    setSelectedSourceIds((prev) =>
      prev.includes(sourceId) ? prev.filter((id) => id !== sourceId) : [...prev, sourceId]
    );
  }, []);

  // Settings panel for source selection
  if (showSettings) {
    return (
      <WidgetWrapper
        title="News Sources"
        icon={<Settings2 className="h-4 w-4" />}
        widgetType="news"
        headerAction={
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => setShowSettings(false)}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        }
      >
        <div className="flex flex-col h-full gap-3">
          <p className="text-xs text-muted-foreground">
            Select the news sources you want to follow.
          </p>
          <ScrollArea className="flex-1 -mx-1">
            <div className="space-y-1 px-1">
              {(["tech", "world", "general", "business", "science"] as const).map((category) => {
                const sourcesInCategory = availableSources.filter((s) => s.category === category);
                if (sourcesInCategory.length === 0) return null;
                return (
                  <div key={category} className="mb-3">
                    <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60 mb-1.5">
                      {category}
                    </p>
                    {sourcesInCategory.map((source) => (
                      <label
                        key={source.id}
                        className="flex items-center gap-2.5 py-1.5 px-2 rounded-md hover:bg-muted/50 cursor-pointer transition-colors"
                      >
                        <Checkbox
                          checked={selectedSourceIds.includes(source.id)}
                          onCheckedChange={() => toggleSource(source.id)}
                        />
                        <span className="text-sm">{source.name}</span>
                      </label>
                    ))}
                  </div>
                );
              })}
            </div>
          </ScrollArea>
          <div className="flex items-center justify-between pt-2 border-t">
            <span className="text-xs text-muted-foreground">
              {selectedSourceIds.length} selected
            </span>
            <Button
              size="sm"
              onClick={handleSaveSources}
              disabled={savingSettings || selectedSourceIds.length === 0}
              className="h-7 text-xs"
            >
              {savingSettings ? (
                <Loader2 className="h-3 w-3 animate-spin mr-1" />
              ) : (
                <Check className="h-3 w-3 mr-1" />
              )}
              Save
            </Button>
          </div>
        </div>
      </WidgetWrapper>
    );
  }

  return (
    <WidgetWrapper
      title="News"
      icon={<Newspaper className="h-4 w-4" />}
      widgetType="news"
      headerAction={
        <div className="flex items-center gap-0.5">
          <button
            onClick={handleOpenSettings}
            className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded-md hover:bg-muted"
            title="Choose sources"
          >
            <Settings2 className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={fetchNews}
            disabled={loading}
            className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded-md hover:bg-muted disabled:opacity-50"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          </button>
        </div>
      }
    >
      {loading && articles.length === 0 ? (
        <div className="flex items-center justify-center h-full">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <div className="flex items-center justify-center h-full">
          <div className="flex flex-col items-center gap-2 text-muted-foreground text-center">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-xs">{error}</span>
          </div>
        </div>
      ) : articles.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground">
          <Newspaper className="h-8 w-8 opacity-40" />
          <p className="text-xs">No articles yet.</p>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={handleOpenSettings}
          >
            Choose sources
          </Button>
        </div>
      ) : (
        <ScrollArea className="h-full -mx-1">
          <div className="space-y-0.5 px-1">
            {articles.map((article) => (
              <a
                key={article.id}
                href={article.link}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex flex-col gap-1 p-2 rounded-lg hover:bg-muted/60 transition-colors"
              >
                <div className="flex items-start justify-between gap-2">
                  <h4 className="text-sm font-medium leading-tight line-clamp-2 group-hover:text-primary transition-colors">
                    {article.title}
                  </h4>
                  <ExternalLink className="h-3 w-3 shrink-0 mt-0.5 opacity-0 group-hover:opacity-60 transition-opacity" />
                </div>
                <div className="flex items-center gap-2">
                  <Badge
                    variant="secondary"
                    className={cn(
                      "text-[10px] px-1.5 py-0 h-4 font-normal",
                      categoryColors[
                        availableSources.find((s) => s.id === article.sourceId)?.category || "tech"
                      ] || categoryColors.tech
                    )}
                  >
                    {article.source}
                  </Badge>
                  <span className="text-[10px] text-muted-foreground">
                    {timeAgo(article.pubDate)}
                  </span>
                </div>
              </a>
            ))}
          </div>
        </ScrollArea>
      )}
    </WidgetWrapper>
  );
}
