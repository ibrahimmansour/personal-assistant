import { NextRequest } from "next/server";
import os from "os";
import { execSync } from "child_process";

export const dynamic = "force-dynamic";

const IS_LINUX = os.platform() === "linux";
const IS_MAC = os.platform() === "darwin";

interface CpuTimes {
  user: number;
  nice: number;
  sys: number;
  idle: number;
  irq: number;
}

function exec(cmd: string, timeout = 3000): string {
  try {
    return execSync(cmd, { encoding: "utf8", timeout }).trim();
  } catch {
    return "";
  }
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
  let swap = { total: 0, used: 0 };
  let breakdown = null;

  if (IS_MAC) {
    // macOS memory pressure
    const pressureResult = exec("memory_pressure 2>/dev/null | head -1", 2000);
    if (pressureResult.includes("WARN")) pressure = "warning";
    else if (pressureResult.includes("CRITICAL")) pressure = "critical";

    // macOS swap
    const swapResult = exec("sysctl vm.swapusage 2>/dev/null", 2000);
    const totalMatch = swapResult.match(/total\s*=\s*([\d.]+)M/);
    const usedMatch = swapResult.match(/used\s*=\s*([\d.]+)M/);
    if (totalMatch) swap.total = parseFloat(totalMatch[1]) * 1024 * 1024;
    if (usedMatch) swap.used = parseFloat(usedMatch[1]) * 1024 * 1024;

    // macOS vm_stat breakdown
    const vmStat = exec("vm_stat 2>/dev/null", 2000);
    if (vmStat) {
      const pageSize = 16384;
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
    }
  } else if (IS_LINUX) {
    // Linux: read /proc/meminfo for swap and detailed info
    const meminfo = exec("cat /proc/meminfo 2>/dev/null", 2000);
    if (meminfo) {
      const extract = (key: string) => {
        const m = meminfo.match(new RegExp(`${key}:\\s+(\\d+)`));
        return m ? parseInt(m[1], 10) * 1024 : 0;
      };
      swap = { total: extract("SwapTotal"), used: extract("SwapTotal") - extract("SwapFree") };
      const buffers = extract("Buffers");
      const cached = extract("Cached");
      const sReclaimable = extract("SReclaimable");
      const active = extract("Active");
      const inactive = extract("Inactive");
      breakdown = {
        wired: buffers,
        active: active,
        inactive: inactive,
        compressed: cached + sReclaimable,
        purgeable: 0,
      };
    }

    // Linux memory pressure via PSI
    const psi = exec("cat /proc/pressure/memory 2>/dev/null", 2000);
    if (psi) {
      const avgMatch = psi.match(/some avg10=(\d+\.\d+)/);
      if (avgMatch) {
        const avg = parseFloat(avgMatch[1]);
        if (avg > 50) pressure = "critical";
        else if (avg > 10) pressure = "warning";
      }
    }
  }

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
    const cmd = IS_LINUX
      ? "df -k --output=source,size,used,avail,pcent,target 2>/dev/null | grep -E '^/' | grep -v '/snap/'"
      : "df -k 2>/dev/null | grep -E '^/'";
    const result = exec(cmd, 3000);
    if (!result) throw new Error("empty");

    for (const line of result.split("\n")) {
      if (!line.trim()) continue;
      const parts = line.split(/\s+/);
      if (IS_LINUX) {
        // --output format: source size used avail pcent target
        const total = parseInt(parts[1], 10) * 1024;
        const used = parseInt(parts[2], 10) * 1024;
        const available = parseInt(parts[3], 10) * 1024;
        const usedPercent = parseInt(parts[4]?.replace("%", "") || "0", 10);
        const mount = parts[5] || "/";
        disks.push({ mount, filesystem: parts[0], total, used, available, usedPercent });
      } else {
        const total = parseInt(parts[1], 10) * 1024;
        const used = parseInt(parts[2], 10) * 1024;
        const available = parseInt(parts[3], 10) * 1024;
        const capacityStr = parts[4]?.replace("%", "") || "0";
        const usedPercent = parseInt(capacityStr, 10);
        const mount = parts.slice(8).join(" ") || parts[5] || "/";
        disks.push({ mount, filesystem: parts[0], total, used, available, usedPercent });
      }
    }
  } catch { /* ignore */ }
  if (disks.length === 0) {
    disks.push({ mount: "/", filesystem: "/", total: 0, used: 0, available: 0, usedPercent: 0 });
  }
  return disks;
}

