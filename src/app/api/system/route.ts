import { NextRequest } from "next/server";
import os from "os";
import { execSync } from "child_process";

export const dynamic = "force-dynamic";

interface CpuTimes {
  user: number;
  nice: number;
  sys: number;
  idle: number;
  irq: number;
}

function getCpuUsage(): { perCore: number[]; average: number; frequency?: number } {
  const cpus = os.cpus();
  const perCore = cpus.map((cpu) => {
    const times = cpu.times as CpuTimes;
    const total = times.user + times.nice + times.sys + times.idle + times.irq;
    const active = total - times.idle;
    return Math.round((active / total) * 100);
  });
  const average = Math.round(perCore.reduce((a, b) => a + b, 0) / perCore.length);
  const frequency = cpus[0]?.speed || undefined;
  return { perCore, average, frequency };
}

function getMemoryInfo() {
  const total = os.totalmem();
  const free = os.freemem();
  const used = total - free;
  let pressure = "nominal";
  try {
    const result = execSync("memory_pressure 2>/dev/null | head -1", {
      encoding: "utf8",
      timeout: 2000,
    }).trim();
    if (result.includes("WARN")) pressure = "warning";
    else if (result.includes("CRITICAL")) pressure = "critical";
  } catch { /* ignore */ }

  let swap = { total: 0, used: 0 };
  try {
    const swapResult = execSync("sysctl vm.swapusage 2>/dev/null", {
      encoding: "utf8",
      timeout: 2000,
    }).trim();
    const totalMatch = swapResult.match(/total\s*=\s*([\d.]+)M/);
    const usedMatch = swapResult.match(/used\s*=\s*([\d.]+)M/);
    if (totalMatch) swap.total = parseFloat(totalMatch[1]) * 1024 * 1024;
    if (usedMatch) swap.used = parseFloat(usedMatch[1]) * 1024 * 1024;
  } catch { /* ignore */ }

  // Get wired/active/inactive/compressed breakdown on macOS
  let breakdown = null;
  try {
    const vmStat = execSync("vm_stat 2>/dev/null", { encoding: "utf8", timeout: 2000 }).trim();
    const pageSize = 16384; // Apple Silicon default
    const extract = (key: string) => {
      const m = vmStat.match(new RegExp(`${key}:\\s+(\\d+)`));
      return m ? parseInt(m[1], 10) * pageSize : 0;
    };
    breakdown = {
      wired: extract("Pages wired down"),
      active: extract("Pages active"),
      inactive: extract("Pages inactive"),
      compressed: extract("Pages occupied by compressor"),
      purgeable: extract("Pages purgeable"),
    };
  } catch { /* ignore */ }

  return {
    total,
    used,
    free,
    usedPercent: Math.round((used / total) * 100),
    pressure,
    swap,
    breakdown,
  };
}

function getDiskInfo() {
  const disks: { mount: string; filesystem: string; total: number; used: number; available: number; usedPercent: number }[] = [];
  try {
    const result = execSync("df -k 2>/dev/null | grep -E '^/'", {
      encoding: "utf8",
      timeout: 3000,
    }).trim();
    for (const line of result.split("\n")) {
      const parts = line.split(/\s+/);
      const total = parseInt(parts[1], 10) * 1024;
      const used = parseInt(parts[2], 10) * 1024;
      const available = parseInt(parts[3], 10) * 1024;
      const capacityStr = parts[4]?.replace("%", "") || "0";
      const usedPercent = parseInt(capacityStr, 10);
      const mount = parts.slice(8).join(" ") || parts[5] || "/";
      disks.push({ mount, filesystem: parts[0], total, used, available, usedPercent });
    }
  } catch { /* ignore */ }
  if (disks.length === 0) {
    disks.push({ mount: "/", filesystem: "/", total: 0, used: 0, available: 0, usedPercent: 0 });
  }
  return disks;
}

function getDiskIO() {
  try {
    const result = execSync(
      "iostat -d -c 1 2>/dev/null | tail -1",
      { encoding: "utf8", timeout: 3000 }
    ).trim();
    const parts = result.split(/\s+/);
    // iostat -d: KB/t tps MB/s
    return {
      kbPerTransfer: parseFloat(parts[0]) || 0,
      transfersPerSec: parseInt(parts[1], 10) || 0,
      mbPerSec: parseFloat(parts[2]) || 0,
    };
  } catch {
    return null;
  }
}

