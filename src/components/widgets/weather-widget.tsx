"use client";

import { WidgetWrapper } from "@/components/widget-wrapper";
import {
  Cloud,
  CloudRain,
  Droplets,
  Sun,
  CloudSun,
  Wind,
  CloudSnow,
  CloudLightning,
  CloudFog,
  RefreshCw,
  Loader2,
  AlertCircle,
  Thermometer,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useEffect, useState, useCallback } from "react";
import { useRefreshOnVisible } from "@/hooks/use-refresh-on-visible";

interface ForecastDay {
  day: string;
  date: string;
  high: number;
  low: number;
  condition: string;
  description: string;
}

interface WeatherData {
  location: string;
  temperature: number;
  condition: string;
  description: string;
  humidity: number;
  wind: number;
  forecast: ForecastDay[];
}

const conditionConfig: Record<string, { icon: typeof Sun; color: string; bg: string }> = {
  Sunny:          { icon: Sun,           color: "text-amber-400",  bg: "bg-amber-400/10" },
  "Partly Cloudy":{ icon: CloudSun,      color: "text-amber-300",  bg: "bg-amber-300/10" },
  Cloudy:         { icon: Cloud,         color: "text-slate-400",  bg: "bg-slate-400/10" },
  Rainy:          { icon: CloudRain,     color: "text-blue-400",   bg: "bg-blue-400/10"  },
  Snowy:          { icon: CloudSnow,     color: "text-cyan-300",   bg: "bg-cyan-300/10"  },
  Stormy:         { icon: CloudLightning,color: "text-violet-400", bg: "bg-violet-400/10"},
  Foggy:          { icon: CloudFog,      color: "text-slate-300",  bg: "bg-slate-300/10" },
};

const fallback = { icon: CloudSun, color: "text-amber-300", bg: "bg-amber-300/10" };

function WeatherIcon({ condition, className }: { condition: string; className?: string }) {
  const { icon: Icon, color } = conditionConfig[condition] || fallback;
  return <Icon className={cn(color, className)} />;
}

function tempColor(temp: number) {
  if (temp >= 30) return "text-orange-400";
  if (temp >= 22) return "text-amber-400";
  if (temp >= 12) return "text-emerald-400";
  if (temp >= 4)  return "text-sky-400";
  return "text-cyan-300";
}

export function WeatherWidget() {
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchWeather = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/weather");
      const data = await res.json();
      if (data.error) { setError(data.error); return; }
      setWeather(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch weather");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchWeather();
    const interval = setInterval(fetchWeather, 10 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchWeather]);

  // Refresh weather when tab becomes visible after being hidden 30s+
  useRefreshOnVisible(fetchWeather);

  const cfg = weather ? (conditionConfig[weather.condition] || fallback) : fallback;

  return (
    <WidgetWrapper
      title="Weather"
      icon={<CloudSun className="h-4 w-4" />}
      headerAction={
        <button
          onClick={fetchWeather}
          disabled={loading}
          className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded-md hover:bg-muted disabled:opacity-50"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
        </button>
      }
    >
      {loading && !weather ? (
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
      ) : weather ? (
        <div className="flex flex-col h-full gap-3">
          {/* Current conditions */}
          <div className="flex items-center justify-between">
            <div className="flex flex-col gap-0.5">
              <div className="flex items-baseline gap-1">
                <span className={cn("text-4xl font-bold tabular-nums", tempColor(weather.temperature))}>
                  {weather.temperature}°
                </span>
                <span className="text-sm text-muted-foreground font-medium">C</span>
              </div>
              <p className="text-sm font-medium text-foreground/80">{weather.description}</p>
              <p className="text-xs text-muted-foreground">{weather.location}</p>
            </div>
            {/* Big coloured icon */}
            <div className={cn("rounded-2xl p-3", cfg.bg)}>
              <WeatherIcon condition={weather.condition} className="h-14 w-14" />
            </div>
          </div>

          {/* Stats row */}
          <div className="flex gap-3">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Droplets className="h-3.5 w-3.5 text-blue-400" />
              <span>{weather.humidity}%</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Wind className="h-3.5 w-3.5 text-sky-400" />
              <span>{weather.wind} km/h</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Thermometer className="h-3.5 w-3.5 text-orange-400" />
              <span>feels like</span>
            </div>
          </div>

          {/* Forecast */}
          <div className="flex justify-between gap-1 mt-auto">
            {weather.forecast.map((day) => (
              <div
                key={day.date}
                className="flex flex-col items-center gap-1 px-1.5 py-2 rounded-xl flex-1 bg-muted/40 hover:bg-muted/70 transition-colors"
              >
                <span className="text-[10px] text-muted-foreground font-medium">{day.day}</span>
                <WeatherIcon condition={day.condition} className="h-4 w-4" />
                <div className="text-[10px] tabular-nums text-center">
                  <span className={cn("font-semibold", tempColor(day.high))}>{day.high}°</span>
                  <span className="text-muted-foreground ml-0.5">{day.low}°</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </WidgetWrapper>
  );
}
