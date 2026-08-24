"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  Activity,
  Cpu,
  HardDrive,
  MemoryStick,
  Network,
  Zap,
  Battery,
  BatteryCharging,
  Thermometer,
  Server,
  ArrowDown,
  ArrowUp,
  Search,
  X,
  Skull,
  ArrowUpDown,
  ChevronDown,
  ChevronRight,
  Monitor,
  Gauge,
  RefreshCw,
  Pause,
  Play,
  Layers,
  Plus,
  Trash2,
  Settings,
  Scale,
  HeartPulse,
  CircleCheck,
  CircleAlert,
  CircleX,
  CircleDashed,
  Pin,
  PinOff,
  EyeOff,
  RotateCw,
  Square,
  Pencil,
  Check,
  ScrollText,
  Plug,
  Container,
  Loader,
} from "lucide-react";
import { WidgetWrapper } from "@/components/widget-wrapper";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { useRefreshOnVisible } from "@/hooks/use-refresh-on-visible";
import { useWidgetNavFor } from "@/components/widget-nav-context";
import type {
  ControlAction,
  ServiceHealth,
  ServiceInfo,
  ServiceTier,
  ServicesSnapshot,
} from "@/lib/service-monitor";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface ProcessInfo {
  user: string;
  pid: number;
  cpu: number;
  mem: number;
  vsz: number;
  rss: number;
  stat: string;
  started: string;
  time: string;
  command: string;
  shortName: string;
}

interface ProcessDetail {
  pid: number;
  openFiles: number;
  threads: number;
  ports: { name: string; type: string; state: string }[];
  envLength: number;
}

interface DiskInfo {
  mount: string;
  filesystem: string;
  total: number;
  used: number;
  available: number;
  usedPercent: number;
}

interface SystemMetrics {
  cpu: {
    perCore: number[];
    average: number;
    frequency?: number;
  };
  memory: {
    total: number;
    used: number;
    free: number;
    usedPercent: number;
    pressure: string;
    swap: { total: number; used: number };
    breakdown: {
      wired: number;
      active: number;
      inactive: number;
      compressed: number;
      purgeable: number;
    } | null;
  };
  disks: DiskInfo[];
  diskIO: { kbPerTransfer: number; transfersPerSec: number; mbPerSec: number } | null;
  network: {
    interfaces: { name: string; address: string; mac: string; family: string }[];
    bytesIn: number;
    bytesOut: number;
    perInterface: { name: string; bytesIn: number; bytesOut: number; packetsIn: number; packetsOut: number }[];
  };
  processes: ProcessInfo[];
  processCount: number;
  openFiles: number;
  loadAverage: { "1m": number; "5m": number; "15m": number };
  gpu: { model: string; vram: string | null; metal: string | null; cores: string | null; utilization: number | null } | null;
  system: {
    hostname: string;
    platform: string;
    arch: string;
    release: string;
    osVersion: string | null;
    cpuModel: string;
    cpuCores: number;
    uptime: string;
    uptimeSeconds: number;
    battery: { percent: number; charging: boolean; timeRemaining: string | null; cycleCount: number | null } | null;
    cpuTemp: number | null;
    serial: string | null;
    userInfo: string;
  };
  timestamp: number;
}

type Tab = "overview" | "services" | "cpu" | "memory" | "processes" | "network" | "disks" | "system";
type ProcessSort = "cpu" | "mem" | "pid" | "name" | "rss";

// ─── Helper functions ──────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function formatBytesShort(bytes: number): string {
  if (!bytes || bytes <= 0) return "0";
  const units = ["B", "K", "M", "G", "T"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 2 ? 1 : 0)}${units[i]}`;
}

function formatDuration(seconds: number | null): string {
  if (seconds === null || seconds < 0) return "—";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${Math.floor(seconds)}s`;
}

// ─── Service health presentation ───────────────────────────────────────────────

const HEALTH_META: Record<ServiceHealth, { label: string; dot: string; text: string; icon: React.ReactNode }> = {
  healthy: { label: "Healthy", dot: "bg-green-500", text: "text-green-600 dark:text-green-500", icon: <CircleCheck className="h-3 w-3" /> },
  degraded: { label: "Degraded", dot: "bg-amber-500", text: "text-amber-600 dark:text-amber-500", icon: <CircleAlert className="h-3 w-3" /> },
  failed: { label: "Failed", dot: "bg-destructive", text: "text-destructive", icon: <CircleX className="h-3 w-3" /> },
  starting: { label: "Starting", dot: "bg-blue-500", text: "text-blue-600 dark:text-blue-500", icon: <Loader className="h-3 w-3 animate-spin" /> },
  stopped: { label: "Stopped", dot: "bg-muted-foreground/50", text: "text-muted-foreground", icon: <CircleDashed className="h-3 w-3" /> },
  unknown: { label: "Unknown", dot: "bg-muted-foreground/50", text: "text-muted-foreground", icon: <CircleDashed className="h-3 w-3" /> },
};

const TIER_META: Record<ServiceTier, { label: string; hint: string }> = {
  app: { label: "Your services", hint: "Installed by you — user units, containers and supervised process trees" },
  infra: { label: "Infrastructure", hint: "Databases, web servers and other daemons you depend on" },
  system: { label: "System", hint: "OS plumbing — correct to run, rarely worth watching" },
};

// ─── Sparkline Component ───────────────────────────────────────────────────────

