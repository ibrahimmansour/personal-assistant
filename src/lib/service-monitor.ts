/**
 * Service monitor — discovers the long-running services on this machine and
 * reports their health.
 *
 * The raw process list in the system monitor answers "what is using CPU", but
 * not "is my staging backend up". The names there are argv[0] (`node`,
 * `next-server (v1`, `postgres`) and a single service scatters across a dozen
 * unrelated-looking rows. This module groups processes by the thing that owns
 * them — a systemd unit, a docker container, or a process tree — and gives
 * each group a stable name, a health state, an uptime and a restart count.
 */

import os from "os";
import { promises as fs } from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const IS_LINUX = os.platform() === "linux";
const IS_MAC = os.platform() === "darwin";

const DATA_DIR = path.join(os.homedir(), ".personal-assistant");
const PREFS_FILE = path.join(DATA_DIR, "services.json");

// ─── Types ───────────────────────────────────────────────────────────────────

export type ServiceHealth =
  | "healthy"
  | "degraded"
  | "failed"
  | "stopped"
  | "starting"
  | "unknown";

/** Display tier. `app` = you installed it, `infra` = daemon you probably care
 *  about, `system` = OS plumbing that only adds noise. */
export type ServiceTier = "app" | "infra" | "system";

export type ServiceSource = "systemd-system" | "systemd-user" | "docker" | "launchd" | "process";

export interface ServiceProcess {
  pid: number;
  ppid: number;
  cpu: number;
  mem: number;
  rss: number;
  etimes: number;
  stat: string;
  user: string;
  /** argv[0] basename — what the old process list showed */
  comm: string;
  command: string;
  /** Role within the group, derived from the command line (e.g. "worker") */
  role: string | null;
}

export interface ServicePort {
  port: number;
  proto: "tcp" | "udp";
  address: string;
}

export interface HealthCheck {
  /** Absolute URL probed with GET; 2xx/3xx counts as healthy */
  url: string;
  expectStatus?: number;
  timeoutMs?: number;
}

export interface ServiceProbe {
  ok: boolean;
  status: number | null;
  latencyMs: number | null;
  error: string | null;
  checkedAt: number;
}

export interface ServiceInfo {
  /** Stable identity used by pins/aliases/checks. Unit id, `docker:<name>`, or `proc:<pid>` */
  id: string;
  name: string;
  description: string | null;
  source: ServiceSource;
  tier: ServiceTier;
  health: ServiceHealth;
  /** Short human reason behind `health` ("failed", "restarted 2m ago", …) */
  healthReason: string | null;
  /** Raw upstream state, kept for the detail pane */
  activeState: string;
  subState: string;
  /** Starts on boot */
  enabled: boolean | null;
  mainPid: number | null;
  startedAt: number | null;
  uptimeSeconds: number | null;
  restarts: number;
  /** Percent of one core, measured across two samples */
  cpu: number;
  /** cgroup memory when available, else summed RSS */
  memory: number;
  memorySource: "cgroup" | "rss";
  processCount: number;
  ports: ServicePort[];
  processes: ServiceProcess[];
  statusText: string | null;
  pinned: boolean;
  canControl: boolean;
  check: HealthCheck | null;
  probe: ServiceProbe | null;
}

export interface ServicePrefs {
  pinned: string[];
  hidden: string[];
  aliases: Record<string, string>;
  checks: Record<string, HealthCheck>;
  showSystem: boolean;
}

const DEFAULT_PREFS: ServicePrefs = {
  pinned: [],
  hidden: [],
  aliases: {},
  checks: {},
  showSystem: false,
};

// ─── Preferences ─────────────────────────────────────────────────────────────

export async function loadPrefs(): Promise<ServicePrefs> {
  try {
    const raw = await fs.readFile(PREFS_FILE, "utf-8");
    return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export async function savePrefs(prefs: ServicePrefs): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(PREFS_FILE, JSON.stringify(prefs, null, 2));
}

// ─── Shell helpers ───────────────────────────────────────────────────────────

async function run(cmd: string, args: string[], timeout = 6000, env?: NodeJS.ProcessEnv): Promise<string> {
  try {
    const { stdout } = await execFileAsync(cmd, args, {
      timeout,
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
      env: env ?? systemctlEnv(),
    });
    return stdout.trim();
  } catch (err) {
    // systemctl exits non-zero for "unit not found" / "inactive" but still
    // prints usable output on stdout, so keep whatever we got.
    const out = (err as { stdout?: string })?.stdout;
    return typeof out === "string" ? out.trim() : "";
  }
}

/**
 * `systemctl --user` talks to the per-user bus over `$XDG_RUNTIME_DIR`. A
 * process started outside a login session (a bare `next start`, the binary
 * launched from cron) inherits no such variable and every user-unit call fails
 * with "Failed to connect to bus", which would hide exactly the units the user
 * installed themselves. Point it at the conventional path when it is missing.
 */
function systemctlEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  if (!env.XDG_RUNTIME_DIR && IS_LINUX) {
    try {
      env.XDG_RUNTIME_DIR = `/run/user/${os.userInfo().uid}`;
    } catch {
      /* no uid, leave unset */
    }
  }
  return env;
}

