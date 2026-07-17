import { NextRequest } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import os from "os";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export const dynamic = "force-dynamic";

interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  modified: string;
  extension: string;
}

interface SearchResultEntry extends FileEntry {
  /** Relevance score (higher = better match) */
  score: number;
  /** For content search: matching line preview */
  matchLine?: string;
  /** For content search: line number of match */
  matchLineNumber?: number;
}

// Directories to always prune from search
const PRUNE_DIRS = [
  "node_modules", ".git", ".Trash", ".cache", ".npm", ".nvm",
  ".next", ".turbo", "dist", "build", ".DS_Store",
  "__pycache__", ".venv", "venv", ".tox",
  "Pods", "DerivedData",
];

// When searching from home dir, also prune these top-level dirs
// (includes macOS-protected directories that cause EPERM errors)
const HOME_PRUNE_DIRS = [
  "Library", "Applications", "Movies", "Music", "Pictures", "Public",
  "Downloads", "Documents", "Desktop",
];

/**
 * Score a search result by relevance.
 * Higher score = more relevant.
 */
function scoreResult(filePath: string, query: string, root: string, isDirectory: boolean): number {
  const name = path.basename(filePath).toLowerCase();
  const relPath = filePath.replace(root, "").toLowerCase();
  const q = query.toLowerCase();
  let score = 0;

  // Exact filename match (highest priority)
  if (name === q) score += 100;
  // Filename starts with query
  else if (name.startsWith(q)) score += 80;
  // Filename contains query
  else if (name.includes(q)) score += 50;
  // Only path matches (not filename)
  else score += 10;

  // Shorter relative paths are more relevant (fewer nesting levels)
  const depth = relPath.split("/").length;
  score += Math.max(0, 20 - depth * 2);

  if (isDirectory) {
    // Directories whose name matches the query are very relevant (user is looking for a project/folder)
    if (name === q) score += 20;
    else if (name.startsWith(q)) score += 10;
  } else {
    // Boost common code/config files
    const ext = path.extname(filePath).toLowerCase();
    const codeExts = new Set([
      ".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs", ".json",
      ".yaml", ".yml", ".toml", ".md", ".sh", ".css", ".html",
    ]);
    if (codeExts.has(ext)) score += 10;
  }

  return score;
}

// ─── File tree index cache ───────────────────────────────────────────────────
// Walks the filesystem once per root directory, caches all entry paths in memory.
// Subsequent searches are pure in-memory string matching — effectively instant.

interface IndexEntry {
  name: string;       // basename, lowercased for matching
  path: string;       // absolute path
  isDirectory: boolean;
}

interface TreeIndex {
  entries: IndexEntry[];
  builtAt: number;  // Date.now()
  building: boolean;
  buildPromise: Promise<void> | null;
}

const INDEX_TTL = 120_000; // 2 minutes
const MAX_INDEX_ENTRIES = 200_000; // safety cap
const treeIndexes = new Map<string, TreeIndex>();

/** Set of directory names to skip during indexing */
const PRUNE_SET = new Set(PRUNE_DIRS);

function shouldPruneDir(name: string, fullPath: string, root: string): boolean {
  if (PRUNE_SET.has(name)) return true;
  // When root is home dir, also prune macOS system dirs at top level
  if (root === os.homedir()) {
    const rel = fullPath.slice(root.length + 1);
    if (!rel.includes("/") && HOME_PRUNE_DIRS.includes(name)) return true;
  }
  return false;
}

async function walkDir(
  dir: string,
  root: string,
  entries: IndexEntry[],
  maxDepth: number,
  currentDepth: number
): Promise<void> {
  if (currentDepth > maxDepth || entries.length >= MAX_INDEX_ENTRIES) return;

  let dirEntries;
  try {
    dirEntries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return; // permission denied, etc.
  }

  for (const entry of dirEntries) {
    if (entries.length >= MAX_INDEX_ENTRIES) break;
    const name = entry.name;
    const fullPath = path.join(dir, name);
    const isDir = entry.isDirectory();

    if (isDir && shouldPruneDir(name, fullPath, root)) continue;
    if (name === ".DS_Store") continue;

    entries.push({
      name: name.toLowerCase(),
      path: fullPath,
      isDirectory: isDir,
    });

    if (isDir) {
      await walkDir(fullPath, root, entries, maxDepth, currentDepth + 1);
    }
  }
}

async function getOrBuildIndex(root: string): Promise<IndexEntry[]> {
  const existing = treeIndexes.get(root);

  // Return cached index if fresh
  if (existing && !existing.building && (Date.now() - existing.builtAt) < INDEX_TTL) {
    return existing.entries;
  }

  // If currently building, wait for it
  if (existing?.building && existing.buildPromise) {
    await existing.buildPromise;
    return existing.entries;
  }

  // Build new index
  const isHomeDir = root === os.homedir();
  const maxDepth = isHomeDir ? 8 : 12;
  const entries: IndexEntry[] = [];

  const index: TreeIndex = {
    entries,
    builtAt: 0,
    building: true,
    buildPromise: null,
  };

  const buildPromise = walkDir(root, root, entries, maxDepth, 0).then(() => {
    index.builtAt = Date.now();
    index.building = false;
    index.buildPromise = null;
    console.log(`[file-index] Built index for ${root}: ${entries.length} entries`);
  }).catch((err) => {
    console.error(`[file-index] Failed to build index for ${root}:`, err);
    index.building = false;
    index.buildPromise = null;
  });

  index.buildPromise = buildPromise;
  treeIndexes.set(root, index);

  await buildPromise;
  return entries;
}

// ─── Query result cache (LRU) ────────────────────────────────────────────────
// Caches the final search results for recent queries so identical keystrokes
// (e.g. typing "rea" then backspacing and retyping "rea") are instant.

const QUERY_CACHE_MAX = 80;
const QUERY_CACHE_TTL = 60_000; // 1 minute

interface CachedResult {
  data: object;
  cachedAt: number;
}

const queryCache = new Map<string, CachedResult>();

function getQueryCache(key: string): object | null {
  const cached = queryCache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.cachedAt > QUERY_CACHE_TTL) {
    queryCache.delete(key);
    return null;
  }
  // Move to end (most recently used)
  queryCache.delete(key);
  queryCache.set(key, cached);
  return cached.data;
}

function setQueryCache(key: string, data: object): void {
  // Evict oldest if at capacity
  if (queryCache.size >= QUERY_CACHE_MAX) {
    const oldest = queryCache.keys().next().value;
    if (oldest) queryCache.delete(oldest);
  }
  queryCache.set(key, { data, cachedAt: Date.now() });
}

// ─── Indexed name/path search ────────────────────────────────────────────────

