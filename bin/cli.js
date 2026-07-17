#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * npx personal-assistant-dashboard
 *
 * Clones/updates the repo, installs dependencies, builds, and starts the server.
 */
const { execSync } = require("child_process");
const { existsSync, mkdirSync } = require("fs");
const { join } = require("path");
const os = require("os");

const REPO = "https://github.com/ibrahimmansour/personal-assistant.git";
const APP_DIR = join(os.homedir(), ".personal-assistant", "app");
const PORT = process.env.PORT || "4444";

function run(cmd, opts = {}) {
  console.log(`> ${cmd}`);
  execSync(cmd, { stdio: "inherit", cwd: APP_DIR, ...opts });
}

console.log("\n🚀 Personal Assistant Dashboard\n");

// Clone or pull
if (existsSync(join(APP_DIR, "package.json"))) {
  console.log("==> Updating existing installation...");
  run("git pull --ff-only");
} else {
  console.log("==> Cloning repository...");
  mkdirSync(APP_DIR, { recursive: true });
  execSync(`git clone ${REPO} "${APP_DIR}"`, { stdio: "inherit" });
}

// Install & build
console.log("\n==> Installing dependencies...");
run("npm ci");

console.log("\n==> Building...");
run("npm run build");

// Start
console.log(`\n==> Starting on port ${PORT}...\n`);
run(`PORT=${PORT} npm run start`);