function getDiskIO() {
  if (IS_MAC) {
    const result = exec("iostat -d -c 1 2>/dev/null | tail -1", 3000);
    if (!result) return null;
    const parts = result.split(/\s+/);
    return {
      kbPerTransfer: parseFloat(parts[0]) || 0,
      transfersPerSec: parseInt(parts[1], 10) || 0,
      mbPerSec: parseFloat(parts[2]) || 0,
    };
  } else if (IS_LINUX) {
    // Read from /proc/diskstats or iostat
    const result = exec("iostat -d -k 1 1 2>/dev/null | grep -E '^(sd|vd|nvme)' | head -1", 5000);
    if (!result) return null;
    const parts = result.split(/\s+/);
    // iostat linux: Device tps kB_read/s kB_wrtn/s kB_read kB_wrtn
    return {
      kbPerTransfer: 0,
      transfersPerSec: parseInt(parts[1], 10) || 0,
      mbPerSec: ((parseFloat(parts[2]) || 0) + (parseFloat(parts[3]) || 0)) / 1024,
    };
  }
  return null;
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

  const perInterface: { name: string; bytesIn: number; bytesOut: number; packetsIn: number; packetsOut: number }[] = [];
  let totalBytesIn = 0;
  let totalBytesOut = 0;

  if (IS_MAC) {
    const result = exec("netstat -ib 2>/dev/null | grep -E '^en'", 3000);
    if (result) {
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
    }
  } else if (IS_LINUX) {
    // Read /proc/net/dev
    const result = exec("cat /proc/net/dev 2>/dev/null", 2000);
    if (result) {
      for (const line of result.split("\n").slice(2)) {
        const match = line.match(/^\s*(\w+):\s*(\d+)\s+(\d+)\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+(\d+)\s+(\d+)/);
        if (match && match[1] !== "lo") {
          const name = match[1];
          const bytesIn = parseInt(match[2], 10);
          const packetsIn = parseInt(match[3], 10);
          const bytesOut = parseInt(match[4], 10);
          const packetsOut = parseInt(match[5], 10);
          perInterface.push({ name, bytesIn, bytesOut, packetsIn, packetsOut });
          totalBytesIn += bytesIn;
          totalBytesOut += bytesOut;
        }
      }
    }
  }

  return { interfaces: active, bytesIn: totalBytesIn, bytesOut: totalBytesOut, perInterface };
}

function getProcesses(sortBy: string = "cpu", limit: number = 30) {
  try {
    let cmd: string;
    if (IS_LINUX) {
      const sortFlag = sortBy === "mem" ? "--sort=-%mem" : "--sort=-%cpu";
      cmd = `ps aux ${sortFlag} 2>/dev/null | head -${limit + 1} | tail -${limit}`;
    } else {
      // macOS: -r = sort by CPU, -m = sort by mem
      const sortFlag = sortBy === "mem" ? "-m" : "-r";
      cmd = `ps aux ${sortFlag} 2>/dev/null | head -${limit + 1} | tail -${limit}`;
    }
    const result = exec(cmd, 5000);
    if (!result) return [];

    const processes = result.split("\n").filter(Boolean).map((line) => {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 11) return null;
      const user = parts[0];
      const pid = parseInt(parts[1], 10);
      const cpu = parseFloat(parts[2]) || 0;
      const mem = parseFloat(parts[3]) || 0;
      const vsz = (parseInt(parts[4], 10) || 0) * 1024;
      const rss = (parseInt(parts[5], 10) || 0) * 1024;
      const stat = parts[7] || "";
      const started = parts[8] || "";
      const time = parts[9] || "";
      const command = parts.slice(10).join(" ");
      const shortName = command.split("/").pop()?.split(" ")[0] || command.substring(0, 40);

      if (isNaN(pid)) return null;
      return { user, pid, cpu, mem, vsz, rss, stat, started, time, command, shortName };
    }).filter(Boolean);

    return processes;
  } catch {
    return [];
  }
}