async function hasBinary(bin: string): Promise<boolean> {
  try {
    await execFileAsync("which", [bin], { timeout: 2000 });
    return true;
  } catch {
    return false;
  }
}

// ─── Process table ───────────────────────────────────────────────────────────

interface RawProcess extends ServiceProcess {
  /** systemd system unit owning the process, or null */
  unit: string | null;
  /** systemd user unit owning the process, or null */
  uunit: string | null;
}

async function getProcessTable(): Promise<RawProcess[]> {
  // `unit`/`uunit` are procps' systemd columns — the cheapest correct way to
  // attribute a PID to a unit, and the whole reason related processes can be
  // grouped at all. They print "-" on non-systemd systems.
  const fields = IS_LINUX
    ? "pid,ppid,unit,uunit,pcpu,pmem,rss,etimes,stat,user:32,args"
    : "pid,ppid,pcpu,pmem,rss,etime,stat,user,args";
  const out = await run("ps", ["-eo", fields, "--no-headers"], 8000);
  if (!out) return [];

  const procs: RawProcess[] = [];
  for (const line of out.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    const parts = t.split(/\s+/);
    let idx = 0;
    const pid = parseInt(parts[idx++], 10);
    const ppid = parseInt(parts[idx++], 10);
    let unit: string | null = null;
    let uunit: string | null = null;
    if (IS_LINUX) {
      const u = parts[idx++];
      const uu = parts[idx++];
      unit = u && u !== "-" ? u : null;
      uunit = uu && uu !== "-" ? uu : null;
    }
    const cpu = parseFloat(parts[idx++]) || 0;
    const mem = parseFloat(parts[idx++]) || 0;
    const rss = (parseInt(parts[idx++], 10) || 0) * 1024;
    const etimes = IS_LINUX ? parseInt(parts[idx++], 10) || 0 : parseElapsed(parts[idx++]);
    const stat = parts[idx++] || "";
    const user = parts[idx++] || "";
    const command = parts.slice(idx).join(" ");
    if (isNaN(pid) || !command) continue;
    const comm = commandBasename(command);
    if (command.startsWith("[") || ppid === 2 || pid === 2) continue; // kernel threads
    procs.push({
      pid, ppid, unit, uunit, cpu, mem, rss, etimes, stat, user, comm, command,
      role: deriveRole(command),
    });
  }
  return procs;
}

/**
 * The unit that *is* a service, as opposed to the container the process merely
 * sits in. A user unit wins over the system unit, because every user unit's
 * processes are also children of `user@N.service`. Scopes and slices
 * (`session-3.scope`, `user.slice`) and `user@N.service` itself are session
 * plumbing, not services — a dev server started by hand in tmux lands in one of
 * those, and must fall through to the unmanaged-process grouping instead of
 * disappearing into the login session's row.
 */
function ownerUnit(p: RawProcess): string | null {
  const asService = (unit: string | null) =>
    unit && unit.endsWith(".service") && !/^user@\d+\.service$/.test(unit) ? unit : null;
  return asService(p.uunit) ?? asService(p.unit);
}

/** macOS `ps -o etime` prints [[dd-]hh:]mm:ss. */
function parseElapsed(v: string): number {
  if (!v) return 0;
  const [dayPart, clockPart] = v.includes("-") ? v.split("-") : ["0", v];
  const bits = clockPart.split(":").map((n) => parseInt(n, 10) || 0);
  const [h, m, s] = bits.length === 3 ? bits : [0, bits[0] || 0, bits[1] || 0];
  return (parseInt(dayPart, 10) || 0) * 86400 + h * 3600 + m * 60 + s;
}

function commandBasename(command: string): string {
  const first = command.split(" ")[0];
  return first.split("/").pop() || first;
}

/**
 * Postgres, nginx and node clusters all announce their job in argv. Surfacing
 * it is what turns eight identical `postgres` rows into "checkpointer",
 * "walwriter", "autovacuum launcher".
 */
function deriveRole(command: string): string | null {
  const pg = command.match(/^postgres:\s+(?:[\w-]+:\s+)?(.+?)(?:\s+process)?$/);
  if (pg) return pg[1].slice(0, 40);
  if (/nginx: master/.test(command)) return "master";
  if (/nginx: worker/.test(command)) return "worker";
  const script = command.match(/\b(?:node|python3?|ruby|bun|deno)\b\s+(\S+)/);
  if (script) {
    const base = script[1].split("/").filter(Boolean).slice(-2).join("/");
    return base.length > 40 ? base.slice(-40) : base;
  }
  return null;
}

