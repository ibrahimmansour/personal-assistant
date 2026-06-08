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
  Gauge,
  Sunrise,
  Sunset,
  Moon,
  Umbrella,
  Navigation,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useEffect, useState, useCallback, useRef } from "react";
import { useRefreshOnVisible } from "@/hooks/use-refresh-on-visible";
import { useWidgetNavFor } from "@/components/widget-nav-context";

// ─── Types ───────────────────────────────────────────────────────────────────

interface HourlyForecast {
  time: string;
  hour: number;
  temperature: number;
  apparentTemperature: number;
  condition: string;
  description: string;
  precipitationProbability: number;
  precipitation: number;
  windSpeed: number;
  windDirection: string;
  windDegrees: number;
  isDay: boolean;
}

interface ForecastDay {
  day: string;
  date: string;
  high: number;
  low: number;
  apparentHigh: number;
  apparentLow: number;
  condition: string;
  description: string;
  sunrise: string;
  sunset: string;
  uvIndexMax: number;
  uvLabel: string;
  precipitationSum: number;
  precipitationProbability: number;
  windSpeedMax: number;
  windGustsMax: number;
  windDirection: string;
}

interface WeatherData {
  location: string;
  temperature: number;
  apparentTemperature: number;
  condition: string;
  description: string;
  humidity: number;
  wind: number;
  windDirection: string;
  windDegrees: number;
  windGusts: number;
  pressure: number;
  cloudCover: number;
  isDay: boolean;
  sunrise: string;
  sunset: string;
  uvIndex: number;
  uvLabel: string;
  hourly: HourlyForecast[];
  forecast: ForecastDay[];
}

// ─── Condition Visuals ───────────────────────────────────────────────────────

const conditionConfig: Record<string, { icon: typeof Sun; color: string; bg: string }> = {
  Sunny:          { icon: Sun,            color: "text-amber-400",  bg: "bg-amber-400/10" },
  "Partly Cloudy":{ icon: CloudSun,       color: "text-amber-300",  bg: "bg-amber-300/10" },
  Cloudy:         { icon: Cloud,          color: "text-slate-400",  bg: "bg-slate-400/10" },
  Rainy:          { icon: CloudRain,      color: "text-blue-400",   bg: "bg-blue-400/10"  },
  Snowy:          { icon: CloudSnow,      color: "text-cyan-300",   bg: "bg-cyan-300/10"  },
  Stormy:         { icon: CloudLightning, color: "text-violet-400", bg: "bg-violet-400/10"},
  Foggy:          { icon: CloudFog,       color: "text-slate-300",  bg: "bg-slate-300/10" },
};

const fallback = { icon: CloudSun, color: "text-amber-300", bg: "bg-amber-300/10" };

function WeatherIcon({ condition, className, isDay = true }: { condition: string; className?: string; isDay?: boolean }) {
  if (!isDay && (condition === "Sunny" || condition === "Partly Cloudy")) {
    return <Moon className={cn("text-indigo-300", className)} />;
  }
  const { icon: Icon, color } = conditionConfig[condition] || fallback;
  return <Icon className={cn(color, className)} />;
}

function tempColor(temp: number) {
  if (temp >= 35) return "text-red-400";
  if (temp >= 30) return "text-orange-400";
  if (temp >= 22) return "text-amber-400";
  if (temp >= 12) return "text-emerald-400";
  if (temp >= 4)  return "text-sky-400";
  if (temp >= -5) return "text-cyan-300";
  return "text-blue-300";
}

function uvColor(uv: number) {
  if (uv <= 2) return "text-emerald-400";
  if (uv <= 5) return "text-amber-400";
  if (uv <= 7) return "text-orange-400";
  if (uv <= 10) return "text-red-400";
  return "text-violet-400";
}

function precipColor(prob: number) {
  if (prob <= 20) return "text-muted-foreground";
  if (prob <= 50) return "text-sky-400";
  if (prob <= 70) return "text-blue-400";
  return "text-blue-500";
}

// ─── Wind Compass ────────────────────────────────────────────────────────────

function WindCompass({ degrees, className }: { degrees: number; className?: string }) {
  return (
    <Navigation
      className={cn("h-3.5 w-3.5 text-sky-400 transition-transform", className)}
      style={{ transform: `rotate(${degrees + 180}deg)` }}
    />
  );
}

// ─── Sun Progress ────────────────────────────────────────────────────────────