function getNetworkInfo() {
  const interfaces = os.networkInterfaces();
  const active: { name: string; address: string; mac: string; family: string }[] = [];

  for (const [name, addrs] of Object.entries(interfaces)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      if (!addr.internal && addr.family === "IPv4") {
        active.push({ name, address: addr.address, mac: addr.mac, family: addr.family });
      }
    }
  }

  // Get per-interface network stats
  const perInterface: { name: string; bytesIn: number; bytesOut: number; packetsIn: number; packetsOut: number }[] = [];
  let totalBytesIn = 0;
  let totalBytesOut = 0;
  try {
    const result = execSync(
      "netstat -ib 2>/dev/null | grep -E '^en'",
      { encoding: "utf8", timeout: 3000 }
    ).trim();
    const seen = new Set<string>();
    for (const line of result.split("\n")) {
      const parts = line.split(/\s+/);
      const name = parts[0];
      if (seen.has(name)) continue;
      seen.add(name);
      const bytesIn = parseInt(parts[6], 10) || 0;
      const bytesOut = parseInt(parts[9], 10) || 0;
      const packetsIn = parseInt(parts[4], 10) || 0;
      const packetsOut = parseInt(parts[7], 10) || 0;
      perInterface.push({ name, bytesIn, bytesOut, packetsIn, packetsOut });
      totalBytesIn += bytesIn;
      totalBytesOut += bytesOut;
    }
  } catch { /* ignore */ }

  return { interfaces: active, bytesIn: totalBytesIn, bytesOut: totalBytesOut, perInterface };
}

function getProcesses(sortBy: string = "cpu", limit: number = 30) {
  try {
    // Get detailed process list
    const sortFlag = sortBy === "mem" ? "-m" : "-r"; // -r = by CPU, -m = by mem
    const result = execSync(
      `ps aux ${sortFlag} 2>/dev/null | head -${limit + 1} | tail -${limit}`,
      { encoding: "utf8", timeout: 5000 }
    ).trim();

    const processes = result.split("\n").map((line) => {
      const parts = line.trim().split(/\s+/);
      const user = parts[0];
      const pid = parseInt(parts[1], 10);
      const cpu = parseFloat(parts[2]);
      const mem = parseFloat(parts[3]);
      const vsz = parseInt(parts[4], 10) * 1024; // Virtual memory in bytes
      const rss = parseInt(parts[5], 10) * 1024; // Resident memory in bytes
      const stat = parts[7] || "";
      const started = parts[8] || "";
      const time = parts[9] || "";
      const command = parts.slice(10).join(" ");
      const shortName = command.split("/").pop()?.split(" ")[0] || command.substring(0, 40);

      return { user, pid, cpu, mem, vsz, rss, stat, started, time, command, shortName };
    });

    return processes;
  } catch {
    return [];
  }
}

function getProcessCount() {
  try {
    const result = execSync("ps aux 2>/dev/null | wc -l", {
      encoding: "utf8",
      timeout: 3000,
    }).trim();
    return Math.max(0, parseInt(result, 10) - 1); // minus header
  } catch {
    return 0;
  }
}

function getOpenFiles() {
  try {
    const result = execSync("sysctl kern.num_files 2>/dev/null", {
      encoding: "utf8",
      timeout: 2000,
    }).trim();
    const match = result.match(/:\s*(\d+)/);
    return match ? parseInt(match[1], 10) : 0;
  } catch {
    return 0;
  }
}

function getLoadAverage() {
  const [one, five, fifteen] = os.loadavg();
  return {
    "1m": Math.round(one * 100) / 100,
    "5m": Math.round(five * 100) / 100,
    "15m": Math.round(fifteen * 100) / 100,
  };
}

