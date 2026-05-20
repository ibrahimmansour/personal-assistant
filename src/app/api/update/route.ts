import { NextRequest } from "next/server";
import { execSync, spawn } from "child_process";
import { readFile } from "fs/promises";
import { join } from "path";
import { homedir } from "os";

export const dynamic = "force-dynamic";

const REPO = "ibrahimmansour/personal-assistant";
const INSTALL_DIR = join(homedir(), ".personal-assistant", "bin");

async function getCurrentVersion(): Promise<string> {
  try {
    // Try reading from the server directory's package.json
    const pkg = await readFile(join(INSTALL_DIR, "server", "package.json"), "utf-8");
    return JSON.parse(pkg).version || "unknown";
  } catch {
    // Fallback: use the app's own version
    try {
      const pkg = await readFile(join(process.cwd(), "package.json"), "utf-8");
      return JSON.parse(pkg).version || "unknown";
    } catch {
      return "unknown";
    }
  }
}

async function getLatestRelease(): Promise<{ tag: string; version: string; url: string } | null> {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { "Accept": "application/vnd.github.v3+json" },
      next: { revalidate: 0 },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return {
      tag: data.tag_name,
      version: data.tag_name.replace(/^v/, ""),
      url: data.html_url,
    };
  } catch {
    return null;
  }
}

function isNewerVersion(latest: string, current: string): boolean {
  const l = latest.split(".").map(Number);
  const c = current.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((l[i] || 0) > (c[i] || 0)) return true;
    if ((l[i] || 0) < (c[i] || 0)) return false;
  }
  return false;
}

export async function GET() {
  const current = await getCurrentVersion();
  const latest = await getLatestRelease();

  return Response.json({
    current,
    latest: latest?.version || null,
    updateAvailable: latest ? isNewerVersion(latest.version, current) : false,
    releaseUrl: latest?.url || null,
  });
}

export async function POST(request: NextRequest) {
  const { action } = await request.json();

  if (action !== "update") {
    return Response.json({ error: "Unknown action" }, { status: 400 });
  }

  try {
    // Download and install latest release, then restart
    const script = `
      set -e
      LATEST=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" | grep '"tag_name"' | cut -d'"' -f4)
      DOWNLOAD_URL="https://github.com/${REPO}/releases/download/$LATEST/personal-assistant-linux-x64.tar.gz"
      curl -fsSL "$DOWNLOAD_URL" | tar -xz -C "${INSTALL_DIR}"
      chmod +x "${INSTALL_DIR}/personal-assistant"
      cd "${INSTALL_DIR}" && npm install --omit=dev 2>/dev/null
    `;

    execSync(script, { shell: "/bin/bash", timeout: 120000, stdio: "pipe" });

    // Schedule restart after response is sent
    setTimeout(() => {
      const child = spawn("/bin/bash", ["-c", `sleep 1 && exec "${INSTALL_DIR}/personal-assistant"`], {
        stdio: "ignore",
        detached: true,
      });
      child.unref();
      process.exit(0);
    }, 1000);

    return Response.json({ success: true, message: "Update installed. Restarting..." });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
