/**
 * AI-assisted features for the File Explorer widget.
 *
 * Three actions:
 *  - "nl-search":         natural-language search over a directory's file index
 *  - "summarize-file":    summarize a text or PDF file in plain English
 *  - "cleanup-suggest":   analyze a folder, propose cleanup categories
 *
 * Uses Anthropic Claude (claude-haiku-4-5 by default). All actions return
 * compact JSON the widget can render directly.
 */

import { NextRequest } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import os from "os";
import {
  complete,
  completeSingle,
  extractJson,
  isAnthropicConfigured,
  AnthropicError,
} from "@/lib/anthropic-client";

export const dynamic = "force-dynamic";

// ─── Types ───────────────────────────────────────────────────────────────────

interface FileSummary {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  modified: string;
  extension: string;
}

interface RankedResult {
  path: string;
  reason: string;
  confidence: "high" | "medium" | "low";
}

interface CleanupItem {
  name: string;
  path: string;
  reason: string;
  defaultChecked: boolean;
}

interface CleanupCategory {
  category: string;
  description: string;
  items: CleanupItem[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const PRUNE_DIRS = new Set([
  "node_modules", ".git", ".Trash", ".cache", ".npm", ".nvm",
  ".next", ".turbo", "dist", "build", ".DS_Store",
  "__pycache__", ".venv", "venv", ".tox",
  "Pods", "DerivedData",
]);

const HOME_PRUNE_DIRS = new Set([
  "Library", "Applications", "Movies", "Music", "Pictures", "Public",
]);

function resolvePath(p: string): string {
  const expanded = p.startsWith("~")
    ? path.join(os.homedir(), p.slice(1))
    : p;
  return path.resolve(expanded);
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}GB`;
}

/**
 * Walk a directory shallowly to collect files for cleanup / NL search.
 * For NL search this is fast metadata only; the heavier index in /api/files
 * is not reused here to keep this route self-contained.
 */
async function shallowWalk(
  root: string,
  maxDepth: number,
  maxEntries: number
): Promise<FileSummary[]> {
  const out: FileSummary[] = [];
  const isHomeDir = root === os.homedir();

  async function recurse(dir: string, depth: number): Promise<void> {
    if (depth > maxDepth || out.length >= maxEntries) return;
    let dirents;
    try {
      dirents = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of dirents) {
      if (out.length >= maxEntries) break;
      const name = ent.name;
      if (name.startsWith(".") && name !== ".env" && name !== ".gitignore") continue;
      if (PRUNE_DIRS.has(name)) continue;
      const full = path.join(dir, name);
      if (ent.isDirectory()) {
        if (isHomeDir && depth === 0 && HOME_PRUNE_DIRS.has(name)) continue;
        let stat;
        try { stat = await fs.stat(full); } catch { continue; }
        out.push({
          name,
          path: full,
          isDirectory: true,
          size: 0,
          modified: stat.mtime.toISOString(),
          extension: "",
        });
        await recurse(full, depth + 1);
      } else if (ent.isFile()) {
        let stat;
        try { stat = await fs.stat(full); } catch { continue; }
        out.push({
          name,
          path: full,
          isDirectory: false,
          size: stat.size,
          modified: stat.mtime.toISOString(),
          extension: path.extname(name).toLowerCase(),
        });
      }
    }
  }

  await recurse(root, 0);
  return out;
}

/**
 * Best-effort plain-text extraction from a file. Currently:
 *  - text/code files: read up to N bytes as utf-8
 *  - PDFs: extract a rough text approximation by stripping binary garbage and
 *    keeping printable ASCII + common punctuation. This is a fallback; for
 *    high-quality PDF text we'd add a parser, but for "give me the gist"
 *    summaries this works on most text-based PDFs.
 *
 * Returns up to ~12KB of text, which fits comfortably in Claude's context for
 * a single-paragraph summary.
 */
async function extractText(filePath: string): Promise<{ text: string; kind: string } | null> {
  const ext = path.extname(filePath).toLowerCase();
  const TEXT_EXT = new Set([
    ".txt", ".md", ".markdown", ".json", ".yaml", ".yml", ".toml", ".ini",
    ".cfg", ".conf", ".csv", ".log", ".env", ".gitignore", ".html", ".xml",
    ".js", ".ts", ".tsx", ".jsx", ".mjs", ".cjs", ".py", ".rb", ".go",
    ".rs", ".java", ".kt", ".swift", ".c", ".cpp", ".h", ".hpp",
    ".sh", ".bash", ".zsh", ".sql", ".graphql", ".css", ".scss",
  ]);
  const MAX = 12 * 1024;

  if (TEXT_EXT.has(ext)) {
    try {
      const content = await fs.readFile(filePath, "utf-8");
      return { text: content.slice(0, MAX), kind: "text" };
    } catch {
      return null;
    }
  }

  if (ext === ".pdf") {
    try {
      const buf = await fs.readFile(filePath);
      const cap = Math.min(buf.length, 1.5 * 1024 * 1024); // 1.5MB cap
      const slice = buf.subarray(0, cap);
      // Pull text-like sequences: printable ASCII runs of length >= 4
      const out: string[] = [];
      let cur = "";
      for (let i = 0; i < slice.length; i++) {
        const b = slice[i];
        // printable ASCII, plus tab/newline
        if (b === 0x09 || b === 0x0a || b === 0x0d || (b >= 0x20 && b <= 0x7e)) {
          cur += String.fromCharCode(b);
        } else {
          if (cur.length >= 4) out.push(cur);
          cur = "";
        }
        if (out.join(" ").length > MAX) break;
      }
      if (cur.length >= 4) out.push(cur);
      const text = out.join(" ").replace(/\s+/g, " ").trim().slice(0, MAX);
      if (text.length < 50) {
        return { text: "", kind: "pdf-binary" };
      }
      return { text, kind: "pdf" };
    } catch {
      return null;
    }
  }

  return null;
}

// ─── Action: Natural-language search ─────────────────────────────────────────

/**
 * Build a compact text index of file metadata suitable to feed Claude.
 * Each line: "path | size | modified | type"
 */
function buildIndexLines(files: FileSummary[], rootDisplay: string): string {
  const lines: string[] = [];
  for (const f of files) {
    const rel = f.path.startsWith(rootDisplay)
      ? "." + f.path.slice(rootDisplay.length)
      : f.path;
    const kind = f.isDirectory ? "dir" : (f.extension || "file");
    const size = f.isDirectory ? "" : ` ${formatSize(f.size)}`;
    const date = f.modified ? f.modified.slice(0, 10) : "";
    lines.push(`${rel} | ${kind}${size} | ${date}`);
  }
  return lines.join("\n");
}

async function nlSearch(query: string, root: string): Promise<Response> {
  const absRoot = resolvePath(root);
  const files = await shallowWalk(absRoot, 5, 1500);

  if (files.length === 0) {
    return Response.json({ results: [], note: "No files found in this folder." });
  }

  const index = buildIndexLines(files, absRoot);
  const homeShort = absRoot.replace(os.homedir(), "~");

  const system = `You are a file-finding assistant for a personal file explorer.
Given a natural-language query and a list of files (path, type, size, modified date), return the most likely matches.

Rules:
- Only return paths that appear EXACTLY in the provided file list.
- Reason like a human: "invoice from last spring" → look at filenames containing "invoice", "bill", "receipt", AND modified dates around March-May.
- Prefer files whose NAME or extension matches the intent. Falling back to path/folder context is OK.
- Return at most 10 results, ranked by confidence.
- If nothing matches, return an empty array — do NOT invent files.

Output ONLY valid JSON, no prose, no code fence:
{"results":[{"path":"<exact path>","reason":"<short why>","confidence":"high"|"medium"|"low"}]}`;

  const user = `Query: ${query}

Files in ${homeShort} (${files.length} entries):
${index}`;

  let raw: string;
  try {
    raw = await complete(
      [{ role: "user", content: user }],
      { system, maxTokens: 800, temperature: 0.1 }
    );
  } catch (err) {
    if (err instanceof AnthropicError) {
      return Response.json({ error: err.message }, { status: err.status || 500 });
    }
    throw err;
  }

  const parsed = extractJson<{ results: RankedResult[] }>(raw);
  if (!parsed?.results) {
    return Response.json({ results: [], note: "AI response could not be parsed." });
  }

  // Validate paths against the actual file list (Claude shouldn't invent, but verify)
  const pathSet = new Set(files.map((f) => f.path));
  const results = parsed.results
    .filter((r) => pathSet.has(r.path))
    .map((r) => {
      const f = files.find((x) => x.path === r.path)!;
      return {
        path: r.path,
        name: f.name,
        isDirectory: f.isDirectory,
        size: f.size,
        modified: f.modified,
        extension: f.extension,
        reason: r.reason,
        confidence: r.confidence,
      };
    });

  return Response.json({ results, total: parsed.results.length });
}

// ─── Action: Summarize file ──────────────────────────────────────────────────

async function summarizeFile(filePath: string): Promise<Response> {
  const absPath = resolvePath(filePath);
  let stat;
  try {
    stat = await fs.stat(absPath);
  } catch {
    return Response.json({ error: "File not found" }, { status: 404 });
  }
  if (!stat.isFile()) {
    return Response.json({ error: "Not a file" }, { status: 400 });
  }
  if (stat.size > 20 * 1024 * 1024) {
    return Response.json({ error: "File too large to summarize (>20MB)" }, { status: 413 });
  }

  const extracted = await extractText(absPath);
  if (!extracted) {
    return Response.json({
      error: "This file type can't be summarized yet (only text and PDFs are supported).",
    }, { status: 415 });
  }
  if (extracted.kind === "pdf-binary" || !extracted.text) {
    return Response.json({
      error: "PDF appears to be image-only / scanned. Text extraction would need OCR.",
    }, { status: 415 });
  }

  const fileName = path.basename(absPath);
  const ext = path.extname(absPath).toLowerCase();

  const system = `You summarize files for a personal file explorer.
Given a file name and its (possibly truncated) text content, write a SHORT summary in plain English.

Format your response as Markdown with these sections (omit any that don't apply):
- **What it is** — 1 sentence
- **Key points** — 2-4 bullets with concrete details (names, dates, amounts, who/what)
- **Action items** — only if the document implies something needs doing

Be specific. Do not invent details. If it's a code file, describe what it does, not "this is a code file".`;

  const user = `File: ${fileName} (${ext || "no extension"})

Content (may be truncated or roughly extracted from PDF):
---
${extracted.text}
---`;

  let summary: string;
  try {
    summary = await completeSingle(user, {
      system,
      maxTokens: 600,
      temperature: 0.2,
    });
  } catch (err) {
    if (err instanceof AnthropicError) {
      return Response.json({ error: err.message }, { status: err.status || 500 });
    }
    throw err;
  }

  return Response.json({
    summary,
    fileName,
    kind: extracted.kind,
    size: stat.size,
    truncated: extracted.text.length >= 12 * 1024 - 1,
  });
}

// ─── Action: Cleanup suggestions ─────────────────────────────────────────────

async function cleanupSuggest(folderPath: string): Promise<Response> {
  const absPath = resolvePath(folderPath);
  let stat;
  try {
    stat = await fs.stat(absPath);
  } catch {
    return Response.json({ error: "Folder not found" }, { status: 404 });
  }
  if (!stat.isDirectory()) {
    return Response.json({ error: "Not a folder" }, { status: 400 });
  }

  // Shallow listing only — cleanup applies to direct children.
  let dirents;
  try {
    dirents = await fs.readdir(absPath, { withFileTypes: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Cannot read folder";
    return Response.json({ error: msg }, { status: 403 });
  }

  const items: FileSummary[] = [];
  for (const ent of dirents) {
    const full = path.join(absPath, ent.name);
    let s;
    try { s = await fs.stat(full); } catch { continue; }
    items.push({
      name: ent.name,
      path: full,
      isDirectory: ent.isDirectory(),
      size: s.size,
      modified: s.mtime.toISOString(),
      extension: ent.isDirectory() ? "" : path.extname(ent.name).toLowerCase(),
    });
  }

  if (items.length === 0) {
    return Response.json({ categories: [], note: "Folder is empty." });
  }
  if (items.length > 500) {
    items.splice(500);
  }

  // Build a compact listing for Claude
  const listing = items
    .map((f) => {
      const kind = f.isDirectory ? "dir" : (f.extension || "file");
      const size = f.isDirectory ? "" : ` ${formatSize(f.size)}`;
      const date = f.modified ? f.modified.slice(0, 10) : "";
      return `${f.name} | ${kind}${size} | ${date}`;
    })
    .join("\n");

  const system = `You help users tidy up cluttered folders (especially Downloads / Desktop).
Given a list of files, group them into cleanup CATEGORIES. Only suggest things that look genuinely safe to remove.

Typical categories (use these names when applicable):
- "Likely duplicates" — files that appear to be copies (e.g. "X.pdf" and "X (1).pdf", "X copy.pdf")
- "Old installers" — .dmg, .pkg, .exe, .msi older than ~6 months
- "Temporary screenshots" — Screenshot * / Screen Shot * files
- "Old archives" — .zip / .tar / .gz that look extracted-and-forgotten
- "Stale downloads" — random files >6 months old that look transient
- "Probably keep" — things that look important; only mention 2-3 examples here, do NOT propose deleting them

For each item you propose removing, set defaultChecked=true ONLY for low-risk categories (duplicates, screenshots, installers). Stale-looking content should be defaultChecked=false so the user opts in.

NEVER propose removing items whose name suggests importance: passport, contract, tax, w-2, signed, invoice, receipt, ID, certificate, resume, CV.

Output ONLY valid JSON, no prose:
{"categories":[{"category":"...","description":"...","items":[{"name":"...","path":"...","reason":"...","defaultChecked":true|false}]}]}

Use the EXACT paths from the file list. Do not invent files. If nothing looks safe to clean, return {"categories":[]}.`;

  const homeShort = absPath.replace(os.homedir(), "~");
  const user = `Folder: ${homeShort} (${items.length} items, today is ${new Date().toISOString().slice(0, 10)})

Listing:
${listing}`;

  let raw: string;
  try {
    raw = await complete(
      [{ role: "user", content: user }],
      { system, maxTokens: 1500, temperature: 0.1 }
    );
  } catch (err) {
    if (err instanceof AnthropicError) {
      return Response.json({ error: err.message }, { status: err.status || 500 });
    }
    throw err;
  }

  const parsed = extractJson<{ categories: CleanupCategory[] }>(raw);
  if (!parsed?.categories) {
    return Response.json({ categories: [], note: "AI response could not be parsed." });
  }

  // Validate paths
  const pathSet = new Set(items.map((f) => f.path));
  const validCategories = parsed.categories
    .map((cat) => ({
      ...cat,
      items: cat.items.filter((it) => pathSet.has(it.path)),
    }))
    .filter((cat) => cat.items.length > 0);

  // Compute total potential savings
  let bytesSaved = 0;
  for (const cat of validCategories) {
    for (const it of cat.items) {
      const f = items.find((x) => x.path === it.path);
      if (f && it.defaultChecked) bytesSaved += f.size;
    }
  }

  return Response.json({
    categories: validCategories,
    folder: absPath,
    totalItems: items.length,
    bytesSaved,
  });
}

// ─── POST handler (action dispatcher) ────────────────────────────────────────

export async function POST(request: NextRequest) {
  if (!isAnthropicConfigured()) {
    return Response.json(
      { error: "ANTHROPIC_API_KEY is not set in .env.local" },
      { status: 503 }
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const action = body?.action;

  try {
    switch (action) {
      case "nl-search": {
        const query: string = body.query;
        const root: string = body.root || "~";
        if (!query?.trim()) {
          return Response.json({ error: "Missing query" }, { status: 400 });
        }
        return await nlSearch(query, root);
      }
      case "summarize-file": {
        const filePath: string = body.path;
        if (!filePath) {
          return Response.json({ error: "Missing path" }, { status: 400 });
        }
        return await summarizeFile(filePath);
      }
      case "cleanup-suggest": {
        const folderPath: string = body.path;
        if (!folderPath) {
          return Response.json({ error: "Missing path" }, { status: 400 });
        }
        return await cleanupSuggest(folderPath);
      }
      default:
        return Response.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[files-ai]", msg);
    return Response.json({ error: msg }, { status: 500 });
  }
}

// Health check
export async function GET() {
  return Response.json({
    available: isAnthropicConfigured(),
    model: process.env.ANTHROPIC_MODEL || "claude-haiku-4-5",
  });
}