// ─── Listening sockets ───────────────────────────────────────────────────────

/**
 * Ports keyed by PID. Without root, `ss`/`lsof` only attribute sockets owned by
 * the current user, so a system daemon's port may be missing — the list is
 * additive evidence, never used to decide that a service is down.
 */
async function getPortsByPid(): Promise<Map<number, ServicePort[]>> {
  const map = new Map<number, ServicePort[]>();
  const add = (pid: number, port: ServicePort) => {
    const list = map.get(pid) ?? [];
    if (!list.some((p) => p.port === port.port && p.proto === port.proto)) list.push(port);
    map.set(pid, list);
  };

  if (IS_LINUX) {
    const out = await run("ss", ["-tulnpH"], 5000);
    for (const line of out.split("\n")) {
      if (!line.trim()) continue;
      const proto = line.startsWith("udp") ? "udp" : "tcp";
      const local = line.split(/\s+/)[4] || "";
      const portMatch = local.match(/:(\d+)$/);
      if (!portMatch) continue;
      const port = parseInt(portMatch[1], 10);
      const address = local.slice(0, local.lastIndexOf(":")) || "*";
      for (const m of line.matchAll(/pid=(\d+)/g)) {
        add(parseInt(m[1], 10), { port, proto, address });
      }
    }
  } else if (IS_MAC) {
    const out = await run("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN", "-FpPn"], 8000);
    let pid = 0;
    for (const line of out.split("\n")) {
      if (line.startsWith("p")) pid = parseInt(line.slice(1), 10) || 0;
      else if (line.startsWith("n") && pid) {
        const m = line.match(/:(\d+)$/);
        if (m) add(pid, { port: parseInt(m[1], 10), proto: "tcp", address: line.slice(1, line.lastIndexOf(":")) });
      }
    }
  }
  return map;
}

// ─── systemd ─────────────────────────────────────────────────────────────────

const SHOW_PROPS = [
  "Id", "Description", "LoadState", "ActiveState", "SubState", "UnitFileState",
  "MainPID", "ExecMainStartTimestamp", "NRestarts", "MemoryCurrent",
  "CPUUsageNSec", "TasksCurrent", "Result", "StatusText", "FragmentPath", "Type",
];

type UnitProps = Record<string, string>;

/**
 * One `systemctl show '*.service'` call returns every loaded unit as
 * blank-line-separated records — ~100ms for the whole machine, versus one
 * fork per unit.
 */
async function showUnits(userScope: boolean): Promise<UnitProps[]> {
  const args = [
    ...(userScope ? ["--user"] : []),
    "show", "*.service",
    "--timestamp=unix",
    ...SHOW_PROPS.flatMap((p) => ["-p", p]),
  ];
  const out = await run("systemctl", args, 8000);
  if (!out || out.includes("Failed to connect to bus")) return [];

  const records: UnitProps[] = [];
  for (const block of out.split(/\n\s*\n/)) {
    const props: UnitProps = {};
    for (const line of block.split("\n")) {
      const eq = line.indexOf("=");
      if (eq > 0) props[line.slice(0, eq)] = line.slice(eq + 1);
    }
    if (props.Id) records.push(props);
  }
  return records;
}

/** OS plumbing: correct to run, useless to watch. */
const SYSTEM_UNIT_PATTERNS = [
  /^systemd-/, /^getty@/, /^serial-getty@/, /^user@/, /^user-runtime-dir@/,
  /^session-\d+/, /^dbus/, /^polkit/, /^modprobe@/, /^dm-event/, /^blk-availability/,
  /^console-setup/, /^keyboard-setup/, /^kmod-/, /^ldconfig/, /^apparmor/, /^auditd/,
  /^e2scrub/, /^emergency/, /^rescue/, /^plymouth/, /^setvtrgb/, /^sys-/, /^rc-local/,
  /^networkd-dispatcher/, /^unattended-upgrades/, /^apt-daily/, /^man-db/, /^logrotate/,
  /^fstrim/, /^cloud-/, /^snapd\./, /^packagekit/, /^upower/, /^rtkit/, /^wpa_supplicant/,
  /^ModemManager/, /^avahi-daemon/, /^rsyslog/, /^cron\.service/, /^anacron/, /^motd-news/,
  /^finalrd/, /^ifupdown/, /^hwclock/, /^lvm2/, /^md(adm|monitor)/, /^multipathd/,
];