function SunProgress({ sunrise, sunset }: { sunrise: string; sunset: string }) {
  const now = new Date();
  const rise = new Date(sunrise);
  const set = new Date(sunset);
  const total = set.getTime() - rise.getTime();
  const elapsed = now.getTime() - rise.getTime();
  const progress = Math.max(0, Math.min(1, elapsed / total));
  const isDaylight = now >= rise && now <= set;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <div className="flex items-center gap-1">
          <Sunrise className="h-3 w-3 text-amber-400" />
          <span>{rise.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false })}</span>
        </div>
        <div className="flex items-center gap-1">
          <span>{set.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false })}</span>
          <Sunset className="h-3 w-3 text-orange-400" />
        </div>
      </div>
      <div className="relative h-1.5 bg-muted rounded-full overflow-hidden">
        <div
          className={cn(
            "absolute inset-y-0 left-0 rounded-full transition-all",
            isDaylight ? "bg-gradient-to-r from-amber-400 to-orange-400" : "bg-muted-foreground/30"
          )}
          style={{ width: `${progress * 100}%` }}
        />
        {isDaylight && (
          <div
            className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-amber-400 border-2 border-background shadow-sm"
            style={{ left: `calc(${progress * 100}% - 5px)` }}
          />
        )}
      </div>
    </div>
  );
}

// ─── Hourly Forecast Scroller ────────────────────────────────────────────────

