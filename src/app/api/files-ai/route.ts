/**
 * AI-assisted features for the File Explorer widget.
 *
 * Three actions:
 *  - "nl-search":         natural-language search over a directory's file index
 *  - "summarize-file":    summarize a text or PDF file in plain English
 *  - "cleanup-suggest":   analyze a folder, propose cleanup categories
 *
 * Two engines work together:
 *  - Jev (TypeSafe) makes the typed judgments — how relevant a candidate file
 *    is to a query, which cleanup bucket an item belongs to and whether it is
 *    safe to remove. Its answers are calibrated probabilities, so there is no
 *    JSON to parse and no invented paths.
 *  - Claude writes prose (file summaries) and is the fallback for search and
 *    cleanup when Jev is unconfigured or finds nothing.
 *
 * All actions return compact JSON the widget can render directly.
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
import { isJevConfigured, jevAsk, jevBatched } from "@/lib/jev-client";

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

const STOPWORDS = new Set([
  "the", "a", "an", "of", "for", "from", "in", "on", "at", "to", "my", "me", "i", "and", "or",
  "with", "that", "this", "file", "files", "find", "show", "get", "about", "last", "some", "any",
  "is", "are", "was", "were", "it", "its", "into", "by", "all", "one",
]);

const RELEVANCE_LEVELS = [
  "Unrelated to the query.",
  "Weakly related: shares a word or a rough time frame but is probably not what the user means.",
  "Likely what the user means: the name, type, or date fits the query well.",
  "Clearly the file the user is asking for.",
] as const;

/** Query terms: lower-cased words of 3+ chars minus stopwords, plus 4-digit years. */
function queryTerms(query: string): string[] {
  const words = query.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}_-]{1,}/gu) || [];
  return Array.from(new Set(words.filter((w) => w.length >= 3 && !STOPWORDS.has(w))));
}

/**
 * Cheap code-side shortlist for Jev: name/path token overlap, year match,
 * recency. Keeps at most `limit` files; pads with the most recent ones when
 * the query matches few names so "something from last week" still has
 * candidates.
 */
function shortlistForJev(query: string, files: FileSummary[], limit: number): FileSummary[] {
  const terms = queryTerms(query);
  const years = terms.filter((t) => /^(19|20)\d{2}$/.test(t));
  const now = Date.now();
  const scored = files.map((f) => {
    const name = f.name.toLowerCase();
    const dir = f.path.toLowerCase();
    let score = 0;
    for (const t of terms) {
      if (name.includes(t)) score += 3;
      else if (dir.includes(t)) score += 1;
    }
    const year = f.modified.slice(0, 4);
    if (years.includes(year)) score += 2;
    const ageDays = (now - new Date(f.modified).getTime()) / 86_400_000;
    const recency = ageDays < 7 ? 1 : ageDays < 90 ? 0.5 : 0;
    return { f, score, recency };
  });
  const matched = scored.filter((x) => x.score > 0).sort((a, b) => b.score - a.score || b.recency - a.recency);
  const picked = matched.slice(0, limit).map((x) => x.f);
  if (picked.length < limit) {
    const seen = new Set(picked.map((f) => f.path));
    const recent = scored
      .filter((x) => !seen.has(x.f.path) && !x.f.isDirectory)
      .sort((a, b) => new Date(b.f.modified).getTime() - new Date(a.f.modified).getTime())
      .slice(0, limit - picked.length)
      .map((x) => x.f);
    picked.push(...recent);
  }
  return picked;
}

interface JevRankedFile extends FileSummary {
  reason: string;
  confidence: "high" | "medium" | "low";
  relevance: number;
}