async function indexedSearch(searchQuery: string, root: string) {
  const maxResults = 100;
  const q = searchQuery.toLowerCase();

  // Try query cache first
  const cacheKey = `name:${root}:${q}`;
  const cached = getQueryCache(cacheKey);
  if (cached) return Response.json(cached);

  const entries = await getOrBuildIndex(root);

  // Filter entries by matching name or path
  const matches: (IndexEntry & { score: number })[] = [];

  for (const entry of entries) {
    // Match against filename
    const nameMatch = entry.name.includes(q);
    // Match against relative path (cheaper than full path)
    const relPath = entry.path.slice(root.length).toLowerCase();
    const pathMatch = !nameMatch && relPath.includes(q);

    if (nameMatch || pathMatch) {
      matches.push({
        ...entry,
        score: scoreResult(entry.path, searchQuery, root, entry.isDirectory),
      });
    }
  }

  // Sort by score descending, then path length ascending
  matches.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.path.length - b.path.length;
  });

  // Stat only the top results we'll return (much fewer stat calls)
  const topMatches = matches.slice(0, maxResults);
  const results: SearchResultEntry[] = [];

  const statPromises = topMatches.map(async (m) => {
    try {
      const stat = await fs.stat(m.path);
      return {
        name: path.basename(m.path),
        path: m.path,
        isDirectory: m.isDirectory,
        size: stat.size,
        modified: stat.mtime.toISOString(),
        extension: m.isDirectory ? "" : path.extname(m.path).toLowerCase(),
        score: m.score,
      } as SearchResultEntry;
    } catch {
      return null;
    }
  });

  const statResults = await Promise.all(statPromises);
  for (const r of statResults) {
    if (r) results.push(r);
  }

  const responseData = {
    results,
    query: searchQuery,
    root,
    total: matches.length,
    cached: false,
  };

  setQueryCache(cacheKey, responseData);
  return Response.json(responseData);
}

/**
 * GET /api/files?path=/some/dir                        → list directory
 * GET /api/files?path=/some/file&read=1                → read file contents (text only, capped)
 * GET /api/files?path=/some/file&raw=1                 → serve raw file with correct MIME type
 * GET /api/files?search=query&root=/path               → search files & folders by name/path under root
 * GET /api/files?search=query&root=/path&mode=content  → search file contents (grep)
 * GET /api/files?reindex=1&root=/path                  → invalidate the cached file tree index
 */

/**
 * Content search: grep for text inside files.
 * Returns file paths + matching line previews.
 */
async function contentSearch(query: string, root: string) {
  const maxResults = 50;
  const isHomeDir = root === os.homedir();

  // Build grep exclude patterns
  const excludeDirs = [...PRUNE_DIRS];
  if (isHomeDir) excludeDirs.push(...HOME_PRUNE_DIRS);
  const excludeArgs: string[] = [];
  for (const dir of excludeDirs) {
    excludeArgs.push("--exclude-dir", dir);
  }
  // Exclude binary files
  excludeArgs.push("--binary-files=without-match");

  try {
    const { stdout } = await execFileAsync(
      "grep",
      [
        "-ril",        // recursive, case-insensitive, files-with-matches
        "--include=*.ts", "--include=*.tsx", "--include=*.js", "--include=*.jsx",
        "--include=*.py", "--include=*.go", "--include=*.rs", "--include=*.java",
        "--include=*.c", "--include=*.cpp", "--include=*.h", "--include=*.hpp",
        "--include=*.rb", "--include=*.swift", "--include=*.kt",
        "--include=*.css", "--include=*.scss", "--include=*.html", "--include=*.xml",
        "--include=*.json", "--include=*.yaml", "--include=*.yml", "--include=*.toml",
        "--include=*.md", "--include=*.txt", "--include=*.sh", "--include=*.bash",
        "--include=*.zsh", "--include=*.sql", "--include=*.graphql",
        "--include=*.vue", "--include=*.svelte", "--include=*.env",
        "--include=*.conf", "--include=*.cfg", "--include=*.ini",
        "--include=*.mjs", "--include=*.cjs", "--include=*.mts", "--include=*.cts",
        ...excludeArgs,
        query,
        root,
      ],
      { timeout: 10000, maxBuffer: 2 * 1024 * 1024 }
    );

    const files = stdout.trim().split("\n").filter(Boolean);

    // For each file, grab the first matching line as context
    const results: SearchResultEntry[] = [];

    const contextPromises = files.slice(0, maxResults).map(async (filePath) => {
      try {
        const stat = await fs.stat(filePath);
        // Get first matching line with grep -in (case-insensitive, line numbers)
        let matchLine: string | undefined;
        let matchLineNumber: number | undefined;
        try {
          const { stdout: lineStdout } = await execFileAsync(
            "grep",
            ["-in", "-m", "1", query, filePath],
            { timeout: 2000, maxBuffer: 64 * 1024 }
          );
          const firstLine = lineStdout.trim().split("\n")[0];
          if (firstLine) {
            const colonIdx = firstLine.indexOf(":");
            if (colonIdx > 0) {
              matchLineNumber = parseInt(firstLine.substring(0, colonIdx), 10);
              matchLine = firstLine.substring(colonIdx + 1).trim().slice(0, 200);
            }
          }
        } catch {
          // ignore — just won't have context line
        }

        return {
          name: path.basename(filePath),
          path: filePath,
          isDirectory: false,
          size: stat.size,
          modified: stat.mtime.toISOString(),
          extension: path.extname(filePath).toLowerCase(),
          score: scoreResult(filePath, query, root, false) + 30, // boost content matches
          matchLine,
          matchLineNumber,
        } as SearchResultEntry;
      } catch {
        return null;
      }
    });

    const contextResults = await Promise.all(contextPromises);
    for (const r of contextResults) {
      if (r) results.push(r);
    }

    results.sort((a, b) => b.score - a.score);

    return Response.json({
      results,
      query,
      root,
      total: files.length,
      mode: "content",
    });
  } catch (err) {
    // grep returns exit code 1 for "no matches" — not really an error
    const isNoMatch = err && typeof err === "object" && "code" in err && (err as { code: number }).code === 1;
    return Response.json({
      results: [],
      query,
      root,
      total: 0,
      mode: "content",
      ...(isNoMatch ? {} : { error: "Search failed" }),
    });
  }
}