function getProcessCount() {
  const result = exec("ps aux 2>/dev/null | wc -l", 3000);
  return result ? Math.max(0, parseInt(result, 10) - 1) : 0;
}

function getOpenFiles() {
  if (IS_MAC) {
    const result = exec("sysctl kern.num_files 2>/dev/null", 2000);
    const match = result.match(/:\s*(\d+)/);
    return match ? parseInt(match[1], 10) : 0;
  } else if (IS_LINUX) {
    const result = exec("cat /proc/sys/fs/file-nr 2>/dev/null", 2000);
    if (result) {
      const parts = result.split(/\s+/);
      return parseInt(parts[0], 10) || 0;
    }
  }
  return 0;
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
  if (IS_MAC) {
    const result = exec(
      "system_profiler SPDisplaysDataType 2>/dev/null | grep -E '(Chipset Model|VRAM|Metal|Total Number of Cores)'",
      5000
    );
    if (!result) return null;
    const model = result.match(/Chipset Model:\s*(.+)/)?.[1]?.trim() || null;
    const vram = result.match(/VRAM.*?:\s*(.+)/)?.[1]?.trim() || null;
    const metal = result.match(/Metal.*?:\s*(.+)/)?.[1]?.trim() || null;
    const cores = result.match(/Total Number of Cores:\s*(\d+)/)?.[1]?.trim() || null;

    let utilization = null;
    const gpuUtil = exec("ioreg -l 2>/dev/null | grep -i 'gpu-active-residency' | head -1", 2000);
    if (gpuUtil) {
      const match = gpuUtil.match(/=\s*(\d+)/);
      if (match) utilization = parseInt(match[1], 10);
    }

    return model ? { model, vram, metal, cores, utilization } : null;
  } else if (IS_LINUX) {
    // Try nvidia-smi
    const nvidiaSmi = exec("nvidia-smi --query-gpu=name,memory.total,utilization.gpu --format=csv,noheader,nounits 2>/dev/null", 3000);
    if (nvidiaSmi) {
      const parts = nvidiaSmi.split(",").map((s) => s.trim());
      return {
        model: parts[0] || "NVIDIA GPU",
        vram: parts[1] ? `${parts[1]} MB` : null,
        metal: null,
        cores: null,
        utilization: parts[2] ? parseInt(parts[2], 10) : null,
      };
    }
    // Try lspci for basic info
    const lspci = exec("lspci 2>/dev/null | grep -i 'vga\\|3d\\|display' | head -1", 3000);
    if (lspci) {
      const model = lspci.replace(/^.*?:\s*/, "").trim();
      return { model, vram: null, metal: null, cores: null, utilization: null };
    }
    return null;
  }
  return null;
}

