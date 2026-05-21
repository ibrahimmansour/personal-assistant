#!/usr/bin/env node
/**
 * Build standalone binaries for mac and linux using bun.
 *
 * Usage:
 *   node scripts/build-binary.mjs          # build for current platform
 *   node scripts/build-binary.mjs --all    # build for mac-arm64, mac-x64, linux-x64
 *   node scripts/build-binary.mjs --target darwin-arm64
 */

import { execSync } from "child_process";
import { mkdirSync, cpSync, existsSync, writeFileSync } from "fs";
import { join } from "path";

const ROOT = new URL("..", import.meta.url).pathname;
const DIST = join(ROOT, "dist");

const TARGETS = {
  "darwin-arm64": "bun-darwin-arm64",
  "darwin-x64": "bun-darwin-x64",
  "linux-x64": "bun-linux-x64",
};

function run(cmd, opts = {}) {
  console.log(`> ${cmd}`);
  execSync(cmd, { stdio: "inherit", cwd: ROOT, ...opts });
}

function buildNextStandalone() {
  console.log("\n📦 Building Next.js standalone...\n");
  run("npm run build");

  if (!existsSync(join(ROOT, ".next/standalone"))) {
    console.error("ERROR: .next/standalone not found. Ensure next.config.ts has output: 'standalone'");
    process.exit(1);
  }
}

function buildBinary(target) {
  const bunTarget = TARGETS[target];
  if (!bunTarget) {
    console.error(`Unknown target: ${target}. Available: ${Object.keys(TARGETS).join(", ")}`);
    process.exit(1);
  }

  const outDir = join(DIST, target);
  mkdirSync(outDir, { recursive: true });

  // Copy standalone output
  cpSync(join(ROOT, ".next/standalone"), join(outDir, "server"), { recursive: true });
  // Copy static assets
  if (existsSync(join(ROOT, ".next/static"))) {
    cpSync(join(ROOT, ".next/static"), join(outDir, "server/.next/static"), { recursive: true });
  }
  // Copy public folder
  if (existsSync(join(ROOT, "public"))) {
    cpSync(join(ROOT, "public"), join(outDir, "server/public"), { recursive: true });
  }

  // Copy PTY server script (runs as separate node process)
  cpSync(join(ROOT, "server/pty-server.mjs"), join(outDir, "pty-server.mjs"));

  // Copy Claude relay server
  mkdirSync(join(outDir, "server/claude-relay"), { recursive: true });
  cpSync(join(ROOT, "server/claude-relay/relay.mjs"), join(outDir, "server/claude-relay/relay.mjs"));

  // Create a package.json for installing node-pty on the target
  const ptyPkg = JSON.stringify({
    name: "personal-assistant-pty",
    private: true,
    dependencies: { "node-pty": "^1.1.0", "ws": "^8.20.0", "@anthropic-ai/claude-agent-sdk": "^0.3.146" }
  }, null, 2);
  writeFileSync(join(outDir, "package.json"), ptyPkg);

  // Build the entry point binary
  const outBin = join(outDir, "personal-assistant");
  console.log(`\n🔨 Compiling binary for ${target}...\n`);
  run(
    `bun build scripts/server-entry.ts --compile --target=${bunTarget} --outfile="${outBin}"`
  );

  console.log(`\n✅ Binary ready: ${outBin}\n`);
}

// --- Main ---

const args = process.argv.slice(2);
const buildAll = args.includes("--all");
const targetFlag = args.find((a) => a.startsWith("--target="));
const target = targetFlag ? targetFlag.split("=")[1] : null;

buildNextStandalone();

if (buildAll) {
  for (const t of Object.keys(TARGETS)) {
    buildBinary(t);
  }
} else if (target) {
  buildBinary(target);
} else {
  // Detect current platform
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  const platform = process.platform === "linux" ? "linux" : "darwin";
  buildBinary(`${platform}-${arch}`);
}