/** Daemons a self-hoster watches even though the distro shipped them. */
const KNOWN_SERVICE_PATTERNS = [
  /postgres/i, /mysql/i, /mariadb/i, /redis/i, /valkey/i, /mongo/i, /nginx/i, /apache/i,
  /httpd/i, /caddy/i, /traefik/i, /haproxy/i, /docker/i, /containerd/i, /podman/i,
  /ollama/i, /elastic/i, /opensearch/i, /rabbitmq/i, /kafka/i, /grafana/i, /prometheus/i,
  /loki/i, /ssh/i, /minio/i, /clickhouse/i, /memcach/i, /influx/i, /vault/i, /consul/i,
  /nats/i, /gitea/i, /forgejo/i, /jenkins/i, /pm2/i, /supervisor/i, /coturn/i, /mosquitto/i,
  /jellyfin/i, /plex/i, /syncthing/i, /wireguard/i, /tailscale/i, /code-server/i, /vscode/i,
];

function classifyUnit(props: UnitProps, hasPorts: boolean, hasProcesses: boolean): ServiceTier {
  const id = props.Id ?? "";
  const fragment = props.FragmentPath ?? "";
  const home = os.homedir();
  // A oneshot runs to completion by design, and `active (exited)` with nothing
  // left running is a boot task that already did its job (apparmor, cloud-init,
  // the postgresql.service wrapper, a timer-driven watchdog). This tab is about
  // things that are *supposed to still be running*, so both belong in the
  // collapsed system tier however they were installed.
  if (props.Type === "oneshot") return "system";
  if (props.SubState === "exited" && !hasProcesses) return "system";
  // Anything you wrote yourself lives in /etc or under $HOME; the distro's own
  // units live in /lib or /usr/lib. That split is the strongest available
  // signal for "this is my service".
  if (fragment.startsWith("/etc/systemd") || fragment.startsWith(home)) return "app";
  if (SYSTEM_UNIT_PATTERNS.some((re) => re.test(id))) return "system";
  if (hasPorts) return "infra";
  if (KNOWN_SERVICE_PATTERNS.some((re) => re.test(id))) return "infra";
  return "system";
}

function parseUnixTimestamp(v: string | undefined): number | null {
  if (!v) return null;
  const m = v.match(/^@?(\d+)$/);
  if (!m) return null;
  const secs = parseInt(m[1], 10);
  return secs > 0 ? secs * 1000 : null;
}

function parseCgroupValue(v: string | undefined): number | null {
  if (!v || v === "[not set]") return null;
  const n = Number(v);
  // systemd reports unset 64-bit counters as UINT64_MAX.
  if (!Number.isFinite(n) || n >= Number.MAX_SAFE_INTEGER) return null;
  return n;
}

// ─── CPU sampling ────────────────────────────────────────────────────────────

/**
 * `ps %cpu` is the process's lifetime average, which for a service running for
 * six days is ~0 no matter what it is doing right now. systemd's cumulative
 * `CPUUsageNSec` differenced across two polls gives real instantaneous load, so
 * the previous sample is kept module-side between requests.
 */
const cpuSamples = new Map<string, { nsec: number; at: number }>();

function sampleCpuPercent(id: string, nsec: number | null): number | null {
  const now = Date.now();
  if (nsec === null) {
    cpuSamples.delete(id);
    return null;
  }
  const prev = cpuSamples.get(id);
  cpuSamples.set(id, { nsec, at: now });
  if (!prev) return null;
  const elapsedNs = (now - prev.at) * 1e6;
  if (elapsedNs <= 0 || nsec < prev.nsec) return null;
  return Math.round(((nsec - prev.nsec) / elapsedNs) * 1000) / 10;
}

// ─── Health ──────────────────────────────────────────────────────────────────

const RECENT_RESTART_WINDOW_S = 300;

function deriveHealth(
  props: UnitProps,
  uptimeSeconds: number | null,
  restarts: number,
  probe: ServiceProbe | null
): { health: ServiceHealth; reason: string | null } {
  const active = props.ActiveState;
  const sub = props.SubState;

  if (active === "failed" || props.Result === "exit-code" || props.Result === "signal") {
    return { health: "failed", reason: props.Result && props.Result !== "success" ? props.Result : "failed" };
  }
  if (active === "activating") return { health: "starting", reason: sub || "activating" };
  if (active === "deactivating") return { health: "starting", reason: "stopping" };
  if (active === "inactive") return { health: "stopped", reason: sub === "dead" ? null : sub };
  if (active === "active") {
    if (probe && !probe.ok) return { health: "degraded", reason: `check failed: ${probe.error ?? probe.status}` };
    if (restarts > 0 && uptimeSeconds !== null && uptimeSeconds < RECENT_RESTART_WINDOW_S) {
      return { health: "degraded", reason: `restarted ${formatAgo(uptimeSeconds)} ago (${restarts}x)` };
    }
    if (sub === "exited") return { health: "healthy", reason: "ran to completion" };
    return { health: "healthy", reason: null };
  }
  return { health: "unknown", reason: active || null };
}

