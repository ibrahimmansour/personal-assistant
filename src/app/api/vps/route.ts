import { NextRequest } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import os from "os";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export const dynamic = "force-dynamic";

const DATA_DIR = path.join(os.homedir(), ".personal-assistant");
const CONNECTIONS_FILE = path.join(DATA_DIR, "vps-connections.json");

export interface VpsConnection {
  id: string;
  label: string;
  host: string;
  port: number;
  username: string;
  /** Path to SSH private key (e.g. ~/.ssh/id_rsa) */
  keyPath: string;
  /** Default remote directory to start in */
  defaultPath: string;
  createdAt: string;
}

async function loadConnections(): Promise<VpsConnection[]> {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const raw = await fs.readFile(CONNECTIONS_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function saveConnections(connections: VpsConnection[]): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(CONNECTIONS_FILE, JSON.stringify(connections, null, 2));
}

/** Build SSH args common to all commands */
function sshArgs(conn: VpsConnection): string[] {
  const keyPath = conn.keyPath.startsWith("~")
    ? path.join(os.homedir(), conn.keyPath.slice(1))
    : conn.keyPath;
  return [
    "-o", "StrictHostKeyChecking=no",
    "-o", "BatchMode=yes",
    "-o", "ConnectTimeout=10",
    "-i", keyPath,
    "-p", String(conn.port),
  ];
}

function sshTarget(conn: VpsConnection): string {
  return `${conn.username}@${conn.host}`;
}

/**
 * GET /api/vps?action=connections                           → list saved connections
 * GET /api/vps?action=list&id=<connId>&path=/remote/dir     → list remote directory
 * GET /api/vps?action=read&id=<connId>&path=/remote/file    → read remote file (text, capped)
 */
export async function GET(request: NextRequest) {
  const action = request.nextUrl.searchParams.get("action") || "connections";

  // ─── List saved connections ────────────────────────────────────────
  if (action === "connections") {
    const connections = await loadConnections();
    // Don't expose key paths to frontend
    return Response.json({
      connections: connections.map((c) => ({
        id: c.id,
        label: c.label,
        host: c.host,
        port: c.port,
        username: c.username,
        defaultPath: c.defaultPath,
        keyPath: c.keyPath,
        createdAt: c.createdAt,
      })),
    });
  }

  // ─── List remote directory ─────────────────────────────────────────
  if (action === "list") {
    const connId = request.nextUrl.searchParams.get("id");
    const remotePath = request.nextUrl.searchParams.get("path") || "/";
    if (!connId) return Response.json({ error: "Missing connection id" }, { status: 400 });

    const connections = await loadConnections();
    const conn = connections.find((c) => c.id === connId);
    if (!conn) return Response.json({ error: "Connection not found" }, { status: 404 });

    try {
      // Use stat-like ls to get file info
      // ls -la --time-style=full-iso outputs: perms links owner group size date time timezone name
      const cmd = `ls -la --time-style=full-iso ${JSON.stringify(remotePath)} 2>/dev/null || ls -la ${JSON.stringify(remotePath)}`;
      const { stdout } = await execFileAsync(
        "ssh",
        [...sshArgs(conn), sshTarget(conn), cmd],
        { timeout: 15000, maxBuffer: 2 * 1024 * 1024 }
      );

      const lines = stdout.trim().split("\n");
      interface RemoteEntry {
        name: string;
        path: string;
        isDirectory: boolean;
        size: number;
        modified: string;
        extension: string;
      }
      const entries: RemoteEntry[] = [];

      for (const line of lines) {
        // Skip total line and . / ..
        if (line.startsWith("total ") || !line.trim()) continue;
        // Parse ls -la output
        const parts = line.split(/\s+/);
        if (parts.length < 9) continue;
        const perms = parts[0];
        const isDir = perms.startsWith("d");
        const isLink = perms.startsWith("l");

        // Name is everything after the 8th field (to handle spaces)
        // With --time-style=full-iso: perms links owner group size date time tz name...
        // Without: perms links owner group size month day time name...
        let name: string;
        let size: number;
        let modified: string;

        if (parts[5] && parts[5].match(/^\d{4}-\d{2}-\d{2}$/)) {
          // full-iso format
          size = parseInt(parts[4], 10) || 0;
          modified = `${parts[5]}T${parts[6] || "00:00:00"}`;
          name = parts.slice(8).join(" ");
        } else {
          // Standard ls format: month day time/year
          size = parseInt(parts[4], 10) || 0;
          modified = `${parts[5]} ${parts[6]} ${parts[7]}`;
          name = parts.slice(8).join(" ");
        }

        // Handle symlinks: name -> target
        if (isLink && name.includes(" -> ")) {
          name = name.split(" -> ")[0];
        }

        // Skip . and ..
        if (name === "." || name === "..") continue;

        const entryPath = remotePath.replace(/\/$/, "") + "/" + name;
        const ext = isDir ? "" : (name.includes(".") ? "." + name.split(".").pop()!.toLowerCase() : "");

        entries.push({
          name,
          path: entryPath,
          isDirectory: isDir || isLink,
          size,
          modified,
          extension: ext,
        });
      }

      // Sort: dirs first, then alphabetical
      entries.sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
        return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      });

      // Get parent path
      const parent = remotePath === "/" ? "/" : path.posix.dirname(remotePath);

      return Response.json({
        path: remotePath,
        parent,
        entries,
        connectionId: connId,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "SSH command failed";
      return Response.json({ error: msg, path: remotePath }, { status: 500 });
    }
  }

  // ─── Read remote file ──────────────────────────────────────────────
  if (action === "read") {
    const connId = request.nextUrl.searchParams.get("id");
    const remotePath = request.nextUrl.searchParams.get("path") || "";
    if (!connId || !remotePath) return Response.json({ error: "Missing id or path" }, { status: 400 });

    const connections = await loadConnections();
    const conn = connections.find((c) => c.id === connId);
    if (!conn) return Response.json({ error: "Connection not found" }, { status: 404 });

    try {
      // Read file via ssh cat, capped at 100KB
      const cmd = `head -c 102400 ${JSON.stringify(remotePath)}`;
      const { stdout } = await execFileAsync(
        "ssh",
        [...sshArgs(conn), sshTarget(conn), cmd],
        { timeout: 15000, maxBuffer: 200 * 1024 }
      );

      const truncated = stdout.length >= 102400;
      const ext = remotePath.includes(".") ? "." + remotePath.split(".").pop()!.toLowerCase() : "";

      return Response.json({
        content: stdout,
        truncated,
        size: stdout.length,
        extension: ext,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to read remote file";
      return Response.json({ error: msg }, { status: 500 });
    }
  }

  return Response.json({ error: "Unknown action" }, { status: 400 });
}

/**
 * POST /api/vps
 * Actions: add-connection, update-connection, delete-connection, test-connection,
 *          copy-to-remote, copy-from-remote, mkdir, delete, rename
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action } = body;

    // ─── Add connection ──────────────────────────────────────────────
    if (action === "add-connection") {
      const { label, host, port, username, keyPath, defaultPath } = body;
      if (!host || !username || !keyPath) {
        return Response.json({ error: "host, username, and keyPath are required" }, { status: 400 });
      }

      const connections = await loadConnections();
      const newConn: VpsConnection = {
        id: `vps-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        label: label || `${username}@${host}`,
        host,
        port: port || 22,
        username,
        keyPath,
        defaultPath: defaultPath || "/home/" + username,
        createdAt: new Date().toISOString(),
      };
      connections.push(newConn);
      await saveConnections(connections);
      return Response.json({ connection: newConn, connections });
    }

    // ─── Update connection ───────────────────────────────────────────
    if (action === "update-connection") {
      const { id, label, host, port, username, keyPath, defaultPath } = body;
      if (!id) return Response.json({ error: "id required" }, { status: 400 });

      const connections = await loadConnections();
      const idx = connections.findIndex((c) => c.id === id);
      if (idx < 0) return Response.json({ error: "Connection not found" }, { status: 404 });

      if (label !== undefined) connections[idx].label = label;
      if (host !== undefined) connections[idx].host = host;
      if (port !== undefined) connections[idx].port = port;
      if (username !== undefined) connections[idx].username = username;
      if (keyPath !== undefined) connections[idx].keyPath = keyPath;
      if (defaultPath !== undefined) connections[idx].defaultPath = defaultPath;

      await saveConnections(connections);
      return Response.json({ connection: connections[idx], connections });
    }

    // ─── Delete connection ───────────────────────────────────────────
    if (action === "delete-connection") {
      const { id } = body;
      if (!id) return Response.json({ error: "id required" }, { status: 400 });

      let connections = await loadConnections();
      connections = connections.filter((c) => c.id !== id);
      await saveConnections(connections);
      return Response.json({ deleted: true, connections });
    }

    // ─── Test connection ─────────────────────────────────────────────
    if (action === "test-connection") {
      const { host, port, username, keyPath } = body;
      if (!host || !username || !keyPath) {
        return Response.json({ error: "host, username, keyPath required" }, { status: 400 });
      }

      const conn: VpsConnection = {
        id: "test", label: "test", host, port: port || 22,
        username, keyPath, defaultPath: "/", createdAt: "",
      };

      try {
        const { stdout } = await execFileAsync(
          "ssh",
          [...sshArgs(conn), sshTarget(conn), "echo ok && hostname"],
          { timeout: 15000 }
        );
        return Response.json({ success: true, output: stdout.trim() });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Connection failed";
        return Response.json({ success: false, error: msg });
      }
    }

    // ─── Copy local → remote (scp upload) ────────────────────────────
    if (action === "copy-to-remote") {
      const { id, localPath, remotePath } = body;
      if (!id || !localPath || !remotePath) {
        return Response.json({ error: "id, localPath, remotePath required" }, { status: 400 });
      }

      const connections = await loadConnections();
      const conn = connections.find((c) => c.id === id);
      if (!conn) return Response.json({ error: "Connection not found" }, { status: 404 });

      const resolvedLocal = localPath.startsWith("~")
        ? path.join(os.homedir(), localPath.slice(1))
        : localPath;
      const keyPath = conn.keyPath.startsWith("~")
        ? path.join(os.homedir(), conn.keyPath.slice(1))
        : conn.keyPath;

      try {
        // Check if source is directory
        const stat = await fs.stat(resolvedLocal);
        const scpArgs = [
          "-o", "StrictHostKeyChecking=no",
          "-o", "BatchMode=yes",
          "-i", keyPath,
          "-P", String(conn.port),
          ...(stat.isDirectory() ? ["-r"] : []),
          resolvedLocal,
          `${sshTarget(conn)}:${remotePath}`,
        ];

        await execFileAsync("scp", scpArgs, { timeout: 120000 });
        return Response.json({ copied: true, from: localPath, to: remotePath });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "SCP upload failed";
        return Response.json({ error: msg }, { status: 500 });
      }
    }

    // ─── Copy remote → local (scp download) ──────────────────────────
    if (action === "copy-from-remote") {
      const { id, remotePath, localPath } = body;
      if (!id || !remotePath || !localPath) {
        return Response.json({ error: "id, remotePath, localPath required" }, { status: 400 });
      }

      const connections = await loadConnections();
      const conn = connections.find((c) => c.id === id);
      if (!conn) return Response.json({ error: "Connection not found" }, { status: 404 });

      const resolvedLocal = localPath.startsWith("~")
        ? path.join(os.homedir(), localPath.slice(1))
        : localPath;
      const keyPath = conn.keyPath.startsWith("~")
        ? path.join(os.homedir(), conn.keyPath.slice(1))
        : conn.keyPath;

      try {
        // Check if remote path is directory
        const { stdout: typeCheck } = await execFileAsync(
          "ssh",
          [...sshArgs(conn), sshTarget(conn), `test -d ${JSON.stringify(remotePath)} && echo dir || echo file`],
          { timeout: 10000 }
        );
        const isDir = typeCheck.trim() === "dir";

        const scpArgs = [
          "-o", "StrictHostKeyChecking=no",
          "-o", "BatchMode=yes",
          "-i", keyPath,
          "-P", String(conn.port),
          ...(isDir ? ["-r"] : []),
          `${sshTarget(conn)}:${remotePath}`,
          resolvedLocal,
        ];

        await execFileAsync("scp", scpArgs, { timeout: 120000 });
        return Response.json({ copied: true, from: remotePath, to: localPath });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "SCP download failed";
        return Response.json({ error: msg }, { status: 500 });
      }
    }

    // ─── Remote mkdir ────────────────────────────────────────────────
    if (action === "mkdir") {
      const { id, remotePath: rp } = body;
      if (!id || !rp) return Response.json({ error: "id, remotePath required" }, { status: 400 });

      const connections = await loadConnections();
      const conn = connections.find((c) => c.id === id);
      if (!conn) return Response.json({ error: "Connection not found" }, { status: 404 });

      try {
        await execFileAsync(
          "ssh",
          [...sshArgs(conn), sshTarget(conn), `mkdir -p ${JSON.stringify(rp)}`],
          { timeout: 10000 }
        );
        return Response.json({ created: true, path: rp });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "mkdir failed";
        return Response.json({ error: msg }, { status: 500 });
      }
    }

    // ─── Remote touch (create empty file) ──────────────────────────
    if (action === "touch") {
      const { id, remotePath: rp } = body;
      if (!id || !rp) return Response.json({ error: "id, remotePath required" }, { status: 400 });

      const connections = await loadConnections();
      const conn = connections.find((c) => c.id === id);
      if (!conn) return Response.json({ error: "Connection not found" }, { status: 404 });

      try {
        await execFileAsync(
          "ssh",
          [...sshArgs(conn), sshTarget(conn), `touch ${JSON.stringify(rp)}`],
          { timeout: 10000 }
        );
        return Response.json({ created: true, path: rp });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "touch failed";
        return Response.json({ error: msg }, { status: 500 });
      }
    }

    // ─── Remote delete ───────────────────────────────────────────────
    if (action === "delete") {
      const { id, remotePath: rp } = body;
      if (!id || !rp) return Response.json({ error: "id, remotePath required" }, { status: 400 });
      // Safety: don't delete root
      if (rp === "/" || rp === "/home") {
        return Response.json({ error: "Refusing to delete root paths" }, { status: 403 });
      }

      const connections = await loadConnections();
      const conn = connections.find((c) => c.id === id);
      if (!conn) return Response.json({ error: "Connection not found" }, { status: 404 });

      try {
        await execFileAsync(
          "ssh",
          [...sshArgs(conn), sshTarget(conn), `rm -rf ${JSON.stringify(rp)}`],
          { timeout: 15000 }
        );
        return Response.json({ deleted: true, path: rp });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Delete failed";
        return Response.json({ error: msg }, { status: 500 });
      }
    }

    // ─── Remote rename ───────────────────────────────────────────────
    if (action === "rename") {
      const { id, from, to } = body;
      if (!id || !from || !to) return Response.json({ error: "id, from, to required" }, { status: 400 });

      const connections = await loadConnections();
      const conn = connections.find((c) => c.id === id);
      if (!conn) return Response.json({ error: "Connection not found" }, { status: 404 });

      try {
        const newPath = path.posix.join(path.posix.dirname(from), to);
        await execFileAsync(
          "ssh",
          [...sshArgs(conn), sshTarget(conn), `mv ${JSON.stringify(from)} ${JSON.stringify(newPath)}`],
          { timeout: 10000 }
        );
        return Response.json({ renamed: true, from, path: newPath });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Rename failed";
        return Response.json({ error: msg }, { status: 500 });
      }
    }

    // ─── Local copy/move ─────────────────────────────────────────────
    if (action === "local-copy") {
      const { from, to } = body;
      if (!from || !to) return Response.json({ error: "from and to required" }, { status: 400 });

      const resolvedFrom = from.startsWith("~") ? path.join(os.homedir(), from.slice(1)) : from;
      const resolvedTo = to.startsWith("~") ? path.join(os.homedir(), to.slice(1)) : to;
      const absFrom = path.resolve(resolvedFrom);
      const absTo = path.resolve(resolvedTo);

      try {
        const stat = await fs.stat(absFrom);
        if (stat.isDirectory()) {
          await execFileAsync("cp", ["-r", absFrom, absTo], { timeout: 60000 });
        } else {
          await fs.copyFile(absFrom, absTo);
        }
        return Response.json({ copied: true, from: absFrom, to: absTo });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Copy failed";
        return Response.json({ error: msg }, { status: 500 });
      }
    }

    return Response.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