/** Ask Jev how relevant each shortlisted file is; returns ≤10 above the bar or null on failure. */
async function jevRerank(query: string, files: FileSummary[], absRoot: string): Promise<JevRankedFile[] | null> {
  const candidates = shortlistForJev(query, files, 60);
  if (candidates.length === 0) return null;
  const today = new Date().toISOString().slice(0, 10);
  const terms = queryTerms(query);

  const state = {
    query,
    today,
    folder: absRoot.replace(os.homedir(), "~"),
    candidates: candidates.map((f) => ({
      path: f.path.startsWith(absRoot) ? "." + f.path.slice(absRoot.length) : f.path,
      kind: f.isDirectory ? "folder" : f.extension || "file",
      size: f.isDirectory ? "" : formatSize(f.size),
      modified: f.modified.slice(0, 10),
    })),
  };
  const questions = Object.fromEntries(
    candidates.map((_, i) => [
      `r${i}`,
      {
        type: "score" as const,
        instructions: `How well does \`candidates[${i}]\` match what the user is looking for in \`query\`? Judge by name, type, folder and modified date relative to \`today\`.`,
        criteria: RELEVANCE_LEVELS,
      },
    ]),
  );

  const result = await jevAsk(state, questions, { timeout: 15_000 });
  if (!result) return null;

  const ranked: JevRankedFile[] = [];
  candidates.forEach((f, i) => {
    const ans = result.answers[`r${i}`] as { score: number; confidence: number } | undefined;
    if (!ans || ans.score < 1.5) return;
    const hits = terms.filter((t) => f.name.toLowerCase().includes(t));
    const why = hits.length > 0 ? `name matches "${hits.join('", "')}"` : `dated ${f.modified.slice(0, 10)}`;
    ranked.push({
      ...f,
      relevance: ans.score,
      confidence: ans.score >= 2.5 ? "high" : ans.score >= 2 ? "medium" : "low",
      reason: `${why} · relevance ${ans.score.toFixed(1)}/3`,
    });
  });
  ranked.sort((a, b) => b.relevance - a.relevance);
  return ranked.slice(0, 10);
}

async function nlSearch(query: string, root: string): Promise<Response> {
  const absRoot = resolvePath(root);
  const files = await shallowWalk(absRoot, 5, 1500);

  if (files.length === 0) {
    return Response.json({ results: [], note: "No files found in this folder." });
  }

  // ─── Jev path: code shortlists, Jev judges relevance ───────────────────
  // The full index can be 1500 lines; Jev evaluates one state per request, so
  // code narrows it to the files that share a token, a year, or recency with
  // the query, then Jev scores each candidate on a 4-level relevance rubric.
  // Nothing above the bar → fall through to Claude reading the whole index.
  if (await isJevConfigured()) {
    const jevResults = await jevRerank(query, files, absRoot);
    if (jevResults && jevResults.length > 0) {
      return Response.json({ results: jevResults, total: jevResults.length, engine: "jev" });
    }
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

  // ─── Jev path: per-item bucket + "safe to remove" probability ──────────
  if (await isJevConfigured()) {
    const jevCategories = await jevCleanup(items, absPath);
    if (jevCategories) {
      return finishCleanup(jevCategories, items, absPath, "jev");
    }
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

  return finishCleanup(parsed.categories, items, absPath, "claude");
}

/** Drop invented paths, empty buckets, and total up the default-checked bytes. */
function finishCleanup(
  categories: CleanupCategory[],
  items: FileSummary[],
  absPath: string,
  engine: "jev" | "claude",
): Response {
  const pathSet = new Set(items.map((f) => f.path));
  const validCategories = categories
    .map((cat) => ({
      ...cat,
      items: cat.items.filter((it) => pathSet.has(it.path)),
    }))
    .filter((cat) => cat.items.length > 0);

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
    engine,
  });
}

/** Names that must never be proposed for removal, whatever the model thinks. */
const IMPORTANT_NAME = /passport|contract|tax|w-?2|signed|invoice|receipt|\bid\b|certificate|resume|\bcv\b/i;

const CLEANUP_BUCKETS = {
  duplicate: {
    label: "Likely duplicates",
    description: "Copies of another file in this folder, e.g. \"X (1).pdf\", \"X copy.pdf\".",
    lowRisk: true,
  },
  screenshot: {
    label: "Temporary screenshots",
    description: "Screenshot / Screen Shot captures that are rarely needed later.",
    lowRisk: true,
  },
  installer: {
    label: "Old installers",
    description: ".dmg / .pkg / .exe / .msi installers older than about six months.",
    lowRisk: true,
  },
  archive: {
    label: "Old archives",
    description: ".zip / .tar / .gz archives that look extracted and forgotten.",
    lowRisk: false,
  },
  stale: {
    label: "Stale downloads",
    description: "Transient-looking files older than six months.",
    lowRisk: false,
  },
  keep: { label: "Probably keep", description: "Looks important or in use.", lowRisk: false },
} as const;

type CleanupBucket = keyof typeof CLEANUP_BUCKETS;

/**
 * Jev cleanup: for each item, one Choice (which bucket) and one Noul (is it
 * safe to remove). Twenty items per request. Low-risk buckets with a high
 * safe-to-remove probability are pre-checked; everything else is opt-in.
 */