function getGpuInfo() {
  try {
    const result = execSync(
      "system_profiler SPDisplaysDataType 2>/dev/null | grep -E '(Chipset Model|VRAM|Metal|Total Number of Cores)'",
      { encoding: "utf8", timeout: 5000 }
    ).trim();
    const model = result.match(/Chipset Model:\s*(.+)/)?.[1]?.trim() || null;
    const vram = result.match(/VRAM.*?:\s*(.+)/)?.[1]?.trim() || null;
    const metal = result.match(/Metal.*?:\s*(.+)/)?.[1]?.trim() || null;
    const cores = result.match(/Total Number of Cores:\s*(\d+)/)?.[1]?.trim() || null;

    // Try to get GPU utilization via powermetrics (usually needs sudo)
    let utilization = null;
    try {
      const gpuUtil = execSync(
        "ioreg -l 2>/dev/null | grep -i 'gpu-active-residency' | head -1",
        { encoding: "utf8", timeout: 2000 }
      ).trim();
      const match = gpuUtil.match(/=\s*(\d+)/);
      if (match) utilization = parseInt(match[1], 10);
    } catch { /* ignore */ }

    return model ? { model, vram, metal, cores, utilization } : null;
  } catch {
    return null;
  }
}

function getSystemInfo() {
  const uptimeSeconds = os.uptime();
  const days = Math.floor(uptimeSeconds / 86400);
  const hours = Math.floor((uptimeSeconds % 86400) / 3600);
  const minutes = Math.floor((uptimeSeconds % 3600) / 60);

  let uptimeStr = "";
  if (days > 0) uptimeStr += `${days}d `;
  uptimeStr += `${hours}h ${minutes}m`;

  // Battery
  let battery = null;
  try {
    const result = execSync(
      "pmset -g batt 2>/dev/null | grep -Eo '\\d+%' | head -1",
      { encoding: "utf8", timeout: 2000 }
    ).trim();
    if (result) {
      const percent = parseInt(result.replace("%", ""), 10);
      const chargingResult = execSync(
        "pmset -g batt 2>/dev/null | grep -c 'AC Power'",
        { encoding: "utf8", timeout: 2000 }
      ).trim();
      // Get time remaining
      let timeRemaining = null;
      try {
        const timeResult = execSync(
          "pmset -g batt 2>/dev/null | grep -Eo '\\d+:\\d+ remaining'",
          { encoding: "utf8", timeout: 2000 }
        ).trim();
        if (timeResult) timeRemaining = timeResult.replace(" remaining", "");
      } catch { /* ignore */ }
      // Get cycle count
      let cycleCount = null;
      try {
        const cycleResult = execSync(
          "ioreg -l 2>/dev/null | grep -i cyclecount | head -1",
          { encoding: "utf8", timeout: 2000 }
        ).trim();
        const match = cycleResult.match(/=\s*(\d+)/);
        if (match) cycleCount = parseInt(match[1], 10);
      } catch { /* ignore */ }
      battery = {
        percent,
        charging: chargingResult === "1",
        timeRemaining,
        cycleCount,
      };
    }
  } catch { /* ignore */ }

  // CPU temperature
  let cpuTemp = null;
  try {
    const result = execSync(
      "sudo powermetrics --samplers smc -i 1 -n 1 2>/dev/null | grep -i 'CPU die temperature' | grep -Eo '[0-9.]+'",
      { encoding: "utf8", timeout: 3000 }
    ).trim();
    if (result) cpuTemp = parseFloat(result);
  } catch { /* ignore */ }

  // macOS version
  let osVersion = null;
  try {
    osVersion = execSync("sw_vers -productVersion 2>/dev/null", {
      encoding: "utf8",
      timeout: 2000,
    }).trim();
  } catch { /* ignore */ }

  // Serial number
  let serial = null;
  try {
    const result = execSync(
      "ioreg -l 2>/dev/null | grep IOPlatformSerialNumber | head -1",
      { encoding: "utf8", timeout: 2000 }
    ).trim();
    const match = result.match(/"IOPlatformSerialNumber"\s*=\s*"(.+?)"/);
    if (match) serial = match[1];
  } catch { /* ignore */ }

  return {
    hostname: os.hostname(),
    platform: os.platform(),
    arch: os.arch(),
    release: os.release(),
    osVersion,
    cpuModel: os.cpus()[0]?.model || "Unknown",
    cpuCores: os.cpus().length,
    uptime: uptimeStr,
    uptimeSeconds,
    battery,
    cpuTemp,
    serial,
    userInfo: os.userInfo().username,
  };
}