function Sparkline({
  data,
  max = 100,
  width = 120,
  height = 32,
  color = "var(--primary)",
  fillOpacity = 0.15,
  className,
}: {
  data: number[];
  max?: number;
  width?: number;
  height?: number;
  color?: string;
  fillOpacity?: number;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || data.length < 2) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    const padding = 1;
    const graphWidth = width - padding * 2;
    const graphHeight = height - padding * 2;
    const step = graphWidth / (data.length - 1);

    const style = getComputedStyle(document.documentElement);
    let computedColor = color;
    if (color.startsWith("var(")) {
      computedColor = style.getPropertyValue(color.slice(4, -1)).trim() || "#888";
    }

    // Fill
    ctx.beginPath();
    ctx.moveTo(padding, height - padding);
    data.forEach((value, i) => {
      const x = padding + i * step;
      const y = padding + graphHeight - (Math.min(value, max) / max) * graphHeight;
      ctx.lineTo(x, y);
    });
    ctx.lineTo(padding + (data.length - 1) * step, height - padding);
    ctx.closePath();
    ctx.fillStyle = computedColor + Math.round(fillOpacity * 255).toString(16).padStart(2, "0");
    ctx.fill();

    // Line
    ctx.beginPath();
    data.forEach((value, i) => {
      const x = padding + i * step;
      const y = padding + graphHeight - (Math.min(value, max) / max) * graphHeight;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = computedColor;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = "round";
    ctx.stroke();

    // Dot
    const lastValue = data[data.length - 1];
    const lastX = padding + (data.length - 1) * step;
    const lastY = padding + graphHeight - (Math.min(lastValue, max) / max) * graphHeight;
    ctx.beginPath();
    ctx.arc(lastX, lastY, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = computedColor;
    ctx.fill();
  }, [data, max, width, height, color, fillOpacity]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className={cn("block", className)}
      style={{ width, height }}
    />
  );
}

// ─── Progress Ring ─────────────────────────────────────────────────────────────

function ProgressRing({
  value,
  size = 64,
  strokeWidth = 6,
  className,
  children,
}: {
  value: number;
  size?: number;
  strokeWidth?: number;
  className?: string;
  children?: React.ReactNode;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (Math.min(value, 100) / 100) * circumference;

  const getColor = (v: number) => {
    if (v >= 90) return "text-destructive";
    if (v >= 70) return "text-amber-500";
    return "text-primary";
  };

  return (
    <div className={cn("relative inline-flex items-center justify-center", className)}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          className="text-muted/30"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className={cn("transition-all duration-700 ease-out", getColor(value))}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        {children}
      </div>
    </div>
  );
}

// ─── Progress Bar ──────────────────────────────────────────────────────────────

function ProgressBar({
  value,
  label,
  detail,
  size = "md",
  color,
}: {
  value: number;
  label: string;
  detail?: string;
  size?: "sm" | "md";
  color?: string;
}) {
  const getColor = (v: number) => {
    if (color) return color;
    if (v >= 90) return "bg-destructive";
    if (v >= 70) return "bg-amber-500";
    return "bg-primary";
  };

  return (
    <div className="space-y-1">
      <div className="flex justify-between items-center">
        <span className={cn("text-muted-foreground", size === "sm" ? "text-[0.625rem]" : "text-xs")}>
          {label}
        </span>
        <span className={cn("font-mono tabular-nums", size === "sm" ? "text-[0.625rem]" : "text-xs")}>
          {detail || `${value}%`}
        </span>
      </div>
      <div className={cn("w-full rounded-full bg-muted/50", size === "sm" ? "h-1" : "h-1.5")}>
        <div
          className={cn(
            "rounded-full transition-all duration-700 ease-out",
            size === "sm" ? "h-1" : "h-1.5",
            getColor(value)
          )}
          style={{ width: `${Math.min(value, 100)}%` }}
        />
      </div>
    </div>
  );
}

// ─── Stacked Bar (for memory breakdown) ────────────────────────────────────────

function StackedBar({ segments }: { segments: { label: string; value: number; color: string }[] }) {
  const total = segments.reduce((s, seg) => s + seg.value, 0);
  if (total === 0) return null;
  return (
    <div className="space-y-1">
      <div className="flex h-2 rounded-full overflow-hidden bg-muted/50">
        {segments.map((seg) => (
          <div
            key={seg.label}
            className={cn("transition-all duration-700", seg.color)}
            style={{ width: `${(seg.value / total) * 100}%` }}
            title={`${seg.label}: ${formatBytes(seg.value)}`}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5">
        {segments.filter((s) => s.value > 0).map((seg) => (
          <div key={seg.label} className="flex items-center gap-1 text-[0.5625rem] text-muted-foreground">
            <div className={cn("w-2 h-2 rounded-sm", seg.color)} />
            <span>{seg.label}</span>
            <span className="font-mono">{formatBytes(seg.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main Widget ───────────────────────────────────────────────────────────────

export function SystemMonitorWidget() {
  const [metrics, setMetrics] = useState<SystemMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [cpuHistory, setCpuHistory] = useState<number[]>([]);
  const [memHistory, setMemHistory] = useState<number[]>([]);
  const [netInHistory, setNetInHistory] = useState<number[]>([]);
  const [netOutHistory, setNetOutHistory] = useState<number[]>([]);
  const prevNetRef = useRef<{ bytesIn: number; bytesOut: number; time: number } | null>(null);
  const [netSpeed, setNetSpeed] = useState({ inPerSec: 0, outPerSec: 0 });
  const [paused, setPaused] = useState(false);
  const [refreshInterval, setRefreshInterval] = useState(3000);
  const { expandRequested, onExpandHandled } = useWidgetNavFor("system-monitor");

  // Process controls
  const [processSort, setProcessSort] = useState<ProcessSort>("cpu");
  const [processSortDir, setProcessSortDir] = useState<"asc" | "desc">("desc");
  const [processSearch, setProcessSearch] = useState("");
  const [searchResults, setSearchResults] = useState<ProcessInfo[] | null>(null);
  const [selectedPid, setSelectedPid] = useState<number | null>(null);
  const [processDetail, setProcessDetail] = useState<ProcessDetail | null>(null);
  const [killConfirm, setKillConfirm] = useState<number | null>(null);
  const [killMessage, setKillMessage] = useState<string | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [processExpanded, _setProcessExpanded] = useState<Set<number>>(new Set());

  // Swap management state
  const [swapInfo, setSwapInfo] = useState<{
    swapFiles: { filename: string; type: string; size: number; used: number; priority: number }[];
    swappiness: number;
  } | null>(null);
  const [swapAction, setSwapAction] = useState<"none" | "create" | "resize">("none");
  const [swapSizeMB, setSwapSizeMB] = useState("1024");
  const [swapPath, setSwapPath] = useState("/swapfile");
  const [swapResizeTarget, setSwapResizeTarget] = useState("");
  const [swapMessage, setSwapMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [swapLoading, setSwapLoading] = useState(false);
  const [swappinessValue, setSwappinessValue] = useState("60");

  // Service monitor state
  const [servicesData, setServicesData] = useState<ServicesSnapshot | null>(null);
  const [servicesError, setServicesError] = useState<string | null>(null);
  const [servicesLoading, setServicesLoading] = useState(true);
  const [serviceSearch, setServiceSearch] = useState("");
  const [expandedService, setExpandedService] = useState<string | null>(null);
  const [showSystemTier, setShowSystemTier] = useState(false);
  const [serviceBusy, setServiceBusy] = useState<string | null>(null);
  const [serviceMessage, setServiceMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [controlConfirm, setControlConfirm] = useState<{ id: string; operation: ControlAction } | null>(null);
  const [serviceLogs, setServiceLogs] = useState<{ id: string; logs: string; error: string | null } | null>(null);
  const [aliasDraft, setAliasDraft] = useState<{ id: string; value: string } | null>(null);
  const [checkDraft, setCheckDraft] = useState<{ id: string; value: string } | null>(null);

  const MAX_HISTORY = 60;

  const fetchMetrics = useCallback(async () => {
    if (paused) return;
    try {
      const res = await fetch(`/api/system?sortBy=${processSort}&processLimit=30`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: SystemMetrics = await res.json();
      setMetrics(data);
      setError(null);

      setCpuHistory((prev) => [...prev.slice(-(MAX_HISTORY - 1)), data.cpu.average]);
      setMemHistory((prev) => [...prev.slice(-(MAX_HISTORY - 1)), data.memory.usedPercent]);

      // Network speed
      const now = Date.now();
      if (prevNetRef.current) {
        const elapsed = (now - prevNetRef.current.time) / 1000;
        if (elapsed > 0) {
          const inDelta = Math.max(0, data.network.bytesIn - prevNetRef.current.bytesIn);
          const outDelta = Math.max(0, data.network.bytesOut - prevNetRef.current.bytesOut);
          const inPerSec = Math.round(inDelta / elapsed);
          const outPerSec = Math.round(outDelta / elapsed);
          setNetSpeed({ inPerSec, outPerSec });
          setNetInHistory((prev) => [...prev.slice(-(MAX_HISTORY - 1)), inPerSec]);
          setNetOutHistory((prev) => [...prev.slice(-(MAX_HISTORY - 1)), outPerSec]);
        }
      }
      prevNetRef.current = { bytesIn: data.network.bytesIn, bytesOut: data.network.bytesOut, time: now };
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch");
    } finally {
      setLoading(false);
    }
  }, [paused, processSort]);

  useEffect(() => {
    fetchMetrics();
    const interval = setInterval(fetchMetrics, refreshInterval);
    return () => clearInterval(interval);
  }, [fetchMetrics, refreshInterval]);

  // Refresh metrics when tab becomes visible after being hidden 30s+
  useRefreshOnVisible(fetchMetrics);

  // Process search
  const handleProcessSearch = useCallback(async (query: string) => {
    setProcessSearch(query);
    if (!query.trim()) {
      setSearchResults(null);
      return;
    }
    try {
      const res = await fetch("/api/system", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "search-processes", query }),
      });
      const data = await res.json();
      setSearchResults(data.processes || []);
    } catch {
      setSearchResults([]);
    }
  }, []);

  // Process detail
  const fetchProcessDetail = useCallback(async (pid: number) => {
    try {
      const res = await fetch("/api/system", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "process-detail", pid }),
      });
      const data = await res.json();
      setProcessDetail(data);
    } catch {
      setProcessDetail(null);
    }
  }, []);

  // Kill process
  const handleKillProcess = useCallback(async (pid: number, signal: string = "SIGTERM") => {
    try {
      const res = await fetch("/api/system", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "kill", pid, signal }),
      });
      const data = await res.json();
      if (data.success) {
        setKillMessage(`Sent ${signal} to PID ${pid}`);
        setKillConfirm(null);
      } else {
        setKillMessage(`Failed: ${data.error}`);
      }
      setTimeout(() => setKillMessage(null), 3000);
    } catch {
      setKillMessage("Failed to send signal");
      setTimeout(() => setKillMessage(null), 3000);
    }
  }, []);

  // Swap management
  const fetchSwapInfo = useCallback(async () => {
    try {
      const res = await fetch("/api/system", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "swap-info" }),
      });
      const data = await res.json();
      if (!data.error) {
        setSwapInfo(data);
        setSwappinessValue(String(data.swappiness));
      }
    } catch { /* ignore */ }
  }, []);

  const handleSwapCreate = useCallback(async () => {
    setSwapLoading(true);
    setSwapMessage(null);
    try {
      const res = await fetch("/api/system", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "swap-create", sizeMB: parseInt(swapSizeMB, 10), path: swapPath }),
      });
      const data = await res.json();
      if (data.success) {
        setSwapMessage({ type: "success", text: data.message });
        setSwapAction("none");
        fetchSwapInfo();
      } else {
        setSwapMessage({ type: "error", text: data.error });
      }
    } catch (err) {
      setSwapMessage({ type: "error", text: err instanceof Error ? err.message : "Failed" });
    } finally {
      setSwapLoading(false);
    }
  }, [swapSizeMB, swapPath, fetchSwapInfo]);

  const handleSwapResize = useCallback(async () => {
    setSwapLoading(true);
    setSwapMessage(null);
    try {
      const res = await fetch("/api/system", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "swap-resize", sizeMB: parseInt(swapSizeMB, 10), path: swapResizeTarget }),
      });
      const data = await res.json();
      if (data.success) {
        setSwapMessage({ type: "success", text: data.message });
        setSwapAction("none");
        fetchSwapInfo();
      } else {
        setSwapMessage({ type: "error", text: data.error });
      }
    } catch (err) {
      setSwapMessage({ type: "error", text: err instanceof Error ? err.message : "Failed" });
    } finally {
      setSwapLoading(false);
    }
  }, [swapSizeMB, swapResizeTarget, fetchSwapInfo]);

  const handleSwapRemove = useCallback(async (path: string) => {
    setSwapLoading(true);
    setSwapMessage(null);
    try {
      const res = await fetch("/api/system", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "swap-remove", path }),
      });
      const data = await res.json();
      if (data.success) {
        setSwapMessage({ type: "success", text: data.message });
        fetchSwapInfo();
      } else {
        setSwapMessage({ type: "error", text: data.error });
      }
    } catch (err) {
      setSwapMessage({ type: "error", text: err instanceof Error ? err.message : "Failed" });
    } finally {
      setSwapLoading(false);
    }
  }, [fetchSwapInfo]);

  const handleSwappinessChange = useCallback(async () => {
    setSwapLoading(true);
    setSwapMessage(null);
    try {
      const res = await fetch("/api/system", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "swap-swappiness", value: parseInt(swappinessValue, 10) }),
      });
      const data = await res.json();
      if (data.success) {
        setSwapMessage({ type: "success", text: data.message });
        fetchSwapInfo();
      } else {
        setSwapMessage({ type: "error", text: data.error });
      }
    } catch (err) {
      setSwapMessage({ type: "error", text: err instanceof Error ? err.message : "Failed" });
    } finally {
      setSwapLoading(false);
    }
  }, [swappinessValue, fetchSwapInfo]);

  // ─── Services ──────────────────────────────────────────────────────────────

  const showSystemAdopted = useRef(false);

  const fetchServices = useCallback(async () => {
    try {
      const res = await fetch("/api/system/services");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: ServicesSnapshot = await res.json();
      setServicesData(data);
      // Adopt the saved toggle once. Re-applying it on every poll would race
      // the optimistic local flip against the write that persists it.
      if (!showSystemAdopted.current) {
        showSystemAdopted.current = true;
        setShowSystemTier(data.prefs.showSystem);
      }
      setServicesError(null);
    } catch (err) {
      setServicesError(err instanceof Error ? err.message : "Failed to load services");
    } finally {
      setServicesLoading(false);
    }
  }, []);

  // Services poll on their own, slower cadence: the endpoint shells out to
  // systemctl/ps/ss, and the CPU figure is a delta between two samples, so a
  // longer gap is both cheaper and more accurate than the metrics tick.
  useEffect(() => {
    if (paused) return;
    fetchServices();
    const interval = setInterval(fetchServices, 10000);
    return () => clearInterval(interval);
  }, [fetchServices, paused]);

  const flashServiceMessage = useCallback((type: "success" | "error", text: string) => {
    setServiceMessage({ type, text });
    setTimeout(() => setServiceMessage(null), 4000);
  }, []);

  const postService = useCallback(async (body: Record<string, unknown>) => {
    const res = await fetch("/api/system/services", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return res.json();
  }, []);

  const handleServiceControl = useCallback(
    async (service: ServiceInfo, operation: ControlAction) => {
      setServiceBusy(service.id);
      setControlConfirm(null);
      try {
        const data = await postService({
          action: "control",
          id: service.id,
          operation,
          source: service.source,
        });
        flashServiceMessage(data.success ? "success" : "error", data.message || data.error || "Failed");
        // systemd returns as soon as the job is queued; give the unit a moment
        // to settle before reading its new state.
        setTimeout(fetchServices, 1200);
      } catch (err) {
        flashServiceMessage("error", err instanceof Error ? err.message : "Failed");
      } finally {
        setServiceBusy(null);
      }
    },
    [postService, flashServiceMessage, fetchServices]
  );

  const handleServiceLogs = useCallback(
    async (service: ServiceInfo) => {
      if (serviceLogs?.id === service.id) {
        setServiceLogs(null);
        return;
      }
      setServiceBusy(service.id);
      try {
        const data = await postService({ action: "logs", id: service.id, source: service.source, lines: 100 });
        setServiceLogs({ id: service.id, logs: data.logs || "", error: data.error ?? null });
      } catch (err) {
        setServiceLogs({ id: service.id, logs: "", error: err instanceof Error ? err.message : "Failed" });
      } finally {
        setServiceBusy(null);
      }
    },
    [postService, serviceLogs]
  );

  const handleServicePref = useCallback(
    async (body: Record<string, unknown>) => {
      try {
        const data = await postService(body);
        if (data.error) flashServiceMessage("error", data.error);
        else fetchServices();
      } catch (err) {
        flashServiceMessage("error", err instanceof Error ? err.message : "Failed");
      }
    },
    [postService, flashServiceMessage, fetchServices]
  );

  const visibleServices = useMemo(() => {
    const all = servicesData?.services ?? [];
    const q = serviceSearch.trim().toLowerCase();
    if (!q) return all;
    return all.filter((s) =>
      [s.name, s.id, s.description ?? "", ...s.ports.map((p) => String(p.port)), ...s.processes.map((p) => p.comm)]
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }, [servicesData, serviceSearch]);

  // Sorted + filtered processes
  const sortedProcesses = useMemo(() => {
    const procs = searchResults || metrics?.processes || [];
    const sorted = [...procs].sort((a, b) => {
      let cmp = 0;
      switch (processSort) {
        case "cpu": cmp = a.cpu - b.cpu; break;
        case "mem": cmp = a.mem - b.mem; break;
        case "rss": cmp = a.rss - b.rss; break;
        case "pid": cmp = a.pid - b.pid; break;
        case "name": cmp = a.shortName.localeCompare(b.shortName); break;
      }
      return processSortDir === "desc" ? -cmp : cmp;
    });
    return sorted;
  }, [metrics?.processes, searchResults, processSort, processSortDir]);

  // ─── Tab navigation ────────────────────────────────────────────────────────

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "overview", label: "Overview", icon: <Activity className="h-3 w-3" /> },
    { id: "services", label: "Services", icon: <HeartPulse className="h-3 w-3" /> },
    { id: "cpu", label: "CPU", icon: <Cpu className="h-3 w-3" /> },
    { id: "memory", label: "Memory", icon: <MemoryStick className="h-3 w-3" /> },
    { id: "processes", label: "Processes", icon: <Server className="h-3 w-3" /> },
    { id: "network", label: "Network", icon: <Network className="h-3 w-3" /> },
    { id: "disks", label: "Disks", icon: <HardDrive className="h-3 w-3" /> },
    { id: "system", label: "System", icon: <Monitor className="h-3 w-3" /> },
  ];

  // ─── Render sections ───────────────────────────────────────────────────────

  const renderContent = () => {
    if (loading && !metrics && activeTab !== "services") {
      return (
        <div className="flex items-center justify-center h-32">
          <div className="flex flex-col items-center gap-2 text-muted-foreground">
            <Activity className="h-5 w-5 animate-pulse" />
            <span className="text-xs">Collecting metrics...</span>
          </div>
        </div>
      );
    }
    if (activeTab === "services") return renderServices();
    if (error && !metrics) {
      return (
        <div className="flex items-center justify-center h-32">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      );
    }
    if (!metrics) return null;

    switch (activeTab) {
      case "overview": return renderOverview();
      case "cpu": return renderCpu();
      case "memory": return renderMemory();
      case "processes": return renderProcesses();
      case "network": return renderNetwork();
      case "disks": return renderDisks();
      case "system": return renderSystem();
    }
  };

  // ─── Overview ──────────────────────────────────────────────────────────────

  const renderOverview = () => {
    if (!metrics) return null;
    return (
      <div className="space-y-3">
        {/* Ring gauges */}
        <div className="grid grid-cols-3 gap-3">
          <div className="flex flex-col items-center gap-1">
            <ProgressRing value={metrics.cpu.average} size={52} strokeWidth={5}>
              <span className="text-[0.625rem] font-bold tabular-nums">{metrics.cpu.average}%</span>
            </ProgressRing>
            <span className="text-[0.5625rem] text-muted-foreground font-medium">CPU</span>
          </div>
          <div className="flex flex-col items-center gap-1">
            <ProgressRing value={metrics.memory.usedPercent} size={52} strokeWidth={5}>
              <span className="text-[0.625rem] font-bold tabular-nums">{metrics.memory.usedPercent}%</span>
            </ProgressRing>
            <span className="text-[0.5625rem] text-muted-foreground font-medium">RAM</span>
          </div>
          <div className="flex flex-col items-center gap-1">
            <ProgressRing value={metrics.disks[0]?.usedPercent || 0} size={52} strokeWidth={5}>
              <span className="text-[0.625rem] font-bold tabular-nums">{metrics.disks[0]?.usedPercent || 0}%</span>
            </ProgressRing>
            <span className="text-[0.5625rem] text-muted-foreground font-medium">Disk</span>
          </div>
        </div>

        {/* Service health — the "is everything still up?" line */}
        {servicesData && (
          <button
            onClick={() => setActiveTab("services")}
            className="w-full rounded-md border p-2 flex items-center justify-between gap-2 hover:bg-muted/50 transition-colors text-left"
          >
            <span className="flex items-center gap-1.5 min-w-0">
              <HeartPulse className="h-3 w-3 text-muted-foreground shrink-0" />
              <span className="text-[0.625rem] text-muted-foreground">Services</span>
            </span>
            <span className="flex items-center gap-2 text-[0.625rem] font-mono tabular-nums shrink-0">
              <span className="text-green-600 dark:text-green-500">{servicesData.summary.healthy} up</span>
              {servicesData.summary.degraded > 0 && (
                <span className="text-amber-600 dark:text-amber-500">{servicesData.summary.degraded} degraded</span>
              )}
              {servicesData.summary.failed > 0 && (
                <span className="text-destructive">{servicesData.summary.failed} failed</span>
              )}
              {servicesData.summary.stopped > 0 && (
                <span className="text-muted-foreground">{servicesData.summary.stopped} stopped</span>
              )}
              <ChevronRight className="h-3 w-3 text-muted-foreground" />
            </span>
          </button>
        )}

        {/* CPU Sparkline */}
        <div className="rounded-md border p-2 space-y-1">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Cpu className="h-3 w-3 text-muted-foreground" />
              <span className="text-[0.625rem] text-muted-foreground">CPU History</span>
            </div>
            <span className="text-[0.625rem] font-mono tabular-nums">{metrics.cpu.average}%</span>
          </div>
          <Sparkline data={cpuHistory} width={280} height={28} className="w-full" />
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 gap-2 text-[0.625rem]">
          <div className="rounded-md border p-2 space-y-1">
            <div className="flex items-center gap-1 text-muted-foreground">
              <Zap className="h-3 w-3" />
              <span>Load</span>
            </div>
            <div className="font-mono tabular-nums text-xs">
              {metrics.loadAverage["1m"]} / {metrics.loadAverage["5m"]} / {metrics.loadAverage["15m"]}
            </div>
          </div>
          <div className="rounded-md border p-2 space-y-1">
            <div className="flex items-center gap-1 text-muted-foreground">
              <Network className="h-3 w-3" />
              <span>Network</span>
            </div>
            <div className="font-mono tabular-nums text-xs flex items-center gap-2">
              <span className="flex items-center gap-0.5 text-green-500">
                <ArrowDown className="h-2.5 w-2.5" />
                {formatBytesShort(netSpeed.inPerSec)}/s
              </span>
              <span className="flex items-center gap-0.5 text-blue-500">
                <ArrowUp className="h-2.5 w-2.5" />
                {formatBytesShort(netSpeed.outPerSec)}/s
              </span>
            </div>
          </div>
          <div className="rounded-md border p-2 space-y-1">
            <div className="flex items-center gap-1 text-muted-foreground">
              <Layers className="h-3 w-3" />
              <span>Processes</span>
            </div>
            <div className="font-mono tabular-nums text-xs">{metrics.processCount}</div>
          </div>
          <div className="rounded-md border p-2 space-y-1">
            <div className="flex items-center gap-1 text-muted-foreground">
              <Gauge className="h-3 w-3" />
              <span>Disk I/O</span>
            </div>
            <div className="font-mono tabular-nums text-xs">
              {metrics.diskIO ? `${(metrics.diskIO.mbPerSec ?? 0).toFixed(1)} MB/s` : "N/A"}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between text-[0.5625rem] text-muted-foreground px-1">
          <span className="flex items-center gap-1">
            <Server className="h-3 w-3" />
            {metrics.system.uptime}
          </span>
          {metrics.system.battery && (
            <span className="flex items-center gap-1">
              {metrics.system.battery.charging ? (
                <BatteryCharging className="h-3 w-3 text-green-500" />
              ) : (
                <Battery className="h-3 w-3" />
              )}
              {metrics.system.battery.percent}%
              {metrics.system.battery.timeRemaining && (
                <span className="text-muted-foreground ml-0.5">({metrics.system.battery.timeRemaining})</span>
              )}
            </span>
          )}
          {metrics.gpu && (
            <span className="flex items-center gap-1">
              <Monitor className="h-3 w-3" />
              {metrics.gpu.utilization != null ? `GPU ${metrics.gpu.utilization}%` : "GPU"}
            </span>
          )}
        </div>
      </div>
    );
  };

  // ─── Services ──────────────────────────────────────────────────────────────

  const renderServices = () => {
    const summary = servicesData?.summary;
    const attention = (summary?.failed ?? 0) + (summary?.degraded ?? 0);

    // A search is an explicit request for a specific unit, so it reaches into
    // the collapsed system tier rather than silently returning nothing.
    const tiers: ServiceTier[] =
      showSystemTier || serviceSearch.trim() ? ["app", "infra", "system"] : ["app", "infra"];
    const pinned = visibleServices.filter((s) => s.pinned);
    const systemCount = (servicesData?.services ?? []).filter((s) => s.tier === "system").length;

    const renderRow = (service: ServiceInfo) => {
      const meta = HEALTH_META[service.health];
      const isOpen = expandedService === service.id;
      const busy = serviceBusy === service.id;

      return (
        <div key={service.id} className="border-b last:border-b-0">
          <button
            onClick={() => {
              setExpandedService(isOpen ? null : service.id);
              if (isOpen) setServiceLogs(null);
            }}
            aria-expanded={isOpen}
            className={cn(
              "w-full text-left flex items-center gap-2 px-1 min-h-11 md:min-h-0 md:py-1.5 rounded hover:bg-muted/50 transition-colors",
              isOpen && "bg-muted/40"
            )}
          >
            <span className={cn("h-2 w-2 rounded-full shrink-0", meta.dot)} aria-hidden="true" />
            <span className="flex-1 min-w-0">
              <span className="flex items-center gap-1.5">
                <span className="text-[0.6875rem] font-medium truncate">{service.name}</span>
                {service.source === "docker" && <Container className="h-2.5 w-2.5 shrink-0 text-muted-foreground" />}
                {service.restarts > 0 && (
                  <Badge variant="secondary" className="h-3.5 px-1 text-[0.5rem] shrink-0 tabular-nums">
                    {service.restarts}&times;
                  </Badge>
                )}
                {service.ports.slice(0, 3).map((port) => (
                  <Badge key={`${port.proto}${port.port}`} variant="outline" className="h-3.5 px-1 text-[0.5rem] shrink-0 tabular-nums font-mono">
                    :{port.port}
                  </Badge>
                ))}
              </span>
              <span className="block text-[0.5625rem] text-muted-foreground truncate">
                {service.healthReason ?? service.description ?? service.id}
              </span>
            </span>
            <span className="shrink-0 text-right text-[0.5625rem] font-mono tabular-nums text-muted-foreground leading-tight">
              <span className="block">{formatDuration(service.uptimeSeconds)}</span>
              <span className="block">
                {service.cpu.toFixed(1)}% · {formatBytesShort(service.memory)}
              </span>
            </span>
            {isOpen ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
          </button>

          {isOpen && (
            <div className="px-2 pb-2 space-y-2 text-[0.5625rem]">
              {/* Facts */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-1 rounded border bg-muted/20 p-2">
                <div>
                  <span className="text-muted-foreground">Status:</span>{" "}
                  <span className={cn("font-medium", meta.text)}>
                    {meta.label} · {service.activeState}/{service.subState}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">Main PID:</span>{" "}
                  <span className="font-mono">{service.mainPid ?? "—"}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Uptime:</span>{" "}
                  <span className="font-mono">{formatDuration(service.uptimeSeconds)}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Restarts:</span>{" "}
                  <span className="font-mono">{service.restarts}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">CPU:</span>{" "}
                  <span className="font-mono">{service.cpu.toFixed(1)}%</span>
                  <span className="text-muted-foreground"> of one core</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Memory:</span>{" "}
                  <span className="font-mono">
                    {formatBytes(service.memory)}
                    <span className="text-muted-foreground"> ({service.memorySource})</span>
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">On boot:</span>{" "}
                  <span className="font-medium">
                    {service.enabled === null ? "—" : service.enabled ? "enabled" : "disabled"}
                  </span>
                </div>
                <div className="col-span-2 sm:col-span-3 break-all">
                  <span className="text-muted-foreground">Unit:</span>{" "}
                  <span className="font-mono">{service.id}</span>
                  <span className="text-muted-foreground"> · {service.source}</span>
                </div>
                {service.statusText && (
                  <div className="col-span-2 sm:col-span-3 break-all">
                    <span className="text-muted-foreground">Reports:</span> {service.statusText}
                  </div>
                )}
              </div>

              {/* Health check */}
              <div className="rounded border p-2 space-y-1.5">
                <div className="flex items-center gap-1 text-muted-foreground">
                  <HeartPulse className="h-3 w-3" />
                  <span className="font-medium">Health check</span>
                </div>
                {service.probe && (
                  <div className={cn("font-mono", service.probe.ok ? "text-green-600 dark:text-green-500" : "text-destructive")}>
                    {service.probe.ok ? "OK" : "FAIL"} {service.probe.status ?? ""}{" "}
                    {service.probe.latencyMs !== null && `· ${service.probe.latencyMs}ms`}
                    {service.probe.error && ` · ${service.probe.error}`}
                  </div>
                )}
                <div className="flex flex-wrap md:flex-nowrap items-center gap-1">
                  <Input
                    value={checkDraft?.id === service.id ? checkDraft.value : service.check?.url ?? ""}
                    onChange={(e) => setCheckDraft({ id: service.id, value: e.target.value })}
                    placeholder="http://127.0.0.1:8080/health"
                    className="h-11 md:h-7 flex-1 text-[0.5625rem] font-mono"
                  />
                  <Button
                    size="sm"
                    variant="secondary"
                    className="h-11 md:h-7 text-[0.5625rem] px-2"
                    onClick={() => {
                      const url = checkDraft?.id === service.id ? checkDraft.value : service.check?.url ?? "";
                      handleServicePref({ action: "set-check", id: service.id, check: url ? { url } : null });
                      setCheckDraft(null);
                    }}
                  >
                    Save
                  </Button>
                </div>
                <p className="text-muted-foreground">
                  An HTTP probe turns &ldquo;the process exists&rdquo; into &ldquo;the service answers&rdquo;.
                </p>
              </div>

              {/* Ports */}
              {service.ports.length > 0 && (
                <div className="flex flex-wrap items-center gap-1">
                  <Plug className="h-3 w-3 text-muted-foreground" />
                  {service.ports.map((port) => (
                    <Badge key={`${port.proto}${port.port}`} variant="outline" className="h-4 px-1 text-[0.5rem] font-mono">
                      {port.address}:{port.port}/{port.proto}
                    </Badge>
                  ))}
                </div>
              )}

              {/* Member processes — the grouping the flat process list could not show */}
              {service.processes.length > 0 && (
                <div className="rounded border">
                  <div className="grid grid-cols-[46px_42px_46px_1fr] gap-1 px-1.5 py-1 border-b text-muted-foreground font-medium">
                    <span>PID</span>
                    <span>CPU%</span>
                    <span>RSS</span>
                    <span>Process</span>
                  </div>
                  {service.processes.map((proc) => (
                    <div
                      key={proc.pid}
                      className="grid grid-cols-[46px_42px_46px_1fr] gap-1 px-1.5 py-0.5 font-mono tabular-nums"
                      title={proc.command}
                    >
                      <span className="text-muted-foreground">{proc.pid}</span>
                      <span>{proc.cpu.toFixed(1)}</span>
                      <span className="text-muted-foreground">{formatBytesShort(proc.rss)}</span>
                      <span className="truncate font-sans">
                        {proc.comm}
                        {proc.role && <span className="text-muted-foreground"> — {proc.role}</span>}
                      </span>
                    </div>
                  ))}
                  <div className="px-1.5 py-1 border-t text-muted-foreground">
                    {service.processCount} process{service.processCount === 1 ? "" : "es"} in this group
                  </div>
                </div>
              )}

              {/* Rename */}
              {aliasDraft?.id === service.id ? (
                <div className="flex flex-wrap md:flex-nowrap items-center gap-1">
                  <Input
                    value={aliasDraft.value}
                    onChange={(e) => setAliasDraft({ id: service.id, value: e.target.value })}
                    placeholder="Display name"
                    className="h-11 md:h-7 flex-1 text-[0.5625rem]"
                    autoFocus
                  />
                  <Button
                    size="sm"
                    variant="secondary"
                    className="h-11 md:h-7 text-[0.5625rem] px-2"
                    onClick={() => {
                      handleServicePref({ action: "alias", id: service.id, name: aliasDraft.value });
                      setAliasDraft(null);
                    }}
                  >
                    <Check className="h-2.5 w-2.5 mr-1" />
                    Save
                  </Button>
                  <Button size="sm" variant="ghost" className="h-11 md:h-7 text-[0.5625rem] px-2" onClick={() => setAliasDraft(null)}>
                    Cancel
                  </Button>
                </div>
              ) : null}

              {/* Actions */}
              <div className="flex flex-wrap items-center gap-1 pt-1 border-t">
                {controlConfirm?.id === service.id ? (
                  <>
                    <span className="text-muted-foreground">
                      {controlConfirm.operation} {service.name}?
                    </span>
                    <Button
                      size="sm"
                      variant="destructive"
                      className="h-11 md:h-7 text-[0.5625rem] px-2"
                      onClick={() => handleServiceControl(service, controlConfirm.operation)}
                    >
                      Confirm
                    </Button>
                    <Button size="sm" variant="ghost" className="h-11 md:h-7 text-[0.5625rem] px-2" onClick={() => setControlConfirm(null)}>
                      Cancel
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      size="sm"
                      variant="secondary"
                      className="h-11 md:h-7 text-[0.5625rem] px-2"
                      disabled={busy || !service.canControl}
                      title={service.canControl ? undefined : "System units need root or a polkit rule"}
                      onClick={() => setControlConfirm({ id: service.id, operation: "restart" })}
                    >
                      <RotateCw className="h-2.5 w-2.5 mr-1" />
                      Restart
                    </Button>
                    {service.activeState === "active" ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        className="h-11 md:h-7 text-[0.5625rem] px-2"
                        disabled={busy || !service.canControl}
                        title={service.canControl ? undefined : "System units need root or a polkit rule"}
                        onClick={() => setControlConfirm({ id: service.id, operation: "stop" })}
                      >
                        <Square className="h-2.5 w-2.5 mr-1" />
                        Stop
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="secondary"
                        className="h-11 md:h-7 text-[0.5625rem] px-2"
                        disabled={busy || !service.canControl}
                        title={service.canControl ? undefined : "System units need root or a polkit rule"}
                        onClick={() => handleServiceControl(service, "start")}
                      >
                        <Play className="h-2.5 w-2.5 mr-1" />
                        Start
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-11 md:h-7 text-[0.5625rem] px-2"
                      disabled={busy}
                      onClick={() => handleServiceLogs(service)}
                    >
                      <ScrollText className="h-2.5 w-2.5 mr-1" />
                      {serviceLogs?.id === service.id ? "Hide logs" : "Logs"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-11 md:h-7 text-[0.5625rem] px-2"
                      onClick={() => handleServicePref({ action: service.pinned ? "unpin" : "pin", id: service.id })}
                    >
                      {service.pinned ? <PinOff className="h-2.5 w-2.5 mr-1" /> : <Pin className="h-2.5 w-2.5 mr-1" />}
                      {service.pinned ? "Unpin" : "Pin"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-11 md:h-7 text-[0.5625rem] px-2"
                      onClick={() => setAliasDraft({ id: service.id, value: service.name })}
                    >
                      <Pencil className="h-2.5 w-2.5 mr-1" />
                      Rename
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-11 md:h-7 text-[0.5625rem] px-2"
                      onClick={() => handleServicePref({ action: "hide", id: service.id })}
                    >
                      <EyeOff className="h-2.5 w-2.5 mr-1" />
                      Hide
                    </Button>
                  </>
                )}
              </div>

              {/* Logs */}
              {serviceLogs?.id === service.id && (
                <div className="rounded border bg-muted/30 p-2 max-h-48 overflow-auto">
                  {serviceLogs.error && <p className="text-muted-foreground">{serviceLogs.error}</p>}
                  {serviceLogs.logs && (
                    <pre className="font-mono text-[0.5rem] leading-relaxed whitespace-pre-wrap break-all">
                      {serviceLogs.logs}
                    </pre>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      );
    };

    return (
      <div className="flex flex-col h-full gap-2">
        {/* Toolbar */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
            <Input
              value={serviceSearch}
              onChange={(e) => setServiceSearch(e.target.value)}
              placeholder="Search services, ports, processes..."
              className="h-6 pl-7 pr-7 text-[0.625rem]"
            />
            {serviceSearch && (
              <button
                aria-label="Clear service search"
                onClick={() => setServiceSearch("")}
                className="absolute right-2 top-1/2 -translate-y-1/2"
              >
                <X className="h-3 w-3 text-muted-foreground hover:text-foreground" />
              </button>
            )}
          </div>
          <button
            onClick={() => {
              const next = !showSystemTier;
              setShowSystemTier(next);
              handleServicePref({ action: "set-show-system", value: next });
            }}
            aria-pressed={showSystemTier}
            className={cn(
              "shrink-0 rounded px-2 h-11 md:h-6 text-[0.5625rem] font-medium transition-colors",
              showSystemTier ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted/50"
            )}
          >
            System ({systemCount})
          </button>
        </div>

        {/* Health summary */}
        {summary && (
          <div className="grid grid-cols-4 gap-1 text-center">
            {([
              ["healthy", summary.healthy],
              ["degraded", summary.degraded],
              ["failed", summary.failed],
              ["stopped", summary.stopped],
            ] as [ServiceHealth, number][]).map(([health, count]) => (
              <div
                key={health}
                className={cn(
                  "rounded-md border py-1",
                  count > 0 && (health === "failed" || health === "degraded") && "border-current",
                  count > 0 ? HEALTH_META[health].text : "text-muted-foreground"
                )}
              >
                <div className="flex items-center justify-center gap-1">
                  {HEALTH_META[health].icon}
                  <span className="text-xs font-bold tabular-nums">{count}</span>
                </div>
                <div className="text-[0.5rem]">{HEALTH_META[health].label}</div>
              </div>
            ))}
          </div>
        )}

        {serviceMessage && (
          <div
            className={cn(
              "text-[0.625rem] px-2 py-1 rounded border break-all",
              serviceMessage.type === "error"
                ? "text-destructive border-destructive/30 bg-destructive/5"
                : "text-green-600 border-green-500/30 bg-green-500/5"
            )}
          >
            {serviceMessage.text}
          </div>
        )}

        {servicesError && !servicesData && (
          <p className="text-[0.625rem] text-destructive px-1">{servicesError}</p>
        )}

        {servicesLoading && !servicesData && (
          <div className="flex items-center justify-center h-24 text-muted-foreground gap-2">
            <HeartPulse className="h-4 w-4 animate-pulse" />
            <span className="text-xs">Discovering services...</span>
          </div>
        )}

        <ScrollArea className="flex-1 min-h-0">
          {pinned.length > 0 && (
            <div className="mb-2">
              <div className="flex items-center gap-1 px-1 pb-1 text-[0.5625rem] font-medium text-muted-foreground uppercase tracking-wide">
                <Pin className="h-2.5 w-2.5" />
                Pinned
              </div>
              <div className="rounded-md border">{pinned.map(renderRow)}</div>
            </div>
          )}

          {tiers.map((tier) => {
            const rows = visibleServices.filter((s) => s.tier === tier && !s.pinned);
            if (rows.length === 0) return null;
            return (
              <div key={tier} className="mb-2">
                <div className="px-1 pb-1">
                  <div className="text-[0.5625rem] font-medium text-muted-foreground uppercase tracking-wide">
                    {TIER_META[tier].label} ({rows.length})
                  </div>
                  <div className="text-[0.5rem] text-muted-foreground/70">{TIER_META[tier].hint}</div>
                </div>
                <div className="rounded-md border">{rows.map(renderRow)}</div>
              </div>
            );
          })}

          {servicesData && visibleServices.length === 0 && (
            <p className="text-[0.625rem] text-muted-foreground px-1 py-4 text-center">
              {serviceSearch ? "No services match that search." : "No services discovered on this host."}
            </p>
          )}

          {servicesData && !servicesData.capabilities.systemd && !servicesData.capabilities.launchd && (
            <p className="text-[0.5rem] text-muted-foreground px-1 pb-2">
              No service manager detected — showing long-running process trees that are listening on a port.
            </p>
          )}
        </ScrollArea>

        {attention > 0 && (
          <div className="text-[0.5625rem] text-destructive px-1 border-t pt-1">
            {attention} service{attention === 1 ? "" : "s"} need attention
          </div>
        )}
      </div>
    );
  };

  // ─── CPU ───────────────────────────────────────────────────────────────────

  const renderCpu = () => {
    if (!metrics) return null;
    return (
      <ScrollArea className="h-full">
        <div className="space-y-3 pr-2">
          <div className="rounded-md border p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium">Overall Usage</span>
              <Badge variant={metrics.cpu.average >= 80 ? "destructive" : "secondary"} className="text-[0.625rem] h-4">
                {metrics.cpu.average}%
              </Badge>
            </div>
            <Sparkline data={cpuHistory} width={280} height={40} className="w-full" />
            {metrics.cpu.frequency && (
              <div className="text-[0.625rem] text-muted-foreground">
                Frequency: {metrics.cpu.frequency} MHz
              </div>
            )}
          </div>

          <div className="text-[0.625rem] text-muted-foreground px-1">
            {metrics.system.cpuModel} ({metrics.system.cpuCores} cores)
          </div>

          <div className="space-y-1.5">
            <span className="text-xs font-medium">Per-Core Usage</span>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              {metrics.cpu.perCore.map((usage, i) => (
                <ProgressBar key={i} value={usage} label={`Core ${i}`} size="sm" />
              ))}
            </div>
          </div>

          <div className="rounded-md border p-3 space-y-2">
            <span className="text-xs font-medium">Load Average</span>
            <div className="grid grid-cols-3 gap-2 text-center">
              {(["1m", "5m", "15m"] as const).map((key) => (
                <div key={key}>
                  <div className="text-lg font-bold tabular-nums">{metrics.loadAverage[key]}</div>
                  <div className="text-[0.625rem] text-muted-foreground">{key.replace("m", " min")}</div>
                </div>
              ))}
            </div>
          </div>

          {metrics.system.cpuTemp && (
            <div className="flex items-center gap-2 text-xs p-2 rounded-md border">
              <Thermometer className="h-4 w-4 text-amber-500" />
              <span>CPU Temperature:</span>
              <span className="font-bold">{metrics.system.cpuTemp}°C</span>
            </div>
          )}
        </div>
      </ScrollArea>
    );
  };

  // ─── Memory ────────────────────────────────────────────────────────────────

  const renderMemory = () => {
    if (!metrics) return null;
    const { memory } = metrics;
    return (
      <ScrollArea className="h-full">
        <div className="space-y-3 pr-2">
          <div className="flex items-center gap-4 p-3 rounded-md border">
            <ProgressRing value={memory.usedPercent} size={68} strokeWidth={7}>
              <span className="text-xs font-bold tabular-nums">{memory.usedPercent}%</span>
            </ProgressRing>
            <div className="flex-1 space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Used</span>
                <span className="font-mono tabular-nums">{formatBytes(memory.used)}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Free</span>
                <span className="font-mono tabular-nums">{formatBytes(memory.free)}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Total</span>
                <span className="font-mono tabular-nums">{formatBytes(memory.total)}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Pressure</span>
                <Badge
                  variant={memory.pressure === "nominal" ? "secondary" : "destructive"}
                  className="text-[0.5625rem] h-4"
                >
                  {memory.pressure}
                </Badge>
              </div>
            </div>
          </div>

          {/* Memory breakdown */}
          {memory.breakdown && (
            <div className="rounded-md border p-3 space-y-2">
              <span className="text-xs font-medium">Memory Breakdown</span>
              <StackedBar
                segments={[
                  { label: "Wired", value: memory.breakdown.wired, color: "bg-red-500" },
                  { label: "Active", value: memory.breakdown.active, color: "bg-amber-500" },
                  { label: "Compressed", value: memory.breakdown.compressed, color: "bg-purple-500" },
                  { label: "Inactive", value: memory.breakdown.inactive, color: "bg-blue-400" },
                  { label: "Purgeable", value: memory.breakdown.purgeable, color: "bg-green-400" },
                ]}
              />
            </div>
          )}

          {/* Sparkline */}
          <div className="rounded-md border p-2 space-y-1">
            <span className="text-[0.625rem] text-muted-foreground">Memory History</span>
            <Sparkline data={memHistory} width={280} height={32} color="var(--chart-2)" className="w-full" />
          </div>

          {/* Swap Management */}
          <div className="rounded-md border p-3 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Scale className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs font-medium">Swap</span>
              </div>
              {metrics.system.platform === "linux" && (
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-5 px-1.5 text-[0.5625rem]"
                    onClick={() => { setSwapAction("create"); fetchSwapInfo(); }}
                  >
                    <Plus className="h-3 w-3 mr-0.5" />
                    Add
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-5 px-1.5 text-[0.5625rem]"
                    onClick={() => fetchSwapInfo()}
                  >
                    <Settings className="h-3 w-3" />
                  </Button>
                </div>
              )}
            </div>

            {/* Current swap usage bar */}
            {memory.swap.total > 0 && (
              <ProgressBar
                value={Math.round((memory.swap.used / memory.swap.total) * 100)}
                label=""
                detail={`${formatBytes(memory.swap.used)} / ${formatBytes(memory.swap.total)}`}
              />
            )}
            {memory.swap.total === 0 && (
              <div className="text-[0.625rem] text-muted-foreground italic">
                No swap configured
              </div>
            )}

            {/* Swap message */}
            {swapMessage && (
              <div className={cn(
                "text-[0.625rem] px-2 py-1.5 rounded border",
                swapMessage.type === "error"
                  ? "text-destructive border-destructive/30 bg-destructive/5"
                  : "text-green-600 border-green-500/30 bg-green-500/5"
              )}>
                {swapMessage.text}
              </div>
            )}

            {/* Swap files list (Linux) */}
            {swapInfo && swapInfo.swapFiles.length > 0 && (
              <div className="space-y-1.5">
                <span className="text-[0.625rem] text-muted-foreground font-medium">Active Swap Files</span>
                {swapInfo.swapFiles.map((sf) => (
                  <div key={sf.filename} className="flex items-center justify-between text-[0.625rem] p-1.5 rounded border bg-muted/20">
                    <div className="flex-1 min-w-0">
                      <div className="font-mono truncate" title={sf.filename}>{sf.filename}</div>
                      <div className="text-muted-foreground">
                        {formatBytes(sf.used)} / {formatBytes(sf.size)} ({sf.type}, priority: {sf.priority})
                      </div>
                    </div>
                    <div className="flex gap-1 ml-2 shrink-0">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-5 px-1.5 text-[0.5625rem]"
                        onClick={() => {
                          setSwapAction("resize");
                          setSwapResizeTarget(sf.filename);
                          setSwapSizeMB(String(Math.round(sf.size / (1024 * 1024))));
                        }}
                      >
                        <Scale className="h-3 w-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-5 px-1.5 text-[0.5625rem] text-destructive hover:text-destructive"
                        onClick={() => handleSwapRemove(sf.filename)}
                        disabled={swapLoading}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Swappiness control */}
            {swapInfo && metrics.system.platform === "linux" && (
              <div className="space-y-1.5">
                <span className="text-[0.625rem] text-muted-foreground font-medium">Swappiness (vm.swappiness)</span>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    value={swappinessValue}
                    onChange={(e) => setSwappinessValue(e.target.value)}
                    className="h-6 w-16 text-[0.625rem] font-mono"
                  />
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={swappinessValue}
                    onChange={(e) => setSwappinessValue(e.target.value)}
                    className="flex-1 h-1.5 accent-primary"
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    className="h-5 px-2 text-[0.5625rem]"
                    onClick={handleSwappinessChange}
                    disabled={swapLoading || parseInt(swappinessValue, 10) === swapInfo.swappiness}
                  >
                    Apply
                  </Button>
                </div>
                <div className="text-[0.5625rem] text-muted-foreground">
                  0 = avoid swap, 100 = swap aggressively (current: {swapInfo.swappiness})
                </div>
              </div>
            )}

            {/* Create swap form */}
            {swapAction === "create" && (
              <div className="space-y-2 p-2 rounded border bg-muted/20">
                <span className="text-[0.625rem] font-medium">Create New Swap</span>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-0.5">
                    <label className="text-[0.5625rem] text-muted-foreground">Size (MB)</label>
                    <Input
                      type="number"
                      min={64}
                      max={65536}
                      value={swapSizeMB}
                      onChange={(e) => setSwapSizeMB(e.target.value)}
                      className="h-6 text-[0.625rem] font-mono"
                    />
                  </div>
                  <div className="space-y-0.5">
                    <label className="text-[0.5625rem] text-muted-foreground">Path</label>
                    <Input
                      value={swapPath}
                      onChange={(e) => setSwapPath(e.target.value)}
                      className="h-6 text-[0.625rem] font-mono"
                    />
                  </div>
                </div>
                {/* Quick size presets */}
                <div className="flex gap-1 flex-wrap">
                  {[256, 512, 1024, 2048, 4096, 8192].map((size) => (
                    <button
                      key={size}
                      onClick={() => setSwapSizeMB(String(size))}
                      className={cn(
                        "px-1.5 py-0.5 rounded text-[0.5625rem] border",
                        parseInt(swapSizeMB, 10) === size
                          ? "bg-primary/10 text-primary border-primary/30"
                          : "hover:bg-muted/50 border-transparent"
                      )}
                    >
                      {size >= 1024 ? `${size / 1024}G` : `${size}M`}
                    </button>
                  ))}
                </div>
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    className="h-11 md:h-6 text-[0.625rem] px-3"
                    onClick={handleSwapCreate}
                    disabled={swapLoading || !swapSizeMB || !swapPath}
                  >
                    {swapLoading ? "Creating..." : "Create & Activate"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-11 md:h-6 text-[0.625rem] px-2"
                    onClick={() => setSwapAction("none")}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {/* Resize swap form */}
            {swapAction === "resize" && (
              <div className="space-y-2 p-2 rounded border bg-muted/20">
                <span className="text-[0.625rem] font-medium">
                  Resize Swap: <span className="font-mono">{swapResizeTarget}</span>
                </span>
                <div className="space-y-0.5">
                  <label className="text-[0.5625rem] text-muted-foreground">New Size (MB)</label>
                  <Input
                    type="number"
                    min={64}
                    max={65536}
                    value={swapSizeMB}
                    onChange={(e) => setSwapSizeMB(e.target.value)}
                    className="h-6 text-[0.625rem] font-mono"
                  />
                </div>
                <div className="flex gap-1 flex-wrap">
                  {[256, 512, 1024, 2048, 4096, 8192].map((size) => (
                    <button
                      key={size}
                      onClick={() => setSwapSizeMB(String(size))}
                      className={cn(
                        "px-1.5 py-0.5 rounded text-[0.5625rem] border",
                        parseInt(swapSizeMB, 10) === size
                          ? "bg-primary/10 text-primary border-primary/30"
                          : "hover:bg-muted/50 border-transparent"
                      )}
                    >
                      {size >= 1024 ? `${size / 1024}G` : `${size}M`}
                    </button>
                  ))}
                </div>
                <div className="text-[0.5625rem] text-amber-500">
                  Warning: This will temporarily disable swap during resize.
                </div>
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    className="h-11 md:h-6 text-[0.625rem] px-3"
                    onClick={handleSwapResize}
                    disabled={swapLoading || !swapSizeMB}
                  >
                    {swapLoading ? "Resizing..." : "Resize Swap"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-11 md:h-6 text-[0.625rem] px-2"
                    onClick={() => setSwapAction("none")}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </ScrollArea>
    );
  };

  // ─── Processes ─────────────────────────────────────────────────────────────

  const renderProcesses = () => {
    if (!metrics) return null;

    const toggleSort = (field: ProcessSort) => {
      if (processSort === field) {
        setProcessSortDir((d) => (d === "desc" ? "asc" : "desc"));
      } else {
        setProcessSort(field);
        setProcessSortDir("desc");
      }
    };

    const SortHeader = ({ field, label, className: cls }: { field: ProcessSort; label: string; className?: string }) => (
      <button
        onClick={() => toggleSort(field)}
        className={cn(
          "flex items-center gap-0.5 text-[0.5625rem] font-medium text-muted-foreground hover:text-foreground transition-colors",
          processSort === field && "text-foreground",
          cls
        )}
      >
        {label}
        {processSort === field && (
          <ArrowUpDown className="h-2.5 w-2.5" />
        )}
      </button>
    );

    return (
      <div className="flex flex-col h-full gap-2">
        {/* Toolbar */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
            <Input
              value={processSearch}
              onChange={(e) => handleProcessSearch(e.target.value)}
              placeholder="Search processes..."
              className="h-6 pl-7 pr-7 text-[0.625rem]"
            />
            {processSearch && (
              <button
                aria-label="Clear process search"
                onClick={() => { setProcessSearch(""); setSearchResults(null); }}
                className="absolute right-2 top-1/2 -translate-y-1/2"
              >
                <X className="h-3 w-3 text-muted-foreground hover:text-foreground" />
              </button>
            )}
          </div>
          <Badge variant="secondary" className="text-[0.5625rem] h-5 shrink-0">
            {metrics.processCount} total
          </Badge>
        </div>

        {/* Kill message */}
        {killMessage && (
          <div className={cn(
            "text-[0.625rem] px-2 py-1 rounded border",
            killMessage.includes("Failed") ? "text-destructive border-destructive/30 bg-destructive/5" : "text-green-600 border-green-500/30 bg-green-500/5"
          )}>
            {killMessage}
          </div>
        )}

        {/* Table header */}
        <div className="grid grid-cols-[40px_50px_50px_55px_1fr_28px] gap-1 px-1 border-b pb-1">
          <SortHeader field="pid" label="PID" />
          <SortHeader field="cpu" label="CPU%" />
          <SortHeader field="mem" label="MEM%" />
          <SortHeader field="rss" label="RSS" />
          <SortHeader field="name" label="Name" />
          <span className="text-[0.5625rem] text-muted-foreground text-center">Act</span>
        </div>

        {/* Process list */}
        <ScrollArea className="flex-1 min-h-0">
          <div className="space-y-0">
            {sortedProcesses.map((proc) => (
              <div key={proc.pid}>
                <div
                  className={cn(
                    "grid grid-cols-[40px_50px_50px_55px_1fr_28px] gap-1 text-[0.625rem] py-1 px-1 rounded hover:bg-muted/50 cursor-pointer items-center",
                    selectedPid === proc.pid && "bg-muted/70",
                    killConfirm === proc.pid && "bg-destructive/10 border border-destructive/30"
                  )}
                  onClick={() => {
                    if (selectedPid === proc.pid) {
                      setSelectedPid(null);
                      setProcessDetail(null);
                    } else {
                      setSelectedPid(proc.pid);
                      fetchProcessDetail(proc.pid);
                    }
                  }}
                >
                  <span className="font-mono tabular-nums text-muted-foreground">{proc.pid}</span>
                  <span className={cn(
                    "font-mono tabular-nums",
                    proc.cpu >= 50 && "text-destructive font-medium",
                    proc.cpu >= 20 && proc.cpu < 50 && "text-amber-500"
                  )}>
                    {(proc.cpu ?? 0).toFixed(1)}
                  </span>
                  <span className={cn(
                    "font-mono tabular-nums",
                    proc.mem >= 10 && "text-amber-500"
                  )}>
                    {(proc.mem ?? 0).toFixed(1)}
                  </span>
                  <span className="font-mono tabular-nums text-muted-foreground text-[0.5625rem]">
                    {formatBytesShort(proc.rss)}
                  </span>
                  <span className="truncate flex items-center gap-1" title={proc.command}>
                    {processExpanded.has(proc.pid) ? (
                      <ChevronDown className="h-2.5 w-2.5 shrink-0" />
                    ) : (
                      <ChevronRight className="h-2.5 w-2.5 shrink-0" />
                    )}
                    {proc.shortName}
                  </span>
                  <div className="flex justify-center">
                    {killConfirm === proc.pid ? (
                      <div className="flex gap-0.5">
                        <button
                          onClick={(e) => { e.stopPropagation(); handleKillProcess(proc.pid); }}
                          className="text-destructive hover:bg-destructive/20 rounded inline-flex items-center justify-center h-11 w-11 md:h-auto md:w-auto md:p-0.5"
                          title="Confirm kill (SIGTERM)"
                          aria-label="Confirm kill (SIGTERM)"
                        >
                          <Skull className="h-3 w-3" />
                        </button>
                        <button
                          aria-label="Cancel"
                          onClick={(e) => { e.stopPropagation(); setKillConfirm(null); }}
                          className="text-muted-foreground hover:bg-muted rounded inline-flex items-center justify-center h-11 w-11 md:h-auto md:w-auto md:p-0.5"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={(e) => { e.stopPropagation(); setKillConfirm(proc.pid); }}
                        className="text-muted-foreground hover:text-destructive rounded inline-flex items-center justify-center h-11 w-11 md:h-auto md:w-auto md:p-0.5 opacity-100 md:opacity-0 md:group-hover:opacity-100 hover:opacity-100 transition-opacity"
                        style={{ opacity: selectedPid === proc.pid ? 1 : undefined }}
                        title="Kill process"
                        aria-label="Kill process"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Expanded detail */}
                {selectedPid === proc.pid && (
                  <div className="ml-4 mr-1 mb-1 p-2 rounded border bg-muted/20 text-[0.5625rem] space-y-1.5">
                    <div className="text-muted-foreground break-all font-mono leading-relaxed">
                      {proc.command}
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <span className="text-muted-foreground">User:</span>{" "}
                        <span className="font-medium">{proc.user}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">VSZ:</span>{" "}
                        <span className="font-mono">{formatBytesShort(proc.vsz)}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Time:</span>{" "}
                        <span className="font-mono">{proc.time}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Started:</span>{" "}
                        <span>{proc.started}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">State:</span>{" "}
                        <span className="font-mono">{proc.stat}</span>
                      </div>
                      {processDetail && processDetail.pid === proc.pid && (
                        <>
                          <div>
                            <span className="text-muted-foreground">Threads:</span>{" "}
                            <span className="font-mono">{processDetail.threads}</span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Open Files:</span>{" "}
                            <span className="font-mono">{processDetail.openFiles}</span>
                          </div>
                        </>
                      )}
                    </div>
                    {processDetail && processDetail.pid === proc.pid && processDetail.ports.length > 0 && (
                      <div className="space-y-0.5">
                        <span className="text-muted-foreground font-medium">Network Ports:</span>
                        {processDetail.ports.slice(0, 5).map((port, i) => (
                          <div key={i} className="font-mono pl-2">
                            {port.name} ({port.type}) {port.state}
                          </div>
                        ))}
                      </div>
                    )}
                    {/* Kill actions */}
                    <div className="flex gap-1 pt-1 border-t">
                      <Button
                        variant="destructive"
                        size="sm"
                        className="h-5 text-[0.5625rem] px-2"
                        onClick={() => handleKillProcess(proc.pid, "SIGTERM")}
                      >
                        <Skull className="h-2.5 w-2.5 mr-1" />
                        SIGTERM
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        className="h-5 text-[0.5625rem] px-2"
                        onClick={() => handleKillProcess(proc.pid, "SIGKILL")}
                      >
                        <Skull className="h-2.5 w-2.5 mr-1" />
                        SIGKILL
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        className="h-5 text-[0.5625rem] px-2"
                        onClick={() => handleKillProcess(proc.pid, "SIGSTOP")}
                      >
                        <Pause className="h-2.5 w-2.5 mr-1" />
                        STOP
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        className="h-5 text-[0.5625rem] px-2"
                        onClick={() => handleKillProcess(proc.pid, "SIGCONT")}
                      >
                        <Play className="h-2.5 w-2.5 mr-1" />
                        CONT
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </ScrollArea>
      </div>
    );
  };

  // ─── Network ───────────────────────────────────────────────────────────────

  const renderNetwork = () => {
    if (!metrics) return null;
    return (
      <ScrollArea className="h-full">
        <div className="space-y-3 pr-2">
          {/* Speed cards */}
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-md border p-2 space-y-1">
              <div className="flex items-center gap-1 text-[0.625rem] text-muted-foreground">
                <ArrowDown className="h-3 w-3 text-green-500" />
                <span>Download</span>
              </div>
              <div className="text-sm font-bold font-mono tabular-nums">
                {formatBytesShort(netSpeed.inPerSec)}/s
              </div>
              <Sparkline
                data={netInHistory}
                max={Math.max(...netInHistory, 1024)}
                width={110}
                height={24}
                color="#22c55e"
                className="w-full"
              />
            </div>
            <div className="rounded-md border p-2 space-y-1">
              <div className="flex items-center gap-1 text-[0.625rem] text-muted-foreground">
                <ArrowUp className="h-3 w-3 text-blue-500" />
                <span>Upload</span>
              </div>
              <div className="text-sm font-bold font-mono tabular-nums">
                {formatBytesShort(netSpeed.outPerSec)}/s
              </div>
              <Sparkline
                data={netOutHistory}
                max={Math.max(...netOutHistory, 1024)}
                width={110}
                height={24}
                color="#3b82f6"
                className="w-full"
              />
            </div>
          </div>

          {/* Per-interface stats */}
          {metrics.network.perInterface.length > 0 && (
            <div className="rounded-md border p-3 space-y-2">
              <span className="text-xs font-medium">Interface Stats</span>
              {metrics.network.perInterface.map((iface) => (
                <div key={iface.name} className="flex items-center justify-between text-[0.625rem]">
                  <span className="font-medium">{iface.name}</span>
                  <div className="flex gap-3 font-mono tabular-nums text-muted-foreground">
                    <span className="text-green-500">↓{formatBytesShort(iface.bytesIn)}</span>
                    <span className="text-blue-500">↑{formatBytesShort(iface.bytesOut)}</span>
                    <span>{iface.packetsIn + iface.packetsOut} pkts</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Total */}
          <div className="rounded-md border p-3 space-y-2">
            <span className="text-xs font-medium">Total Transfer (since boot)</span>
            <div className="grid grid-cols-2 gap-4 text-xs">
              <div>
                <span className="text-muted-foreground">Received</span>
                <div className="font-mono tabular-nums font-medium">{formatBytes(metrics.network.bytesIn)}</div>
              </div>
              <div>
                <span className="text-muted-foreground">Sent</span>
                <div className="font-mono tabular-nums font-medium">{formatBytes(metrics.network.bytesOut)}</div>
              </div>
            </div>
          </div>

          {/* Active interfaces */}
          <div className="space-y-2">
            <span className="text-xs font-medium">Active Interfaces</span>
            {metrics.network.interfaces.map((iface) => (
              <div key={iface.name + iface.address} className="rounded-md border p-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium">{iface.name}</span>
                  <Badge variant="secondary" className="text-[0.5625rem] h-4">{iface.family}</Badge>
                </div>
                <div className="text-[0.625rem] text-muted-foreground font-mono mt-0.5">{iface.address}</div>
                <div className="text-[0.5625rem] text-muted-foreground font-mono">{iface.mac}</div>
              </div>
            ))}
          </div>
        </div>
      </ScrollArea>
    );
  };

  // ─── Disks ─────────────────────────────────────────────────────────────────

  const renderDisks = () => {
    if (!metrics) return null;
    return (
      <ScrollArea className="h-full">
        <div className="space-y-3 pr-2">
          {metrics.disks.map((disk, i) => (
            <div key={i} className="rounded-md border p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <HardDrive className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-xs font-medium">{disk.mount}</span>
                </div>
                <Badge
                  variant={disk.usedPercent >= 90 ? "destructive" : disk.usedPercent >= 70 ? "secondary" : "secondary"}
                  className="text-[0.5625rem] h-4"
                >
                  {disk.usedPercent}%
                </Badge>
              </div>
              <ProgressBar
                value={disk.usedPercent}
                label=""
                detail={`${formatBytes(disk.used)} / ${formatBytes(disk.total)}`}
              />
              <div className="flex justify-between text-[0.625rem] text-muted-foreground">
                <span>Available: {formatBytes(disk.available)}</span>
                <span className="font-mono">{disk.filesystem}</span>
              </div>
            </div>
          ))}

          {/* Disk I/O */}
          {metrics.diskIO && (
            <div className="rounded-md border p-3 space-y-2">
              <span className="text-xs font-medium">Disk I/O</span>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div>
                  <div className="text-sm font-bold tabular-nums">{(metrics.diskIO.mbPerSec ?? 0).toFixed(2)}</div>
                  <div className="text-[0.5625rem] text-muted-foreground">MB/s</div>
                </div>
                <div>
                  <div className="text-sm font-bold tabular-nums">{metrics.diskIO.transfersPerSec ?? 0}</div>
                  <div className="text-[0.5625rem] text-muted-foreground">IOPS</div>
                </div>
                <div>
                  <div className="text-sm font-bold tabular-nums">{(metrics.diskIO.kbPerTransfer ?? 0).toFixed(1)}</div>
                  <div className="text-[0.5625rem] text-muted-foreground">KB/transfer</div>
                </div>
              </div>
            </div>
          )}
        </div>
      </ScrollArea>
    );
  };

  // ─── System ────────────────────────────────────────────────────────────────

  const renderSystem = () => {
    if (!metrics) return null;
    const { system } = metrics;

    const InfoRow = ({ label, value }: { label: string; value: string | null | undefined }) => (
      value ? (
        <div className="flex justify-between items-center py-1 text-xs">
          <span className="text-muted-foreground">{label}</span>
          <span className="font-mono text-[0.6875rem] text-right max-w-[60%] truncate">{value}</span>
        </div>
      ) : null
    );

    return (
      <ScrollArea className="h-full">
        <div className="space-y-3 pr-2">
          {/* Hardware */}
          <div className="rounded-md border p-3 space-y-0.5">
            <span className="text-xs font-medium mb-1 block">Hardware</span>
            <Separator className="my-1" />
            <InfoRow label="Hostname" value={system.hostname} />
            <InfoRow label="Platform" value={`${system.platform} (${system.arch})`} />
            <InfoRow label="macOS Version" value={system.osVersion} />
            <InfoRow label="Kernel" value={system.release} />
            <InfoRow label="User" value={system.userInfo} />
            <InfoRow label="Serial" value={system.serial} />
            <InfoRow label="Uptime" value={system.uptime} />
          </div>

          {/* CPU */}
          <div className="rounded-md border p-3 space-y-0.5">
            <span className="text-xs font-medium mb-1 block">Processor</span>
            <Separator className="my-1" />
            <InfoRow label="Model" value={system.cpuModel} />
            <InfoRow label="Cores" value={String(system.cpuCores)} />
            {metrics.cpu.frequency && <InfoRow label="Frequency" value={`${metrics.cpu.frequency} MHz`} />}
            {system.cpuTemp && <InfoRow label="Temperature" value={`${system.cpuTemp}°C`} />}
          </div>

          {/* GPU */}
          {metrics.gpu && (
            <div className="rounded-md border p-3 space-y-0.5">
              <span className="text-xs font-medium mb-1 block">Graphics</span>
              <Separator className="my-1" />
              <InfoRow label="Model" value={metrics.gpu.model} />
              <InfoRow label="VRAM" value={metrics.gpu.vram} />
              <InfoRow label="Metal" value={metrics.gpu.metal} />
              <InfoRow label="GPU Cores" value={metrics.gpu.cores} />
              {metrics.gpu.utilization != null && <InfoRow label="Utilization" value={`${metrics.gpu.utilization}%`} />}
            </div>
          )}

          {/* Battery */}
          {system.battery && (
            <div className="rounded-md border p-3 space-y-0.5">
              <span className="text-xs font-medium mb-1 block">Battery</span>
              <Separator className="my-1" />
              <InfoRow label="Charge" value={`${system.battery.percent}%`} />
              <InfoRow label="Status" value={system.battery.charging ? "Charging (AC Power)" : "On Battery"} />
              <InfoRow label="Time Remaining" value={system.battery.timeRemaining} />
              {system.battery.cycleCount && <InfoRow label="Cycle Count" value={String(system.battery.cycleCount)} />}
              <div className="pt-1">
                <ProgressBar
                  value={system.battery.percent}
                  label=""
                  color={system.battery.percent <= 20 ? "bg-destructive" : system.battery.charging ? "bg-green-500" : "bg-primary"}
                />
              </div>
            </div>
          )}

          {/* Resource summary */}
          <div className="rounded-md border p-3 space-y-0.5">
            <span className="text-xs font-medium mb-1 block">Resources</span>
            <Separator className="my-1" />
            <InfoRow label="Total Processes" value={String(metrics.processCount)} />
            <InfoRow label="Open Files (system)" value={String(metrics.openFiles)} />
            <InfoRow label="Memory" value={`${formatBytes(metrics.memory.used)} / ${formatBytes(metrics.memory.total)}`} />
          </div>
        </div>
      </ScrollArea>
    );
  };

  // ─── Widget render ─────────────────────────────────────────────────────────

  return (
    <WidgetWrapper
      title="System Monitor"
      icon={<Activity className="h-4 w-4" />}
      widgetType="system-monitor"
      expandRequested={expandRequested}
      onExpandHandled={onExpandHandled}
      headerAction={
        <div className="flex items-center gap-1">
          {servicesData && servicesData.summary.failed + servicesData.summary.degraded > 0 && (
            <button
              onClick={() => setActiveTab("services")}
              aria-label={`${servicesData.summary.failed + servicesData.summary.degraded} services need attention`}
            >
              <Badge variant="destructive" className="text-[0.5625rem] h-4 px-1.5 tabular-nums gap-0.5">
                <CircleAlert className="h-2.5 w-2.5" />
                {servicesData.summary.failed + servicesData.summary.degraded}
              </Badge>
            </button>
          )}
          {metrics && (
            <>
              <Badge
                variant={metrics.cpu.average >= 80 ? "destructive" : "secondary"}
                className="text-[0.5625rem] h-4 px-1.5 tabular-nums"
              >
                {metrics.cpu.average}%
              </Badge>
              <Badge
                variant={metrics.memory.usedPercent >= 85 ? "destructive" : "secondary"}
                className="text-[0.5625rem] h-4 px-1.5 tabular-nums"
              >
                {metrics.memory.usedPercent}%
              </Badge>
            </>
          )}
          <button
            onClick={() => setPaused((p) => !p)}
            className={cn(
              "inline-flex items-center justify-center h-11 w-11 md:h-auto md:w-auto md:p-0.5 rounded hover:bg-muted/70 transition-colors",
              paused && "text-amber-500"
            )}
            title={paused ? "Resume monitoring" : "Pause monitoring"}
            aria-label={paused ? "Resume monitoring" : "Pause monitoring"}
          >
            {paused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
          </button>
          <button
            onClick={() => { fetchMetrics(); }}
            className="inline-flex items-center justify-center h-11 w-11 md:h-auto md:w-auto md:p-0.5 rounded hover:bg-muted/70 transition-colors"
            title="Refresh now"
            aria-label="Refresh now"
          >
            <RefreshCw className="h-3 w-3" />
          </button>
        </div>
      }
    >
      <div className="flex flex-col h-full gap-2">
        {/* Tab bar */}
        <div className="flex gap-0.5 border-b pb-1.5 overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex items-center gap-1 px-2 py-1 rounded-md text-[0.625rem] font-medium transition-colors whitespace-nowrap",
                activeTab === tab.id
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
              )}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {/* Refresh interval control */}
        {activeTab === "processes" && (
          <div className="flex items-center gap-2 text-[0.5625rem] text-muted-foreground">
            <span>Refresh:</span>
            {[1000, 3000, 5000, 10000].map((ms) => (
              <button
                key={ms}
                onClick={() => setRefreshInterval(ms)}
                className={cn(
                  "px-1.5 py-0.5 rounded text-[0.5625rem]",
                  refreshInterval === ms ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted/50"
                )}
              >
                {ms / 1000}s
              </button>
            ))}
          </div>
        )}

        {/* Content */}
        <div className="flex-1 min-h-0">{renderContent()}</div>

        {/* Status bar */}
        {metrics && (
          <div className="flex items-center justify-between text-[0.5rem] text-muted-foreground border-t pt-1">
            <span>
              Updated {new Date(metrics.timestamp).toLocaleTimeString()}
            </span>
            {paused && (
              <Badge variant="secondary" className="text-[0.5rem] h-3 px-1 text-amber-500">
                PAUSED
              </Badge>
            )}
          </div>
        )}
      </div>
    </WidgetWrapper>
  );
}