function getSystemInfo() {
  const uptimeSeconds = os.uptime();
  const days = Math.floor(uptimeSeconds / 86400);
  const hours = Math.floor((uptimeSeconds % 86400) / 3600);
  const minutes = Math.floor((uptimeSeconds % 3600) / 60);

  let uptimeStr = "";
  if (days > 0) uptimeStr += `${days}d `;
  uptimeStr += `${hours}h ${minutes}m`;

  // Battery (macOS only)
  let battery = null;
  if (IS_MAC) {
    const battResult = exec("pmset -g batt 2>/dev/null | grep -Eo '\\d+%' | head -1", 2000);
    if (battResult) {
      const percent = parseInt(battResult.replace("%", ""), 10);
      const chargingResult = exec("pmset -g batt 2>/dev/null | grep -c 'AC Power'", 2000);
      let timeRemaining = null;
      const timeResult = exec("pmset -g batt 2>/dev/null | grep -Eo '\\d+:\\d+ remaining'", 2000);
      if (timeResult) timeRemaining = timeResult.replace(" remaining", "");
      let cycleCount = null;
      const cycleResult = exec("ioreg -l 2>/dev/null | grep -i cyclecount | head -1", 2000);
      if (cycleResult) {
        const match = cycleResult.match(/=\s*(\d+)/);
        if (match) cycleCount = parseInt(match[1], 10);
      }
      battery = { percent, charging: chargingResult === "1", timeRemaining, cycleCount };
    }
  }

  // CPU temperature
  let cpuTemp = null;
  if (IS_LINUX) {
    // Try thermal zone
    const temp = exec("cat /sys/class/thermal/thermal_zone0/temp 2>/dev/null", 2000);
    if (temp) cpuTemp = Math.round(parseInt(temp, 10) / 1000);
    // Try sensors
    if (!cpuTemp) {
      const sensors = exec("sensors 2>/dev/null | grep -i 'package id\\|tctl\\|cpu' | head -1 | grep -oP '[\\d.]+(?=°C)' | head -1", 2000);
      if (sensors) cpuTemp = Math.round(parseFloat(sensors));
    }
  } else if (IS_MAC) {
    // Requires sudo usually, will silently fail
    const temp = exec("sudo powermetrics --samplers smc -i 1 -n 1 2>/dev/null | grep -i 'CPU die temperature' | grep -Eo '[0-9.]+'", 3000);
    if (temp) cpuTemp = parseFloat(temp);
  }

  // OS version
  let osVersion = null;
  if (IS_MAC) {
    osVersion = exec("sw_vers -productVersion 2>/dev/null", 2000) || null;
  } else if (IS_LINUX) {
    osVersion = exec("cat /etc/os-release 2>/dev/null | grep PRETTY_NAME | cut -d'\"' -f2", 2000) || null;
  }

  // Serial / machine ID
  let serial = null;
  if (IS_MAC) {
    const result = exec("ioreg -l 2>/dev/null | grep IOPlatformSerialNumber | head -1", 2000);
    const match = result.match(/"IOPlatformSerialNumber"\s*=\s*"(.+?)"/);
    if (match) serial = match[1];
  } else if (IS_LINUX) {
    serial = exec("cat /etc/machine-id 2>/dev/null", 2000) || null;
    if (serial && serial.length > 12) serial = serial.substring(0, 12) + "...";
  }

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

// ─── GET: Fetch all metrics ──────────────────────────────────────────────────

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

// ─── POST: Process actions ───────────────────────────────────────────────────

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

        let openFiles = 0;
        let threads = 0;
        let ports: { name: string; type: string; state: string }[] = [];

        if (IS_LINUX) {
          // Linux: use /proc filesystem (no sudo needed)
          const fdCount = exec(`ls /proc/${pid}/fd 2>/dev/null | wc -l`, 3000);
          openFiles = parseInt(fdCount, 10) || 0;

          const taskCount = exec(`ls /proc/${pid}/task 2>/dev/null | wc -l`, 3000);
          threads = parseInt(taskCount, 10) || 0;

          // Network connections from /proc/net or ss
          const ss = exec(`ss -tunap 2>/dev/null | grep "pid=${pid}," | head -10`, 5000);
          if (ss) {
            ports = ss.split("\n").filter(Boolean).map((l) => {
              const parts = l.split(/\s+/);
              return { name: parts[4] || "", type: parts[0] || "", state: parts[1] || "" };
            });
          }
        } else {
          // macOS
          const lsof = exec(`lsof -p ${pid} 2>/dev/null | wc -l`, 5000);
          openFiles = Math.max(0, parseInt(lsof, 10) - 1);

          const threadCount = exec(`ps -M -p ${pid} 2>/dev/null | wc -l`, 3000);
          threads = Math.max(0, parseInt(threadCount, 10) - 1);

          const portsResult = exec(`lsof -i -P -n -p ${pid} 2>/dev/null | grep -v "^COMMAND"`, 5000);
          if (portsResult) {
            ports = portsResult.split("\n").filter(Boolean).map((l) => {
              const parts = l.split(/\s+/);
              return { name: parts[8] || "", type: parts[7] || "", state: parts[9] || "" };
            });
          }
        }

        return Response.json({ pid, openFiles, threads, ports, envLength: 0 });
      }

      case "search-processes": {
        const { query } = body;
        if (!query) return Response.json({ processes: [] });
        const safeQuery = query.replace(/[^a-zA-Z0-9. _-]/g, "");
        const result = exec(
          `ps aux 2>/dev/null | grep -i "${safeQuery}" | grep -v grep | head -20`,
          5000
        );
        if (!result) return Response.json({ processes: [] });
        const processes = result.split("\n").filter(Boolean).map((line) => {
          const parts = line.trim().split(/\s+/);
          if (parts.length < 11) return null;
          const pid = parseInt(parts[1], 10);
          if (isNaN(pid)) return null;
          return {
            user: parts[0],
            pid,
            cpu: parseFloat(parts[2]) || 0,
            mem: parseFloat(parts[3]) || 0,
            vsz: (parseInt(parts[4], 10) || 0) * 1024,
            rss: (parseInt(parts[5], 10) || 0) * 1024,
            stat: parts[7] || "",
            started: parts[8] || "",
            time: parts[9] || "",
            command: parts.slice(10).join(" "),
            shortName: parts.slice(10).join(" ").split("/").pop()?.split(" ")[0] || "",
          };
        }).filter(Boolean);
        return Response.json({ processes });
      }

      // ─── Swap management (Linux only) ────────────────────────────────────

      case "swap-info": {
        if (!IS_LINUX) {
          return Response.json({ error: "Swap management is only available on Linux" }, { status: 400 });
        }
        // Get current swap files/partitions
        const swaps = exec("cat /proc/swaps 2>/dev/null", 2000);
        const swapFiles: { filename: string; type: string; size: number; used: number; priority: number }[] = [];
        if (swaps) {
          const lines = swaps.split("\n").slice(1); // skip header
          for (const line of lines) {
            if (!line.trim()) continue;
            const parts = line.split(/\s+/);
            swapFiles.push({
              filename: parts[0],
              type: parts[1],
              size: (parseInt(parts[2], 10) || 0) * 1024,
              used: (parseInt(parts[3], 10) || 0) * 1024,
              priority: parseInt(parts[4], 10) || 0,
            });
          }
        }
        // Check swappiness
        const swappiness = parseInt(exec("cat /proc/sys/vm/swappiness 2>/dev/null", 2000), 10) || 60;
        return Response.json({ swapFiles, swappiness });
      }

      case "swap-create": {
        if (!IS_LINUX) {
          return Response.json({ error: "Swap management is only available on Linux" }, { status: 400 });
        }
        const { sizeMB, path: swapPath } = body;
        if (!sizeMB || sizeMB < 64 || sizeMB > 65536) {
          return Response.json({ error: "Size must be between 64 MB and 64 GB" }, { status: 400 });
        }
        const filePath = swapPath || "/swapfile";

        // Check if file already exists as swap
        const existingSwaps = exec("cat /proc/swaps 2>/dev/null", 2000);
        if (existingSwaps && existingSwaps.includes(filePath)) {
          return Response.json({ error: `${filePath} is already an active swap` }, { status: 400 });
        }

        try {
          // Create swap file: allocate, set permissions, mkswap, swapon
          const commands = [
            `fallocate -l ${sizeMB}M ${filePath} 2>/dev/null || dd if=/dev/zero of=${filePath} bs=1M count=${sizeMB} 2>/dev/null`,
            `chmod 600 ${filePath}`,
            `mkswap ${filePath}`,
            `swapon ${filePath}`,
          ];
          for (const cmd of commands) {
            const result = exec(cmd, 30000);
            if (result === "" && cmd.includes("mkswap")) {
              // mkswap outputs to stderr on success, check if file exists
              const check = exec(`file ${filePath} 2>/dev/null`, 2000);
              if (!check.includes("swap")) {
                return Response.json({ error: `Failed at: ${cmd}` }, { status: 500 });
              }
            }
          }

          // Make permanent by adding to /etc/fstab if not already there
          const fstab = exec("cat /etc/fstab 2>/dev/null", 2000);
          if (!fstab.includes(filePath)) {
            exec(`echo '${filePath} none swap sw 0 0' >> /etc/fstab`, 3000);
          }

          return Response.json({
            success: true,
            message: `Created ${sizeMB} MB swap at ${filePath} and activated`,
          });
        } catch (err) {
          return Response.json(
            { error: `Failed to create swap: ${err instanceof Error ? err.message : "Unknown"}` },
            { status: 500 }
          );
        }
      }

      case "swap-resize": {
        if (!IS_LINUX) {
          return Response.json({ error: "Swap management is only available on Linux" }, { status: 400 });
        }
        const { sizeMB: newSizeMB, path: resizePath } = body;
        if (!newSizeMB || newSizeMB < 64 || newSizeMB > 65536) {
          return Response.json({ error: "Size must be between 64 MB and 64 GB" }, { status: 400 });
        }
        const targetPath = resizePath || "/swapfile";

        try {
          // Turn off swap on the file
          exec(`swapoff ${targetPath} 2>/dev/null`, 10000);

          // Recreate with new size
          const allocResult = exec(
            `fallocate -l ${newSizeMB}M ${targetPath} 2>/dev/null || dd if=/dev/zero of=${targetPath} bs=1M count=${newSizeMB} 2>/dev/null`,
            60000
          );

          // Set permissions and format
          exec(`chmod 600 ${targetPath}`, 3000);
          exec(`mkswap ${targetPath}`, 10000);
          exec(`swapon ${targetPath}`, 5000);

          return Response.json({
            success: true,
            message: `Resized swap at ${targetPath} to ${newSizeMB} MB`,
          });
        } catch (err) {
          // Try to re-enable old swap if resize failed
          exec(`swapon ${targetPath} 2>/dev/null`, 5000);
          return Response.json(
            { error: `Failed to resize swap: ${err instanceof Error ? err.message : "Unknown"}` },
            { status: 500 }
          );
        }
      }

      case "swap-remove": {
        if (!IS_LINUX) {
          return Response.json({ error: "Swap management is only available on Linux" }, { status: 400 });
        }
        const { path: removePath } = body;
        if (!removePath) {
          return Response.json({ error: "Path is required" }, { status: 400 });
        }

        try {
          exec(`swapoff ${removePath}`, 10000);
          exec(`rm -f ${removePath}`, 5000);

          // Remove from /etc/fstab
          exec(`sed -i '\\|${removePath}|d' /etc/fstab 2>/dev/null`, 3000);

          return Response.json({
            success: true,
            message: `Removed swap at ${removePath}`,
          });
        } catch (err) {
          return Response.json(
            { error: `Failed to remove swap: ${err instanceof Error ? err.message : "Unknown"}` },
            { status: 500 }
          );
        }
      }

      case "swap-swappiness": {
        if (!IS_LINUX) {
          return Response.json({ error: "Swap management is only available on Linux" }, { status: 400 });
        }
        const { value } = body;
        if (value === undefined || value < 0 || value > 100) {
          return Response.json({ error: "Swappiness must be between 0 and 100" }, { status: 400 });
        }

        try {
          // Set immediately
          exec(`sysctl vm.swappiness=${value}`, 3000);
          // Make permanent
          const sysctl = exec("cat /etc/sysctl.conf 2>/dev/null", 2000);
          if (sysctl.includes("vm.swappiness")) {
            exec(`sed -i 's/vm.swappiness=.*/vm.swappiness=${value}/' /etc/sysctl.conf`, 3000);
          } else {
            exec(`echo 'vm.swappiness=${value}' >> /etc/sysctl.conf`, 3000);
          }
          return Response.json({ success: true, message: `Swappiness set to ${value}` });
        } catch (err) {
          return Response.json(
            { error: `Failed to set swappiness: ${err instanceof Error ? err.message : "Unknown"}` },
            { status: 500 }
          );
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