export async function GET(request: NextRequest) {
  const searchQuery = request.nextUrl.searchParams.get("search");
  const gitStatus = request.nextUrl.searchParams.get("git");

  // ─── Git diff ──────────────────────────────────────────────────────
  const diffParam = request.nextUrl.searchParams.get("diff");
  if (diffParam) {
    const dirPath = request.nextUrl.searchParams.get("path") || os.homedir();
    const filePath = request.nextUrl.searchParams.get("file") || "";
    const staged = request.nextUrl.searchParams.get("staged") === "1";
    const resolvedDir = dirPath.startsWith("~") ? path.join(os.homedir(), dirPath.slice(1)) : dirPath;
    const absDir = path.resolve(resolvedDir);

    try {
      const { stdout: gitRoot } = await execFileAsync("git", ["rev-parse", "--show-toplevel"], { cwd: absDir, timeout: 3000 });
      const repoRoot = gitRoot.trim();
      const args = ["diff", "--no-color", "-U5"];
      if (staged) args.push("--cached");
      if (filePath) args.push("--", filePath);
      const { stdout: diffOut } = await execFileAsync("git", args, { cwd: repoRoot, timeout: 10000, maxBuffer: 2 * 1024 * 1024 });
      return Response.json({ diff: diffOut, repoRoot, file: filePath, staged });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Git diff failed";
      return Response.json({ diff: "", error: msg });
    }
  }

  // ─── Git blame ─────────────────────────────────────────────────────
  const blameParam = request.nextUrl.searchParams.get("blame");
  if (blameParam) {
    const filePath = request.nextUrl.searchParams.get("file") || "";
    const dirPath = request.nextUrl.searchParams.get("path") || os.homedir();
    const resolvedDir = dirPath.startsWith("~") ? path.join(os.homedir(), dirPath.slice(1)) : dirPath;
    const absDir = path.resolve(resolvedDir);

    try {
      const { stdout: gitRoot } = await execFileAsync("git", ["rev-parse", "--show-toplevel"], { cwd: absDir, timeout: 3000 });
      const repoRoot = gitRoot.trim();
      const { stdout: blameOut } = await execFileAsync(
        "git", ["blame", "--line-porcelain", filePath],
        { cwd: repoRoot, timeout: 15000, maxBuffer: 4 * 1024 * 1024 }
      );

      // Parse line-porcelain format
      interface BlameLine { hash: string; author: string; date: string; lineNum: number; content: string; }
      const lines: BlameLine[] = [];
      const chunks = blameOut.split("\n");
      let i = 0;
      while (i < chunks.length) {
        const headerLine = chunks[i];
        if (!headerLine || !headerLine.match(/^[0-9a-f]{40}/)) { i++; continue; }
        const parts = headerLine.split(" ");
        const hash = parts[0];
        const lineNum = parseInt(parts[2], 10) || 0;
        let author = "", authorTime = "";
        i++;
        while (i < chunks.length && !chunks[i].startsWith("\t")) {
          if (chunks[i].startsWith("author ")) author = chunks[i].slice(7);
          if (chunks[i].startsWith("author-time ")) authorTime = chunks[i].slice(12);
          i++;
        }
        const content = i < chunks.length ? chunks[i].slice(1) : "";
        const date = authorTime ? new Date(parseInt(authorTime, 10) * 1000).toISOString() : "";
        lines.push({ hash: hash.slice(0, 8), author, date, lineNum, content });
        i++;
      }
      return Response.json({ blame: lines, file: filePath, repoRoot });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Git blame failed";
      return Response.json({ blame: [], error: msg });
    }
  }

  // ─── Git branches ──────────────────────────────────────────────────
  const branchesParam = request.nextUrl.searchParams.get("branches");
  if (branchesParam) {
    const dirPath = request.nextUrl.searchParams.get("path") || os.homedir();
    const resolvedDir = dirPath.startsWith("~") ? path.join(os.homedir(), dirPath.slice(1)) : dirPath;
    const absDir = path.resolve(resolvedDir);

    try {
      const { stdout: gitRoot } = await execFileAsync("git", ["rev-parse", "--show-toplevel"], { cwd: absDir, timeout: 3000 });
      const repoRoot = gitRoot.trim();
      const { stdout: branchOut } = await execFileAsync(
        "git", ["branch", "-a", "--format=%(refname:short)\t%(HEAD)\t%(objectname:short)\t%(upstream:short)"],
        { cwd: repoRoot, timeout: 5000 }
      );
      const branches = branchOut.trim().split("\n").filter(Boolean).map((line) => {
        const [name, head, sha, upstream] = line.split("\t");
        return { name, current: head === "*", sha, upstream: upstream || null };
      });
      return Response.json({ branches, repoRoot });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to list branches";
      return Response.json({ branches: [], error: msg });
    }
  }

  // ─── Symbols (outline) for a file ──────────────────────────────────
  const symbolsParam = request.nextUrl.searchParams.get("symbols");
  if (symbolsParam) {
    const filePath = request.nextUrl.searchParams.get("file") || "";
    const resolvedPath = filePath.startsWith("~") ? path.join(os.homedir(), filePath.slice(1)) : filePath;
    const absPath = path.resolve(resolvedPath);

    try {
      const content = await fs.readFile(absPath, "utf-8");
      const ext = path.extname(absPath).toLowerCase();
      interface Symbol { name: string; kind: string; line: number; }
      const symbols: Symbol[] = [];
      const lines = content.split("\n");

      // Language-specific regex patterns
      const patterns: { kind: string; regex: RegExp }[] = [];

      if ([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"].includes(ext)) {
        patterns.push(
          { kind: "function", regex: /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/  },
          { kind: "class", regex: /^(?:export\s+)?class\s+(\w+)/ },
          { kind: "interface", regex: /^(?:export\s+)?interface\s+(\w+)/ },
          { kind: "type", regex: /^(?:export\s+)?type\s+(\w+)\s*=/ },
          { kind: "const", regex: /^(?:export\s+)?const\s+(\w+)\s*[=:]/ },
          { kind: "enum", regex: /^(?:export\s+)?enum\s+(\w+)/ },
          { kind: "method", regex: /^\s+(?:async\s+)?(\w+)\s*\([^)]*\)\s*[:{]/ },
        );
      } else if (ext === ".py") {
        patterns.push(
          { kind: "function", regex: /^(?:async\s+)?def\s+(\w+)/ },
          { kind: "class", regex: /^class\s+(\w+)/ },
        );
      } else if (ext === ".go") {
        patterns.push(
          { kind: "function", regex: /^func\s+(?:\([^)]+\)\s+)?(\w+)/ },
          { kind: "type", regex: /^type\s+(\w+)/ },
        );
      } else if (ext === ".rs") {
        patterns.push(
          { kind: "function", regex: /^(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/ },
          { kind: "struct", regex: /^(?:pub\s+)?struct\s+(\w+)/ },
          { kind: "enum", regex: /^(?:pub\s+)?enum\s+(\w+)/ },
          { kind: "trait", regex: /^(?:pub\s+)?trait\s+(\w+)/ },
          { kind: "impl", regex: /^impl(?:<[^>]*>)?\s+(\w+)/ },
        );
      } else if ([".java", ".kt"].includes(ext)) {
        patterns.push(
          { kind: "class", regex: /^(?:public\s+|private\s+|protected\s+)?(?:abstract\s+|static\s+)?class\s+(\w+)/ },
          { kind: "interface", regex: /^(?:public\s+)?interface\s+(\w+)/ },
          { kind: "method", regex: /^\s+(?:public\s+|private\s+|protected\s+)?(?:static\s+)?(?:abstract\s+)?(?:\w+\s+)?(\w+)\s*\(/ },
        );
      } else if ([".c", ".cpp", ".h", ".hpp"].includes(ext)) {
        patterns.push(
          { kind: "function", regex: /^(?:\w+[\s*]+)+(\w+)\s*\([^)]*\)\s*\{?$/ },
          { kind: "class", regex: /^(?:class|struct)\s+(\w+)/ },
        );
      } else if (ext === ".rb") {
        patterns.push(
          { kind: "function", regex: /^\s*def\s+(\w+)/ },
          { kind: "class", regex: /^\s*class\s+(\w+)/ },
          { kind: "module", regex: /^\s*module\s+(\w+)/ },
        );
      } else if (ext === ".swift") {
        patterns.push(
          { kind: "function", regex: /^\s*(?:public\s+|private\s+|internal\s+)?(?:static\s+)?func\s+(\w+)/ },
          { kind: "class", regex: /^\s*(?:public\s+|private\s+)?class\s+(\w+)/ },
          { kind: "struct", regex: /^\s*(?:public\s+|private\s+)?struct\s+(\w+)/ },
          { kind: "protocol", regex: /^\s*(?:public\s+)?protocol\s+(\w+)/ },
        );
      } else if (ext === ".css" || ext === ".scss") {
        patterns.push(
          { kind: "selector", regex: /^([.#@][\w-][\w-\s,.#>:[\]()]+)\s*\{/ },
        );
      } else if (ext === ".sh" || ext === ".bash" || ext === ".zsh") {
        patterns.push(
          { kind: "function", regex: /^(?:function\s+)?(\w+)\s*\(\s*\)/ },
        );
      }

      for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
        const line = lines[lineIdx];
        for (const { kind, regex } of patterns) {
          const match = line.match(regex);
          if (match && match[1]) {
            symbols.push({ name: match[1], kind, line: lineIdx + 1 });
            break;
          }
        }
      }

      return Response.json({ symbols, file: absPath });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to extract symbols";
      return Response.json({ symbols: [], error: msg });
    }
  }

  // ─── Language stats ────────────────────────────────────────────────
  const langStatsParam = request.nextUrl.searchParams.get("langstats");
  if (langStatsParam) {
    const dirPath = request.nextUrl.searchParams.get("path") || os.homedir();
    const resolvedDir = dirPath.startsWith("~") ? path.join(os.homedir(), dirPath.slice(1)) : dirPath;
    const absDir = path.resolve(resolvedDir);

    try {
      const { stdout: gitRoot } = await execFileAsync("git", ["rev-parse", "--show-toplevel"], { cwd: absDir, timeout: 3000 });
      const repoRoot = gitRoot.trim();

      // Use git ls-files to get tracked files only
      const { stdout: lsFiles } = await execFileAsync(
        "git", ["ls-files"],
        { cwd: repoRoot, timeout: 10000, maxBuffer: 4 * 1024 * 1024 }
      );

      const langMap: Record<string, { ext: string; color: string }> = {
        ".ts": { ext: "TypeScript", color: "#3178c6" },
        ".tsx": { ext: "TypeScript", color: "#3178c6" },
        ".js": { ext: "JavaScript", color: "#f1e05a" },
        ".jsx": { ext: "JavaScript", color: "#f1e05a" },
        ".mjs": { ext: "JavaScript", color: "#f1e05a" },
        ".cjs": { ext: "JavaScript", color: "#f1e05a" },
        ".py": { ext: "Python", color: "#3572A5" },
        ".go": { ext: "Go", color: "#00ADD8" },
        ".rs": { ext: "Rust", color: "#dea584" },
        ".java": { ext: "Java", color: "#b07219" },
        ".kt": { ext: "Kotlin", color: "#A97BFF" },
        ".swift": { ext: "Swift", color: "#F05138" },
        ".c": { ext: "C", color: "#555555" },
        ".cpp": { ext: "C++", color: "#f34b7d" },
        ".h": { ext: "C/C++ Header", color: "#555555" },
        ".hpp": { ext: "C++", color: "#f34b7d" },
        ".rb": { ext: "Ruby", color: "#701516" },
        ".css": { ext: "CSS", color: "#563d7c" },
        ".scss": { ext: "SCSS", color: "#c6538c" },
        ".html": { ext: "HTML", color: "#e34c26" },
        ".json": { ext: "JSON", color: "#292929" },
        ".yaml": { ext: "YAML", color: "#cb171e" },
        ".yml": { ext: "YAML", color: "#cb171e" },
        ".md": { ext: "Markdown", color: "#083fa1" },
        ".sh": { ext: "Shell", color: "#89e051" },
        ".bash": { ext: "Shell", color: "#89e051" },
        ".zsh": { ext: "Shell", color: "#89e051" },
        ".sql": { ext: "SQL", color: "#e38c00" },
        ".vue": { ext: "Vue", color: "#41b883" },
        ".svelte": { ext: "Svelte", color: "#ff3e00" },
        ".toml": { ext: "TOML", color: "#9c4221" },
        ".xml": { ext: "XML", color: "#0060ac" },
      };

      const counts: Record<string, { count: number; color: string }> = {};
      const files = lsFiles.trim().split("\n").filter(Boolean);
      for (const file of files) {
        const ext = path.extname(file).toLowerCase();
        const lang = langMap[ext];
        if (lang) {
          if (!counts[lang.ext]) counts[lang.ext] = { count: 0, color: lang.color };
          counts[lang.ext].count++;
        }
      }

      const total = Object.values(counts).reduce((s, c) => s + c.count, 0);
      const stats = Object.entries(counts)
        .map(([lang, { count, color }]) => ({ lang, count, percent: total > 0 ? Math.round((count / total) * 1000) / 10 : 0, color }))
        .sort((a, b) => b.count - a.count);

      return Response.json({ stats, total: files.length, repoRoot });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to compute stats";
      return Response.json({ stats: [], error: msg });
    }
  }

  // ─── Gitignore check ───────────────────────────────────────────────
  const gitignoreParam = request.nextUrl.searchParams.get("gitignore");
  if (gitignoreParam) {
    const dirPath = request.nextUrl.searchParams.get("path") || os.homedir();
    const resolvedDir = dirPath.startsWith("~") ? path.join(os.homedir(), dirPath.slice(1)) : dirPath;
    const absDir = path.resolve(resolvedDir);

    try {
      const { stdout: gitRoot } = await execFileAsync("git", ["rev-parse", "--show-toplevel"], { cwd: absDir, timeout: 3000 });
      const repoRoot = gitRoot.trim();

      // Get list of gitignored files in this directory
      const { stdout: checkIgnore } = await execFileAsync(
        "git", ["ls-files", "--others", "--ignored", "--exclude-standard", "--directory", absDir + "/"],
        { cwd: repoRoot, timeout: 5000, maxBuffer: 1024 * 1024 }
      );

      const ignoredPaths = checkIgnore.trim().split("\n").filter(Boolean).map((p) => {
        const full = path.isAbsolute(p) ? p : path.join(repoRoot, p);
        return path.basename(full.replace(/\/$/, ""));
      });

      return Response.json({ ignored: ignoredPaths, repoRoot });
    } catch {
      return Response.json({ ignored: [] });
    }
  }

  // ─── Project detection ─────────────────────────────────────────────
  const projectParam = request.nextUrl.searchParams.get("project");
  if (projectParam) {
    const dirPath = request.nextUrl.searchParams.get("path") || os.homedir();
    const resolvedDir = dirPath.startsWith("~") ? path.join(os.homedir(), dirPath.slice(1)) : dirPath;
    const absDir = path.resolve(resolvedDir);

    interface ProjectInfo {
      type: string;
      name: string;
      scripts: Record<string, string>;
      detectedBy: string;
    }

    const project: ProjectInfo = { type: "unknown", name: path.basename(absDir), scripts: {}, detectedBy: "" };

    // Check various project files
    const checks: { file: string; type: string }[] = [
      { file: "package.json", type: "node" },
      { file: "Cargo.toml", type: "rust" },
      { file: "go.mod", type: "go" },
      { file: "pyproject.toml", type: "python" },
      { file: "setup.py", type: "python" },
      { file: "requirements.txt", type: "python" },
      { file: "Gemfile", type: "ruby" },
      { file: "Package.swift", type: "swift" },
      { file: "build.gradle", type: "java" },
      { file: "pom.xml", type: "java" },
      { file: "Makefile", type: "make" },
      { file: "CMakeLists.txt", type: "cmake" },
      { file: "Dockerfile", type: "docker" },
      { file: "docker-compose.yml", type: "docker" },
      { file: "docker-compose.yaml", type: "docker" },
    ];

    for (const check of checks) {
      try {
        await fs.access(path.join(absDir, check.file));
        project.type = check.type;
        project.detectedBy = check.file;

        // Extract scripts for node projects
        if (check.type === "node") {
          try {
            const pkg = JSON.parse(await fs.readFile(path.join(absDir, check.file), "utf-8"));
            project.name = pkg.name || project.name;
            project.scripts = pkg.scripts || {};
          } catch { /* ignore */ }
        }

        // Extract name for Cargo.toml
        if (check.type === "rust") {
          try {
            const cargo = await fs.readFile(path.join(absDir, check.file), "utf-8");
            const nameMatch = cargo.match(/name\s*=\s*"([^"]+)"/);
            if (nameMatch) project.name = nameMatch[1];
            project.scripts = { build: "cargo build", test: "cargo test", run: "cargo run", check: "cargo check" };
          } catch { /* ignore */ }
        }

        // Go
        if (check.type === "go") {
          try {
            const gomod = await fs.readFile(path.join(absDir, check.file), "utf-8");
            const modMatch = gomod.match(/module\s+(\S+)/);
            if (modMatch) project.name = modMatch[1];
            project.scripts = { build: "go build ./...", test: "go test ./...", run: "go run .", vet: "go vet ./..." };
          } catch { /* ignore */ }
        }

        // Python
        if (check.type === "python") {
          project.scripts = { test: "pytest", lint: "ruff check .", format: "ruff format .", run: "python -m " + project.name };
        }

        break;
      } catch { /* not found, continue */ }
    }

    return Response.json(project);
  }

  // ─── Git status ────────────────────────────────────────────────────
  if (gitStatus) {
    const dirPath = request.nextUrl.searchParams.get("path") || os.homedir();
    const resolvedDir = dirPath.startsWith("~")
      ? path.join(os.homedir(), dirPath.slice(1))
      : dirPath;
    const absDir = path.resolve(resolvedDir);

    try {
      // Check if this is a git repo
      const { stdout: gitRoot } = await execFileAsync(
        "git", ["rev-parse", "--show-toplevel"],
        { cwd: absDir, timeout: 3000 }
      );
      const repoRoot = gitRoot.trim();

      // Get current branch
      const { stdout: branchOut } = await execFileAsync(
        "git", ["branch", "--show-current"],
        { cwd: repoRoot, timeout: 3000 }
      );

      // Get status in porcelain v2 format for machine parsing
      const { stdout: statusOut } = await execFileAsync(
        "git", ["status", "--porcelain=v1", "-uall"],
        { cwd: repoRoot, timeout: 5000, maxBuffer: 1024 * 1024 }
      );

      // Get ahead/behind
      let ahead = 0;
      let behind = 0;
      try {
        const { stdout: abOut } = await execFileAsync(
          "git", ["rev-list", "--left-right", "--count", "HEAD...@{u}"],
          { cwd: repoRoot, timeout: 3000 }
        );
        const parts = abOut.trim().split(/\s+/);
        ahead = parseInt(parts[0], 10) || 0;
        behind = parseInt(parts[1], 10) || 0;
      } catch {
        // no upstream
      }

      // Parse porcelain v1 output
      interface GitFileStatus {
        path: string;
        status: string; // "M", "A", "D", "?", "R", "C", "U", etc.
        staged: boolean;
        working: boolean;
      }

      const files: GitFileStatus[] = [];
      for (const line of statusOut.split("\n")) {
        if (!line.trim()) continue;
        const x = line[0]; // index/staged status
        const y = line[1]; // working tree status
        const filePath = line.slice(3);

        if (x === "?" && y === "?") {
          files.push({ path: filePath, status: "?", staged: false, working: true });
        } else {
          if (x !== " " && x !== "?") {
            files.push({ path: filePath, status: x, staged: true, working: false });
          }
          if (y !== " " && y !== "?") {
            files.push({ path: filePath, status: y, staged: false, working: true });
          }
        }
      }

      // Get last commit info
      let lastCommit = "";
      try {
        const { stdout: logOut } = await execFileAsync(
          "git", ["log", "-1", "--format=%h %s"],
          { cwd: repoRoot, timeout: 3000 }
        );
        lastCommit = logOut.trim();
      } catch {
        // empty repo
      }

      return Response.json({
        isGitRepo: true,
        repoRoot,
        branch: branchOut.trim(),
        ahead,
        behind,
        files,
        lastCommit,
      });
    } catch {
      return Response.json({ isGitRepo: false });
    }
  }

  // ─── Search mode ───────────────────────────────────────────────────
  if (searchQuery) {
    const root = request.nextUrl.searchParams.get("root") || os.homedir();
    const mode = request.nextUrl.searchParams.get("mode") || "name"; // "name" | "content"
    const resolvedRoot = root.startsWith("~")
      ? path.join(os.homedir(), root.slice(1))
      : root;

    try {
      if (mode === "content") {
        // Content search still uses grep (can't index file contents in memory)
        // but we cache the query results
        const cacheKey = `content:${resolvedRoot}:${searchQuery.toLowerCase()}`;
        const cached = getQueryCache(cacheKey);
        if (cached) return Response.json(cached);

        const result = await contentSearch(searchQuery, resolvedRoot);
        // Clone the response data to cache it
        const cloned = await result.clone().json();
        setQueryCache(cacheKey, cloned);
        return result;
      }

      // ─── Indexed filename + path search (includes directories) ─────
      return await indexedSearch(searchQuery, resolvedRoot);
    } catch {
      return Response.json({ results: [], query: searchQuery, root: resolvedRoot, total: 0 });
    }
  }

  // ─── Recent files ──────────────────────────────────────────────────
  const recentParam = request.nextUrl.searchParams.get("recent");
  if (recentParam) {
    const root = request.nextUrl.searchParams.get("root") || "~";
    const limit = parseInt(request.nextUrl.searchParams.get("limit") || "60", 10);
    const resolvedRoot = root.startsWith("~")
      ? path.join(os.homedir(), root.slice(1))
      : root;

    try {
      // Use find to get recently modified files (not dirs, not hidden, not in pruned dirs)
      const pruneArgs: string[] = [];
      const allPrune = [...PRUNE_DIRS, ...HOME_PRUNE_DIRS];
      for (const dir of allPrune) {
        pruneArgs.push("-name", dir, "-prune", "-o");
      }

      const { stdout } = await execFileAsync("find", [
        resolvedRoot,
        ...pruneArgs,
        "-type", "f",
        "!", "-name", ".*",
        "-newer", path.join(resolvedRoot, ".DS_Store").replace(/\.DS_Store$/, "") + "/.",
        "-print",
      ], { timeout: 5000, maxBuffer: 1024 * 512 }).catch(() =>
        // Fallback: find without -newer filter, just get all files sorted
        execFileAsync("find", [
          resolvedRoot,
          ...pruneArgs,
          "-type", "f",
          "!", "-name", ".*",
          "-print",
        ], { timeout: 5000, maxBuffer: 1024 * 512 })
      );

      const filePaths = stdout.trim().split("\n").filter(Boolean).slice(0, 500);

      // Stat all files in parallel (capped)
      const statResults = await Promise.allSettled(
        filePaths.map(async (fp) => {
          const s = await fs.stat(fp);
          return {
            name: path.basename(fp),
            path: fp,
            isDirectory: false,
            size: s.size,
            modified: s.mtime.toISOString(),
            extension: path.extname(fp).toLowerCase(),
          } as FileEntry;
        })
      );

      const files: FileEntry[] = statResults
        .filter((r): r is PromiseFulfilledResult<FileEntry> => r.status === "fulfilled")
        .map((r) => r.value);

      files.sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime());
      return Response.json({ results: files.slice(0, limit) });
    } catch {
      return Response.json({ results: [] });
    }
  }

  // ─── Reindex: invalidate the cached file tree ──────────────────────
  const reindex = request.nextUrl.searchParams.get("reindex");
  if (reindex) {
    const root = request.nextUrl.searchParams.get("root") || os.homedir();
    const resolvedRoot = root.startsWith("~")
      ? path.join(os.homedir(), root.slice(1))
      : root;
    treeIndexes.delete(resolvedRoot);
    // Clear all query caches for this root
    for (const key of queryCache.keys()) {
      if (key.includes(resolvedRoot)) queryCache.delete(key);
    }
    return Response.json({ reindexed: true, root: resolvedRoot });
  }

  const rawPath = request.nextUrl.searchParams.get("path") || os.homedir();
  const readFile = request.nextUrl.searchParams.get("read") === "1";
  const rawFile = request.nextUrl.searchParams.get("raw") === "1";

  // Resolve ~ to home dir
  const resolvedPath = rawPath.startsWith("~")
    ? path.join(os.homedir(), rawPath.slice(1))
    : rawPath;

  const absPath = path.resolve(resolvedPath);

  try {
    const stat = await fs.stat(absPath);

    // ─── Serve raw file ──────────────────────────────────────────────
    if (rawFile && stat.isFile()) {
      const ext = path.extname(absPath).toLowerCase();
      const mimeTypes: Record<string, string> = {
        ".pdf": "application/pdf",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".gif": "image/gif",
        ".svg": "image/svg+xml",
        ".webp": "image/webp",
        ".ico": "image/x-icon",
        ".bmp": "image/bmp",
        ".mp4": "video/mp4",
        ".mov": "video/quicktime",
        ".avi": "video/x-msvideo",
        ".mkv": "video/x-matroska",
        ".webm": "video/webm",
        ".mp3": "audio/mpeg",
        ".wav": "audio/wav",
        ".flac": "audio/flac",
        ".ogg": "audio/ogg",
        ".aac": "audio/aac",
        ".m4a": "audio/mp4",
        ".html": "text/html",
        ".css": "text/css",
        ".js": "text/javascript",
        ".json": "application/json",
        ".xml": "application/xml",
        ".txt": "text/plain",
        ".csv": "text/csv",
        ".md": "text/markdown",
      };

      const contentType = mimeTypes[ext] || "application/octet-stream";
      const buffer = await fs.readFile(absPath);
      const fileName = path.basename(absPath);
      // RFC 5987: encode non-ASCII filenames so the header stays valid Latin-1
      const encodedFileName = encodeURIComponent(fileName).replace(/'/g, "%27");
      const disposition = `inline; filename="${fileName.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodedFileName}`;

      return new Response(buffer, {
        headers: {
          "Content-Type": contentType,
          "Content-Disposition": disposition,
          "Content-Length": String(buffer.length),
        },
      });
    }

    // ─── Read file contents ──────────────────────────────────────────
    if (readFile && stat.isFile()) {
      const ext = path.extname(absPath).toLowerCase();
      const textExtensions = new Set([
        ".txt", ".md", ".json", ".js", ".ts", ".tsx", ".jsx", ".css",
        ".html", ".xml", ".yaml", ".yml", ".toml", ".ini", ".cfg",
        ".sh", ".bash", ".zsh", ".fish", ".py", ".rb", ".go", ".rs",
        ".java", ".c", ".cpp", ".h", ".hpp", ".swift", ".kt",
        ".sql", ".graphql", ".env", ".gitignore", ".dockerignore",
        ".dockerfile", ".makefile", ".csv", ".log", ".conf",
        ".mjs", ".cjs", ".mts", ".cts", ".vue", ".svelte",
      ]);

      // Check if likely text file
      const isText =
        textExtensions.has(ext) ||
        ext === "" || // no extension — try reading
        stat.size < 512 * 1024; // < 512KB — try reading

      if (!isText || stat.size > 2 * 1024 * 1024) {
        return Response.json({
          error: "File too large or binary",
          size: stat.size,
        });
      }

      try {
        const content = await fs.readFile(absPath, "utf-8");
        // Cap at 100KB of text
        const truncated = content.length > 100_000;
        return Response.json({
          content: truncated ? content.slice(0, 100_000) : content,
          truncated,
          size: stat.size,
          extension: ext,
        });
      } catch {
        return Response.json({ error: "Cannot read file as text" });
      }
    }

    // ─── List directory ──────────────────────────────────────────────
    if (stat.isDirectory()) {
      let entries;
      try {
        entries = await fs.readdir(absPath, { withFileTypes: true });
      } catch (readErr) {
        // EPERM on macOS-protected directories (Downloads, Documents, Desktop, etc.)
        // Return empty listing with a permission flag so the UI can show a helpful message
        const msg = readErr instanceof Error ? readErr.message : "Permission denied";
        return Response.json({
          path: absPath,
          parent: path.dirname(absPath),
          entries: [],
          permissionDenied: true,
          error: msg,
        });
      }
      const files: FileEntry[] = [];

      for (const entry of entries) {
        // Skip hidden system files that cause permission errors
        if (entry.name === ".Trash" && absPath === os.homedir()) continue;

        const fullPath = path.join(absPath, entry.name);
        try {
          const entryStat = await fs.stat(fullPath);
          files.push({
            name: entry.name,
            path: fullPath,
            isDirectory: entry.isDirectory(),
            size: entryStat.size,
            modified: entryStat.mtime.toISOString(),
            extension: entry.isDirectory()
              ? ""
              : path.extname(entry.name).toLowerCase(),
          });
        } catch {
          // Permission denied or broken symlink — include with minimal info
          files.push({
            name: entry.name,
            path: fullPath,
            isDirectory: entry.isDirectory(),
            size: 0,
            modified: "",
            extension: entry.isDirectory()
              ? ""
              : path.extname(entry.name).toLowerCase(),
          });
        }
      }

      // Sort: directories first, then alphabetical (case-insensitive)
      files.sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
        return a.name.localeCompare(b.name, undefined, {
          sensitivity: "base",
        });
      });

      return Response.json({
        path: absPath,
        parent: path.dirname(absPath),
        entries: files,
      });
    }

    // Single file info (no read)
    return Response.json({
      path: absPath,
      parent: path.dirname(absPath),
      isFile: true,
      size: stat.size,
      modified: stat.mtime.toISOString(),
      extension: path.extname(absPath).toLowerCase(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 400 });
  }
}

// ─── POST: save file contents ────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action } = body;

    if (action === "save") {
      const filePath: string = body.path;
      const content: string = body.content;

      if (!filePath || content === undefined) {
        return Response.json({ error: "Missing path or content" }, { status: 400 });
      }

      const resolvedPath = filePath.startsWith("~")
        ? path.join(os.homedir(), filePath.slice(1))
        : filePath;
      const absPath = path.resolve(resolvedPath);

      // Safety: ensure the file already exists (we don't create new files from the widget)
      try {
        await fs.access(absPath);
      } catch {
        return Response.json({ error: "File does not exist" }, { status: 404 });
      }

      await fs.writeFile(absPath, content, "utf-8");
      const stat = await fs.stat(absPath);

      return Response.json({
        saved: true,
        path: absPath,
        size: stat.size,
        modified: stat.mtime.toISOString(),
      });
    }

    // ─── Create file ──────────────────────────────────────────────────
    if (action === "touch") {
      const filePath: string = body.path;
      if (!filePath) return Response.json({ error: "Missing path" }, { status: 400 });

      const resolved = filePath.startsWith("~")
        ? path.join(os.homedir(), filePath.slice(1))
        : filePath;
      const absPath = path.resolve(resolved);

      // Refuse to overwrite an existing entry
      try {
        await fs.access(absPath);
        return Response.json({ error: "Already exists" }, { status: 409 });
      } catch { /* expected — file doesn't exist yet */ }

      await fs.writeFile(absPath, "", "utf-8");
      const stat = await fs.stat(absPath);
      return Response.json({ created: true, path: absPath, isDirectory: false, size: 0, modified: stat.mtime.toISOString() });
    }

    // ─── Create directory ─────────────────────────────────────────────
    if (action === "mkdir") {
      const dirPath: string = body.path;
      if (!dirPath) return Response.json({ error: "Missing path" }, { status: 400 });

      const resolved = dirPath.startsWith("~")
        ? path.join(os.homedir(), dirPath.slice(1))
        : dirPath;
      const absPath = path.resolve(resolved);

      try {
        await fs.access(absPath);
        return Response.json({ error: "Already exists" }, { status: 409 });
      } catch { /* expected */ }

      await fs.mkdir(absPath, { recursive: true });
      return Response.json({ created: true, path: absPath, isDirectory: true });
    }

    // ─── Delete file or directory ─────────────────────────────────────
    if (action === "delete") {
      const filePath: string = body.path;
      if (!filePath) return Response.json({ error: "Missing path" }, { status: 400 });

      const resolved = filePath.startsWith("~")
        ? path.join(os.homedir(), filePath.slice(1))
        : filePath;
      const absPath = path.resolve(resolved);

      // Safety: refuse to delete home dir or root
      const home = os.homedir();
      if (absPath === home || absPath === "/") {
        return Response.json({ error: "Refusing to delete home or root" }, { status: 403 });
      }

      const stat = await fs.stat(absPath);
      if (stat.isDirectory()) {
        await fs.rm(absPath, { recursive: true, force: true });
      } else {
        await fs.unlink(absPath);
      }
      return Response.json({ deleted: true, path: absPath });
    }

    // ─── Rename / move ────────────────────────────────────────────────
    if (action === "rename") {
      const fromPath: string = body.from;
      const toName: string = body.to; // just the new filename, not a full path

      if (!fromPath || !toName) return Response.json({ error: "Missing from/to" }, { status: 400 });

      const resolvedFrom = fromPath.startsWith("~")
        ? path.join(os.homedir(), fromPath.slice(1))
        : fromPath;
      const absFrom = path.resolve(resolvedFrom);
      const absTo = path.join(path.dirname(absFrom), toName);

      try {
        await fs.access(absTo);
        return Response.json({ error: "Name already taken" }, { status: 409 });
      } catch { /* expected */ }

      await fs.rename(absFrom, absTo);
      const stat = await fs.stat(absTo);
      return Response.json({
        renamed: true,
        from: absFrom,
        path: absTo,
        isDirectory: stat.isDirectory(),
        modified: stat.mtime.toISOString(),
      });
    }

    // ─── Git stage ──────────────────────────────────────────────────────
    if (action === "git-stage") {
      const filePaths: string | string[] = body.files; // relative to repo root
      const dirPath: string = body.path;
      const resolvedDir = dirPath?.startsWith("~") ? path.join(os.homedir(), dirPath.slice(1)) : dirPath || os.homedir();

      try {
        const { stdout: gitRoot } = await execFileAsync("git", ["rev-parse", "--show-toplevel"], { cwd: resolvedDir, timeout: 3000 });
        const repoRoot = gitRoot.trim();
        const files = Array.isArray(filePaths) ? filePaths : [filePaths];
        await execFileAsync("git", ["add", ...files], { cwd: repoRoot, timeout: 5000 });
        return Response.json({ staged: true, files });
      } catch (err) {
        return Response.json({ error: err instanceof Error ? err.message : "Stage failed" }, { status: 500 });
      }
    }

    // ─── Git unstage ─────────────────────────────────────────────────────
    if (action === "git-unstage") {
      const filePaths: string | string[] = body.files;
      const dirPath: string = body.path;
      const resolvedDir = dirPath?.startsWith("~") ? path.join(os.homedir(), dirPath.slice(1)) : dirPath || os.homedir();

      try {
        const { stdout: gitRoot } = await execFileAsync("git", ["rev-parse", "--show-toplevel"], { cwd: resolvedDir, timeout: 3000 });
        const repoRoot = gitRoot.trim();
        const files = Array.isArray(filePaths) ? filePaths : [filePaths];
        await execFileAsync("git", ["reset", "HEAD", ...files], { cwd: repoRoot, timeout: 5000 });
        return Response.json({ unstaged: true, files });
      } catch (err) {
        return Response.json({ error: err instanceof Error ? err.message : "Unstage failed" }, { status: 500 });
      }
    }

    // ─── Git commit ──────────────────────────────────────────────────────
    if (action === "git-commit") {
      const message: string = body.message;
      const dirPath: string = body.path;
      if (!message?.trim()) return Response.json({ error: "Commit message required" }, { status: 400 });
      const resolvedDir = dirPath?.startsWith("~") ? path.join(os.homedir(), dirPath.slice(1)) : dirPath || os.homedir();

      try {
        const { stdout: gitRoot } = await execFileAsync("git", ["rev-parse", "--show-toplevel"], { cwd: resolvedDir, timeout: 3000 });
        const repoRoot = gitRoot.trim();
        const { stdout: commitOut } = await execFileAsync("git", ["commit", "-m", message.trim()], { cwd: repoRoot, timeout: 10000 });
        return Response.json({ committed: true, output: commitOut.trim() });
      } catch (err) {
        return Response.json({ error: err instanceof Error ? err.message : "Commit failed" }, { status: 500 });
      }
    }

    // ─── Git stash ───────────────────────────────────────────────────────
    if (action === "git-stash") {
      const subAction: string = body.subAction || "push"; // "push" | "pop" | "list"
      const dirPath: string = body.path;
      const stashMessage: string = body.message || "";
      const resolvedDir = dirPath?.startsWith("~") ? path.join(os.homedir(), dirPath.slice(1)) : dirPath || os.homedir();

      try {
        const { stdout: gitRoot } = await execFileAsync("git", ["rev-parse", "--show-toplevel"], { cwd: resolvedDir, timeout: 3000 });
        const repoRoot = gitRoot.trim();

        if (subAction === "push") {
          const args = ["stash", "push"];
          if (stashMessage) args.push("-m", stashMessage);
          const { stdout } = await execFileAsync("git", args, { cwd: repoRoot, timeout: 10000 });
          return Response.json({ stashed: true, output: stdout.trim() });
        } else if (subAction === "pop") {
          const { stdout } = await execFileAsync("git", ["stash", "pop"], { cwd: repoRoot, timeout: 10000 });
          return Response.json({ popped: true, output: stdout.trim() });
        } else if (subAction === "list") {
          const { stdout } = await execFileAsync("git", ["stash", "list"], { cwd: repoRoot, timeout: 5000 });
          const stashes = stdout.trim().split("\n").filter(Boolean);
          return Response.json({ stashes });
        }
        return Response.json({ error: "Unknown stash subAction" }, { status: 400 });
      } catch (err) {
        return Response.json({ error: err instanceof Error ? err.message : "Stash failed" }, { status: 500 });
      }
    }

    // ─── Git checkout branch ─────────────────────────────────────────────
    if (action === "git-checkout") {
      const branch: string = body.branch;
      const create: boolean = body.create || false;
      const dirPath: string = body.path;
      if (!branch?.trim()) return Response.json({ error: "Branch name required" }, { status: 400 });
      const resolvedDir = dirPath?.startsWith("~") ? path.join(os.homedir(), dirPath.slice(1)) : dirPath || os.homedir();

      try {
        const { stdout: gitRoot } = await execFileAsync("git", ["rev-parse", "--show-toplevel"], { cwd: resolvedDir, timeout: 3000 });
        const repoRoot = gitRoot.trim();
        const args = create ? ["checkout", "-b", branch.trim()] : ["checkout", branch.trim()];
        const { stdout: checkoutOut } = await execFileAsync("git", args, { cwd: repoRoot, timeout: 10000 });
        return Response.json({ checkedOut: true, branch: branch.trim(), output: checkoutOut.trim() });
      } catch (err) {
        return Response.json({ error: err instanceof Error ? err.message : "Checkout failed" }, { status: 500 });
      }
    }

    // ─── File bookmarks ──────────────────────────────────────────────────
    if (action === "bookmark") {
      const DATA_DIR = path.join(os.homedir(), ".personal-assistant");
      const BOOKMARKS_FILE = path.join(DATA_DIR, "file-bookmarks.json");
      const subAction: string = body.subAction; // "add" | "remove" | "list"
      const filePath: string = body.filePath || "";

      try {
        await fs.mkdir(DATA_DIR, { recursive: true });
        let bookmarks: { path: string; name: string; isDirectory: boolean; addedAt: string }[] = [];
        try {
          const raw = await fs.readFile(BOOKMARKS_FILE, "utf-8");
          bookmarks = JSON.parse(raw);
        } catch { /* file doesn't exist yet */ }

        if (subAction === "list") {
          return Response.json({ bookmarks });
        } else if (subAction === "add") {
          if (!filePath) return Response.json({ error: "filePath required" }, { status: 400 });
          const resolved = filePath.startsWith("~") ? path.join(os.homedir(), filePath.slice(1)) : filePath;
          const abs = path.resolve(resolved);
          if (bookmarks.some((b) => b.path === abs)) return Response.json({ bookmarks }); // already bookmarked
          let isDir = false;
          try { const s = await fs.stat(abs); isDir = s.isDirectory(); } catch { /* ignore */ }
          bookmarks.push({ path: abs, name: path.basename(abs), isDirectory: isDir, addedAt: new Date().toISOString() });
          await fs.writeFile(BOOKMARKS_FILE, JSON.stringify(bookmarks, null, 2));
          return Response.json({ bookmarks });
        } else if (subAction === "remove") {
          if (!filePath) return Response.json({ error: "filePath required" }, { status: 400 });
          const resolved = filePath.startsWith("~") ? path.join(os.homedir(), filePath.slice(1)) : filePath;
          const abs = path.resolve(resolved);
          bookmarks = bookmarks.filter((b) => b.path !== abs);
          await fs.writeFile(BOOKMARKS_FILE, JSON.stringify(bookmarks, null, 2));
          return Response.json({ bookmarks });
        }
        return Response.json({ error: "Unknown bookmark subAction" }, { status: 400 });
      } catch (err) {
        return Response.json({ error: err instanceof Error ? err.message : "Bookmark operation failed" }, { status: 500 });
      }
    }

    // ─── Upload (paste) file ────────────────────────────────────────────────
    if (action === "upload") {
      const destDir: string = body.destDir;
      const fileName: string = body.fileName;
      const dataBase64: string = body.data; // base64-encoded file content

      if (!destDir || !fileName || !dataBase64) {
        return Response.json({ error: "Missing destDir, fileName, or data" }, { status: 400 });
      }

      const resolvedDir = destDir.startsWith("~")
        ? path.join(os.homedir(), destDir.slice(1))
        : destDir;
      const absDir = path.resolve(resolvedDir);

      // Ensure destination directory exists
      try {
        const stat = await fs.stat(absDir);
        if (!stat.isDirectory()) {
          return Response.json({ error: "Destination is not a directory" }, { status: 400 });
        }
      } catch {
        return Response.json({ error: "Destination directory does not exist" }, { status: 404 });
      }

      // Sanitize filename (remove path separators)
      const safeName = path.basename(fileName);
      if (!safeName) {
        return Response.json({ error: "Invalid file name" }, { status: 400 });
      }

      let finalPath = path.join(absDir, safeName);

      // If file already exists, append a number to avoid overwriting
      try {
        await fs.access(finalPath);
        // File exists — find a unique name
        const ext = path.extname(safeName);
        const base = path.basename(safeName, ext);
        let counter = 1;
        while (true) {
          finalPath = path.join(absDir, `${base} (${counter})${ext}`);
          try {
            await fs.access(finalPath);
            counter++;
          } catch {
            break; // this name is available
          }
        }
      } catch {
        // File doesn't exist — use original name
      }

      // Decode base64 and write
      const buffer = Buffer.from(dataBase64, "base64");
      await fs.writeFile(finalPath, buffer);
      const fileStat = await fs.stat(finalPath);

      return Response.json({
        uploaded: true,
        path: finalPath,
        name: path.basename(finalPath),
        size: fileStat.size,
        modified: fileStat.mtime.toISOString(),
      });
    }

    return Response.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