async function jevCleanup(items: FileSummary[], absPath: string): Promise<CleanupCategory[] | null> {
  const today = new Date().toISOString().slice(0, 10);
  const buckets: Record<CleanupBucket, CleanupItem[]> = {
    duplicate: [], screenshot: [], installer: [], archive: [], stale: [], keep: [],
  };
  const siblings = items.map((f) => f.name);

  const ok = await jevBatched(
    items,
    20,
    (chunk) => ({
      state: {
        today,
        folder: absPath.replace(os.homedir(), "~"),
        all_names_in_folder: siblings.slice(0, 500),
        items: chunk.map((f) => ({
          name: f.name,
          kind: f.isDirectory ? "folder" : f.extension || "file",
          size: f.isDirectory ? "" : formatSize(f.size),
          modified: f.modified.slice(0, 10),
        })),
      },
      questions: Object.fromEntries(
        chunk.flatMap((_, i) => [
          [
            `b${i}`,
            {
              type: "choice" as const,
              instructions: `Which cleanup bucket does \`items[${i}]\` belong to? Use \`all_names_in_folder\` to spot duplicates and \`today\` for age.`,
              criteria: {
                duplicate: CLEANUP_BUCKETS.duplicate.description,
                screenshot: CLEANUP_BUCKETS.screenshot.description,
                installer: CLEANUP_BUCKETS.installer.description,
                archive: CLEANUP_BUCKETS.archive.description,
                stale: CLEANUP_BUCKETS.stale.description,
                keep: "Documents, projects, media, recent work, or anything that looks important (passport, contract, tax, invoice, receipt, certificate, resume).",
              },
            },
          ],
          [
            `s${i}`,
            {
              type: "noul" as const,
              instructions: `Would a careful person be comfortable deleting \`items[${i}]\` without opening it first?`,
              criteria: {
                true: "Clearly disposable: a duplicate, an old installer, a throwaway screenshot, or an extracted archive.",
                false: "Could hold something the user still needs, or its purpose is unclear.",
              },
            },
          ],
        ]),
      ),
    }),
    (result, chunk) => {
      chunk.forEach((f, i) => {
        const bucketAns = result.answers[`b${i}`] as { choice: string; confidence: number } | undefined;
        const safeAns = result.answers[`s${i}`] as { noul: number } | undefined;
        if (!bucketAns || !safeAns) return;
        let bucket = (bucketAns.choice in CLEANUP_BUCKETS ? bucketAns.choice : "keep") as CleanupBucket;
        if (IMPORTANT_NAME.test(f.name)) bucket = "keep";
        const safe = safeAns.noul;
        const lowRisk = CLEANUP_BUCKETS[bucket].lowRisk;
        buckets[bucket].push({
          name: f.name,
          path: f.path,
          reason: bucket === "keep"
            ? "Looks important or in use"
            : `${CLEANUP_BUCKETS[bucket].label.toLowerCase()} · ${Math.round(safe * 100)}% safe to remove`,
          defaultChecked: lowRisk && safe >= 0.7,
        });
      });
    },
    { timeout: 15_000, concurrency: 3 },
  );
  if (!ok) return null;

  const categories: CleanupCategory[] = [];
  for (const key of ["duplicate", "installer", "screenshot", "archive", "stale"] as CleanupBucket[]) {
    if (buckets[key].length > 0) {
      categories.push({ category: CLEANUP_BUCKETS[key].label, description: CLEANUP_BUCKETS[key].description, items: buckets[key] });
    }
  }
  // "Probably keep" is informational: a few examples, never proposed for deletion.
  if (buckets.keep.length > 0) {
    categories.push({
      category: CLEANUP_BUCKETS.keep.label,
      description: CLEANUP_BUCKETS.keep.description,
      items: buckets.keep.slice(0, 3).map((it) => ({ ...it, defaultChecked: false })),
    });
  }
  return categories;
}

// ─── POST handler (action dispatcher) ────────────────────────────────────────

export async function POST(request: NextRequest) {
  if (!(await isAnthropicConfigured())) {
    return Response.json(
      { error: "Claude is not available: log in to Claude Code (claude /login) or set ANTHROPIC_API_KEY." },
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
  const [claude, jev] = await Promise.all([isAnthropicConfigured(), isJevConfigured()]);
  return Response.json({
    available: claude,
    model: process.env.ANTHROPIC_API_KEY ? process.env.ANTHROPIC_MODEL || "claude-haiku-4-5" : "claude-code",
    jev,
  });
}