function HourlyScroller({ hourly }: { hourly: HourlyForecast[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={scrollRef}
      className="flex gap-0.5 overflow-x-auto pb-1 scrollbar-thin"
    >
      {hourly.slice(0, 24).map((h, i) => (
        <div
          key={h.time}
          className={cn(
            "flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-lg shrink-0 min-w-[42px] transition-colors",
            i === 0 ? "bg-primary/10" : "hover:bg-muted/50"
          )}
        >
          <span className="text-[9px] text-muted-foreground font-medium">
            {i === 0 ? "Now" : `${h.hour}:00`}
          </span>
          <WeatherIcon condition={h.condition} className="h-3.5 w-3.5" isDay={h.isDay} />
          <span className={cn("text-[10px] font-semibold tabular-nums", tempColor(h.temperature))}>
            {h.temperature}°
          </span>
          {h.precipitationProbability > 0 && (
            <span className={cn("text-[8px] tabular-nums", precipColor(h.precipitationProbability))}>
              {h.precipitationProbability}%
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Stat Card ───────────────────────────────────────────────────────────────

function StatCard({ icon, label, value, subValue, className }: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  subValue?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-0.5 rounded-xl bg-muted/40 px-2.5 py-2", className)}>
      <div className="flex items-center gap-1.5">
        {icon}
        <span className="text-[10px] text-muted-foreground font-medium">{label}</span>
      </div>
      <span className="text-sm font-semibold tabular-nums text-foreground">{value}</span>
      {subValue && (
        <span className="text-[10px] text-muted-foreground">{subValue}</span>
      )}
    </div>
  );
}

// ─── Main Widget ─────────────────────────────────────────────────────────────

export function WeatherWidget() {
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { expandRequested, onExpandHandled } = useWidgetNavFor("weather");

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

  useRefreshOnVisible(fetchWeather);

  const cfg = weather ? (conditionConfig[weather.condition] || fallback) : fallback;

  return (
    <WidgetWrapper
      title="Weather"
      icon={<CloudSun className="h-4 w-4" />}
      widgetType="weather"
      expandRequested={expandRequested}
      onExpandHandled={onExpandHandled}
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
        <div className="flex flex-col h-full gap-3 overflow-y-auto scrollbar-thin">
          {/* ── Current Conditions ── */}
          <div className="flex items-start justify-between">
            <div className="flex flex-col gap-0.5">
              <div className="flex items-baseline gap-1.5">
                <span className={cn("text-4xl font-bold tabular-nums", tempColor(weather.temperature))}>
                  {weather.temperature}°
                </span>
                <span className="text-sm text-muted-foreground font-medium">C</span>
              </div>
              <p className="text-sm font-medium text-foreground/80">{weather.description}</p>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-xs text-muted-foreground">{weather.location}</span>
                <span className="text-xs text-muted-foreground/60">|</span>
                <span className={cn("text-xs", tempColor(weather.apparentTemperature))}>
                  Feels {weather.apparentTemperature}°
                </span>
              </div>
            </div>
            <div className={cn("rounded-2xl p-3 shrink-0", cfg.bg)}>
              <WeatherIcon condition={weather.condition} className="h-12 w-12" isDay={weather.isDay} />
            </div>
          </div>

          {/* ── Hourly Forecast ── */}
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Next 24 hours</span>
            <HourlyScroller hourly={weather.hourly} />
          </div>

          {/* ── Stats Grid ── */}
          <div className="grid grid-cols-3 gap-1.5">
            <StatCard
              icon={<Droplets className="h-3 w-3 text-blue-400" />}
              label="Humidity"
              value={`${weather.humidity}%`}
              subValue={`${weather.cloudCover}% cloud`}
            />
            <StatCard
              icon={<Wind className="h-3 w-3 text-sky-400" />}
              label="Wind"
              value={`${weather.wind} km/h`}
              subValue={`${weather.windDirection} gusts ${weather.windGusts}`}
            />
            <StatCard
              icon={<Gauge className="h-3 w-3 text-indigo-400" />}
              label="Pressure"
              value={`${weather.pressure}`}
              subValue="hPa"
            />
            <StatCard
              icon={<Sun className={cn("h-3 w-3", uvColor(weather.uvIndex))} />}
              label="UV Index"
              value={weather.uvIndex.toFixed(1)}
              subValue={weather.uvLabel}
              className={cn(weather.uvIndex > 5 && "ring-1 ring-orange-400/30")}
            />
            <StatCard
              icon={<WindCompass degrees={weather.windDegrees} />}
              label="Direction"
              value={weather.windDirection}
              subValue={`${weather.windDegrees}°`}
            />
            <StatCard
              icon={<Thermometer className="h-3 w-3 text-orange-400" />}
              label="Feels Like"
              value={`${weather.apparentTemperature}°`}
              subValue={weather.apparentTemperature > weather.temperature ? "Warmer" : weather.apparentTemperature < weather.temperature ? "Colder" : "Same"}
            />
          </div>

          {/* ── Sun Progress ── */}
          <SunProgress sunrise={weather.sunrise} sunset={weather.sunset} />

          {/* ── 7-Day Forecast ── */}
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">7-Day Forecast</span>
            <div className="flex flex-col gap-0.5">
              {weather.forecast.map((day) => (
                <div
                  key={day.date}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-muted/50 transition-colors"
                >
                  <span className="text-xs font-medium text-foreground w-8 shrink-0">{day.day}</span>
                  <WeatherIcon condition={day.condition} className="h-4 w-4 shrink-0" />
                  {/* Precipitation probability */}
                  <div className="flex items-center gap-0.5 w-10 shrink-0">
                    {day.precipitationProbability > 0 ? (
                      <>
                        <Umbrella className={cn("h-2.5 w-2.5", precipColor(day.precipitationProbability))} />
                        <span className={cn("text-[10px] tabular-nums", precipColor(day.precipitationProbability))}>
                          {day.precipitationProbability}%
                        </span>
                      </>
                    ) : (
                      <span className="text-[10px] text-muted-foreground/40">--</span>
                    )}
                  </div>
                  {/* Temperature bar */}
                  <div className="flex-1 flex items-center gap-1.5">
                    <span className={cn("text-[10px] tabular-nums font-medium w-5 text-right", tempColor(day.low))}>
                      {day.low}°
                    </span>
                    <TemperatureBar low={day.low} high={day.high} forecast={weather.forecast} />
                    <span className={cn("text-[10px] tabular-nums font-semibold w-5", tempColor(day.high))}>
                      {day.high}°
                    </span>
                  </div>
                  {/* Wind */}
                  <div className="flex items-center gap-0.5 shrink-0">
                    <WindCompass degrees={0} className="h-2.5 w-2.5 opacity-50" />
                    <span className="text-[9px] text-muted-foreground tabular-nums">{day.windSpeedMax}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </WidgetWrapper>
  );
}

// ─── Temperature Range Bar ───────────────────────────────────────────────────

function TemperatureBar({ low, high, forecast }: { low: number; high: number; forecast: ForecastDay[] }) {
  // Calculate global min/max across all forecast days for relative positioning
  const globalMin = Math.min(...forecast.map(d => d.low));
  const globalMax = Math.max(...forecast.map(d => d.high));
  const range = globalMax - globalMin || 1;

  const leftPct = ((low - globalMin) / range) * 100;
  const widthPct = ((high - low) / range) * 100;

  return (
    <div className="flex-1 h-1.5 bg-muted rounded-full relative overflow-hidden">
      <div
        className="absolute inset-y-0 rounded-full bg-gradient-to-r from-sky-400 via-emerald-400 to-amber-400"
        style={{ left: `${leftPct}%`, width: `${Math.max(widthPct, 4)}%` }}
      />
    </div>
  );
}