export async function GET(request: NextRequest) {
  const sortBy = request.nextUrl.searchParams.get("sortBy") || "cpu";
  const processLimit = parseInt(request.nextUrl.searchParams.get("processLimit") || "30", 10);

  try {
    const cpu = getCpuUsage();
    const memory = getMemoryInfo();
    const disks = getDiskInfo();
    const diskIO = getDiskIO();
    const network = getNetworkInfo();
    const processes = getProcesses(sortBy, processLimit);
    const processCount = getProcessCount();
    const openFiles = getOpenFiles();
    const loadAverage = getLoadAverage();
    const gpu = getGpuInfo();
    const system = getSystemInfo();

    return Response.json({
      cpu,
      memory,
      disks,
      diskIO,
      network,
      processes,
      processCount,
      openFiles,
      loadAverage,
      gpu,
      system,
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error("System API error:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to get system info" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action } = body;

    switch (action) {
      case "kill": {
        const { pid, signal } = body;
        if (!pid || typeof pid !== "number") {
          return Response.json({ error: "Invalid PID" }, { status: 400 });
        }
        const sig = signal || "SIGTERM";
        try {
          process.kill(pid, sig);
          return Response.json({ success: true, message: `Sent ${sig} to PID ${pid}` });
        } catch (err) {
          return Response.json(
            { error: `Failed to kill PID ${pid}: ${err instanceof Error ? err.message : "Unknown"}` },
            { status: 403 }
          );
        }
      }

      case "process-detail": {
        const { pid } = body;
        if (!pid) return Response.json({ error: "Invalid PID" }, { status: 400 });
        try {
          // Get detailed info about a specific process
          const lsof = execSync(
            `lsof -p ${pid} 2>/dev/null | wc -l`,
            { encoding: "utf8", timeout: 5000 }
          ).trim();
          const env = execSync(
            `ps eww -p ${pid} 2>/dev/null | tail -1`,
            { encoding: "utf8", timeout: 3000 }
          ).trim();
          const threads = execSync(
            `ps -M -p ${pid} 2>/dev/null | wc -l`,
            { encoding: "utf8", timeout: 3000 }
          ).trim();
          const ports = execSync(
            `lsof -i -P -n -p ${pid} 2>/dev/null | grep -v "^COMMAND"`,
            { encoding: "utf8", timeout: 5000 }
          ).trim();

          return Response.json({
            pid,
            openFiles: Math.max(0, parseInt(lsof, 10) - 1),
            threads: Math.max(0, parseInt(threads, 10) - 1),
            ports: ports ? ports.split("\n").map((l) => {
              const parts = l.split(/\s+/);
              return { name: parts[8] || "", type: parts[7] || "", state: parts[9] || "" };
            }) : [],
            envLength: env.length,
          });
        } catch {
          return Response.json({ pid, openFiles: 0, threads: 0, ports: [], envLength: 0 });
        }
      }

      case "search-processes": {
        const { query } = body;
        if (!query) return Response.json({ processes: [] });
        try {
          const result = execSync(
            `ps aux 2>/dev/null | grep -i "${query.replace(/[^a-zA-Z0-9. _-]/g, "")}" | grep -v grep | head -20`,
            { encoding: "utf8", timeout: 5000 }
          ).trim();
          if (!result) return Response.json({ processes: [] });
          const processes = result.split("\n").map((line) => {
            const parts = line.trim().split(/\s+/);
            return {
              user: parts[0],
              pid: parseInt(parts[1], 10),
              cpu: parseFloat(parts[2]),
              mem: parseFloat(parts[3]),
              vsz: parseInt(parts[4], 10) * 1024,
              rss: parseInt(parts[5], 10) * 1024,
              stat: parts[7] || "",
              started: parts[8] || "",
              time: parts[9] || "",
              command: parts.slice(10).join(" "),
              shortName: parts.slice(10).join(" ").split("/").pop()?.split(" ")[0] || "",
            };
          });
          return Response.json({ processes });
        } catch {
          return Response.json({ processes: [] });
        }
      }

      default:
        return Response.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