function formatAgo(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${Math.round(seconds / 3600)}h`;
}

export async function probeHealthCheck(check: HealthCheck): Promise<ServiceProbe> {
  const started = Date.now();
  const timeout = check.timeoutMs ?? 4000;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const res = await fetch(check.url, { signal: controller.signal, redirect: "manual" });
    clearTimeout(timer);
    const ok = check.expectStatus ? res.status === check.expectStatus : res.status < 400;
    return {
      ok,
      status: res.status,
      latencyMs: Date.now() - started,
      error: ok ? null : `HTTP ${res.status}`,
      checkedAt: Date.now(),
    };
  } catch (err) {
    return {
      ok: false,
      status: null,
      latencyMs: Date.now() - started,
      error: err instanceof Error ? (err.name === "AbortError" ? "timeout" : err.message) : "failed",
      checkedAt: Date.now(),
    };
  }
}

// ─── Docker ──────────────────────────────────────────────────────────────────

async function getDockerServices(prefs: ServicePrefs): Promise<ServiceInfo[]> {
  if (!(await hasBinary("docker"))) return [];
  const out = await run(
    "docker",
    ["ps", "-a", "--no-trunc", "--format", "{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.State}}\t{{.Status}}\t{{.Ports}}"],
    6000,
    process.env
  );
  if (!out) return [];

  const services: ServiceInfo[] = [];
  for (const line of out.split("\n")) {
    if (!line.trim()) continue;
    const [, name, image, state, status, portsRaw] = line.split("\t");
    if (!name) continue;
    const id = `docker:${name}`;
    const ports: ServicePort[] = [];
    for (const m of (portsRaw ?? "").matchAll(/:(\d+)->\d+\/(tcp|udp)/g)) {
      ports.push({ port: parseInt(m[1], 10), proto: m[2] as "tcp" | "udp", address: "0.0.0.0" });
    }
    const unhealthy = /\(unhealthy\)/.test(status ?? "");
    const restarting = state === "restarting" || state === "created";
    const health: ServiceHealth =
      state === "running" ? (unhealthy ? "degraded" : "healthy")
        : restarting ? "starting"
          : state === "exited" || state === "dead" ? (/Exited \((?!0\))/.test(status ?? "") ? "failed" : "stopped")
            : "unknown";
    services.push({
      id,
      name: prefs.aliases[id] ?? name,
      description: image ?? null,
      source: "docker",
      tier: "app",
      health,
      healthReason: unhealthy ? "container reports unhealthy" : health === "failed" ? status : null,
      activeState: state ?? "unknown",
      subState: status ?? "",
      enabled: null,
      mainPid: null,
      startedAt: null,
      uptimeSeconds: null,
      restarts: 0,
      cpu: 0,
      memory: 0,
      memorySource: "rss",
      processCount: 0,
      ports,
      processes: [],
      statusText: status ?? null,
      pinned: prefs.pinned.includes(id),
      canControl: true,
      check: prefs.checks[id] ?? null,
      probe: null,
    });
  }
  return services;
}

// ─── launchd (macOS) ─────────────────────────────────────────────────────────

async function getLaunchdServices(
  prefs: ServicePrefs,
  byPid: Map<number, RawProcess>,
  portsByPid: Map<number, ServicePort[]>
): Promise<ServiceInfo[]> {
  const out = await run("launchctl", ["list"], 6000, process.env);
  if (!out) return [];
  const services: ServiceInfo[] = [];
  for (const line of out.split("\n").slice(1)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 3) continue;
    const pid = parts[0] === "-" ? null : parseInt(parts[0], 10);
    const exitCode = parseInt(parts[1], 10) || 0;
    const label = parts.slice(2).join(" ");
    // Apple's own agents are the launchd equivalent of systemd plumbing.
    const tier: ServiceTier = label.startsWith("com.apple.") ? "system" : "app";
    if (tier === "system" && !prefs.pinned.includes(label)) continue;
    const proc = pid ? byPid.get(pid) : undefined;
    const health: ServiceHealth = pid ? "healthy" : exitCode !== 0 ? "failed" : "stopped";
    services.push({
      id: label,
      name: prefs.aliases[label] ?? label.split(".").pop() ?? label,
      description: label,
      source: "launchd",
      tier,
      health,
      healthReason: health === "failed" ? `last exit ${exitCode}` : null,
      activeState: pid ? "active" : "inactive",
      subState: pid ? "running" : "dead",
      enabled: null,
      mainPid: pid,
      startedAt: proc ? Date.now() - proc.etimes * 1000 : null,
      uptimeSeconds: proc?.etimes ?? null,
      restarts: 0,
      cpu: proc?.cpu ?? 0,
      memory: proc?.rss ?? 0,
      memorySource: "rss",
      processCount: proc ? 1 : 0,
      ports: pid ? portsByPid.get(pid) ?? [] : [],
      processes: proc ? [stripRaw(proc)] : [],
      statusText: null,
      pinned: prefs.pinned.includes(label),
      canControl: false,
      check: prefs.checks[label] ?? null,
      probe: null,
    });
  }
  return services;
}

// ─── Unmanaged long-running processes ────────────────────────────────────────

const UNMANAGED_MIN_UPTIME_S = 600;

/**
 * A `npm run dev` in tmux is "supposed to be running" just as much as a unit
 * is, but no supervisor knows about it. Adopt process trees that have been up a
 * while and are listening on a port, keyed by the root of the tree so the
 * children come along.
 */
function getUnmanagedServices(
  procs: RawProcess[],
  portsByPid: Map<number, ServicePort[]>,
  prefs: ServicePrefs
): ServiceInfo[] {
  const byPid = new Map(procs.map((p) => [p.pid, p]));
  const candidates = procs.filter((p) => !ownerUnit(p));

  // Group by the cgroup the process actually sits in. A scope
  // (`session-3.scope`, the one a tmux pane or an ssh login lives in) is a real
  // boundary, so it groups exactly the processes started together. Walking the
  // parent chain instead would climb straight past it into `systemd --user` and
  // fold every unrelated session into one row.
  const groups = new Map<string, RawProcess[]>();
  const keyOf = (p: RawProcess): string => {
    const container = p.uunit ?? p.unit;
    if (container) return container;
    // No cgroup information (macOS, or a container without systemd): fall back
    // to the root of the process tree, stopping at anything already managed.
    let cur = p;
    const seen = new Set<number>();
    while (cur.ppid > 1 && !seen.has(cur.ppid)) {
      seen.add(cur.ppid);
      const parent = byPid.get(cur.ppid);
      if (!parent || ownerUnit(parent) || (parent.uunit ?? parent.unit)) break;
      cur = parent;
    }
    return `pid:${cur.pid}`;
  };

  for (const p of candidates) {
    const key = keyOf(p);
    const list = groups.get(key) ?? [];
    list.push(p);
    groups.set(key, list);
  }

  const services: ServiceInfo[] = [];
  for (const [, members] of groups) {
    // Only adopt a group that looks like it is meant to stay up: something in
    // it is listening, and it has been up long enough not to be a one-off
    // command that happened to bind a port.
    const listeners = members.filter((m) => portsByPid.has(m.pid));
    if (listeners.length === 0) continue;
    const oldest = members.reduce((a, b) => (a.etimes >= b.etimes ? a : b));
    if (oldest.etimes < UNMANAGED_MIN_UPTIME_S) continue;

    const anchor = listeners.reduce((a, b) => (a.etimes >= b.etimes ? a : b));
    const id = `proc:${anchor.pid}`;
    services.push({
      id,
      name: prefs.aliases[id] ?? deriveProcessName(anchor),
      description: anchor.command.slice(0, 200),
      source: "process",
      tier: "app",
      health: "healthy",
      healthReason: "unmanaged — no supervisor will restart it",
      activeState: "active",
      subState: "running",
      enabled: false,
      mainPid: anchor.pid,
      startedAt: Date.now() - oldest.etimes * 1000,
      uptimeSeconds: oldest.etimes,
      restarts: 0,
      cpu: Math.round(members.reduce((a, m) => a + m.cpu, 0) * 10) / 10,
      memory: members.reduce((a, m) => a + m.rss, 0),
      memorySource: "rss",
      processCount: members.length,
      ports: dedupePorts(members.flatMap((m) => portsByPid.get(m.pid) ?? [])),
      processes: members.sort((a, b) => b.rss - a.rss).map(stripRaw),
      statusText: null,
      pinned: prefs.pinned.includes(id),
      canControl: false,
      check: prefs.checks[id] ?? null,
      probe: null,
    });
  }
  return services;
}

/** `/home/me/apps/zeed/server.js` reads better as "zeed" than as "node". */
function deriveProcessName(p: RawProcess): string {
  const tokens = p.command.split(/\s+/).filter(Boolean);
  const isInterpreter = /^(node|python3?|ruby|bun|deno|java|php)$/;
  const start = tokens.findIndex((t) => isInterpreter.test(t.split("/").pop() ?? ""));
  if (start === -1) return p.comm;

  for (let i = start + 1; i < tokens.length; i++) {
    const token = tokens[i];
    // `python3 -m http.server` names itself by the module, not the flag.
    if (token === "-m" || token === "--module" || token === "-jar") return tokens[i + 1] ?? p.comm;
    if (token.startsWith("-")) continue;
    const segs = token.split("/").filter(Boolean);
    const file = segs[segs.length - 1] ?? "";
    const dir = segs[segs.length - 2] ?? "";
    const stem = file.replace(/\.(js|mjs|cjs|ts|py|rb|jar|php)$/, "");
    // An entrypoint file says nothing; the directory holding it is the project.
    if (dir && /^(index|main|server|app|start|run)$/i.test(stem)) return dir;
    return stem || p.comm;
  }
  return p.comm;
}

function dedupePorts(ports: ServicePort[]): ServicePort[] {
  const seen = new Set<string>();
  return ports.filter((p) => {
    const key = `${p.proto}:${p.port}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function stripRaw(p: RawProcess | ServiceProcess): ServiceProcess {
  const { pid, ppid, cpu, mem, rss, etimes, stat, user, comm, command, role } = p;
  return { pid, ppid, cpu, mem, rss, etimes, stat, user, comm, command, role };
}

// ─── Assembly ────────────────────────────────────────────────────────────────

export interface ServicesSnapshot {
  services: ServiceInfo[];
  prefs: ServicePrefs;
  summary: {
    healthy: number;
    degraded: number;
    failed: number;
    stopped: number;
    total: number;
  };
  capabilities: {
    systemd: boolean;
    docker: boolean;
    launchd: boolean;
  };
  timestamp: number;
}

export async function getServices(options: { probe?: boolean } = {}): Promise<ServicesSnapshot> {
  const prefs = await loadPrefs();
  const [procs, portsByPid] = await Promise.all([getProcessTable(), getPortsByPid()]);
  const byPid = new Map(procs.map((p) => [p.pid, p]));

  const [systemUnits, userUnits] = IS_LINUX
    ? await Promise.all([showUnits(false), showUnits(true)])
    : [[], []];
  const systemdAvailable = systemUnits.length > 0 || userUnits.length > 0;

  // Attribute every process to its unit up front so each group can report its
  // real member count and aggregate RSS.
  const procsByUnit = new Map<string, RawProcess[]>();
  for (const p of procs) {
    const owner = ownerUnit(p);
    if (!owner) continue;
    const list = procsByUnit.get(owner) ?? [];
    list.push(p);
    procsByUnit.set(owner, list);
  }

  const services: ServiceInfo[] = [];
  const buildUnit = (props: UnitProps, scope: "system" | "user") => {
    const id = props.Id;
    if (!id || props.LoadState === "not-found") return;
    const members = procsByUnit.get(id) ?? [];
    const ports = dedupePorts(members.flatMap((m) => portsByPid.get(m.pid) ?? []));
    const tier = classifyUnit(props, ports.length > 0, members.length > 0);
    const mainPid = parseInt(props.MainPID ?? "0", 10) || null;
    const startedAt = parseUnixTimestamp(props.ExecMainStartTimestamp);
    const uptimeSeconds = startedAt ? Math.max(0, Math.round((Date.now() - startedAt) / 1000)) : null;
    const restarts = parseInt(props.NRestarts ?? "0", 10) || 0;
    const cgroupMem = parseCgroupValue(props.MemoryCurrent);
    const rssTotal = members.reduce((a, m) => a + m.rss, 0);
    const sampledCpu = sampleCpuPercent(id, parseCgroupValue(props.CPUUsageNSec));
    const { health, reason } = deriveHealth(props, uptimeSeconds, restarts, null);
    const stem = id.replace(/\.service$/, "");

    services.push({
      id,
      name: prefs.aliases[id] ?? stem,
      description: props.Description && props.Description !== id ? props.Description : null,
      source: scope === "user" ? "systemd-user" : "systemd-system",
      tier,
      health,
      healthReason: reason,
      activeState: props.ActiveState ?? "unknown",
      subState: props.SubState ?? "",
      enabled: props.UnitFileState ? props.UnitFileState.startsWith("enabled") : null,
      mainPid,
      startedAt,
      uptimeSeconds,
      restarts,
      // First poll has no previous sample to difference against; the lifetime
      // average from ps is a reasonable stand-in for one tick.
      cpu: sampledCpu ?? Math.round(members.reduce((a, m) => a + m.cpu, 0) * 10) / 10,
      memory: cgroupMem ?? rssTotal,
      memorySource: cgroupMem !== null ? "cgroup" : "rss",
      processCount: members.length,
      ports,
      processes: members
        .sort((a, b) => b.rss - a.rss)
        .slice(0, 40)
        .map(stripRaw),
      statusText: props.StatusText || null,
      pinned: prefs.pinned.includes(id),
      canControl: scope === "user",
      check: prefs.checks[id] ?? null,
      probe: null,
    });
  };

  for (const props of userUnits) buildUnit(props, "user");
  // A unit id can exist in both scopes; the user scope is the more specific
  // owner of the processes we grouped, so it is registered first and wins.
  const seen = new Set(services.map((s) => s.id));
  for (const props of systemUnits) {
    if (seen.has(props.Id)) continue;
    buildUnit(props, "system");
  }

  if (IS_MAC) services.push(...(await getLaunchdServices(prefs, byPid, portsByPid)));
  services.push(...(await getDockerServices(prefs)));
  services.push(...getUnmanagedServices(procs, portsByPid, prefs));

  // Configured HTTP checks refine health beyond "the process exists".
  if (options.probe !== false) {
    await Promise.all(
      services
        .filter((s) => s.check && s.activeState === "active")
        .map(async (s) => {
          s.probe = await probeHealthCheck(s.check!);
          if (!s.probe.ok) {
            s.health = "degraded";
            s.healthReason = `check failed: ${s.probe.error ?? s.probe.status}`;
          }
        })
    );
  }

  const visible = services.filter((s) => !prefs.hidden.includes(s.id));
  visible.sort(compareServices);

  const counted = visible.filter((s) => s.tier !== "system");
  return {
    services: visible,
    prefs,
    summary: {
      healthy: counted.filter((s) => s.health === "healthy").length,
      degraded: counted.filter((s) => s.health === "degraded").length,
      failed: counted.filter((s) => s.health === "failed").length,
      stopped: counted.filter((s) => s.health === "stopped").length,
      total: counted.length,
    },
    capabilities: {
      systemd: systemdAvailable,
      docker: services.some((s) => s.source === "docker"),
      launchd: services.some((s) => s.source === "launchd"),
    },
    timestamp: Date.now(),
  };
}

const TIER_ORDER: Record<ServiceTier, number> = { app: 0, infra: 1, system: 2 };
const HEALTH_ORDER: Record<ServiceHealth, number> = {
  failed: 0, degraded: 1, starting: 2, healthy: 3, unknown: 4, stopped: 5,
};

function compareServices(a: ServiceInfo, b: ServiceInfo): number {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
  if (a.tier !== b.tier) return TIER_ORDER[a.tier] - TIER_ORDER[b.tier];
  if (a.health !== b.health) return HEALTH_ORDER[a.health] - HEALTH_ORDER[b.health];
  return a.name.localeCompare(b.name);
}

// ─── Control ─────────────────────────────────────────────────────────────────

const UNIT_ID_RE = /^[A-Za-z0-9@:._\\-]+\.(service|socket|timer|target|mount|path)$/;

export function isValidUnitId(id: string): boolean {
  return UNIT_ID_RE.test(id);
}

export type ControlAction = "start" | "stop" | "restart";

export async function controlService(
  id: string,
  action: ControlAction,
  scope: "user" | "system"
): Promise<{ success: boolean; message: string }> {
  if (id.startsWith("docker:")) {
    const name = id.slice("docker:".length);
    if (!/^[A-Za-z0-9_.-]+$/.test(name)) return { success: false, message: "Invalid container name" };
    const out = await run("docker", [action, name], 30000, process.env);
    return { success: out.includes(name), message: out || `docker ${action} ${name} produced no output` };
  }
  if (!isValidUnitId(id)) return { success: false, message: "Invalid unit id" };

  const args = [...(scope === "user" ? ["--user"] : []), action, id];
  try {
    await execFileAsync("systemctl", args, { timeout: 30000, env: systemctlEnv() });
    return { success: true, message: `${action} ${id}` };
  } catch (err) {
    const stderr = (err as { stderr?: string })?.stderr?.trim();
    return {
      success: false,
      message:
        stderr ||
        (scope === "system"
          ? `Failed to ${action} ${id} — system units need root or a polkit rule`
          : `Failed to ${action} ${id}`),
    };
  }
}

export async function getServiceLogs(
  id: string,
  scope: "user" | "system",
  lines = 100
): Promise<{ logs: string; error: string | null }> {
  if (id.startsWith("docker:")) {
    const name = id.slice("docker:".length);
    if (!/^[A-Za-z0-9_.-]+$/.test(name)) return { logs: "", error: "Invalid container name" };
    const out = await run("docker", ["logs", "--tail", String(lines), name], 10000, process.env);
    return { logs: out, error: out ? null : "No output" };
  }
  if (!isValidUnitId(id)) return { logs: "", error: "Invalid unit id" };

  const flag = scope === "user" ? "--user-unit" : "-u";
  const out = await run(
    "journalctl",
    [flag, id, "-n", String(Math.min(Math.max(lines, 1), 1000)), "--no-pager", "-o", "short-iso", "-q"],
    10000
  );
  if (!out) {
    return {
      logs: "",
      error:
        scope === "system"
          ? "No journal entries readable — add your user to the 'adm' or 'systemd-journal' group to read system unit logs"
          : "No journal entries",
    };
  }
  return { logs: out, error: null };
}
