"use client";

import { WidgetWrapper } from "@/components/widget-wrapper";
import { cn } from "@/lib/utils";
import {
  FolderOpen,
  Folder,
  File,
  FileText,
  FileCode,
  FileJson,
  FileImage,
  FileVideo,
  FileAudio,
  FileArchive,
  ChevronRight,
  ArrowUp,
  Home,
  Eye,
  EyeOff,
  X,
  RefreshCw,
  ExternalLink,
  Search,
  FileSearch,
  Globe,
  GitBranch,
  GitCommit,
  Plus,
  Minus,
  Pencil,
  Save,
  Undo2,
  LayoutList,
  LayoutGrid,
  Columns2,
  GalleryHorizontalEnd,
  TreePine,
  Clock,
  FolderOpenDot,
  FilePlus,
  FolderPlus,
  Trash2,
  Diff,
  Bookmark,
  BookmarkCheck,
  Copy,
  FolderCode,
  GitMerge,
  Hash,
  ListTree,
  Play,
  Package,
  Ban,
  Check,
  ChevronsUpDown,
  Archive,
  ClipboardCopy,
  ClipboardPaste,
  BarChart3,
  User,
  RotateCcw,
  PanelLeftClose,
  PanelLeftOpen,
  Server,
  Wifi,
  WifiOff,
  ArrowLeftRight,
  Loader2,
  ArrowDownAZ,
  ArrowUpAZ,
  Database,
  Table2,
  Columns3,
  Zap,
  Sparkles,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import { useTheme } from "next-themes";
import { codeToHtml, type BundledLanguage } from "shiki";
import { useWidgetNavFor } from "@/components/widget-nav-context";
import { TerminalPanel } from "@/components/terminal-panel";
import Editor from "@monaco-editor/react";
import ReactMarkdown from "react-markdown";

// ─── Types ───────────────────────────────────────────────────────────────────

type ViewMode = "list" | "grid" | "columns" | "gallery" | "tree" | "recent";

type SortField = "name" | "size" | "modified" | "type";
type SortDir = "asc" | "desc";

function sortFileEntries(entries: FileEntry[], field: SortField, dir: SortDir): FileEntry[] {
  const dirMultiplier = dir === "asc" ? 1 : -1;
  return [...entries].sort((a, b) => {
    switch (field) {
      case "name":
        return dirMultiplier * a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      case "size":
        return dirMultiplier * ((a.size || 0) - (b.size || 0));
      case "modified":
        return dirMultiplier * ((a.modified || "").localeCompare(b.modified || ""));
      case "type": {
        const extA = a.isDirectory ? "" : (a.name.includes(".") ? a.name.split(".").pop()! : "");
        const extB = b.isDirectory ? "" : (b.name.includes(".") ? b.name.split(".").pop()! : "");
        return dirMultiplier * extA.localeCompare(extB);
      }
      default:
        return 0;
    }
  });
}

// ─── PathJump ─────────────────────────────────────────────────────────────────
// Inline path editor: click the breadcrumb area to type a path and jump to it.

function PathJump({
  currentPath,
  onNavigate,
}: {
  currentPath: string;
  onNavigate: (path: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [suggIdx, setSuggIdx] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const open = useCallback(() => {
    setValue(currentPath.replace(/^\/Users\/[^/]+/, "~"));
    setSuggestions([]);
    setSuggIdx(-1);
    setEditing(true);
    setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 20);
  }, [currentPath]);

  const close = useCallback(() => {
    setEditing(false);
    setSuggestions([]);
  }, []);

  const commit = useCallback((path?: string) => {
    const target = (path ?? value).trim();
    if (target) onNavigate(target);
    close();
  }, [value, onNavigate, close]);

  // Fetch suggestions: list directories matching the typed prefix
  useEffect(() => {
    if (!editing) return;
    if (timerRef.current) clearTimeout(timerRef.current);

    const raw = value;
    // Only suggest once the user has typed a separator (looking into a dir)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!raw || !raw.includes("/")) { setSuggestions([]); return; }

    timerRef.current = setTimeout(async () => {
      // Split into parent dir and partial name
      const lastSlash = raw.lastIndexOf("/");
      const parentRaw = raw.slice(0, lastSlash) || "/";
      const partial = raw.slice(lastSlash + 1).toLowerCase();

      try {
        const res = await fetch(`/api/files?path=${encodeURIComponent(parentRaw)}`);
        const data = await res.json() as DirListing & { error?: string };
        if (data.error || !data.entries) return;
        const dirs = data.entries
          .filter((e) => e.isDirectory && e.name.toLowerCase().startsWith(partial))
          .slice(0, 8)
          .map((e) => shortenPath(e.path) + "/");
        setSuggestions(dirs);
        setSuggIdx(-1);
      } catch { /* ignore */ }
    }, 120);

    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [value, editing]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commit(suggIdx >= 0 ? suggestions[suggIdx] : undefined);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSuggIdx((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSuggIdx((i) => Math.max(i - 1, -1));
    } else if (e.key === "Tab" && suggestions.length > 0) {
      e.preventDefault();
      const pick = suggestions[suggIdx >= 0 ? suggIdx : 0];
      setValue(pick);
      setSuggestions([]);
      setSuggIdx(-1);
    }
  }, [commit, close, suggestions, suggIdx]);

  if (!editing) {
    return (
      <button
        onClick={open}
        title="Click to jump to a folder (type a path)"
        className="flex-1 min-w-0 text-left text-[10px] text-muted-foreground hover:text-foreground truncate px-1 rounded hover:bg-muted/50 transition-colors"
      >
        {shortenPath(currentPath)}
      </button>
    );
  }

  return (
    <div className="flex-1 min-w-0 relative">
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => setTimeout(close, 150)}
        className="w-full text-[10px] bg-muted/60 border border-primary/40 rounded px-1.5 py-0.5 outline-none font-mono text-foreground"
        spellCheck={false}
        autoComplete="off"
      />
      {suggestions.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-0.5 bg-popover border border-border rounded-md shadow-md z-50 overflow-hidden">
          {suggestions.map((s, i) => (
            <button
              key={s}
              onMouseDown={(e) => { e.preventDefault(); setValue(s); setSuggestions([]); }}
              className={cn(
                "w-full text-left text-[10px] px-2 py-1 font-mono truncate transition-colors",
                i === suggIdx ? "bg-primary/15 text-primary" : "hover:bg-muted/60 text-foreground"
              )}
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── File context menu ────────────────────────────────────────────────────────

interface ContextMenuState {
  x: number;
  y: number;
  entry: FileEntry;
  dirPath: string; // directory that contains this entry (or the entry itself if dir)
}

function FileContextMenu({
  state,
  onClose,
  onNewFile,
  onNewFolder,
  onRename,
  onDelete,
  onCopyPath,
  onCopyRelativePath,
  onToggleBookmark,
  onCleanup,
  onPaste,
  isBookmarked,
}: {
  state: ContextMenuState;
  onClose: () => void;
  onNewFile: (inDir: string) => void;
  onNewFolder: (inDir: string) => void;
  onRename: (entry: FileEntry) => void;
  onDelete: (entry: FileEntry) => void;
  onCopyPath: (entry: FileEntry) => void;
  onCopyRelativePath: (entry: FileEntry) => void;
  onToggleBookmark: (entry: FileEntry) => void;
  onCleanup: (entry: FileEntry) => void;
  onPaste: (inDir: string) => void;
  isBookmarked: boolean;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on outside click or Escape
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    const handleKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  // Adjust position to keep menu on-screen
  const [pos, setPos] = useState({ x: state.x, y: state.y });
  useEffect(() => {
    if (!menuRef.current) return;
    const { offsetWidth: w, offsetHeight: h } = menuRef.current;
    const vw = window.innerWidth, vh = window.innerHeight;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPos({
      x: state.x + w > vw ? Math.max(0, vw - w - 4) : state.x,
      y: state.y + h > vh ? Math.max(0, vh - h - 4) : state.y,
    });
  }, [state.x, state.y]);

  const inDir = state.entry.isDirectory ? state.entry.path : state.dirPath;

  const item = (icon: React.ReactNode, label: string, action: () => void, danger = false) => (
    <button
      onClick={() => { action(); onClose(); }}
      className={cn(
        "w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors hover:bg-muted/70",
        danger ? "text-red-500 hover:text-red-400" : "text-foreground"
      )}
    >
      {icon}
      {label}
    </button>
  );

  return createPortal(
    <div
      ref={menuRef}
      style={{ position: "fixed", left: pos.x, top: pos.y, zIndex: 9999 }}
      className="min-w-[170px] bg-popover border border-border rounded-lg shadow-xl py-1 overflow-hidden"
    >
      <div className="px-3 py-1 text-[9px] text-muted-foreground/60 uppercase tracking-wider truncate border-b border-border mb-1">
        {state.entry.name}
      </div>
      {item(<FilePlus className="h-3.5 w-3.5 shrink-0" />, "New File Here", () => onNewFile(inDir))}
      {item(<FolderPlus className="h-3.5 w-3.5 shrink-0" />, "New Folder Here", () => onNewFolder(inDir))}
      {item(<ClipboardPaste className="h-3.5 w-3.5 shrink-0" />, "Paste", () => onPaste(inDir))}
      {state.entry.isDirectory && (
        <>
          <div className="border-t border-border my-1" />
          {item(<Sparkles className="h-3.5 w-3.5 shrink-0 text-primary" />, "Clean up with AI", () => onCleanup(state.entry))}
        </>
      )}
      <div className="border-t border-border my-1" />
      {item(<ClipboardCopy className="h-3.5 w-3.5 shrink-0" />, "Copy Path", () => onCopyPath(state.entry))}
      {item(<Copy className="h-3.5 w-3.5 shrink-0" />, "Copy Relative Path", () => onCopyRelativePath(state.entry))}
      {item(
        isBookmarked ? <BookmarkCheck className="h-3.5 w-3.5 shrink-0" /> : <Bookmark className="h-3.5 w-3.5 shrink-0" />,
        isBookmarked ? "Remove Pin" : "Pin to Quick Access",
        () => onToggleBookmark(state.entry)
      )}
      <div className="border-t border-border my-1" />
      {item(<Pencil className="h-3.5 w-3.5 shrink-0" />, "Rename", () => onRename(state.entry))}
      {item(<Trash2 className="h-3.5 w-3.5 shrink-0" />, `Delete ${state.entry.isDirectory ? "Folder" : "File"}`, () => onDelete(state.entry), true)}
    </div>,
    document.body
  );
}

// ─── Inline new-entry input row ───────────────────────────────────────────────

function NewEntryRow({
  type,
  inDir,
  onCommit,
  onCancel,
}: {
  type: "file" | "folder";
  inDir: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const committingRef = useRef(false);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const commit = () => {
    if (committingRef.current) return;
    committingRef.current = true;
    const v = value.trim();
    if (v) onCommit(v); else onCancel();
  };

  return (
    <div className="flex items-center gap-2 px-2 py-1 bg-primary/5 border-b border-primary/20">
      {type === "folder"
        ? <Folder className="h-3.5 w-3.5 shrink-0 text-blue-400" />
        : <File className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      }
      <span className="text-[9px] text-muted-foreground/50 shrink-0 truncate max-w-[100px]" title={inDir}>
        {inDir.split("/").pop() || inDir}/
      </span>
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); commit(); }
          if (e.key === "Escape") { e.preventDefault(); onCancel(); }
        }}
        onBlur={() => { setTimeout(() => { if (!committingRef.current) onCancel(); }, 120); }}
        placeholder={type === "folder" ? "Folder name…" : "File name…"}
        className="flex-1 text-xs bg-transparent outline-none text-foreground placeholder:text-muted-foreground/40 font-mono"
        spellCheck={false}
        autoComplete="off"
      />
      <button onMouseDown={(e) => { e.preventDefault(); commit(); }} className="text-primary hover:text-primary/80 text-[10px] shrink-0">
        <Save className="h-3 w-3" />
      </button>
    </div>
  );
}

function RenameDialog({
  entry,
  value,
  onChange,
  onCommit,
  onCancel,
  inputRef,
}: {
  entry: FileEntry;
  value: string;
  onChange: (v: string) => void;
  onCommit: () => void;
  onCancel: () => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
}) {
  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/30"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className="bg-popover border border-border rounded-lg shadow-xl p-3 min-w-[260px] max-w-[360px]">
        <div className="text-[10px] text-muted-foreground/60 uppercase tracking-wider mb-2">
          Rename {entry.isDirectory ? "folder" : "file"}
        </div>
        <div className="flex items-center gap-2">
          <FileIcon entry={entry} className="h-4 w-4 shrink-0" />
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); onCommit(); }
              if (e.key === "Escape") { e.preventDefault(); onCancel(); }
            }}
            className="flex-1 text-xs bg-transparent outline-none border-b border-primary font-mono text-foreground py-1"
            spellCheck={false}
            autoComplete="off"
            autoFocus
          />
        </div>
        <div className="flex justify-end gap-2 mt-3">
          <button
            onClick={onCancel}
            className="text-[10px] text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-muted transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onCommit}
            className="text-[10px] text-primary hover:text-primary/80 px-2 py-1 rounded hover:bg-primary/10 transition-colors font-medium"
          >
            Rename
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  modified: string;
  extension: string;
}

interface SearchResultEntry extends FileEntry {
  score: number;
  matchLine?: string;
  matchLineNumber?: number;
  /** AI search: short reason why this file was suggested */
  reason?: string;
  /** AI search: model's confidence in this result */
  confidence?: "high" | "medium" | "low";
}

interface DirListing {
  path: string;
  parent: string;
  entries: FileEntry[];
}

interface FileContent {
  content?: string;
  truncated?: boolean;
  size?: number;
  extension?: string;
  error?: string;
}

interface GitFileStatus {
  path: string;
  status: string;
  staged: boolean;
  working: boolean;
}

interface GitStatus {
  isGitRepo: boolean;
  repoRoot?: string;
  branch?: string;
  ahead?: number;
  behind?: number;
  files?: GitFileStatus[];
  lastCommit?: string;
}

// ─── New dev-centric types ───────────────────────────────────────────────────

interface BlameLine {
  hash: string;
  author: string;
  date: string;
  lineNum: number;
  content: string;
}

interface SymbolInfo {
  name: string;
  kind: string;
  line: number;
}

interface FileBookmark {
  path: string;
  name: string;
  isDirectory: boolean;
  addedAt: string;
}

interface GitBranchInfo {
  name: string;
  current: boolean;
  sha: string;
  upstream: string | null;
}

interface ProjectInfo {
  type: string;
  name: string;
  scripts: Record<string, string>;
  detectedBy: string;
}

interface LangStat {
  lang: string;
  count: number;
  percent: number;
  color: string;
}

interface OpenTab {
  name: string;
  path: string;
  extension: string;
  content: string;
  truncated: boolean;
  dirty?: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatSize(bytes: number): string {
  if (bytes === 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatDate(iso: string): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays === 0)
      return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return `${diffDays}d ago`;
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    return "—";
  }
}

function shortenPath(fullPath: string): string {
  return fullPath.replace(/^\/Users\/[^/]+/, "~");
}

// ─── File type sets ──────────────────────────────────────────────────────────

const textExtensions = new Set([
  ".txt", ".md", ".json", ".js", ".ts", ".tsx", ".jsx", ".css",
  ".html", ".xml", ".yaml", ".yml", ".toml", ".ini", ".cfg",
  ".sh", ".bash", ".zsh", ".fish", ".py", ".rb", ".go", ".rs",
  ".java", ".c", ".cpp", ".h", ".hpp", ".swift", ".kt",
  ".sql", ".graphql", ".env", ".gitignore", ".dockerignore",
  ".dockerfile", ".makefile", ".csv", ".log", ".conf",
  ".mjs", ".cjs", ".mts", ".cts", ".vue", ".svelte", ".scss",
]);

const codeExtensions = new Set([
  ".js", ".ts", ".tsx", ".jsx", ".py", ".rb", ".go", ".rs",
  ".java", ".c", ".cpp", ".h", ".hpp", ".swift", ".kt",
  ".css", ".scss", ".html", ".xml", ".vue", ".svelte",
  ".sh", ".bash", ".zsh", ".fish", ".mjs", ".cjs",
]);

const imageExtensions = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".ico", ".bmp",
]);
const videoExtensions = new Set([".mp4", ".mov", ".avi", ".mkv", ".webm"]);
const audioExtensions = new Set([".mp3", ".wav", ".flac", ".ogg", ".aac", ".m4a"]);
const archiveExtensions = new Set([".zip", ".tar", ".gz", ".rar", ".7z", ".bz2"]);
const openableExtensions = new Set([
  ...imageExtensions, ...videoExtensions, ...audioExtensions, ".pdf",
]);

// ─── Shiki language map ──────────────────────────────────────────────────────

const shikiLangMap: Record<string, BundledLanguage> = {
  ".js": "javascript", ".mjs": "javascript", ".cjs": "javascript",
  ".ts": "typescript", ".tsx": "tsx", ".jsx": "jsx",
  ".json": "json", ".py": "python", ".rb": "ruby", ".go": "go",
  ".rs": "rust", ".java": "java", ".c": "c", ".cpp": "cpp",
  ".h": "c", ".hpp": "cpp", ".swift": "swift", ".kt": "kotlin",
  ".css": "css", ".scss": "scss", ".html": "html", ".xml": "xml",
  ".sh": "bash", ".bash": "bash", ".zsh": "bash",
  ".sql": "sql", ".md": "markdown", ".yaml": "yaml", ".yml": "yaml",
  ".toml": "toml", ".vue": "vue", ".svelte": "svelte",
  ".graphql": "graphql", ".dockerfile": "dockerfile",
  ".ini": "ini", ".csv": "csv",
};

function isTextFile(ext: string): boolean {
  return textExtensions.has(ext) || codeExtensions.has(ext) || ext === "";
}

function isOpenableInBrowser(ext: string): boolean {
  return openableExtensions.has(ext);
}

function rawFileUrl(filePath: string): string {
  return `/api/files?path=${encodeURIComponent(filePath)}&raw=1`;
}

const gitStatusLabels: Record<string, { label: string; color: string }> = {
  M: { label: "Modified", color: "text-yellow-500" },
  A: { label: "Added", color: "text-green-500" },
  D: { label: "Deleted", color: "text-red-500" },
  R: { label: "Renamed", color: "text-blue-500" },
  C: { label: "Copied", color: "text-blue-500" },
  U: { label: "Unmerged", color: "text-orange-500" },
  "?": { label: "Untracked", color: "text-muted-foreground" },
};

function GitStatusBadge({ status }: { status: string }) {
  const info = gitStatusLabels[status] || { label: status, color: "text-muted-foreground" };
  return (
    <span className={cn("text-[9px] font-mono font-bold shrink-0", info.color)} title={info.label}>
      {status}
    </span>
  );
}

// ─── Diff Viewer ─────────────────────────────────────────────────────────────

function DiffViewer({ diff, onClose }: { diff: string; onClose: () => void }) {
  if (!diff.trim()) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-xs py-4">
        No changes
      </div>
    );
  }

  const lines = diff.split("\n");
  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-2 py-1 bg-muted/30 border-b border-border shrink-0">
        <span className="text-[10px] font-medium flex items-center gap-1.5">
          <Diff className="h-3 w-3" /> Diff
        </span>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-0.5 rounded hover:bg-muted transition-colors">
          <X className="h-3 w-3" />
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-auto font-mono text-[10px] leading-relaxed">
        {lines.map((line, i) => {
          let bg = "";
          let textColor = "text-foreground";
          if (line.startsWith("+") && !line.startsWith("+++")) { bg = "bg-green-500/10"; textColor = "text-green-600 dark:text-green-400"; }
          else if (line.startsWith("-") && !line.startsWith("---")) { bg = "bg-red-500/10"; textColor = "text-red-600 dark:text-red-400"; }
          else if (line.startsWith("@@")) { bg = "bg-blue-500/10"; textColor = "text-blue-600 dark:text-blue-400"; }
          else if (line.startsWith("diff") || line.startsWith("index") || line.startsWith("---") || line.startsWith("+++")) { textColor = "text-muted-foreground"; }

          return (
            <div key={i} className={cn("px-2 py-0 whitespace-pre-wrap break-all", bg, textColor)}>
              {line || " "}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Blame Viewer ────────────────────────────────────────────────────────────

function BlameViewer({ blameLines, onClose }: { blameLines: BlameLine[]; onClose: () => void }) {
  const uniqueHashes = useMemo(() => {
    const hashes = [...new Set(blameLines.map((l) => l.hash))];
    const colors = ["text-blue-500", "text-green-500", "text-yellow-500", "text-purple-500", "text-pink-500", "text-cyan-500", "text-orange-500", "text-emerald-500"];
    return Object.fromEntries(hashes.map((h, i) => [h, colors[i % colors.length]]));
  }, [blameLines]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-2 py-1 bg-muted/30 border-b border-border shrink-0">
        <span className="text-[10px] font-medium flex items-center gap-1.5">
          <User className="h-3 w-3" /> Blame
        </span>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-0.5 rounded hover:bg-muted transition-colors">
          <X className="h-3 w-3" />
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-auto font-mono text-[10px] leading-relaxed">
        {blameLines.map((line, i) => (
          <div key={i} className="flex hover:bg-muted/40 transition-colors group">
            <div className="w-[180px] shrink-0 flex items-start gap-1.5 px-1.5 py-0 border-r border-border bg-muted/20 text-muted-foreground truncate">
              <span className={cn("shrink-0 font-bold", uniqueHashes[line.hash])} title={line.hash}>{line.hash}</span>
              <span className="truncate" title={line.author}>{line.author.split(" ")[0]}</span>
              <span className="text-[9px] text-muted-foreground/50 shrink-0 ml-auto">{formatDate(line.date)}</span>
            </div>
            <div className="flex-1 min-w-0 px-1.5 py-0 whitespace-pre-wrap break-all text-foreground">
              <span className="text-muted-foreground/40 mr-2 select-none inline-block w-[32px] text-right">{line.lineNum}</span>
              {line.content}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Symbol / Outline View ───────────────────────────────────────────────────

const symbolKindIcons: Record<string, { icon: React.ReactNode; color: string }> = {
  function: { icon: <Hash className="h-3 w-3" />, color: "text-blue-500" },
  class: { icon: <Package className="h-3 w-3" />, color: "text-yellow-500" },
  interface: { icon: <ListTree className="h-3 w-3" />, color: "text-green-500" },
  type: { icon: <ListTree className="h-3 w-3" />, color: "text-cyan-500" },
  const: { icon: <Hash className="h-3 w-3" />, color: "text-purple-500" },
  enum: { icon: <ChevronsUpDown className="h-3 w-3" />, color: "text-orange-500" },
  method: { icon: <Hash className="h-3 w-3" />, color: "text-blue-400" },
  struct: { icon: <Package className="h-3 w-3" />, color: "text-yellow-400" },
  trait: { icon: <ListTree className="h-3 w-3" />, color: "text-green-400" },
  impl: { icon: <Package className="h-3 w-3" />, color: "text-cyan-400" },
  module: { icon: <Package className="h-3 w-3" />, color: "text-pink-500" },
  selector: { icon: <Hash className="h-3 w-3" />, color: "text-purple-400" },
  protocol: { icon: <ListTree className="h-3 w-3" />, color: "text-teal-500" },
};

function SymbolOutline({ symbols, onSelect, onClose }: { symbols: SymbolInfo[]; onSelect: (line: number) => void; onClose: () => void }) {
  const grouped = useMemo(() => {
    const groups: Record<string, SymbolInfo[]> = {};
    for (const s of symbols) {
      if (!groups[s.kind]) groups[s.kind] = [];
      groups[s.kind].push(s);
    }
    return groups;
  }, [symbols]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-2 py-1 bg-muted/30 border-b border-border shrink-0">
        <span className="text-[10px] font-medium flex items-center gap-1.5">
          <ListTree className="h-3 w-3" /> Outline ({symbols.length})
        </span>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-0.5 rounded hover:bg-muted transition-colors">
          <X className="h-3 w-3" />
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin py-0.5">
        {Object.entries(grouped).map(([kind, syms]) => {
          const info = symbolKindIcons[kind] || { icon: <Hash className="h-3 w-3" />, color: "text-muted-foreground" };
          return (
            <div key={kind}>
              <div className="flex items-center gap-1.5 px-2 py-0.5 text-[9px] text-muted-foreground uppercase tracking-wider">
                <span className={info.color}>{info.icon}</span> {kind}s ({syms.length})
              </div>
              {syms.map((s) => (
                <button
                  key={`${s.name}-${s.line}`}
                  onClick={() => onSelect(s.line)}
                  className="w-full flex items-center gap-2 px-3 py-0.5 text-xs hover:bg-muted/60 transition-colors text-left"
                >
                  <span className={cn("truncate flex-1", info.color)}>{s.name}</span>
                  <span className="text-[9px] text-muted-foreground/50 shrink-0">:{s.line}</span>
                </button>
              ))}
            </div>
          );
        })}
        {symbols.length === 0 && (
          <div className="text-xs text-muted-foreground text-center py-4">No symbols found</div>
        )}
      </div>
    </div>
  );
}

// ─── Language Stats Bar ──────────────────────────────────────────────────────

function LanguageStatsBar({ stats, onClose }: { stats: LangStat[]; onClose: () => void }) {
  const topStats = stats.slice(0, 8);
  const otherPercent = stats.slice(8).reduce((s, l) => s + l.percent, 0);

  return (
    <div className="shrink-0 border border-border rounded-md overflow-hidden bg-muted/10">
      <div className="flex items-center justify-between px-2 py-1 bg-muted/30 border-b border-border">
        <span className="text-[10px] font-medium flex items-center gap-1.5">
          <BarChart3 className="h-3 w-3" /> Languages
        </span>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-0.5 rounded hover:bg-muted transition-colors">
          <X className="h-3 w-3" />
        </button>
      </div>
      {/* Color bar */}
      <div className="flex h-2 mx-2 mt-1.5 rounded-full overflow-hidden">
        {topStats.map((s) => (
          <div key={s.lang} style={{ width: `${s.percent}%`, backgroundColor: s.color }} title={`${s.lang}: ${s.percent}%`} className="transition-all" />
        ))}
        {otherPercent > 0 && (
          <div style={{ width: `${otherPercent}%` }} className="bg-muted-foreground/30" title={`Other: ${otherPercent.toFixed(1)}%`} />
        )}
      </div>
      {/* Legend */}
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 px-2 py-1.5 text-[10px]">
        {topStats.map((s) => (
          <span key={s.lang} className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
            <span className="text-foreground">{s.lang}</span>
            <span className="text-muted-foreground/60">{s.percent}%</span>
          </span>
        ))}
        {otherPercent > 0 && (
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full shrink-0 bg-muted-foreground/30" />
            <span className="text-foreground">Other</span>
            <span className="text-muted-foreground/60">{otherPercent.toFixed(1)}%</span>
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Image Diff Viewer ───────────────────────────────────────────────────────

function ImageDiffViewer({ filePath, repoRoot, onClose }: { filePath: string; repoRoot: string; onClose: () => void }) {
  const [mode, setMode] = useState<"swipe" | "side">("side");
  const [swipePos, setSwipePos] = useState(50);
  const [oldImageUrl, setOldImageUrl] = useState<string | null>(null);

  // Get old version from git
  useEffect(() => {
    // Set old image URL — actual git blob extraction would need a dedicated endpoint
    // For now, just point to the current file (limitation acknowledged)
    setOldImageUrl(`/api/files?path=${encodeURIComponent(repoRoot + "/" + filePath)}&raw=1`);
  }, [filePath, repoRoot]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-2 py-1 bg-muted/30 border-b border-border shrink-0">
        <span className="text-[10px] font-medium flex items-center gap-1.5">
          <FileImage className="h-3 w-3" /> Image Diff
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setMode("side")}
            className={cn("text-[9px] px-1.5 py-0.5 rounded", mode === "side" ? "bg-primary/15 text-primary" : "text-muted-foreground")}
          >Side</button>
          <button
            onClick={() => setMode("swipe")}
            className={cn("text-[9px] px-1.5 py-0.5 rounded", mode === "swipe" ? "bg-primary/15 text-primary" : "text-muted-foreground")}
          >Swipe</button>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-0.5 rounded hover:bg-muted transition-colors">
            <X className="h-3 w-3" />
          </button>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-auto p-2">
        {mode === "side" ? (
          <div className="flex gap-2 h-full">
            <div className="flex-1 flex flex-col items-center gap-1">
              <span className="text-[9px] text-red-500 font-medium">Before</span>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={oldImageUrl || ""} alt="Before" className="max-w-full max-h-full object-contain rounded bg-muted/50" onError={(e) => (e.currentTarget.style.display = "none")} />
            </div>
            <div className="flex-1 flex flex-col items-center gap-1">
              <span className="text-[9px] text-green-500 font-medium">After</span>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={rawFileUrl(`${repoRoot}/${filePath}`)} alt="After" className="max-w-full max-h-full object-contain rounded bg-muted/50" />
            </div>
          </div>
        ) : (
          <div className="relative h-full">
            <div className="absolute inset-0 overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={rawFileUrl(`${repoRoot}/${filePath}`)} alt="After" className="w-full h-full object-contain" />
            </div>
            <div className="absolute inset-0 overflow-hidden" style={{ clipPath: `inset(0 ${100 - swipePos}% 0 0)` }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={oldImageUrl || ""} alt="Before" className="w-full h-full object-contain" />
            </div>
            <input
              type="range"
              min={0}
              max={100}
              value={swipePos}
              onChange={(e) => setSwipePos(Number(e.target.value))}
              className="absolute bottom-2 left-1/2 -translate-x-1/2 w-3/4"
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Project Actions Panel ───────────────────────────────────────────────────

function ProjectActionsPanel({
  project,
  onRunScript,
  onClose,
}: {
  project: ProjectInfo;
  onRunScript: (cmd: string) => void;
  onClose: () => void;
}) {
  const projectTypeIcons: Record<string, React.ReactNode> = {
    node: <Package className="h-3 w-3 text-green-500" />,
    rust: <Package className="h-3 w-3 text-orange-500" />,
    go: <Package className="h-3 w-3 text-cyan-500" />,
    python: <Package className="h-3 w-3 text-yellow-500" />,
    ruby: <Package className="h-3 w-3 text-red-500" />,
    java: <Package className="h-3 w-3 text-red-400" />,
    make: <Package className="h-3 w-3 text-muted-foreground" />,
    docker: <Package className="h-3 w-3 text-blue-500" />,
    unknown: <Package className="h-3 w-3 text-muted-foreground" />,
  };

  const scriptEntries = Object.entries(project.scripts);

  return (
    <div className="shrink-0 border border-border rounded-md overflow-hidden bg-muted/10">
      <div className="flex items-center justify-between px-2 py-1 bg-muted/30 border-b border-border">
        <span className="text-[10px] font-medium flex items-center gap-1.5">
          {projectTypeIcons[project.type] || projectTypeIcons.unknown}
          {project.name}
          <span className="text-[9px] text-muted-foreground/60">({project.type})</span>
        </span>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-0.5 rounded hover:bg-muted transition-colors">
          <X className="h-3 w-3" />
        </button>
      </div>
      {scriptEntries.length > 0 ? (
        <div className="flex flex-wrap gap-1 p-1.5">
          {scriptEntries.slice(0, 12).map(([name, cmd]) => (
            <button
              key={name}
              onClick={() => onRunScript(project.type === "node" ? `npm run ${name}` : cmd)}
              title={cmd}
              className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-md bg-muted/50 hover:bg-primary/10 hover:text-primary border border-border/50 transition-colors"
            >
              <Play className="h-2.5 w-2.5" />
              {name}
            </button>
          ))}
        </div>
      ) : (
        <div className="text-xs text-muted-foreground text-center py-2">No scripts detected</div>
      )}
      {project.detectedBy && (
        <div className="text-[9px] text-muted-foreground/50 px-2 py-0.5 border-t border-border">
          Detected via {project.detectedBy}
        </div>
      )}
    </div>
  );
}

// ─── Cleanup Assistant Panel (AI) ────────────────────────────────────────────

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

interface CleanupResponse {
  categories: CleanupCategory[];
  folder: string;
  totalItems: number;
  bytesSaved?: number;
  note?: string;
  error?: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function CleanupAssistantPanel({
  folderPath,
  onClose,
  onDeleted,
}: {
  folderPath: string;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<CleanupResponse | null>(null);
  // Map of path → checked
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [deleting, setDeleting] = useState(false);
  const [deleteResult, setDeleteResult] = useState<string | null>(null);

  // Fetch suggestions when folder changes
  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      // Reset all state up-front, then fetch
      setLoading(true);
      setError(null);
      setData(null);
      setSelected({});
      setDeleteResult(null);

      try {
        const res = await fetch("/api/files-ai", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "cleanup-suggest", path: folderPath }),
        });
        const json: CleanupResponse = await res.json();
        if (cancelled) return;
        if (json.error) {
          setError(json.error);
        } else {
          setData(json);
          // Pre-select items where defaultChecked is true
          const initial: Record<string, boolean> = {};
          for (const cat of json.categories || []) {
            for (const it of cat.items) {
              initial[it.path] = it.defaultChecked;
            }
          }
          setSelected(initial);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load");
      }
      if (!cancelled) setLoading(false);
    };

    run();
    return () => { cancelled = true; };
  }, [folderPath]);

  const toggle = (p: string) => setSelected((s) => ({ ...s, [p]: !s[p] }));

  const allItems = useMemo(() => {
    if (!data) return [] as CleanupItem[];
    return data.categories.flatMap((c) => c.items);
  }, [data]);

  const selectedCount = useMemo(() => {
    return Object.values(selected).filter(Boolean).length;
  }, [selected]);

  const toggleCategory = (cat: CleanupCategory, value: boolean) => {
    setSelected((s) => {
      const next = { ...s };
      for (const it of cat.items) next[it.path] = value;
      return next;
    });
  };

  const performDelete = async () => {
    const paths = Object.entries(selected)
      .filter(([, v]) => v)
      .map(([p]) => p);
    if (paths.length === 0) return;
    if (!window.confirm(`Delete ${paths.length} item${paths.length === 1 ? "" : "s"}? This cannot be undone.`)) return;

    setDeleting(true);
    setDeleteResult(null);
    let succeeded = 0;
    let failed = 0;
    for (const p of paths) {
      try {
        const res = await fetch("/api/files", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "delete", path: p }),
        });
        const j = await res.json();
        if (j.deleted) succeeded++;
        else failed++;
      } catch {
        failed++;
      }
    }
    setDeleting(false);
    setDeleteResult(
      failed === 0
        ? `Deleted ${succeeded} item${succeeded === 1 ? "" : "s"}.`
        : `Deleted ${succeeded}, failed ${failed}.`
    );
    if (succeeded > 0) onDeleted();
  };

  const homeShort = folderPath.replace(/^\/Users\/[^/]+/, "~");

  return (
    <div className="shrink-0 max-h-[60%] flex flex-col border border-primary/30 rounded-md overflow-hidden bg-primary/5">
      <div className="flex items-center justify-between px-2 py-1 bg-primary/10 border-b border-primary/20 shrink-0">
        <span className="text-[10px] font-medium flex items-center gap-1.5 text-primary min-w-0">
          <Sparkles className="h-3 w-3 shrink-0" />
          <span className="truncate">Clean up: {homeShort}</span>
        </span>
        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground p-0.5 rounded hover:bg-muted transition-colors shrink-0"
        >
          <X className="h-3 w-3" />
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin">
        {loading && (
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground p-3">
            <div className="h-3 w-3 border-[1.5px] border-muted-foreground/30 border-t-primary rounded-full animate-spin" />
            Analyzing folder…
          </div>
        )}

        {error && (
          <div className="flex items-start gap-1.5 text-[11px] text-red-500 p-3">
            <AlertCircle className="h-3 w-3 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {!loading && !error && data && data.categories.length === 0 && (
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground p-3">
            <CheckCircle2 className="h-3 w-3 shrink-0 text-green-500" />
            <span>{data.note || "Nothing obvious to clean up here."}</span>
          </div>
        )}

        {!loading && !error && data && data.categories.length > 0 && (
          <div className="py-1">
            {data.categories.map((cat) => {
              const allChecked = cat.items.every((it) => selected[it.path]);
              const noneChecked = cat.items.every((it) => !selected[it.path]);
              return (
                <div key={cat.category} className="border-b border-border/50 last:border-b-0">
                  <div className="flex items-start gap-2 px-2 py-1 bg-muted/30">
                    <input
                      type="checkbox"
                      checked={allChecked}
                      ref={(el) => { if (el) el.indeterminate = !allChecked && !noneChecked; }}
                      onChange={(e) => toggleCategory(cat, e.target.checked)}
                      className="mt-0.5 cursor-pointer accent-primary"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] font-medium text-foreground">{cat.category}</div>
                      <div className="text-[10px] text-muted-foreground/80">{cat.description}</div>
                    </div>
                    <span className="text-[9px] text-muted-foreground/60 shrink-0 mt-0.5">
                      {cat.items.length}
                    </span>
                  </div>
                  {cat.items.map((it) => (
                    <label
                      key={it.path}
                      className="flex items-start gap-2 px-3 py-0.5 hover:bg-muted/40 cursor-pointer transition-colors"
                    >
                      <input
                        type="checkbox"
                        checked={!!selected[it.path]}
                        onChange={() => toggle(it.path)}
                        className="mt-1 cursor-pointer accent-primary shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-[11px] truncate font-mono">{it.name}</div>
                        <div className="text-[10px] text-muted-foreground/70 italic">{it.reason}</div>
                      </div>
                    </label>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer / actions */}
      {!loading && !error && data && allItems.length > 0 && (
        <div className="shrink-0 border-t border-primary/20 bg-muted/20 px-2 py-1.5 flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground flex-1 min-w-0 truncate">
            {selectedCount === 0
              ? "Select items to delete"
              : `${selectedCount} selected${data.bytesSaved ? ` · saves up to ${formatBytes(data.bytesSaved)}` : ""}`}
          </span>
          {deleteResult && (
            <span className="text-[10px] text-green-500 truncate">{deleteResult}</span>
          )}
          <button
            onClick={performDelete}
            disabled={selectedCount === 0 || deleting}
            className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded bg-red-500/10 text-red-500 hover:bg-red-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
          >
            {deleting ? (
              <div className="h-2.5 w-2.5 border-[1.5px] border-red-500/30 border-t-red-500 rounded-full animate-spin" />
            ) : (
              <Trash2 className="h-2.5 w-2.5" />
            )}
            Delete selected
          </button>
        </div>
      )}
    </div>
  );
}


// ─── File Tabs ───────────────────────────────────────────────────────────────

function FileTabs({
  tabs,
  activeIdx,
  onSelect,
  onClose,
}: {
  tabs: OpenTab[];
  activeIdx: number;
  onSelect: (idx: number) => void;
  onClose: (idx: number) => void;
}) {
  if (tabs.length <= 1) return null;

  return (
    <div className="flex items-center gap-0 overflow-x-auto scrollbar-thin shrink-0 border-b border-border bg-muted/20">
      {tabs.map((tab, idx) => (
        <div
          key={tab.path}
          className={cn(
            "flex items-center gap-1 px-2 py-1 text-[10px] cursor-pointer border-r border-border transition-colors group min-w-0 max-w-[140px]",
            idx === activeIdx ? "bg-background text-foreground border-b-2 border-b-primary" : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
          )}
          onClick={() => onSelect(idx)}
        >
          <FileIcon entry={{ extension: tab.extension, isDirectory: false }} className="h-3 w-3 shrink-0" />
          <span className="truncate">{tab.name}</span>
          {tab.dirty && <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />}
          <button
            onClick={(e) => { e.stopPropagation(); onClose(idx); }}
            className="ml-auto p-0.5 rounded text-muted-foreground/0 group-hover:text-muted-foreground hover:!text-foreground hover:bg-muted transition-colors shrink-0"
          >
            <X className="h-2.5 w-2.5" />
          </button>
        </div>
      ))}
    </div>
  );
}

// ─── Git Actions Panel (commit, stash, branch) ──────────────────────────────

function GitActionsPanel({
  resolvedPath,
  gitStatus,
  onRefreshGit,
  onClose,
}: {
  resolvedPath: string;
  gitStatus: GitStatus;
  onRefreshGit: () => void;
  onOpenTerminal: (cmd: string) => void;
  onClose: () => void;
}) {
  const [commitMsg, setCommitMsg] = useState("");
  const [committing, setCommitting] = useState(false);
  const [commitResult, setCommitResult] = useState<string | null>(null);
  const [stashMsg, setStashMsg] = useState("");
  const [branches, setBranches] = useState<GitBranchInfo[]>([]);
  const [showBranches, setShowBranches] = useState(false);
  const [showStash, setShowStash] = useState(false);
  const [stashes, setStashes] = useState<string[]>([]);
  const [actionResult, setActionResult] = useState<string | null>(null);

  const stagedFiles = gitStatus.files?.filter((f) => f.staged) || [];

  const doStage = async (files: string[]) => {
    await fetch("/api/files", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "git-stage", files, path: resolvedPath }) });
    onRefreshGit();
  };

  const doUnstage = async (files: string[]) => {
    await fetch("/api/files", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "git-unstage", files, path: resolvedPath }) });
    onRefreshGit();
  };

  const doCommit = async () => {
    if (!commitMsg.trim()) return;
    setCommitting(true); setCommitResult(null);
    try {
      const res = await fetch("/api/files", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "git-commit", message: commitMsg, path: resolvedPath }) });
      const data = await res.json();
      if (data.error) setCommitResult(`Error: ${data.error}`);
      else { setCommitResult("Committed!"); setCommitMsg(""); }
    } catch { setCommitResult("Commit failed"); }
    setCommitting(false);
    onRefreshGit();
    setTimeout(() => setCommitResult(null), 3000);
  };

  const doStash = async (sub: "push" | "pop") => {
    try {
      const res = await fetch("/api/files", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "git-stash", subAction: sub, message: stashMsg || undefined, path: resolvedPath }) });
      const data = await res.json();
      setActionResult(data.error || data.output || (sub === "push" ? "Stashed" : "Popped"));
    } catch { setActionResult("Stash failed"); }
    onRefreshGit();
    setStashMsg("");
    setTimeout(() => setActionResult(null), 3000);
  };

  const loadBranches = async () => {
    try {
      const res = await fetch(`/api/files?branches=1&path=${encodeURIComponent(resolvedPath)}`);
      const data = await res.json();
      setBranches(data.branches || []);
    } catch { setBranches([]); }
  };

  const doCheckout = async (branch: string) => {
    try {
      const res = await fetch("/api/files", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "git-checkout", branch, path: resolvedPath }) });
      const data = await res.json();
      setActionResult(data.error || `Switched to ${branch}`);
    } catch { setActionResult("Checkout failed"); }
    onRefreshGit();
    setTimeout(() => setActionResult(null), 3000);
  };

  const loadStashes = async () => {
    try {
      const res = await fetch("/api/files", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "git-stash", subAction: "list", path: resolvedPath }) });
      const data = await res.json();
      setStashes(data.stashes || []);
    } catch { setStashes([]); }
  };

  return (
    <div className="shrink-0 max-h-[55%] flex flex-col border border-border rounded-md overflow-hidden bg-muted/10">
      <div className="flex items-center justify-between px-2 py-1 bg-muted/30 border-b border-border">
        <span className="text-[10px] font-medium flex items-center gap-1.5">
          <GitBranch className="h-3 w-3" /> Git Actions
          <span className="text-muted-foreground/60">({gitStatus.branch})</span>
        </span>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-0.5 rounded hover:bg-muted transition-colors">
          <X className="h-3 w-3" />
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin">
        {/* Stage/Unstage actions on changed files */}
        {gitStatus.files && gitStatus.files.length > 0 && (
          <div className="px-2 py-1 border-b border-border">
            <div className="flex items-center gap-1 mb-1">
              <button
                onClick={() => { const working = gitStatus.files?.filter((f) => f.working && !f.staged).map((f) => f.path) || []; if (working.length) doStage(working); }}
                className="text-[9px] px-1.5 py-0.5 rounded bg-green-500/10 text-green-600 dark:text-green-400 hover:bg-green-500/20 transition-colors"
                title="Stage all working changes"
              >
                <Plus className="h-2.5 w-2.5 inline mr-0.5" />Stage All
              </button>
              <button
                onClick={() => { const staged = gitStatus.files?.filter((f) => f.staged).map((f) => f.path) || []; if (staged.length) doUnstage(staged); }}
                className="text-[9px] px-1.5 py-0.5 rounded bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 hover:bg-yellow-500/20 transition-colors"
                title="Unstage all"
              >
                <Minus className="h-2.5 w-2.5 inline mr-0.5" />Unstage All
              </button>
            </div>
            {gitStatus.files.map((f) => (
              <div key={`${f.path}-${f.staged}`} className="flex items-center gap-1 py-0.5 text-[10px]">
                <button
                  onClick={() => f.staged ? doUnstage([f.path]) : doStage([f.path])}
                  className={cn("shrink-0 p-0.5 rounded hover:bg-muted transition-colors", f.staged ? "text-green-500" : "text-muted-foreground")}
                  title={f.staged ? "Unstage" : "Stage"}
                >
                  {f.staged ? <Minus className="h-2.5 w-2.5" /> : <Plus className="h-2.5 w-2.5" />}
                </button>
                <GitStatusBadge status={f.status} />
                <span className="truncate flex-1">{f.path}</span>
              </div>
            ))}
          </div>
        )}

        {/* Commit section */}
        <div className="px-2 py-1.5 border-b border-border">
          <div className="flex items-center gap-1">
            <input
              value={commitMsg}
              onChange={(e) => setCommitMsg(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && commitMsg.trim()) doCommit(); }}
              placeholder={`Commit message (${stagedFiles.length} staged)...`}
              className="flex-1 text-[10px] bg-muted/40 border border-border rounded px-1.5 py-0.5 outline-none focus:ring-1 focus:ring-primary/50 placeholder:text-muted-foreground/40"
            />
            <button
              onClick={doCommit}
              disabled={committing || !commitMsg.trim() || stagedFiles.length === 0}
              className="text-[9px] px-2 py-0.5 rounded bg-primary/10 text-primary hover:bg-primary/20 transition-colors disabled:opacity-40 flex items-center gap-1"
            >
              <GitCommit className="h-2.5 w-2.5" />
              {committing ? "..." : "Commit"}
            </button>
          </div>
          {commitResult && (
            <div className={cn("text-[9px] mt-0.5", commitResult.startsWith("Error") ? "text-red-500" : "text-green-500")}>
              {commitResult}
            </div>
          )}
        </div>

        {/* Branch + Stash actions */}
        <div className="flex items-center gap-1 px-2 py-1.5">
          <button
            onClick={() => { setShowBranches(!showBranches); if (!showBranches) loadBranches(); }}
            className={cn("text-[9px] px-1.5 py-0.5 rounded flex items-center gap-1 transition-colors", showBranches ? "bg-primary/15 text-primary" : "bg-muted/50 text-muted-foreground hover:text-foreground")}
          >
            <GitMerge className="h-2.5 w-2.5" /> Branches
          </button>
          <button
            onClick={() => { setShowStash(!showStash); if (!showStash) loadStashes(); }}
            className={cn("text-[9px] px-1.5 py-0.5 rounded flex items-center gap-1 transition-colors", showStash ? "bg-primary/15 text-primary" : "bg-muted/50 text-muted-foreground hover:text-foreground")}
          >
            <Archive className="h-2.5 w-2.5" /> Stash
          </button>
        </div>

        {/* Branch list */}
        {showBranches && (
          <div className="px-2 pb-1.5 border-b border-border">
            {branches.length === 0 ? (
              <div className="text-[9px] text-muted-foreground text-center py-1">Loading...</div>
            ) : (
              <div className="max-h-[120px] overflow-y-auto scrollbar-thin">
                {branches.filter((b) => !b.name.startsWith("origin/")).map((b) => (
                  <button
                    key={b.name}
                    onClick={() => { if (!b.current) doCheckout(b.name); }}
                    className={cn("w-full flex items-center gap-1.5 px-1 py-0.5 text-[10px] rounded hover:bg-muted/60 transition-colors text-left", b.current && "text-primary font-medium")}
                  >
                    {b.current ? <Check className="h-2.5 w-2.5 shrink-0" /> : <GitBranch className="h-2.5 w-2.5 shrink-0 text-muted-foreground" />}
                    <span className="truncate flex-1">{b.name}</span>
                    <span className="text-[8px] text-muted-foreground/50 font-mono shrink-0">{b.sha}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Stash list */}
        {showStash && (
          <div className="px-2 pb-1.5">
            <div className="flex items-center gap-1 mb-1">
              <input
                value={stashMsg}
                onChange={(e) => setStashMsg(e.target.value)}
                placeholder="Stash message (optional)..."
                className="flex-1 text-[10px] bg-muted/40 border border-border rounded px-1.5 py-0.5 outline-none focus:ring-1 focus:ring-primary/50 placeholder:text-muted-foreground/40"
              />
              <button onClick={() => doStash("push")} className="text-[9px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-500 hover:bg-blue-500/20 transition-colors">Push</button>
              <button onClick={() => doStash("pop")} className="text-[9px] px-1.5 py-0.5 rounded bg-orange-500/10 text-orange-500 hover:bg-orange-500/20 transition-colors">Pop</button>
            </div>
            {stashes.length > 0 && (
              <div className="max-h-[80px] overflow-y-auto scrollbar-thin">
                {stashes.map((s, i) => (
                  <div key={i} className="text-[10px] text-muted-foreground truncate py-0.5 px-1">{s}</div>
                ))}
              </div>
            )}
          </div>
        )}

        {actionResult && (
          <div className={cn("text-[9px] px-2 py-1", actionResult.includes("fail") || actionResult.includes("Error") ? "text-red-500" : "text-green-500")}>
            {actionResult}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Bookmarks Panel ─────────────────────────────────────────────────────────

function BookmarksPanel({
  bookmarks,
  onNavigate,
  onRemove,
  onClose,
}: {
  bookmarks: FileBookmark[];
  onNavigate: (path: string) => void;
  onRemove: (path: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="shrink-0 max-h-[30%] flex flex-col border border-border rounded-md overflow-hidden bg-muted/10">
      <div className="flex items-center justify-between px-2 py-1 bg-muted/30 border-b border-border">
        <span className="text-[10px] font-medium flex items-center gap-1.5">
          <Bookmark className="h-3 w-3" /> Pinned ({bookmarks.length})
        </span>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-0.5 rounded hover:bg-muted transition-colors">
          <X className="h-3 w-3" />
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin">
        {bookmarks.length === 0 ? (
          <div className="text-xs text-muted-foreground text-center py-3">No pinned files. Right-click to pin.</div>
        ) : (
          bookmarks.map((b) => (
            <div key={b.path} className="group flex items-center gap-2 px-2 py-1 hover:bg-muted/60 transition-colors">
              <button onClick={() => onNavigate(b.path)} className="flex items-center gap-2 flex-1 min-w-0 text-left">
                {b.isDirectory ? <Folder className="h-3 w-3 shrink-0 text-blue-400" /> : <File className="h-3 w-3 shrink-0 text-muted-foreground" />}
                <span className="text-xs truncate">{b.name}</span>
              </button>
              <span className="text-[9px] text-muted-foreground/40 truncate max-w-[100px] hidden group-hover:hidden">{shortenPath(b.path)}</span>
              <button
                onClick={() => onRemove(b.path)}
                className="p-0.5 rounded text-muted-foreground/0 group-hover:text-red-400/60 hover:!text-red-400 transition-colors shrink-0"
                title="Remove pin"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ─── File icons ──────────────────────────────────────────────────────────────

function FileIcon({
  entry,
  className,
}: {
  entry: { name?: string; extension: string; isDirectory: boolean };
  className?: string;
}) {
  if (entry.isDirectory)
    return <Folder className={cn(className, "text-blue-400")} />;
  const ext = entry.extension;
  if (ext === ".json") return <FileJson className={cn(className, "text-yellow-400")} />;
  if (codeExtensions.has(ext)) return <FileCode className={cn(className, "text-green-400")} />;
  if (imageExtensions.has(ext)) return <FileImage className={cn(className, "text-purple-400")} />;
  if (videoExtensions.has(ext)) return <FileVideo className={cn(className, "text-pink-400")} />;
  if (audioExtensions.has(ext)) return <FileAudio className={cn(className, "text-orange-400")} />;
  if (archiveExtensions.has(ext)) return <FileArchive className={cn(className, "text-red-400")} />;
  if (ext === ".md" || ext === ".txt" || ext === ".log")
    return <FileText className={cn(className, "text-muted-foreground")} />;
  return <File className={cn(className, "text-muted-foreground")} />;
}

// ─── Highlighted code component ──────────────────────────────────────────────

function HighlightedCode({ code, extension }: { code: string; extension: string }) {
  const [html, setHtml] = useState<string | null>(null);
  const { resolvedTheme } = useTheme();
  const lang = shikiLangMap[extension];
  const shikiTheme = resolvedTheme === "light" ? "github-light-default" : "github-dark-default";

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!lang) { setHtml(null); return; }
    let cancelled = false;
    const cappedCode = code.length > 50_000 ? code.slice(0, 50_000) : code;
    codeToHtml(cappedCode, { lang, theme: shikiTheme })
      .then((result) => { if (!cancelled) setHtml(result); })
      .catch(() => { if (!cancelled) setHtml(null); });
    return () => { cancelled = true; };
  }, [code, lang, shikiTheme]);

  if (!lang || html === null) {
    return (
      <pre className="text-[10px] leading-relaxed font-mono whitespace-pre-wrap break-all text-foreground">
        {code}
      </pre>
    );
  }
  return (
    <div
      className="shiki-preview text-[10px] leading-relaxed [&_pre]:!bg-transparent [&_pre]:!p-0 [&_pre]:!m-0 [&_code]:!text-[10px] [&_code]:!leading-relaxed overflow-x-auto"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

// ─── Monaco language map ──────────────────────────────────────────────────────

const monacoLangMap: Record<string, string> = {
  ".js": "javascript", ".mjs": "javascript", ".cjs": "javascript",
  ".ts": "typescript", ".tsx": "typescriptreact", ".jsx": "javascriptreact",
  ".json": "json", ".py": "python", ".rb": "ruby", ".go": "go",
  ".rs": "rust", ".java": "java", ".c": "c", ".cpp": "cpp",
  ".h": "c", ".hpp": "cpp", ".swift": "swift", ".kt": "kotlin",
  ".css": "css", ".scss": "scss", ".html": "html", ".xml": "xml",
  ".sh": "shell", ".bash": "shell", ".zsh": "shell",
  ".sql": "sql", ".md": "markdown", ".yaml": "yaml", ".yml": "yaml",
  ".toml": "toml", ".vue": "vue", ".svelte": "svelte",
  ".graphql": "graphql", ".dockerfile": "dockerfile",
  ".ini": "ini", ".csv": "plaintext", ".txt": "plaintext",
  ".log": "plaintext", ".env": "plaintext", ".gitignore": "plaintext",
};

// ─── Monaco Editor Component ─────────────────────────────────────────────────

function MonacoEditorPanel({
  content,
  extension,
  filePath,
  onSave,
  readOnly,
}: {
  content: string;
  extension: string;
  filePath?: string;
  onSave?: (content: string) => void;
  readOnly?: boolean;
}) {
  const { resolvedTheme } = useTheme();
  const language = monacoLangMap[extension] || "plaintext";
  const monacoTheme = resolvedTheme === "light" ? "light" : "vs-dark";

  return (
    <Editor
      height="100%"
      language={language}
      value={content}
      theme={monacoTheme}
      path={filePath}
      options={{
        readOnly: readOnly ?? false,
        minimap: { enabled: true },
        fontSize: 12,
        lineNumbers: "on",
        wordWrap: "on",
        scrollBeyondLastLine: false,
        automaticLayout: true,
        tabSize: 2,
        renderWhitespace: "selection",
        bracketPairColorization: { enabled: true },
        guides: { bracketPairs: true, indentation: true },
        smoothScrolling: true,
        cursorBlinking: "smooth",
        cursorSmoothCaretAnimation: "on",
        folding: true,
        links: true,
        padding: { top: 8 },
      }}
      onMount={(editor, monaco) => {
        // Cmd+S / Ctrl+S to save
        if (onSave) {
          editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
            onSave(editor.getValue());
          });
        }
      }}
    />
  );
}

// ─── SVG Icons ────────────────────────────────────────────────────────────────

function ClaudeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 248 248" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M52.4285 162.873L98.7844 136.879L99.5485 134.602L98.7844 133.334H96.4921L88.7237 132.862L62.2346 132.153L39.3113 131.207L17.0249 130.026L11.4214 128.844L6.2 121.873L6.7094 118.447L11.4214 115.257L18.171 115.847L33.0711 116.911L55.485 118.447L71.6586 119.392L95.728 121.873H99.5485L100.058 120.337L98.7844 119.392L97.7656 118.447L74.5877 102.732L49.4995 86.1905L36.3823 76.62L29.3779 71.7757L25.8121 67.2858L24.2839 57.3608L30.6515 50.2716L39.3113 50.8623L41.4763 51.4531L50.2636 58.1879L68.9842 72.7209L93.4357 90.6804L97.0015 93.6343L98.4374 92.6652L98.6571 91.9801L97.0015 89.2625L83.757 65.2772L69.621 40.8192L63.2534 30.6579L61.5978 24.632C60.9565 22.1032 60.579 20.0111 60.579 17.4246L67.8381 7.49965L71.9133 6.19995L81.7193 7.49965L85.7946 11.0443L91.9074 24.9865L101.714 46.8451L116.996 76.62L121.453 85.4816L123.873 93.6343L124.764 96.1155H126.292V94.6976L127.566 77.9197L129.858 57.3608L132.15 30.8942L132.915 23.4505L136.608 14.4708L143.994 9.62643L149.725 12.344L154.437 19.0788L153.8 23.4505L150.998 41.6463L145.522 70.1215L141.957 89.2625H143.994L146.414 86.7813L156.093 74.0206L172.266 53.698L179.398 45.6635L187.803 36.802L193.152 32.5484H203.34L210.726 43.6549L207.415 55.1159L196.972 68.3492L188.312 79.5739L175.896 96.2095L168.191 109.585L168.882 110.689L170.738 110.53L198.755 104.504L213.91 101.787L231.994 98.7149L240.144 102.496L241.036 106.395L237.852 114.311L218.495 119.037L195.826 123.645L162.07 131.592L161.696 131.893L162.137 132.547L177.36 133.925L183.855 134.279H199.774L229.447 136.524L237.215 141.605L241.8 147.867L241.036 152.711L229.065 158.737L213.019 154.956L175.45 145.977L162.587 142.787H160.805V143.85L171.502 154.366L191.242 172.089L215.82 195.011L217.094 200.682L213.91 205.172L210.599 204.699L188.949 188.394L180.544 181.069L161.696 165.118H160.422V166.772L164.752 173.152L187.803 207.771L188.949 218.405L187.294 221.832L181.308 223.959L174.813 222.777L161.187 203.754L147.305 182.486L136.098 163.345L134.745 164.2L128.075 235.42L125.019 239.082L117.887 241.8L111.902 237.31L108.718 229.984L111.902 215.452L115.722 196.547L118.779 181.541L121.58 162.873L123.291 156.636L123.14 156.219L121.773 156.449L107.699 175.752L86.304 204.699L69.3663 222.777L65.291 224.431L58.2867 220.768L58.9235 214.27L62.8713 208.48L86.304 178.705L100.44 160.155L109.551 149.507L109.462 147.967L108.959 147.924L46.6977 188.512L35.6182 189.93L30.7788 185.44L31.4156 178.115L33.7079 175.752L52.4285 162.873Z" />
    </svg>
  );
}

function OpenCodeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M320 224V352H192V224H320Z" fill="currentColor" opacity="0.5" />
      <path fillRule="evenodd" clipRule="evenodd" d="M384 416H128V96H384V416ZM320 160H192V352H320V160Z" fill="currentColor" />
    </svg>
  );
}

// ─── Inline preview panel (shared by multiple views) ─────────────────────────

interface InlinePreviewProps {
  entry: FileEntry | null;
  onClose?: () => void;
  className?: string;
}

function InlinePreview({ entry, onClose, className }: InlinePreviewProps) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!entry || entry.isDirectory) { setContent(null); return; }
    if (imageExtensions.has(entry.extension)) { setContent(null); return; }
    if (!isTextFile(entry.extension)) { setContent(null); return; }
    setLoading(true);
    setContent(null);
    let cancelled = false;
    fetch(`/api/files?path=${encodeURIComponent(entry.path)}&read=1`)
      .then((r) => r.json())
      .then((d: FileContent) => { if (!cancelled) setContent(d.content || ""); })
      .catch(() => { if (!cancelled) setContent(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [entry]);

  if (!entry) {
    return (
      <div className={cn("flex items-center justify-center h-full text-muted-foreground text-xs", className)}>
        Select a file to preview
      </div>
    );
  }

  if (entry.isDirectory) {
    return (
      <div className={cn("flex flex-col items-center justify-center h-full gap-2 text-muted-foreground", className)}>
        <Folder className="h-10 w-10 text-blue-400/60" />
        <span className="text-xs font-medium">{entry.name}</span>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col h-full overflow-hidden", className)}>
      {onClose && (
        <div className="flex items-center justify-between px-2 py-1 border-b border-border bg-muted/30 shrink-0">
          <span className="text-[10px] font-medium truncate">{entry.name}</span>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-0.5 rounded hover:bg-muted transition-colors shrink-0">
            <X className="h-3 w-3" />
          </button>
        </div>
      )}
      <div className="flex-1 min-h-0 overflow-auto p-2">
        {imageExtensions.has(entry.extension) ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={rawFileUrl(entry.path)}
            alt={entry.name}
            className="max-w-full max-h-full object-contain rounded"
          />
        ) : loading ? (
          <div className="flex items-center gap-2 text-muted-foreground text-[10px]">
            <div className="h-3 w-3 border-2 border-muted-foreground/30 border-t-primary rounded-full animate-spin" />
            Loading...
          </div>
        ) : content !== null ? (
          <HighlightedCode code={content} extension={entry.extension} />
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground">
            <FileIcon entry={entry} className="h-10 w-10 opacity-40" />
            <span className="text-xs">No preview available</span>
            <a
              href={rawFileUrl(entry.path)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-primary hover:underline flex items-center gap-1"
            >
              <ExternalLink className="h-3 w-3" /> Open in new tab
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── VIEW: Grid ───────────────────────────────────────────────────────────────

function GridView({
  entries,
  selectedPath,
  dirPath,
  onFileClick,
  onDragStart,
  onContextMenu,
}: {
  entries: FileEntry[];
  selectedPath?: string | null;
  dirPath: string;
  onFileClick: (e: FileEntry) => void;
  onDragStart: (e: React.DragEvent, entry: FileEntry) => void;
  onContextMenu: (e: React.MouseEvent, entry: FileEntry, dirPath: string) => void;
}) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(72px,1fr))] gap-2 p-1">
      {entries.map((entry) => (
        <div
          key={entry.path}
          role="button"
          tabIndex={0}
          draggable
          onDragStart={(e) => onDragStart(e, entry)}
          onClick={() => onFileClick(entry)}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onFileClick(entry); }}
          onContextMenu={(e) => onContextMenu(e, entry, dirPath)}
          className={cn(
            "flex flex-col items-center gap-1 p-2 rounded-lg hover:bg-muted/70 transition-colors text-center group cursor-grab active:cursor-grabbing select-none",
            selectedPath === entry.path && "bg-primary/10 ring-1 ring-primary/30"
          )}
        >
          <div className="relative h-10 w-10 flex items-center justify-center pointer-events-none">
            {imageExtensions.has(entry.extension) ? (
              <ImageThumb path={entry.path} name={entry.name} />
            ) : (
              <FileIcon entry={entry} className="h-10 w-10" />
            )}
          </div>
          <a
            href={entry.isDirectory ? undefined : rawFileUrl(entry.path)}
            className="text-[10px] leading-tight line-clamp-2 w-full break-words text-foreground/80 group-hover:text-foreground"
            onClick={(e) => e.preventDefault()}
            draggable={false}
            tabIndex={-1}
          >
            {entry.name}
          </a>
        </div>
      ))}
    </div>
  );
}

/** Lazy image thumbnail with fallback to FileIcon */
function ImageThumb({ path: filePath, name }: { path: string; name: string }) {
  const [state, setState] = useState<"loading" | "ok" | "err">("loading");
  return (
    <div className="h-10 w-10 flex items-center justify-center">
      {state !== "err" && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={rawFileUrl(filePath)}
          alt={name}
          className={cn(
            "h-10 w-10 object-cover rounded-md bg-muted/50 transition-opacity",
            state === "loading" ? "opacity-0" : "opacity-100"
          )}
          onLoad={() => setState("ok")}
          onError={() => setState("err")}
        />
      )}
      {state === "loading" && (
        <div className="absolute inset-0 flex items-center justify-center">
          <FileImage className="h-10 w-10 text-purple-400/50 animate-pulse" />
        </div>
      )}
      {state === "err" && (
        <FileImage className="h-10 w-10 text-purple-400" />
      )}
    </div>
  );
}

// ─── VIEW: Columns (Miller Columns) ──────────────────────────────────────────

function ColumnsView({
  initialPath,
  onContextMenu,
}: {
  initialPath: string;
  onContextMenu: (e: React.MouseEvent, entry: FileEntry, dirPath: string) => void;
}) {
  const [columns, setColumns] = useState<
    { path: string; entries: FileEntry[]; selectedPath: string | null; loading: boolean }[]
  >([]);
  const [previewEntry, setPreviewEntry] = useState<FileEntry | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const loadColumn = useCallback(async (dirPath: string) => {
    try {
      const res = await fetch(`/api/files?path=${encodeURIComponent(dirPath)}`);
      const data = await res.json() as DirListing & { error?: string };
      return data.entries || [];
    } catch {
      return [];
    }
  }, []);

  // Load first column only on mount (initialPath is captured once)
  const initialPathRef = useRef(initialPath);
  useEffect(() => {
    (async () => {
      const entries = await loadColumn(initialPathRef.current);
      setColumns([{ path: initialPathRef.current, entries, selectedPath: null, loading: false }]);
      setPreviewEntry(null);
    })();
  }, [loadColumn]); // intentionally omit initialPath — we only want this on mount

  // Auto-scroll columns container to show rightmost column
  useEffect(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollLeft = scrollContainerRef.current.scrollWidth;
    }
  }, [columns.length]);

  const handleSelect = useCallback(async (colIdx: number, entry: FileEntry) => {
    setColumns((prev) => {
      const next = prev.slice(0, colIdx + 1).map((col, i) =>
        i === colIdx ? { ...col, selectedPath: entry.path } : col
      );
      return next;
    });

    if (entry.isDirectory) {
      setPreviewEntry(null);
      setColumns((prev) => [
        ...prev.slice(0, colIdx + 1).map((col, i) =>
          i === colIdx ? { ...col, selectedPath: entry.path } : col
        ),
        { path: entry.path, entries: [], selectedPath: null, loading: true },
      ]);
      const entries = await loadColumn(entry.path);
      setColumns((prev) => {
        const next = [...prev];
        if (next[colIdx + 1]) {
          next[colIdx + 1] = { ...next[colIdx + 1], entries, loading: false };
        }
        return next;
      });
    } else {
      setPreviewEntry(entry);
      // Truncate any dir columns added after this col
      setColumns((prev) => prev.slice(0, colIdx + 1).map((col, i) =>
        i === colIdx ? { ...col, selectedPath: entry.path } : col
      ));
    }
  }, [loadColumn]);

  // Keyboard nav inside columns
  const handleKeyDown = useCallback((e: React.KeyboardEvent, colIdx: number, entry: FileEntry, entryIdx: number, colEntries: FileEntry[]) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const next = colEntries[entryIdx + 1];
      if (next) handleSelect(colIdx, next);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const prev = colEntries[entryIdx - 1];
      if (prev) handleSelect(colIdx, prev);
    } else if (e.key === "ArrowRight" && entry.isDirectory) {
      e.preventDefault();
      handleSelect(colIdx, entry);
    } else if (e.key === "ArrowLeft" && colIdx > 0) {
      e.preventDefault();
      // Focus previous column's selected entry
      const prevCol = columns[colIdx - 1];
      if (prevCol?.selectedPath) {
        const prevEntry = prevCol.entries.find((en) => en.path === prevCol.selectedPath);
        if (prevEntry) handleSelect(colIdx - 1, prevEntry);
      }
    } else if (e.key === "Enter") {
      e.preventDefault();
      handleSelect(colIdx, entry);
    }
  }, [handleSelect, columns]);

  const showPreview = previewEntry !== null;

  return (
    <div className="flex h-full overflow-hidden gap-0">
      {/* Column scroller */}
      <div
        ref={scrollContainerRef}
        className={cn(
          "flex overflow-x-auto gap-0 border border-border rounded-md",
          showPreview ? "flex-[0_0_55%]" : "flex-1"
        )}
      >
        {columns.map((col, colIdx) => (
          <div
            key={col.path + colIdx}
            className="min-w-[155px] max-w-[195px] flex-shrink-0 border-r border-border last:border-r-0 overflow-y-auto scrollbar-thin"
          >
            {col.loading ? (
              <div className="flex items-center justify-center h-16">
                <div className="h-4 w-4 border-2 border-muted-foreground/30 border-t-primary rounded-full animate-spin" />
              </div>
            ) : (
              col.entries.map((entry, entryIdx) => (
                <div
                  key={entry.path}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleSelect(colIdx, entry)}
                  onKeyDown={(e) => handleKeyDown(e, colIdx, entry, entryIdx, col.entries)}
                  onContextMenu={(e) => onContextMenu(e, entry, col.path)}
                  className={cn(
                    "w-full flex items-center gap-1.5 px-2 py-1 text-xs text-left hover:bg-muted/60 transition-colors focus:outline-none focus:bg-muted/50 cursor-pointer",
                    col.selectedPath === entry.path && "bg-primary/15 text-primary"
                  )}
                >
                  <FileIcon entry={entry} className="h-3.5 w-3.5 shrink-0 pointer-events-none" />
                  <a
                    href={entry.isDirectory ? undefined : rawFileUrl(entry.path)}
                    className="truncate flex-1"
                    onClick={(e) => e.preventDefault()}
                    draggable={false}
                    tabIndex={-1}
                  >
                    {entry.name}
                  </a>
                  {entry.isDirectory && (
                    <ChevronRight className="h-3 w-3 text-muted-foreground/50 shrink-0 pointer-events-none" />
                  )}
                </div>
              ))
            )}
          </div>
        ))}
      </div>

      {/* Preview pane */}
      {showPreview && previewEntry && (
        <div className="flex-1 min-w-0 border border-border rounded-md ml-1 overflow-hidden">
          <InlinePreview
            entry={previewEntry}
            onClose={() => setPreviewEntry(null)}
          />
        </div>
      )}
    </div>
  );
}

// ─── VIEW: Gallery (list + large preview) ────────────────────────────────────

function GalleryView({
  entries,
  dirPath,
  onFileClick,
  onNavigate,
  onContextMenu,
}: {
  entries: FileEntry[];
  dirPath: string;
  onFileClick: (e: FileEntry) => void;
  onNavigate: (e: FileEntry) => void;
  onContextMenu: (e: React.MouseEvent, entry: FileEntry, dirPath: string) => void;
}) {
  const [selected, setSelected] = useState<FileEntry | null>(null);
  const [focusedIdx, setFocusedIdx] = useState<number>(-1);
  const listRef = useRef<HTMLDivElement>(null);

  const handleSelect = useCallback((entry: FileEntry, idx: number) => {
    setFocusedIdx(idx);
    if (entry.isDirectory) { onNavigate(entry); return; }
    setSelected(entry);
    onFileClick(entry);
  }, [onFileClick, onNavigate]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setFocusedIdx((prev) => {
        const next = Math.min(prev + 1, entries.length - 1);
        const entry = entries[next];
        if (entry && !entry.isDirectory) setSelected(entry);
        return next;
      });
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setFocusedIdx((prev) => {
        const next = Math.max(prev - 1, 0);
        const entry = entries[next];
        if (entry && !entry.isDirectory) setSelected(entry);
        return next;
      });
    } else if (e.key === "Enter" && focusedIdx >= 0) {
      const entry = entries[focusedIdx];
      if (entry) handleSelect(entry, focusedIdx);
    }
  }, [entries, focusedIdx, handleSelect]);

  return (
    <div className="flex h-full gap-0 overflow-hidden" onKeyDown={handleKeyDown} tabIndex={-1}>
      {/* File list */}
      <div ref={listRef} className="w-[45%] shrink-0 border-r border-border overflow-y-auto scrollbar-thin">
        {entries.map((entry, idx) => (
          <div
            key={entry.path}
            role="button"
            tabIndex={0}
            onClick={() => handleSelect(entry, idx)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") handleSelect(entry, idx); }}
            onContextMenu={(e) => onContextMenu(e, entry, dirPath)}
            className={cn(
              "w-full flex items-center gap-2 px-2 py-1.5 text-xs text-left hover:bg-muted/60 transition-colors focus:outline-none cursor-pointer",
              selected?.path === entry.path && "bg-primary/15",
              focusedIdx === idx && "ring-1 ring-inset ring-primary/40"
            )}
          >
            <FileIcon entry={entry} className="h-3.5 w-3.5 shrink-0 pointer-events-none" />
            <a
              href={entry.isDirectory ? undefined : rawFileUrl(entry.path)}
              className={cn("truncate flex-1", entry.isDirectory && "font-medium")}
              onClick={(e) => e.preventDefault()}
              draggable={false}
              tabIndex={-1}
            >
              {entry.name}
            </a>
            {entry.isDirectory && <ChevronRight className="h-3 w-3 text-muted-foreground/50 shrink-0 pointer-events-none" />}
          </div>
        ))}
      </div>

      {/* Preview pane */}
      <div className="flex-1 min-w-0 overflow-hidden">
        <InlinePreview entry={selected} />
      </div>
    </div>
  );
}

// ─── VIEW: Tree ───────────────────────────────────────────────────────────────

interface TreeNode {
  entry: FileEntry;
  children?: TreeNode[];
  loaded: boolean;
  expanded: boolean;
}

function TreeNodeRow({
  node,
  depth,
  onToggle,
  onFileClick,
  isSelected,
  onSelect,
  onContextMenu,
}: {
  node: TreeNode;
  depth: number;
  onToggle: (path: string) => void;
  onFileClick: (e: FileEntry) => void;
  isSelected?: boolean;
  onSelect?: (path: string) => void;
  onContextMenu?: (e: React.MouseEvent, entry: FileEntry, dirPath: string) => void;
}) {
  // Count loaded children for directories
  const childCount = node.loaded && node.children ? node.children.length : null;

  const handleContextMenu = onContextMenu
    ? (e: React.MouseEvent) => {
        e.preventDefault();
        const parentDir = node.entry.path.lastIndexOf("/") > 0
          ? node.entry.path.slice(0, node.entry.path.lastIndexOf("/"))
          : "/";
        onContextMenu(e, node.entry, parentDir);
      }
    : undefined;

  return (
    <>
      <button
        onClick={() => {
          if (node.entry.isDirectory) onToggle(node.entry.path);
          else onFileClick(node.entry);
          onSelect?.(node.entry.path);
        }}
        onContextMenu={handleContextMenu}
        className={cn(
          "w-full flex items-center gap-1 px-1 py-0.5 text-xs text-left hover:bg-muted/60 transition-colors rounded focus:outline-none focus:bg-muted/50",
          isSelected && "bg-primary/10 text-primary"
        )}
        style={{ paddingLeft: `${4 + depth * 14}px` }}
      >
        {node.entry.isDirectory ? (
          <ChevronRight
            className={cn("h-3 w-3 shrink-0 text-muted-foreground/60 transition-transform",
              node.expanded && "rotate-90"
            )}
          />
        ) : (
          <span className="w-3 shrink-0" />
        )}
        <FileIcon entry={node.entry} className="h-3.5 w-3.5 shrink-0" />
        <span className={cn("truncate flex-1", node.entry.isDirectory && "font-medium")}>
          {node.entry.name}
        </span>
        {/* Child count badge for directories (only once loaded) */}
        {node.entry.isDirectory && childCount !== null && childCount > 0 && (
          <span className="ml-1 text-[9px] text-muted-foreground/50 shrink-0 bg-muted/60 rounded px-1">
            {childCount}
          </span>
        )}
        {!node.entry.isDirectory && (
          <span className="text-[9px] text-muted-foreground/50 shrink-0">
            {formatDate(node.entry.modified)}
          </span>
        )}
      </button>
      {node.expanded && node.children && (
        node.children.map((child) => (
          <TreeNodeRow
            key={child.entry.path}
            node={child}
            depth={depth + 1}
            onToggle={onToggle}
            onFileClick={onFileClick}
            isSelected={isSelected}
            onSelect={onSelect}
            onContextMenu={onContextMenu}
          />
        ))
      )}
    </>
  );
}

function TreeView({
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  rootPath: _rootPath,
  rootEntries,
  onFileClick,
  onContextMenu,
}: {
  rootPath: string;
  rootEntries: FileEntry[];
  onFileClick: (e: FileEntry) => void;
  onContextMenu?: (e: React.MouseEvent, entry: FileEntry, dirPath: string) => void;
}) {
  const [nodes, setNodes] = useState<TreeNode[]>(() =>
    rootEntries.map((e) => ({ entry: e, loaded: false, expanded: false }))
  );
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  // Refresh root entries when they change
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNodes(rootEntries.map((e) => ({ entry: e, loaded: false, expanded: false })));
  }, [rootEntries]);

  const toggle = useCallback(async (path: string) => {
    setNodes((prev) => {
      const update = (nodes: TreeNode[]): TreeNode[] =>
        nodes.map((n) => {
          if (n.entry.path === path) {
            return { ...n, expanded: !n.expanded };
          }
          if (n.children) return { ...n, children: update(n.children) };
          return n;
        });
      return update(prev);
    });

    // Load children if not yet loaded
    const findNode = (nodes: TreeNode[], p: string): TreeNode | null => {
      for (const n of nodes) {
        if (n.entry.path === p) return n;
        if (n.children) { const found = findNode(n.children, p); if (found) return found; }
      }
      return null;
    };

    const node = findNode(nodes, path);
    if (node && !node.loaded) {
      try {
        const res = await fetch(`/api/files?path=${encodeURIComponent(path)}`);
        const data = await res.json() as DirListing;
        const children: TreeNode[] = (data.entries || []).map((e) => ({
          entry: e,
          loaded: false,
          expanded: false,
        }));
        setNodes((prev) => {
          const update = (ns: TreeNode[]): TreeNode[] =>
            ns.map((n) => {
              if (n.entry.path === path) return { ...n, loaded: true, children };
              if (n.children) return { ...n, children: update(n.children) };
              return n;
            });
          return update(prev);
        });
      } catch { /* ignore */ }
    }
  }, [nodes]);

  return (
    <div className="py-0.5">
      {nodes.map((node) => (
        <TreeNodeRow
          key={node.entry.path}
          node={node}
          depth={0}
          onToggle={toggle}
          onFileClick={onFileClick}
          isSelected={selectedPath === node.entry.path}
          onSelect={setSelectedPath}
          onContextMenu={onContextMenu}
        />
      ))}
    </div>
  );
}

// ─── VIEW: Recent ─────────────────────────────────────────────────────────────

function RecentView({
  onFileClick,
  onOpenParent,
}: {
  onFileClick: (entry: FileEntry) => void;
  onOpenParent: (dirPath: string) => void;
}) {
  const [recent, setRecent] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [hoveredPath, setHoveredPath] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/files?recent=1&root=~&limit=60`);
        const data = await res.json();
        setRecent(data.results || []);
      } catch { setRecent([]); }
      setLoading(false);
    })();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <div className="h-4 w-4 border-2 border-muted-foreground/30 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  // Group by date
  const grouped = new Map<string, FileEntry[]>();
  for (const f of recent) {
    const label = formatDate(f.modified);
    if (!grouped.has(label)) grouped.set(label, []);
    grouped.get(label)!.push(f);
  }

  return (
    <div className="space-y-0">
      {[...grouped.entries()].map(([label, files]) => (
        <div key={label}>
          <div className="flex items-center gap-1.5 px-2 py-1 text-[10px] text-muted-foreground font-medium uppercase tracking-wider sticky top-0 bg-background/90 backdrop-blur-sm">
            <Clock className="h-2.5 w-2.5" />
            {label}
          </div>
          {files.map((f) => {
            const parentDir = f.path.substring(0, f.path.lastIndexOf("/"));
            return (
              <div
                key={f.path}
                className="group flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-muted/60 transition-colors"
                onMouseEnter={() => setHoveredPath(f.path)}
                onMouseLeave={() => setHoveredPath(null)}
              >
                <button
                  onClick={() => onFileClick(f)}
                  className="flex items-center gap-2 flex-1 min-w-0 text-left"
                >
                  <FileIcon entry={f} className="h-3.5 w-3.5 shrink-0" />
                  <span className="flex-1 truncate">{f.name}</span>
                </button>
                <span className="text-[9px] text-muted-foreground/60 shrink-0 truncate max-w-[100px] hidden group-hover:hidden">
                  {shortenPath(parentDir)}
                </span>
                {hoveredPath === f.path && (
                  <button
                    onClick={() => onOpenParent(parentDir)}
                    title={`Open ${shortenPath(parentDir)}`}
                    className="shrink-0 flex items-center gap-1 text-[9px] text-muted-foreground hover:text-primary transition-colors px-1 py-0.5 rounded hover:bg-muted"
                  >
                    <FolderOpenDot className="h-3 w-3" />
                    <span className="truncate max-w-[90px]">{shortenPath(parentDir)}</span>
                  </button>
                )}
              </div>
            );
          })}
        </div>
      ))}
      {recent.length === 0 && (
        <div className="flex items-center justify-center h-full text-muted-foreground text-xs py-8">
          No recent files found
        </div>
      )}
    </div>
  );
}

// ─── View mode toolbar ────────────────────────────────────────────────────────

const VIEW_MODES: { id: ViewMode; icon: React.ComponentType<{ className?: string }>; label: string }[] = [
  { id: "list",    icon: LayoutList,           label: "List" },
  { id: "grid",    icon: LayoutGrid,           label: "Grid" },
  { id: "columns", icon: Columns2,             label: "Columns" },
  { id: "gallery", icon: GalleryHorizontalEnd, label: "Gallery" },
  { id: "tree",    icon: TreePine,             label: "Tree" },
  { id: "recent",  icon: Clock,               label: "Recent" },
];

function ViewToggle({ view, onChange }: { view: ViewMode; onChange: (v: ViewMode) => void }) {
  return (
    <div className="flex items-center gap-0.5 border border-border rounded-md p-0.5 bg-muted/30">
      {VIEW_MODES.map(({ id, icon: Icon, label }) => (
        <button
          key={id}
          onClick={() => onChange(id)}
          title={label}
          className={cn(
            "p-1 rounded transition-colors",
            view === id
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <Icon className="h-3 w-3" />
        </button>
      ))}
    </div>
  );
}

// ─── localStorage persistence ─────────────────────────────────────────────────

const STORAGE_KEY = "files-widget-view-mode";

function loadViewMode(): ViewMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v && VIEW_MODES.some((m) => m.id === v)) return v as ViewMode;
  } catch { /* ignore */ }
  return "list";
}

function saveViewMode(v: ViewMode) {
  try { localStorage.setItem(STORAGE_KEY, v); } catch { /* ignore */ }
}

// ─── VPS Types ──────────────────────────────────────────────────────────────

interface VpsConnection {
  id: string;
  label: string;
  host: string;
  port: number;
  username: string;
  keyPath: string;
  defaultPath: string;
  createdAt: string;
}

/** Source descriptor: either local filesystem or a VPS connection */
type PaneSource = { type: "local" } | { type: "vps"; connectionId: string; connection: VpsConnection };

// ─── VPS Connection Dialog ──────────────────────────────────────────────────

function VpsConnectionDialog({
  connections,
  onClose,
  onSaved,
  editingConn,
}: {
  connections: VpsConnection[];
  onClose: () => void;
  onSaved: () => void;
  editingConn?: VpsConnection | null;
}) {
  const [label, setLabel] = useState(editingConn?.label || "");
  const [host, setHost] = useState(editingConn?.host || "");
  const [port, setPort] = useState(String(editingConn?.port || 22));
  const [username, setUsername] = useState(editingConn?.username || "");
  const [keyPath, setKeyPath] = useState(editingConn?.keyPath || "~/.ssh/id_rsa");
  const [defaultPath, setDefaultPath] = useState(editingConn?.defaultPath || "");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const testConnection = async () => {
    setTesting(true); setTestResult(null);
    try {
      const res = await fetch("/api/vps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "test-connection", host, port: parseInt(port, 10), username, keyPath }),
      });
      const data = await res.json();
      setTestResult({ success: data.success, message: data.success ? `Connected: ${data.output}` : data.error });
    } catch (err) {
      setTestResult({ success: false, message: err instanceof Error ? err.message : "Failed" });
    }
    setTesting(false);
  };

  const saveConnection = async () => {
    if (!host || !username || !keyPath) return;
    setSaving(true);
    try {
      const action = editingConn ? "update-connection" : "add-connection";
      const payload: Record<string, unknown> = {
        action,
        label: label || `${username}@${host}`,
        host,
        port: parseInt(port, 10),
        username,
        keyPath,
        defaultPath: defaultPath || `/home/${username}`,
      };
      if (editingConn) payload.id = editingConn.id;

      await fetch("/api/vps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      onSaved();
      onClose();
    } catch { /* ignore */ }
    setSaving(false);
  };

  const field = (label: string, value: string, onChange: (v: string) => void, placeholder: string) => (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-muted-foreground w-16 shrink-0 text-right">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="flex-1 text-xs bg-muted/40 border border-border rounded px-2 py-1 outline-none focus:ring-1 focus:ring-primary/50 font-mono"
      />
    </div>
  );

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-popover border border-border rounded-lg shadow-xl p-4 min-w-[340px] max-w-[440px] space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium flex items-center gap-2">
            <Server className="h-4 w-4" />
            {editingConn ? "Edit VPS Connection" : "New VPS Connection"}
          </span>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-0.5 rounded hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-2">
          {field("Label", label, setLabel, "My VPS")}
          {field("Host", host, setHost, "192.168.1.100 or vps.example.com")}
          {field("Port", port, setPort, "22")}
          {field("User", username, setUsername, "root")}
          {field("SSH Key", keyPath, setKeyPath, "~/.ssh/id_rsa")}
          {field("Path", defaultPath, setDefaultPath, "/home/user")}
        </div>

        {testResult && (
          <div className={cn("text-xs px-2 py-1 rounded", testResult.success ? "bg-green-500/10 text-green-600" : "bg-red-500/10 text-red-500")}>
            {testResult.message}
          </div>
        )}

        <div className="flex items-center justify-between pt-1">
          <button
            onClick={testConnection}
            disabled={testing || !host || !username || !keyPath}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-muted hover:bg-muted/80 transition-colors disabled:opacity-40"
          >
            {testing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wifi className="h-3 w-3" />}
            Test
          </button>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="text-xs px-3 py-1.5 rounded-md text-muted-foreground hover:text-foreground transition-colors">
              Cancel
            </button>
            <button
              onClick={saveConnection}
              disabled={saving || !host || !username || !keyPath}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40"
            >
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
              Save
            </button>
          </div>
        </div>

        {/* Existing connections list */}
        {connections.length > 0 && !editingConn && (
          <div className="border-t border-border pt-2 mt-2">
            <div className="text-[10px] text-muted-foreground mb-1">Saved Connections</div>
            {connections.map((c) => (
              <div key={c.id} className="flex items-center gap-2 py-1 text-xs">
                <Server className="h-3 w-3 text-muted-foreground shrink-0" />
                <span className="truncate flex-1">{c.label}</span>
                <span className="text-[9px] text-muted-foreground/60">{c.host}:{c.port}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

// ─── Mini Explorer Pane (for dual-pane mode) ─────────────────────────────────

type MiniViewMode = "list" | "grid";

function MiniExplorerPane({
  source,
  onDragStartEntry,
  onDropEntry,
  vpsConnections,
  onChangeSource,
  onOpenVpsDialog,
  initialPath,
}: {
  source: PaneSource;
  onDragStartEntry: (e: React.DragEvent, entry: FileEntry, source: PaneSource, currentPath: string) => void;
  onDropEntry: (targetSource: PaneSource, targetPath: string) => void;
  vpsConnections: VpsConnection[];
  onChangeSource: (source: PaneSource) => void;
  onOpenVpsDialog: () => void;
  initialPath?: string;
}) {
  const [currentPath, setCurrentPath] = useState(() =>
    initialPath || (source.type === "vps" ? source.connection.defaultPath : "~")
  );
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [parentPath, setParentPath] = useState("");
  const [resolvedPath, setResolvedPath] = useState("");
  const [showHidden, setShowHidden] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [miniView, setMiniView] = useState<MiniViewMode>("list");
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; entry: FileEntry } | null>(null);
  const ctxMenuRef = useRef<HTMLDivElement>(null);

  // Reset path when source changes
  const sourceKey = source.type === "vps" ? source.connectionId : "local";
  useEffect(() => {
    const newPath = source.type === "vps" ? source.connection.defaultPath : "~";
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCurrentPath(newPath);
  }, [sourceKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchDir = useCallback(async (dirPath: string) => {
    setLoading(true);
    setError(null);

    try {
      if (source.type === "vps") {
        const res = await fetch(`/api/vps?action=list&id=${source.connectionId}&path=${encodeURIComponent(dirPath)}`);
        const data = await res.json();
        if (data.error) { setError(data.error); setEntries([]); }
        else {
          setEntries(data.entries || []);
          setParentPath(data.parent || "/");
          setResolvedPath(data.path || dirPath);
          setCurrentPath(data.path || dirPath);
        }
      } else {
        const res = await fetch(`/api/files?path=${encodeURIComponent(dirPath)}`);
        const data = await res.json();
        if (data.error || data.permissionDenied) { setError(data.error || "Permission denied"); setEntries([]); }
        else {
          setEntries(data.entries || []);
          setParentPath(data.parent || "");
          setResolvedPath(data.path || dirPath);
          setCurrentPath(data.path || dirPath);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    }
    setLoading(false);
  }, [source]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchDir(currentPath);
  }, [currentPath]); // eslint-disable-line react-hooks/exhaustive-deps

  const goUp = useCallback(() => {
    if (source.type === "vps") {
      const parent = currentPath === "/" ? "/" : currentPath.replace(/\/[^/]+\/?$/, "") || "/";
      fetchDir(parent);
    } else if (parentPath) {
      fetchDir(parentPath);
    }
  }, [source, currentPath, parentPath, fetchDir]);

  const goHome = useCallback(() => {
    if (source.type === "vps") {
      fetchDir(source.connection.defaultPath);
    } else {
      fetchDir("~");
    }
  }, [source, fetchDir]);

  const handleFileClick = useCallback((entry: FileEntry) => {
    if (entry.isDirectory) {
      fetchDir(entry.path);
    }
  }, [fetchDir]);

  const filteredEntries = useMemo(() => {
    const filtered = showHidden ? entries : entries.filter((e) => !e.name.startsWith("."));
    return sortFileEntries(filtered, sortField, sortDir);
  }, [entries, showHidden, sortField, sortDir]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => setDragOver(false), []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    onDropEntry(source, resolvedPath);
  }, [source, resolvedPath, onDropEntry]);

  const shortenRemote = (p: string) => {
    if (source.type === "vps") return p;
    return shortenPath(p);
  };

  // Context menu actions
  const handleDelete = useCallback(async (entry: FileEntry) => {
    if (!confirm(`Delete "${entry.name}"?`)) return;
    try {
      if (source.type === "vps") {
        await fetch("/api/vps", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "delete", id: (source as { connectionId: string }).connectionId, path: entry.path }),
        });
      } else {
        await fetch("/api/files", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "delete", path: entry.path }),
        });
      }
      fetchDir(resolvedPath || currentPath);
    } catch { /* ignore */ }
  }, [source, resolvedPath, currentPath, fetchDir]);

  const handleCopyPath = useCallback((entry: FileEntry) => {
    navigator.clipboard.writeText(entry.path).catch(() => {});
  }, []);

  // Close context menu on outside click / Escape
  useEffect(() => {
    if (!ctxMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (ctxMenuRef.current && !ctxMenuRef.current.contains(e.target as Node)) setCtxMenu(null);
    };
    const handleKey = (e: KeyboardEvent) => { if (e.key === "Escape") setCtxMenu(null); };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => { document.removeEventListener("mousedown", handleClick); document.removeEventListener("keydown", handleKey); };
  }, [ctxMenu]);

  const cycleSortField = useCallback(() => {
    const fields: SortField[] = ["name", "size", "modified", "type"];
    const idx = fields.indexOf(sortField);
    setSortField(fields[(idx + 1) % fields.length]);
  }, [sortField]);

  return (
    <div
      className={cn(
        "flex flex-col h-full border border-border rounded-md overflow-hidden transition-all",
        dragOver && "ring-2 ring-primary ring-offset-1 bg-primary/5"
      )}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Pane header: source selector + controls */}
      <div className="flex items-center gap-1 px-1.5 py-1 bg-muted/30 border-b border-border shrink-0">
        <select
          value={source.type === "vps" ? source.connectionId : "local"}
          onChange={(e) => {
            const val = e.target.value;
            if (val === "local") onChangeSource({ type: "local" });
            else if (val === "__add__") onOpenVpsDialog();
            else {
              const conn = vpsConnections.find((c) => c.id === val);
              if (conn) onChangeSource({ type: "vps", connectionId: val, connection: conn });
            }
          }}
          className="text-[10px] bg-muted/50 border border-border rounded px-1 py-0.5 outline-none min-w-0 flex-1 truncate"
        >
          <option value="local">Local</option>
          {vpsConnections.map((c) => (
            <option key={c.id} value={c.id}>{c.label}</option>
          ))}
          <option value="__add__">+ Add VPS...</option>
        </select>

        {source.type === "vps" && (
          <Wifi className="h-3 w-3 text-green-500 shrink-0" />
        )}

        {/* Sort toggle */}
        <button
          onClick={cycleSortField}
          className="p-0.5 rounded text-muted-foreground hover:text-foreground shrink-0"
          title={`Sort: ${sortField}`}
        >
          <ArrowDownAZ className="h-3 w-3" />
        </button>
        <button
          onClick={() => setSortDir(d => d === "asc" ? "desc" : "asc")}
          className="p-0.5 rounded text-muted-foreground hover:text-foreground shrink-0"
          title={sortDir === "asc" ? "Ascending" : "Descending"}
        >
          {sortDir === "asc" ? <ArrowDownAZ className="h-2.5 w-2.5" /> : <ArrowUpAZ className="h-2.5 w-2.5" />}
        </button>

        {/* View mode toggle */}
        <button
          onClick={() => setMiniView(v => v === "list" ? "grid" : "list")}
          className="p-0.5 rounded text-muted-foreground hover:text-foreground shrink-0"
          title={miniView === "list" ? "Grid view" : "List view"}
        >
          {miniView === "list" ? <LayoutGrid className="h-3 w-3" /> : <LayoutList className="h-3 w-3" />}
        </button>

        <button onClick={() => setShowHidden(!showHidden)} className={cn("p-0.5 rounded shrink-0", showHidden ? "text-foreground" : "text-muted-foreground hover:text-foreground")} title="Hidden files">
          {showHidden ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
        </button>
        <button onClick={() => fetchDir(resolvedPath || currentPath)} className="text-muted-foreground hover:text-foreground p-0.5 rounded shrink-0">
          <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} />
        </button>
      </div>

      {/* Breadcrumb */}
      <div className="flex items-center gap-1 px-1.5 py-0.5 shrink-0 bg-muted/10 border-b border-border/50">
        <button onClick={goUp} disabled={resolvedPath === "/" && source.type === "vps"} className="text-muted-foreground hover:text-foreground p-0.5 rounded hover:bg-muted disabled:opacity-30 shrink-0">
          <ArrowUp className="h-3 w-3" />
        </button>
        <button onClick={goHome} className="text-muted-foreground hover:text-foreground p-0.5 rounded hover:bg-muted shrink-0">
          <Home className="h-3 w-3" />
        </button>
        <span className="text-[9px] text-muted-foreground truncate flex-1" title={resolvedPath}>
          {shortenRemote(resolvedPath || currentPath)}
        </span>
        <span className="text-[8px] text-muted-foreground/40 shrink-0">{sortField}</span>
      </div>

      {/* File list / grid */}
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-full gap-1 text-muted-foreground px-2 text-center">
            <WifiOff className="h-5 w-5 text-red-400" />
            <span className="text-[10px]">{error}</span>
            <button onClick={() => fetchDir(currentPath)} className="text-[10px] text-primary hover:underline">Retry</button>
          </div>
        ) : filteredEntries.length === 0 ? (
          <div className="flex items-center justify-center h-full text-muted-foreground text-xs">
            Empty directory
          </div>
        ) : miniView === "grid" ? (
          <div className="grid grid-cols-3 gap-1 p-1.5">
            {filteredEntries.map((entry) => (
              <div
                key={entry.path}
                draggable
                onDragStart={(e) => { e.stopPropagation(); onDragStartEntry(e, entry, source, resolvedPath); }}
                onClick={() => handleFileClick(entry)}
                onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setCtxMenu({ x: e.clientX, y: e.clientY, entry }); }}
                className="flex flex-col items-center gap-0.5 p-1.5 rounded-md hover:bg-muted/60 cursor-grab active:cursor-grabbing transition-colors"
              >
                <FileIcon entry={entry} className="h-6 w-6 shrink-0 pointer-events-none" />
                <span className={cn("text-[9px] text-center truncate w-full", entry.isDirectory && "font-medium")}>
                  {entry.name}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-0">
            {filteredEntries.map((entry) => (
              <div
                key={entry.path}
                draggable
                onDragStart={(e) => {
                  e.stopPropagation();
                  onDragStartEntry(e, entry, source, resolvedPath);
                }}
                onClick={() => handleFileClick(entry)}
                onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setCtxMenu({ x: e.clientX, y: e.clientY, entry }); }}
                className="group flex items-center gap-2 px-2 py-1 hover:bg-muted/60 transition-colors cursor-grab active:cursor-grabbing"
              >
                <FileIcon entry={entry} className="h-3.5 w-3.5 shrink-0 pointer-events-none" />
                <span className={cn("flex-1 text-xs truncate", entry.isDirectory && "font-medium")}>
                  {entry.name}
                </span>
                {!entry.isDirectory && (
                  <span className="text-[9px] text-muted-foreground/50 shrink-0">{formatSize(entry.size)}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Context menu */}
      {ctxMenu && createPortal(
        <div
          ref={ctxMenuRef}
          style={{ position: "fixed", left: ctxMenu.x, top: ctxMenu.y, zIndex: 9999 }}
          className="min-w-[140px] bg-popover border border-border rounded-lg shadow-xl py-1 overflow-hidden"
        >
          <div className="px-3 py-1 text-[9px] text-muted-foreground/60 uppercase tracking-wider truncate border-b border-border mb-1">
            {ctxMenu.entry.name}
          </div>
          <button onClick={() => { handleCopyPath(ctxMenu.entry); setCtxMenu(null); }} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-muted/70">
            <ClipboardCopy className="h-3.5 w-3.5 shrink-0" /> Copy Path
          </button>
          <div className="border-t border-border my-1" />
          <button onClick={() => { handleDelete(ctxMenu.entry); setCtxMenu(null); }} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-red-500 hover:text-red-400 hover:bg-muted/70">
            <Trash2 className="h-3.5 w-3.5 shrink-0" /> Delete
          </button>
        </div>,
        document.body
      )}

      {/* Status bar */}
      <div className="shrink-0 text-[9px] text-muted-foreground/60 flex items-center justify-between px-1.5 py-0.5 border-t border-border bg-muted/10">
        <span>{filteredEntries.length} items</span>
        {source.type === "vps" && (
          <span className="flex items-center gap-1">
            <Server className="h-2.5 w-2.5" />
            {source.connection.host}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Dual Pane Explorer ──────────────────────────────────────────────────────

function DualPaneExplorer({
  vpsConnections,
  onOpenVpsDialog,
  initialLeftPath,
}: {
  vpsConnections: VpsConnection[];
  onOpenVpsDialog: () => void;
  initialLeftPath?: string;
}) {
  const [leftSource, setLeftSource] = useState<PaneSource>({ type: "local" });
  const [rightSource, setRightSource] = useState<PaneSource>(() => {
    // Default right pane to first VPS if available, otherwise local
    if (vpsConnections.length > 0) {
      return { type: "vps", connectionId: vpsConnections[0].id, connection: vpsConnections[0] };
    }
    return { type: "local" };
  });

  // Update right source when connections load
  const vpsCount = vpsConnections.length;
  useEffect(() => {
    if (rightSource.type === "local" && vpsCount > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRightSource({ type: "vps", connectionId: vpsConnections[0].id, connection: vpsConnections[0] });
    }
  }, [vpsCount]); // eslint-disable-line react-hooks/exhaustive-deps

  // Drag state for cross-pane operations
  const dragRef = useRef<{
    entry: FileEntry;
    source: PaneSource;
    sourcePath: string;
  } | null>(null);

  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const [copying, setCopying] = useState(false);

  const handleDragStartEntry = useCallback((e: React.DragEvent, entry: FileEntry, source: PaneSource, currentPath: string) => {
    dragRef.current = { entry, source, sourcePath: currentPath };
    e.dataTransfer.setData("text/plain", entry.name);
    e.dataTransfer.setData("application/x-file-path", entry.path);
    e.dataTransfer.setData("application/x-is-directory", entry.isDirectory ? "1" : "0");
    e.dataTransfer.setData("application/x-pane-source", JSON.stringify(source));
    e.dataTransfer.effectAllowed = "copy";
  }, []);

  const handleDropEntry = useCallback(async (targetSource: PaneSource, targetPath: string) => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;

    const { entry, source: srcSource } = drag;
    setCopying(true);
    setCopyStatus(null);

    try {
      // Determine the copy operation type
      const srcIsLocal = srcSource.type === "local";
      const dstIsLocal = targetSource.type === "local";
      const destPath = targetPath.replace(/\/$/, "") + "/" + entry.name;

      if (srcIsLocal && dstIsLocal) {
        // Local → Local copy
        const res = await fetch("/api/vps", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "local-copy", from: entry.path, to: destPath }),
        });
        const data = await res.json();
        if (data.error) setCopyStatus(`Error: ${data.error}`);
        else setCopyStatus(`Copied ${entry.name}`);
      } else if (srcIsLocal && !dstIsLocal) {
        // Local → Remote (scp upload)
        const vps = targetSource as { type: "vps"; connectionId: string; connection: VpsConnection };
        const res = await fetch("/api/vps", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "copy-to-remote",
            id: vps.connectionId,
            localPath: entry.path,
            remotePath: targetPath,
          }),
        });
        const data = await res.json();
        if (data.error) setCopyStatus(`Error: ${data.error}`);
        else setCopyStatus(`Uploaded ${entry.name}`);
      } else if (!srcIsLocal && dstIsLocal) {
        // Remote → Local (scp download)
        const vps = srcSource as { type: "vps"; connectionId: string; connection: VpsConnection };
        const res = await fetch("/api/vps", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "copy-from-remote",
            id: vps.connectionId,
            remotePath: entry.path,
            localPath: destPath,
          }),
        });
        const data = await res.json();
        if (data.error) setCopyStatus(`Error: ${data.error}`);
        else setCopyStatus(`Downloaded ${entry.name}`);
      } else {
        // Remote → Remote (not supported yet)
        setCopyStatus("Remote-to-remote copy not supported");
      }
    } catch (err) {
      setCopyStatus(`Error: ${err instanceof Error ? err.message : "Copy failed"}`);
    }

    setCopying(false);
    setTimeout(() => setCopyStatus(null), 4000);
  }, []);

  return (
    <div className="flex flex-col h-full gap-1">
      {/* Transfer status banner */}
      {(copying || copyStatus) && (
        <div className={cn(
          "flex items-center gap-2 px-2 py-1 rounded-md text-xs shrink-0",
          copying ? "bg-primary/10 text-primary" : copyStatus?.includes("Error") ? "bg-red-500/10 text-red-500" : "bg-green-500/10 text-green-500"
        )}>
          {copying ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" />
              <span>Copying...</span>
            </>
          ) : (
            <>
              {copyStatus?.includes("Error") ? <X className="h-3 w-3" /> : <Check className="h-3 w-3" />}
              <span>{copyStatus}</span>
            </>
          )}
        </div>
      )}

      {/* Dual pane */}
      <div className="flex-1 min-h-0 flex gap-1">
        <div className="flex-1 min-w-0">
          <MiniExplorerPane
            source={leftSource}
            onDragStartEntry={handleDragStartEntry}
            onDropEntry={handleDropEntry}
            vpsConnections={vpsConnections}
            onChangeSource={setLeftSource}
            onOpenVpsDialog={onOpenVpsDialog}
            initialPath={initialLeftPath}
          />
        </div>

        {/* Drag indicator */}
        <div className="flex items-center justify-center shrink-0 w-5">
          <ArrowLeftRight className="h-3.5 w-3.5 text-muted-foreground/40" />
        </div>

        <div className="flex-1 min-w-0">
          <MiniExplorerPane
            source={rightSource}
            onDragStartEntry={handleDragStartEntry}
            onDropEntry={handleDropEntry}
            vpsConnections={vpsConnections}
            onChangeSource={setRightSource}
            onOpenVpsDialog={onOpenVpsDialog}
          />
        </div>
      </div>

      <div className="shrink-0 text-[9px] text-muted-foreground/50 text-center">
        Drag files between panes to copy • Supports local ↔ VPS transfers
      </div>
    </div>
  );
}

// ─── VS Code Full Layout ─────────────────────────────────────────────────────

type VscodeSidebarPanel = "explorer" | "scripts" | "sourceControl" | "search" | "database";

interface VscodeOpenFile {
  name: string;
  path: string;
  extension: string;
  content: string;
  dirty: boolean;
}

// ─── Database Explorer Panel ─────────────────────────────────────────────────

interface DbConnectionInfo {
  id: string;
  label: string;
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  ssl: boolean;
}

interface DbColumn {
  name: string;
  type: string;
  nullable: boolean;
  default: string | null;
  maxLength: number | null;
}

interface DbTable {
  name: string;
  type: "table" | "view";
}

// ─── DB Preview Table ────────────────────────────────────────────────────────

function DbPreviewTable({ content }: { content: string }) {
  const data = useMemo(() => {
    try { return JSON.parse(content); }
    catch { return null; }
  }, [content]);

  if (!data || !data.__dbPreview) {
    return <div className="p-4 text-muted-foreground text-sm">Invalid preview data</div>;
  }

  const { columns, rows, table, rowCount } = data as { columns: string[]; rows: Record<string, unknown>[]; table: string; rowCount: number };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 bg-muted/30 border-b border-border">
        <Table2 className="h-3.5 w-3.5 text-green-500" />
        <span className="text-[11px] font-medium">{table}</span>
        <span className="text-[10px] text-muted-foreground">({rowCount} rows)</span>
      </div>
      <div className="flex-1 min-h-0 overflow-auto">
        <table className="w-full text-[11px] border-collapse">
          <thead className="sticky top-0 bg-muted/80 backdrop-blur-sm">
            <tr>
              {columns.map((col) => (
                <th key={col} className="text-left px-2 py-1 border-b border-border font-medium text-foreground whitespace-nowrap">
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="hover:bg-muted/40 transition-colors border-b border-border/50">
                {columns.map((col) => (
                  <td key={col} className="px-2 py-0.5 whitespace-nowrap max-w-[200px] truncate font-mono text-[10px]" title={String(row[col] ?? "")}>
                    {row[col] === null ? <span className="text-muted-foreground/40 italic">NULL</span> : String(row[col])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && (
          <div className="text-center text-muted-foreground text-xs py-8">No rows</div>
        )}
      </div>
    </div>
  );
}

// ─── DB Query Editor ─────────────────────────────────────────────────────────

function DbQueryEditor({
  connId,
  initialSql,
  onSqlChange,
}: {
  connId: string;
  initialSql: string;
  onSqlChange: (sql: string) => void;
}) {
  const { resolvedTheme } = useTheme();
  const [sql, setSql] = useState(initialSql);
  const [results, setResults] = useState<{ columns: string[]; rows: Record<string, unknown>[]; rowCount: number; command: string; duration: number } | null>(null);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const runQuery = useCallback(async (queryText?: string) => {
    const toRun = queryText || sql;
    if (!toRun.trim()) return;
    setRunning(true); setQueryError(null); setResults(null);
    try {
      const res = await fetch("/api/database", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "query", id: connId, sql: toRun }),
      });
      const data = await res.json();
      if (data.error) setQueryError(data.error);
      else setResults(data);
    } catch (err) {
      setQueryError(err instanceof Error ? err.message : "Query failed");
    }
    setRunning(false);
  }, [sql, connId]);

  const handleSqlChange = useCallback((value: string) => {
    setSql(value);
    onSqlChange(value);
  }, [onSqlChange]);

  const [aiPrompt, setAiPrompt] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const aiAbortRef = useRef<AbortController | null>(null);

  const generateSql = useCallback(async () => {
    if (!aiPrompt.trim()) return;
    aiAbortRef.current?.abort();
    const controller = new AbortController();
    aiAbortRef.current = controller;
    setAiLoading(true);
    try {
      const res = await fetch("/api/database", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "generate-sql", id: connId, prompt: aiPrompt }),
        signal: controller.signal,
      });
      const data = await res.json();
      if (data.sql) {
        setSql(data.sql);
        onSqlChange(data.sql);
        setAiPrompt("");
      } else if (data.error) {
        setQueryError(data.error);
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setQueryError(err instanceof Error ? err.message : "AI generation failed");
      }
    }
    setAiLoading(false);
  }, [aiPrompt, connId, onSqlChange]);

  const stopGenerate = useCallback(() => {
    aiAbortRef.current?.abort();
    setAiLoading(false);
  }, []);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* AI Natural Language Input */}
      <div className="shrink-0 flex items-center gap-1.5 px-2 py-1.5 bg-muted/30 border-b border-border">
        <Zap className="h-3.5 w-3.5 text-amber-500 shrink-0" />
        <input
          type="text"
          value={aiPrompt}
          onChange={(e) => setAiPrompt(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); generateSql(); } }}
          placeholder="Ask in natural language... (e.g. &quot;show all users created this week&quot;)"
          className="flex-1 text-[11px] bg-transparent border-none outline-none placeholder:text-muted-foreground/50"
        />
        {aiLoading ? (
          <button
            onClick={stopGenerate}
            className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-500/20 border border-red-500/20 transition-colors"
          >
            <Ban className="h-3 w-3" />
            Stop
          </button>
        ) : (
          <button
            onClick={generateSql}
            disabled={!aiPrompt.trim()}
            className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 border border-amber-500/20 transition-colors disabled:opacity-40"
          >
            <Zap className="h-3 w-3" />
            Generate
          </button>
        )}
      </div>

      {/* SQL Editor */}
      <div className="flex-[2] min-h-[100px] border-b border-border relative">
        <Editor
          height="100%"
          language="sql"
          value={sql}
          theme={resolvedTheme === "light" ? "light" : "vs-dark"}
          options={{
            minimap: { enabled: false },
            fontSize: 12,
            lineNumbers: "on",
            wordWrap: "on",
            scrollBeyondLastLine: false,
            automaticLayout: true,
            tabSize: 2,
            padding: { top: 8 },
          }}
          onChange={(v) => handleSqlChange(v || "")}
          onMount={(editor, monaco) => {
            // Ctrl+Enter / Cmd+Enter to run query
            editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
              runQuery(editor.getValue());
            });
          }}
        />
        {/* Run button */}
        <div className="absolute top-1 right-2 z-10">
          <button
            onClick={() => runQuery()}
            disabled={running || !sql.trim()}
            className="flex items-center gap-1 px-2 py-1 text-[10px] rounded-md bg-green-500/10 text-green-600 dark:text-green-400 hover:bg-green-500/20 border border-green-500/20 transition-colors disabled:opacity-40"
            title="Run query (Cmd+Enter)"
          >
            {running ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
            Run
          </button>
        </div>
      </div>

      {/* Results */}
      <div className="flex-[3] min-h-0 overflow-hidden flex flex-col">
        {queryError && (
          <div className="shrink-0 px-3 py-2 bg-red-500/10 text-red-500 text-[11px] border-b border-border">
            {queryError}
          </div>
        )}
        {results && (
          <>
            <div className="shrink-0 flex items-center gap-2 px-3 py-1 bg-muted/30 border-b border-border text-[10px] text-muted-foreground">
              <span className="font-medium text-foreground">{results.command}</span>
              <span>{results.rowCount} row{results.rowCount !== 1 ? "s" : ""}</span>
              <span>{results.duration}ms</span>
            </div>
            <div className="flex-1 min-h-0 overflow-auto">
              {results.columns.length > 0 ? (
                <table className="w-full text-[11px] border-collapse">
                  <thead className="sticky top-0 bg-muted/80 backdrop-blur-sm">
                    <tr>
                      {results.columns.map((col) => (
                        <th key={col} className="text-left px-2 py-1 border-b border-border font-medium text-foreground whitespace-nowrap">
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {results.rows.map((row, i) => (
                      <tr key={i} className="hover:bg-muted/40 transition-colors border-b border-border/50">
                        {results.columns.map((col) => (
                          <td key={col} className="px-2 py-0.5 whitespace-nowrap max-w-[200px] truncate font-mono text-[10px]" title={String(row[col] ?? "")}>
                            {row[col] === null ? <span className="text-muted-foreground/40 italic">NULL</span> : String(row[col])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="text-center text-muted-foreground text-xs py-4">
                  Query executed successfully ({results.rowCount} row{results.rowCount !== 1 ? "s" : ""} affected)
                </div>
              )}
            </div>
          </>
        )}
        {!results && !queryError && !running && (
          <div className="flex items-center justify-center h-full text-muted-foreground text-xs">
            Press Cmd+Enter or click Run to execute
          </div>
        )}
        {running && (
          <div className="flex items-center justify-center h-full gap-2 text-muted-foreground text-xs">
            <Loader2 className="h-4 w-4 animate-spin" />
            Running query...
          </div>
        )}
      </div>
    </div>
  );
}

function VscodeDatabasePanel({
  onOpenQueryTab,
  onPreviewTable,
}: {
  onOpenQueryTab: (connId: string, connLabel: string) => void;
  onPreviewTable: (connId: string, schema: string, table: string) => void;
}) {
  const [connections, setConnections] = useState<DbConnectionInfo[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [expandedConn, setExpandedConn] = useState<string | null>(null);
  const [schemas, setSchemas] = useState<Record<string, string[]>>({});
  const [expandedSchema, setExpandedSchema] = useState<string | null>(null);
  const [tables, setTables] = useState<Record<string, DbTable[]>>({});
  const [expandedTable, setExpandedTable] = useState<string | null>(null);
  const [columns, setColumns] = useState<Record<string, DbColumn[]>>({});
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // New connection form
  const [formLabel, setFormLabel] = useState("");
  const [formHost, setFormHost] = useState("localhost");
  const [formPort, setFormPort] = useState("5432");
  const [formDatabase, setFormDatabase] = useState("postgres");
  const [formUsername, setFormUsername] = useState("postgres");
  const [formPassword, setFormPassword] = useState("");
  const [formSsl, setFormSsl] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  const fetchConnections = useCallback(async () => {
    try {
      const res = await fetch("/api/database?action=connections");
      const data = await res.json();
      setConnections(data.connections || []);
    } catch { setConnections([]); }
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { fetchConnections(); }, [fetchConnections]);

  const testConnection = async () => {
    setTesting(true); setTestResult(null);
    try {
      const res = await fetch("/api/database", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "test-connection", host: formHost, port: formPort, database: formDatabase, username: formUsername, password: formPassword, ssl: formSsl }),
      });
      const data = await res.json();
      setTestResult({ success: data.success, message: data.success ? data.version : data.error });
    } catch (err) {
      setTestResult({ success: false, message: err instanceof Error ? err.message : "Failed" });
    }
    setTesting(false);
  };

  const saveConnection = async () => {
    try {
      await fetch("/api/database", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "add-connection",
          label: formLabel || `${formUsername}@${formHost}/${formDatabase}`,
          host: formHost, port: formPort, database: formDatabase,
          username: formUsername, password: formPassword, ssl: formSsl,
        }),
      });
      setShowAddForm(false);
      setFormLabel(""); setFormHost("localhost"); setFormPort("5432");
      setFormDatabase("postgres"); setFormUsername("postgres"); setFormPassword("");
      setTestResult(null);
      fetchConnections();
    } catch { /* ignore */ }
  };

  const deleteConnection = async (id: string) => {
    if (!confirm("Delete this connection?")) return;
    await fetch("/api/database", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete-connection", id }),
    });
    fetchConnections();
    if (expandedConn === id) setExpandedConn(null);
  };

  const loadSchemas = async (connId: string) => {
    if (expandedConn === connId) { setExpandedConn(null); return; }
    setExpandedConn(connId);
    setExpandedSchema(null); setExpandedTable(null);
    setLoading(connId); setError(null);
    try {
      const res = await fetch(`/api/database?action=schemas&id=${connId}`);
      const data = await res.json();
      if (data.error) { setError(data.error); }
      else setSchemas((prev) => ({ ...prev, [connId]: data.schemas }));
    } catch (err) { setError(err instanceof Error ? err.message : "Failed"); }
    setLoading(null);
  };

  const loadTables = async (connId: string, schema: string) => {
    const key = `${connId}:${schema}`;
    if (expandedSchema === key) { setExpandedSchema(null); return; }
    setExpandedSchema(key); setExpandedTable(null);
    setLoading(key);
    try {
      const res = await fetch(`/api/database?action=tables&id=${connId}&schema=${encodeURIComponent(schema)}`);
      const data = await res.json();
      if (data.error) setError(data.error);
      else setTables((prev) => ({ ...prev, [key]: data.tables }));
    } catch { /* ignore */ }
    setLoading(null);
  };

  const loadColumns = async (connId: string, schema: string, table: string) => {
    const key = `${connId}:${schema}:${table}`;
    if (expandedTable === key) { setExpandedTable(null); return; }
    setExpandedTable(key);
    setLoading(key);
    try {
      const res = await fetch(`/api/database?action=columns&id=${connId}&schema=${encodeURIComponent(schema)}&table=${encodeURIComponent(table)}`);
      const data = await res.json();
      if (data.error) setError(data.error);
      else setColumns((prev) => ({ ...prev, [key]: data.columns }));
    } catch { /* ignore */ }
    setLoading(null);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Add connection button */}
      <div className="px-2 py-1.5 border-b border-border shrink-0">
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="w-full flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-md bg-muted/50 hover:bg-primary/10 hover:text-primary border border-border/50 transition-colors"
        >
          <Plus className="h-3 w-3" />
          {showAddForm ? "Cancel" : "Add Connection"}
        </button>
      </div>

      {/* Add connection form */}
      {showAddForm && (
        <div className="px-2 py-2 border-b border-border space-y-1.5 shrink-0">
          <input value={formLabel} onChange={(e) => setFormLabel(e.target.value)} placeholder="Label (optional)" className="w-full text-[10px] bg-muted/40 border border-border rounded px-2 py-0.5 outline-none focus:ring-1 focus:ring-primary/50" />
          <div className="flex gap-1">
            <input value={formHost} onChange={(e) => setFormHost(e.target.value)} placeholder="Host" className="flex-1 text-[10px] bg-muted/40 border border-border rounded px-2 py-0.5 outline-none focus:ring-1 focus:ring-primary/50" />
            <input value={formPort} onChange={(e) => setFormPort(e.target.value)} placeholder="Port" className="w-12 text-[10px] bg-muted/40 border border-border rounded px-2 py-0.5 outline-none focus:ring-1 focus:ring-primary/50" />
          </div>
          <input value={formDatabase} onChange={(e) => setFormDatabase(e.target.value)} placeholder="Database" className="w-full text-[10px] bg-muted/40 border border-border rounded px-2 py-0.5 outline-none focus:ring-1 focus:ring-primary/50" />
          <input value={formUsername} onChange={(e) => setFormUsername(e.target.value)} placeholder="Username" className="w-full text-[10px] bg-muted/40 border border-border rounded px-2 py-0.5 outline-none focus:ring-1 focus:ring-primary/50" />
          <input value={formPassword} onChange={(e) => setFormPassword(e.target.value)} placeholder="Password" type="password" className="w-full text-[10px] bg-muted/40 border border-border rounded px-2 py-0.5 outline-none focus:ring-1 focus:ring-primary/50" />
          <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <input type="checkbox" checked={formSsl} onChange={(e) => setFormSsl(e.target.checked)} className="rounded" />
            Use SSL
          </label>
          {testResult && (
            <div className={cn("text-[9px] px-1 py-0.5 rounded", testResult.success ? "bg-green-500/10 text-green-500" : "bg-red-500/10 text-red-500")}>
              {testResult.message}
            </div>
          )}
          <div className="flex items-center gap-1">
            <button onClick={testConnection} disabled={testing} className="flex-1 text-[10px] px-2 py-1 rounded bg-muted hover:bg-muted/80 transition-colors disabled:opacity-40">
              {testing ? <Loader2 className="h-3 w-3 animate-spin inline" /> : "Test"}
            </button>
            <button onClick={saveConnection} className="flex-1 text-[10px] px-2 py-1 rounded bg-primary/10 text-primary hover:bg-primary/20 transition-colors">
              Save
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="px-2 py-1 text-[9px] text-red-500 border-b border-border shrink-0">
          {error}
          <button onClick={() => setError(null)} className="ml-1 underline">dismiss</button>
        </div>
      )}

      {/* Connection list / tree */}
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin py-0.5">
        {connections.length === 0 && !showAddForm && (
          <div className="text-xs text-muted-foreground text-center py-4">No connections</div>
        )}
        {connections.map((conn) => (
          <div key={conn.id}>
            {/* Connection node */}
            <div className="flex items-center group">
              <button
                onClick={() => loadSchemas(conn.id)}
                className={cn(
                  "flex-1 flex items-center gap-1.5 px-2 py-1 text-[11px] hover:bg-muted/60 transition-colors text-left",
                  expandedConn === conn.id && "text-primary font-medium"
                )}
              >
                <ChevronRight className={cn("h-3 w-3 shrink-0 text-muted-foreground/60 transition-transform", expandedConn === conn.id && "rotate-90")} />
                <Database className="h-3.5 w-3.5 shrink-0 text-blue-500" />
                <span className="truncate">{conn.label}</span>
                {loading === conn.id && <Loader2 className="h-2.5 w-2.5 animate-spin shrink-0 text-muted-foreground" />}
              </button>
              <div className="flex items-center gap-0.5 pr-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => onOpenQueryTab(conn.id, conn.label)}
                  className="p-0.5 rounded text-muted-foreground hover:text-primary hover:bg-muted transition-colors"
                  title="New query"
                >
                  <Zap className="h-3 w-3" />
                </button>
                <button
                  onClick={() => deleteConnection(conn.id)}
                  className="p-0.5 rounded text-muted-foreground hover:text-red-400 hover:bg-muted transition-colors"
                  title="Delete connection"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            </div>

            {/* Schemas */}
            {expandedConn === conn.id && schemas[conn.id] && (
              <div>
                {schemas[conn.id].map((schema) => {
                  const schemaKey = `${conn.id}:${schema}`;
                  return (
                    <div key={schema}>
                      <button
                        onClick={() => loadTables(conn.id, schema)}
                        className={cn("w-full flex items-center gap-1.5 py-0.5 text-[11px] hover:bg-muted/60 transition-colors text-left", expandedSchema === schemaKey && "text-primary")}
                        style={{ paddingLeft: "28px" }}
                      >
                        <ChevronRight className={cn("h-2.5 w-2.5 shrink-0 text-muted-foreground/60 transition-transform", expandedSchema === schemaKey && "rotate-90")} />
                        <Folder className="h-3 w-3 shrink-0 text-yellow-500" />
                        <span className="truncate">{schema}</span>
                        {loading === schemaKey && <Loader2 className="h-2.5 w-2.5 animate-spin shrink-0" />}
                      </button>

                      {/* Tables */}
                      {expandedSchema === schemaKey && tables[schemaKey] && (
                        <div>
                          {tables[schemaKey].map((table) => {
                            const tableKey = `${conn.id}:${schema}:${table.name}`;
                            return (
                              <div key={table.name}>
                                <div className="flex items-center group/table">
                                  <button
                                    onClick={() => loadColumns(conn.id, schema, table.name)}
                                    className={cn("flex-1 flex items-center gap-1.5 py-0.5 text-[11px] hover:bg-muted/60 transition-colors text-left", expandedTable === tableKey && "text-primary")}
                                    style={{ paddingLeft: "44px" }}
                                  >
                                    <ChevronRight className={cn("h-2.5 w-2.5 shrink-0 text-muted-foreground/60 transition-transform", expandedTable === tableKey && "rotate-90")} />
                                    <Table2 className={cn("h-3 w-3 shrink-0", table.type === "view" ? "text-purple-500" : "text-green-500")} />
                                    <span className="truncate">{table.name}</span>
                                    {table.type === "view" && <span className="text-[8px] text-purple-400 shrink-0">VIEW</span>}
                                    {loading === tableKey && <Loader2 className="h-2.5 w-2.5 animate-spin shrink-0" />}
                                  </button>
                                  <button
                                    onClick={() => onPreviewTable(conn.id, schema, table.name)}
                                    className="p-0.5 rounded text-muted-foreground/0 group-hover/table:text-muted-foreground hover:!text-primary hover:bg-muted transition-colors mr-1 shrink-0"
                                    title="Preview data"
                                  >
                                    <Eye className="h-3 w-3" />
                                  </button>
                                </div>

                                {/* Columns */}
                                {expandedTable === tableKey && columns[tableKey] && (
                                  <div>
                                    {columns[tableKey].map((col) => (
                                      <div
                                        key={col.name}
                                        className="flex items-center gap-1.5 py-[1px] text-[10px] text-muted-foreground hover:bg-muted/40 transition-colors"
                                        style={{ paddingLeft: "62px" }}
                                        title={`${col.type}${col.nullable ? " (nullable)" : ""}${col.default ? ` default: ${col.default}` : ""}`}
                                      >
                                        <Columns3 className="h-2.5 w-2.5 shrink-0 text-muted-foreground/60" />
                                        <span className="truncate font-medium">{col.name}</span>
                                        <span className="text-[9px] text-muted-foreground/50 shrink-0 ml-auto mr-1">{col.type}</span>
                                        {!col.nullable && <span className="text-[8px] text-orange-400 shrink-0">NN</span>}
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function VscodeLayout({
  rootPath,
  gitStatus,
  projectInfo,
  onClose,
  onRefreshGit,
}: {
  rootPath: string;
  gitStatus: GitStatus | null;
  projectInfo: ProjectInfo | null;
  onClose: () => void;
  onRefreshGit: () => void;
}) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { resolvedTheme: _resolvedTheme } = useTheme();
  const [activePanel, setActivePanel] = useState<VscodeSidebarPanel>("explorer");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [openFiles, setOpenFiles] = useState<VscodeOpenFile[]>([]);
  const [activeFileIdx, setActiveFileIdx] = useState(-1);
  const [explorerNodes, setExplorerNodes] = useState<TreeNode[]>([]);
  const [saveStatus, setSaveStatus] = useState<"saved" | "error" | null>(null);

  // Commit state
  const [commitMsg, setCommitMsg] = useState("");
  const [committing, setCommitting] = useState(false);
  const [commitResult, setCommitResult] = useState<string | null>(null);

  // Terminal panel for running scripts
  const [terminalCmd, setTerminalCmd] = useState<{ cwd: string; command: string; label: string } | null>(null);

  // Explorer tree loading
  const loadDir = useCallback(async (dirPath: string): Promise<FileEntry[]> => {
    try {
      const res = await fetch(`/api/files?path=${encodeURIComponent(dirPath)}`);
      const data = await res.json() as DirListing & { error?: string };
      return data.entries || [];
    } catch { return []; }
  }, []);

  // Load root entries
  useEffect(() => {
    (async () => {
      const entries = await loadDir(rootPath);
      setExplorerNodes(entries.map((e) => ({ entry: e, loaded: false, expanded: false })));
    })();
  }, [rootPath, loadDir]);

  const toggleNode = useCallback(async (path: string) => {
    const findAndUpdate = (nodes: TreeNode[]): TreeNode[] =>
      nodes.map((n) => {
        if (n.entry.path === path) return { ...n, expanded: !n.expanded };
        if (n.children) return { ...n, children: findAndUpdate(n.children) };
        return n;
      });
    setExplorerNodes((prev) => findAndUpdate(prev));

    // Load children if needed
    const findNode = (nodes: TreeNode[], p: string): TreeNode | null => {
      for (const n of nodes) {
        if (n.entry.path === p) return n;
        if (n.children) { const f = findNode(n.children, p); if (f) return f; }
      }
      return null;
    };
    const node = findNode(explorerNodes, path);
    if (node && !node.loaded) {
      const children = (await loadDir(path)).map((e) => ({ entry: e, loaded: false, expanded: false } as TreeNode));
      setExplorerNodes((prev) => {
        const update = (ns: TreeNode[]): TreeNode[] =>
          ns.map((n) => {
            if (n.entry.path === path) return { ...n, loaded: true, children };
            if (n.children) return { ...n, children: update(n.children) };
            return n;
          });
        return update(prev);
      });
    }
  }, [explorerNodes, loadDir]);

  const openFile = useCallback(async (entry: FileEntry) => {
    if (entry.isDirectory) { toggleNode(entry.path); return; }
    // Check if already open
    const existingIdx = openFiles.findIndex((f) => f.path === entry.path);
    if (existingIdx >= 0) { setActiveFileIdx(existingIdx); return; }
    // Fetch content
    try {
      const res = await fetch(`/api/files?path=${encodeURIComponent(entry.path)}&read=1`);
      const data = await res.json() as FileContent;
      const newFile: VscodeOpenFile = {
        name: entry.name,
        path: entry.path,
        extension: entry.extension,
        content: data.content || "",
        dirty: false,
      };
      setOpenFiles((prev) => [...prev, newFile]);
      setActiveFileIdx(openFiles.length);
    } catch { /* ignore */ }
  }, [openFiles, toggleNode]);

  const closeFile = useCallback((idx: number) => {
    setOpenFiles((prev) => prev.filter((_, i) => i !== idx));
    if (activeFileIdx >= idx) setActiveFileIdx(Math.max(0, activeFileIdx - 1));
    if (openFiles.length <= 1) setActiveFileIdx(-1);
  }, [activeFileIdx, openFiles.length]);

  const saveActiveFile = useCallback(async (content: string) => {
    const file = openFiles[activeFileIdx];
    if (!file) return;
    setSaveStatus(null);
    try {
      const res = await fetch("/api/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save", path: file.path, content }),
      });
      const data = await res.json();
      if (data.saved) {
        setOpenFiles((prev) => prev.map((f, i) => i === activeFileIdx ? { ...f, content, dirty: false } : f));
        setSaveStatus("saved");
        onRefreshGit();
        setTimeout(() => setSaveStatus(null), 2000);
      } else { setSaveStatus("error"); }
    } catch { setSaveStatus("error"); }
  }, [openFiles, activeFileIdx, onRefreshGit]);

  // Source control: stage/unstage
  const doStage = useCallback(async (files: string[]) => {
    await fetch("/api/files", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "git-stage", files, path: rootPath }) });
    onRefreshGit();
  }, [rootPath, onRefreshGit]);

  const doUnstage = useCallback(async (files: string[]) => {
    await fetch("/api/files", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "git-unstage", files, path: rootPath }) });
    onRefreshGit();
  }, [rootPath, onRefreshGit]);

  const doCommit = useCallback(async () => {
    if (!commitMsg.trim()) return;
    setCommitting(true); setCommitResult(null);
    try {
      const res = await fetch("/api/files", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "git-commit", message: commitMsg, path: rootPath }) });
      const data = await res.json();
      if (data.error) setCommitResult(`Error: ${data.error}`);
      else { setCommitResult("Committed!"); setCommitMsg(""); }
    } catch { setCommitResult("Commit failed"); }
    setCommitting(false);
    onRefreshGit();
    setTimeout(() => setCommitResult(null), 3000);
  }, [commitMsg, rootPath, onRefreshGit]);

  const runScript = useCallback((name: string, cmd: string) => {
    const command = projectInfo?.type === "node" ? `npm run ${name}` : cmd;
    setTerminalCmd({ cwd: rootPath, command, label: name });
  }, [rootPath, projectInfo]);


  // Active file
  const activeFile = activeFileIdx >= 0 ? openFiles[activeFileIdx] : null;

  // Activity bar items
  const activityItems: { id: VscodeSidebarPanel; icon: React.ReactNode; label: string }[] = [
    { id: "explorer", icon: <FolderOpen className="h-4 w-4" />, label: "Explorer" },
    { id: "search", icon: <Search className="h-4 w-4" />, label: "Search" },
    { id: "sourceControl", icon: <GitBranch className="h-4 w-4" />, label: "Source Control" },
    { id: "scripts", icon: <Play className="h-4 w-4" />, label: "Run & Debug" },
    { id: "database", icon: <Database className="h-4 w-4" />, label: "Database Explorer" },
  ];

  return (
    <div className="flex h-full w-full overflow-hidden">
      {/* Activity Bar */}
      <div className="flex flex-col items-center w-10 shrink-0 bg-muted/30 border-r border-border py-1 gap-0.5">
        {activityItems.map((item) => (
          <button
            key={item.id}
            onClick={() => {
              if (activePanel === item.id && !sidebarCollapsed) setSidebarCollapsed(true);
              else { setActivePanel(item.id); setSidebarCollapsed(false); }
            }}
            className={cn(
              "w-9 h-9 flex items-center justify-center rounded-md transition-colors relative",
              activePanel === item.id && !sidebarCollapsed
                ? "text-foreground bg-muted"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
            )}
            title={item.label}
          >
            {item.icon}
            {activePanel === item.id && !sidebarCollapsed && (
              <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-primary rounded-r" />
            )}
          </button>
        ))}

        <div className="flex-1" />

        {/* Close VS Code mode button */}
        <button
          onClick={onClose}
          className="w-9 h-9 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
          title="Exit VS Code mode"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Sidebar */}
      {!sidebarCollapsed && (
        <div className="w-52 shrink-0 flex flex-col border-r border-border bg-background overflow-hidden">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium px-3 py-2 border-b border-border shrink-0">
            {activePanel === "explorer" && "Explorer"}
            {activePanel === "search" && "Search"}
            {activePanel === "sourceControl" && "Source Control"}
            {activePanel === "scripts" && "Scripts"}
            {activePanel === "database" && "Database"}
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin">
            {/* Explorer Panel */}
            {activePanel === "explorer" && (
              <div className="py-0.5">
                <div className="text-[9px] uppercase tracking-wider text-muted-foreground/60 px-3 py-1 font-medium">
                  {rootPath.split("/").pop() || rootPath}
                </div>
                {explorerNodes.map((node) => (
                  <VscodeTreeNode
                    key={node.entry.path}
                    node={node}
                    depth={0}
                    onToggle={toggleNode}
                    onFileClick={openFile}
                    activeFilePath={activeFile?.path}
                  />
                ))}
              </div>
            )}

            {/* Search Panel */}
            {activePanel === "search" && (
              <VscodeSearchPanel rootPath={rootPath} onOpenFile={openFile} />
            )}

            {/* Source Control Panel */}
            {activePanel === "sourceControl" && (
              <div className="py-1">
                {gitStatus?.isGitRepo ? (
                  <>
                    <div className="flex items-center gap-1.5 px-3 py-1 text-[10px] text-muted-foreground">
                      <GitBranch className="h-3 w-3" />
                      <span className="font-medium">{gitStatus.branch}</span>
                      {(gitStatus.ahead || 0) > 0 && <span className="text-green-500">↑{gitStatus.ahead}</span>}
                      {(gitStatus.behind || 0) > 0 && <span className="text-orange-500">↓{gitStatus.behind}</span>}
                    </div>
                    {/* Commit input */}
                    <div className="px-3 py-1.5 border-b border-border">
                      <div className="flex items-center gap-1">
                        <input
                          value={commitMsg}
                          onChange={(e) => setCommitMsg(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter" && commitMsg.trim()) doCommit(); }}
                          placeholder="Commit message..."
                          className="flex-1 text-[11px] bg-muted/40 border border-border rounded px-2 py-1 outline-none focus:ring-1 focus:ring-primary/50 placeholder:text-muted-foreground/40"
                        />
                        <button
                          onClick={doCommit}
                          disabled={committing || !commitMsg.trim() || !(gitStatus.files?.some((f) => f.staged))}
                          className="p-1 rounded bg-primary/10 text-primary hover:bg-primary/20 transition-colors disabled:opacity-40"
                          title="Commit staged changes"
                        >
                          {committing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                        </button>
                      </div>
                      {commitResult && (
                        <div className={cn("text-[9px] mt-1", commitResult.startsWith("Error") ? "text-red-500" : "text-green-500")}>
                          {commitResult}
                        </div>
                      )}
                    </div>
                    {gitStatus.files && gitStatus.files.length > 0 ? (
                      <>
                        {/* Staged */}
                        {gitStatus.files.filter((f) => f.staged).length > 0 && (
                          <div>
                            <div className="flex items-center justify-between px-3 py-1">
                              <span className="text-[9px] uppercase tracking-wider text-green-500 font-medium">
                                Staged ({gitStatus.files.filter((f) => f.staged).length})
                              </span>
                              <button
                                onClick={() => doUnstage(gitStatus.files!.filter((f) => f.staged).map((f) => f.path))}
                                className="text-[9px] text-muted-foreground hover:text-foreground"
                                title="Unstage all"
                              >
                                <Minus className="h-3 w-3" />
                              </button>
                            </div>
                            {gitStatus.files.filter((f) => f.staged).map((f) => (
                              <button
                                key={`s-${f.path}`}
                                onClick={() => {
                                  const name = f.path.split("/").pop() || f.path;
                                  const ext = name.includes(".") ? "." + name.split(".").pop()!.toLowerCase() : "";
                                  const absPath = gitStatus.repoRoot ? `${gitStatus.repoRoot}/${f.path}` : f.path;
                                  openFile({ name, path: absPath, extension: ext, isDirectory: false, size: 0, modified: "" });
                                }}
                                className="w-full flex items-center gap-1.5 px-3 py-0.5 text-[11px] hover:bg-muted/60 transition-colors text-left"
                              >
                                <GitStatusBadge status={f.status} />
                                <span className="truncate flex-1 text-green-600 dark:text-green-400">{f.path}</span>
                                <button
                                  onClick={(e) => { e.stopPropagation(); doUnstage([f.path]); }}
                                  className="p-0.5 text-muted-foreground hover:text-foreground shrink-0"
                                >
                                  <Minus className="h-2.5 w-2.5" />
                                </button>
                              </button>
                            ))}
                          </div>
                        )}
                        {/* Working */}
                        {gitStatus.files.filter((f) => f.working).length > 0 && (
                          <div>
                            <div className="flex items-center justify-between px-3 py-1">
                              <span className="text-[9px] uppercase tracking-wider text-yellow-500 font-medium">
                                Changes ({gitStatus.files.filter((f) => f.working).length})
                              </span>
                              <button
                                onClick={() => doStage(gitStatus.files!.filter((f) => f.working && !f.staged).map((f) => f.path))}
                                className="text-[9px] text-muted-foreground hover:text-foreground"
                                title="Stage all"
                              >
                                <Plus className="h-3 w-3" />
                              </button>
                            </div>
                            {gitStatus.files.filter((f) => f.working).map((f) => (
                              <button
                                key={`w-${f.path}`}
                                onClick={() => {
                                  const name = f.path.split("/").pop() || f.path;
                                  const ext = name.includes(".") ? "." + name.split(".").pop()!.toLowerCase() : "";
                                  const absPath = gitStatus.repoRoot ? `${gitStatus.repoRoot}/${f.path}` : f.path;
                                  openFile({ name, path: absPath, extension: ext, isDirectory: false, size: 0, modified: "" });
                                }}
                                className="w-full flex items-center gap-1.5 px-3 py-0.5 text-[11px] hover:bg-muted/60 transition-colors text-left"
                              >
                                <GitStatusBadge status={f.status} />
                                <span className={cn("truncate flex-1", f.status === "D" ? "text-red-500 line-through" : "text-yellow-600 dark:text-yellow-400")}>{f.path}</span>
                                <button
                                  onClick={(e) => { e.stopPropagation(); doStage([f.path]); }}
                                  className="p-0.5 text-muted-foreground hover:text-foreground shrink-0"
                                >
                                  <Plus className="h-2.5 w-2.5" />
                                </button>
                              </button>
                            ))}
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="text-xs text-muted-foreground text-center py-4">Working tree clean</div>
                    )}
                  </>
                ) : (
                  <div className="text-xs text-muted-foreground text-center py-4">Not a git repository</div>
                )}
              </div>
            )}

            {/* Scripts Panel */}
            {activePanel === "scripts" && (
              <div className="py-1">
                {projectInfo && Object.entries(projectInfo.scripts).length > 0 ? (
                  <>
                    <div className="flex items-center gap-1.5 px-3 py-1 text-[10px] text-muted-foreground">
                      <Package className="h-3 w-3" />
                      <span className="font-medium">{projectInfo.name}</span>
                      <span className="text-muted-foreground/50">({projectInfo.type})</span>
                    </div>
                    {Object.entries(projectInfo.scripts).map(([name, cmd]) => (
                      <button
                        key={name}
                        onClick={() => runScript(name, cmd)}
                        className="w-full flex items-center gap-1.5 px-3 py-1.5 text-[11px] hover:bg-muted/60 transition-colors group text-left"
                        title={`Run: ${cmd}`}
                      >
                        <Play className="h-3 w-3 text-green-500 shrink-0 group-hover:scale-110 transition-transform" />
                        <span className="truncate flex-1 font-medium">{name}</span>
                        <span className="text-[9px] text-muted-foreground/50 truncate max-w-[80px] hidden group-hover:block">{cmd}</span>
                      </button>
                    ))}
                  </>
                ) : (
                  <div className="text-xs text-muted-foreground text-center py-4">No scripts detected</div>
                )}
              </div>
            )}

            {/* Database Panel */}
            {activePanel === "database" && (
              <VscodeDatabasePanel
                onOpenQueryTab={(connId, connLabel) => {
                  // Open a new "query" tab in the editor
                  const queryFile: VscodeOpenFile = {
                    name: `Query - ${connLabel}`,
                    path: `__query__:${connId}:${Date.now()}`,
                    extension: ".sql",
                    content: "-- Write your SQL query here\nSELECT 1;\n",
                    dirty: false,
                  };
                  setOpenFiles((prev) => [...prev, queryFile]);
                  setActiveFileIdx(openFiles.length);
                }}
                onPreviewTable={async (connId, schema, table) => {
                  // Fetch preview and open as a special tab
                  try {
                    const res = await fetch(`/api/database?action=preview&id=${connId}&schema=${encodeURIComponent(schema)}&table=${encodeURIComponent(table)}&limit=50`);
                    const data = await res.json();
                    if (data.error) { return; }
                    const content = JSON.stringify({ __dbPreview: true, columns: data.columns, rows: data.rows, table: `${schema}.${table}`, rowCount: data.rowCount }, null, 2);
                    const previewFile: VscodeOpenFile = {
                      name: `${schema}.${table}`,
                      path: `__dbpreview__:${connId}:${schema}:${table}`,
                      extension: ".dbpreview",
                      content,
                      dirty: false,
                    };
                    setOpenFiles((prev) => {
                      const existing = prev.findIndex((f) => f.path === previewFile.path);
                      if (existing >= 0) {
                        setActiveFileIdx(existing);
                        return prev.map((f, i) => i === existing ? previewFile : f);
                      }
                      setActiveFileIdx(prev.length);
                      return [...prev, previewFile];
                    });
                  } catch { /* ignore */ }
                }}
              />
            )}
          </div>
        </div>
      )}

      {/* Main Editor Area */}
      <div className="flex-1 min-w-0 flex flex-col bg-background overflow-hidden">
        {/* Tabs */}
        {openFiles.length > 0 && (
          <div className="flex items-center overflow-x-auto scrollbar-thin shrink-0 bg-muted/20 border-b border-border">
            {openFiles.map((file, idx) => (
              <div
                key={file.path}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 text-[11px] cursor-pointer border-r border-border transition-colors group min-w-0 max-w-[160px] shrink-0",
                  idx === activeFileIdx
                    ? "bg-background text-foreground border-b-2 border-b-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
                )}
                onClick={() => setActiveFileIdx(idx)}
              >
                <FileIcon entry={{ extension: file.extension, isDirectory: false }} className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{file.name}</span>
                {file.dirty && <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />}
                <button
                  onClick={(e) => { e.stopPropagation(); closeFile(idx); }}
                  className="ml-auto p-0.5 rounded text-muted-foreground/0 group-hover:text-muted-foreground hover:!text-foreground hover:bg-muted transition-colors shrink-0"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </div>
            ))}
            {/* Save status */}
            {saveStatus && (
              <span className={cn("text-[9px] px-2 shrink-0", saveStatus === "saved" ? "text-green-500" : "text-red-500")}>
                {saveStatus === "saved" ? "Saved" : "Save failed"}
              </span>
            )}
          </div>
        )}

        {/* Editor */}
        <div className={cn("min-h-0", terminalCmd ? "flex-[2]" : "flex-1")}>
          {activeFile ? (
            activeFile.extension === ".dbpreview" ? (
              <DbPreviewTable content={activeFile.content} />
            ) : activeFile.path.startsWith("__query__:") ? (
              <DbQueryEditor
                connId={activeFile.path.split(":")[1]}
                initialSql={activeFile.content}
                onSqlChange={(sql) => {
                  setOpenFiles((prev) => prev.map((f, i) => i === activeFileIdx ? { ...f, content: sql, dirty: true } : f));
                }}
              />
            ) : (
              <MonacoEditorPanel
                content={activeFile.content}
                extension={activeFile.extension}
                filePath={activeFile.path}
                onSave={saveActiveFile}
              />
            )
          ) : (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
              <FolderOpen className="h-12 w-12 opacity-20" />
              <span className="text-sm">Open a file from the explorer</span>
              <span className="text-xs text-muted-foreground/50">
                {shortenPath(rootPath)}
              </span>
            </div>
          )}
        </div>

        {/* Terminal Panel (for running scripts) */}
        {terminalCmd && (
          <div className="flex-1 min-h-[120px] max-h-[40%] border-t border-border">
            <TerminalPanel
              cwd={terminalCmd.cwd}
              command={terminalCmd.command}
              label={terminalCmd.label}
              onClose={() => setTerminalCmd(null)}
            />
          </div>
        )}

        {/* Status Bar */}
        <div className="shrink-0 flex items-center justify-between px-2 py-0.5 bg-primary/10 border-t border-border text-[9px]">
          <div className="flex items-center gap-2 text-muted-foreground">
            {gitStatus?.isGitRepo && (
              <span className="flex items-center gap-1">
                <GitBranch className="h-2.5 w-2.5" />
                {gitStatus.branch}
              </span>
            )}
            {gitStatus?.files && gitStatus.files.length > 0 && (
              <span className="text-yellow-500">{gitStatus.files.length} changes</span>
            )}
          </div>
          <div className="flex items-center gap-2 text-muted-foreground">
            {activeFile && (
              <>
                <span>{monacoLangMap[activeFile.extension] || "plaintext"}</span>
                <span>UTF-8</span>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── VS Code Tree Node (simplified for sidebar) ─────────────────────────────

function VscodeTreeNode({
  node,
  depth,
  onToggle,
  onFileClick,
  activeFilePath,
}: {
  node: TreeNode;
  depth: number;
  onToggle: (path: string) => void;
  onFileClick: (entry: FileEntry) => void;
  activeFilePath?: string;
}) {
  const isActive = !node.entry.isDirectory && node.entry.path === activeFilePath;

  return (
    <>
      <button
        onClick={() => {
          if (node.entry.isDirectory) onToggle(node.entry.path);
          else onFileClick(node.entry);
        }}
        className={cn(
          "w-full flex items-center gap-1 px-1 py-[2px] text-[11px] text-left hover:bg-muted/60 transition-colors focus:outline-none",
          isActive && "bg-primary/10 text-primary"
        )}
        style={{ paddingLeft: `${8 + depth * 12}px` }}
      >
        {node.entry.isDirectory ? (
          <ChevronRight className={cn("h-3 w-3 shrink-0 text-muted-foreground/60 transition-transform", node.expanded && "rotate-90")} />
        ) : (
          <span className="w-3 shrink-0" />
        )}
        <FileIcon entry={node.entry} className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{node.entry.name}</span>
      </button>
      {node.expanded && node.children?.map((child) => (
        <VscodeTreeNode
          key={child.entry.path}
          node={child}
          depth={depth + 1}
          onToggle={onToggle}
          onFileClick={onFileClick}
          activeFilePath={activeFilePath}
        />
      ))}
    </>
  );
}

// ─── VS Code Search Panel ────────────────────────────────────────────────────

function VscodeSearchPanel({
  rootPath,
  onOpenFile,
}: {
  rootPath: string;
  onOpenFile: (entry: FileEntry) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResultEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    const q = query.trim();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (q.length < 2) { setResults([]); return; }
    setLoading(true);
    timerRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/files?search=${encodeURIComponent(q)}&root=${encodeURIComponent(rootPath)}&mode=content`);
        const data = await res.json();
        setResults(data.results || []);
      } catch { setResults([]); }
      setLoading(false);
    }, 200);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [query, rootPath]);

  return (
    <div className="flex flex-col h-full">
      <div className="px-2 py-1.5 shrink-0">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search in files..."
            className="w-full pl-7 pr-2 py-1 text-[11px] bg-muted/40 border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary/50 placeholder:text-muted-foreground/50"
          />
          {loading && (
            <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 animate-spin text-muted-foreground" />
          )}
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin">
        {results.map((r) => (
          <button
            key={r.path + (r.matchLineNumber || "")}
            onClick={() => onOpenFile(r)}
            className="w-full flex flex-col px-3 py-1 text-left hover:bg-muted/60 transition-colors"
          >
            <div className="flex items-center gap-1.5 text-[11px]">
              <FileIcon entry={r} className="h-3 w-3 shrink-0" />
              <span className="truncate font-medium">{r.name}</span>
              {r.matchLineNumber && <span className="text-[9px] text-muted-foreground/50">:{r.matchLineNumber}</span>}
            </div>
            {r.matchLine && (
              <span className="text-[10px] text-muted-foreground truncate pl-[18px] font-mono">{r.matchLine}</span>
            )}
          </button>
        ))}
        {query.length >= 2 && !loading && results.length === 0 && (
          <div className="text-xs text-muted-foreground text-center py-4">No results</div>
        )}
      </div>
    </div>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

export function FilesWidget() {
  const [currentPath, setCurrentPath] = useState("~");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [parentPath, setParentPath] = useState("");
  const [resolvedPath, setResolvedPath] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("list");

  // Load view mode from localStorage on first mount
  useEffect(() => {
    setViewMode(loadViewMode());
  }, []);

  const handleViewModeChange = useCallback((v: ViewMode) => {
    setViewMode(v);
    saveViewMode(v);
  }, []);

  // VS Code (Monaco) mode
  const [monacoMode, setMonacoMode] = useState(false);

  // Preview / Edit state
  const [preview, setPreview] = useState<{
    name: string;
    content: string;
    extension: string;
    truncated: boolean;
    filePath?: string;
  } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  // AI summary for the current preview file
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [aiSummaryLoading, setAiSummaryLoading] = useState(false);
  const [aiSummaryError, setAiSummaryError] = useState<string | null>(null);
  const [aiSummaryFor, setAiSummaryFor] = useState<string | null>(null); // path the summary is for
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"saved" | "error" | null>(null);
  const editTextareaRef = useRef<HTMLTextAreaElement>(null);

  // Search state
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchMode, setSearchMode] = useState<"name" | "content" | "ai">("name");
  const [showToolbar, setShowToolbar] = useState(false);
  const [searchGlobal, setSearchGlobal] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResultEntry[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchTotal, setSearchTotal] = useState(0);
  const [aiSearchNote, setAiSearchNote] = useState<string | null>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Git state
  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null);
  const [gitOpen, setGitOpen] = useState(false);
  const [gitLoading, setGitLoading] = useState(false);

  const { expandRequested, onExpandHandled, pendingItemId, clearPendingItem } =
    useWidgetNavFor("files");

  // Split terminal panel state
  const [splitTerminal, setSplitTerminal] = useState<{
    cwd: string;
    command: string;
    label: string;
  } | null>(null);

  // Drag-and-drop state: dragging a file over the terminal panel
  const [dragOverTerminal, setDragOverTerminal] = useState(false);
  const terminalPasteRef = useRef<((text: string) => void) | null>(null);

  // ─── Dev-centric feature state ──────────────────────────────────────────

  // Multi-file tabs
  const [openTabs, setOpenTabs] = useState<OpenTab[]>([]);
  const [activeTabIdx, setActiveTabIdx] = useState(-1);

  // Diff viewer
  const [diffContent, setDiffContent] = useState<string | null>(null);
  const [diffFile, setDiffFile] = useState<string | null>(null);

  // Blame viewer
  const [blameLines, setBlameLines] = useState<BlameLine[] | null>(null);

  // Symbol outline
  const [symbols, setSymbols] = useState<SymbolInfo[] | null>(null);
  const [showSymbols, setShowSymbols] = useState(false);

  // Git actions panel
  const [showGitActions, setShowGitActions] = useState(false);

  // Bookmarks
  const [bookmarks, setBookmarks] = useState<FileBookmark[]>([]);
  const [showBookmarks, setShowBookmarks] = useState(false);

  // Project detection
  const [projectInfo, setProjectInfo] = useState<ProjectInfo | null>(null);
  const [showProject, setShowProject] = useState(false);

  // Language stats
  const [langStats, setLangStats] = useState<LangStat[] | null>(null);
  const [showLangStats, setShowLangStats] = useState(false);

  // AI cleanup assistant — when set, the panel is shown for this folder path
  const [cleanupFor, setCleanupFor] = useState<string | null>(null);

  // Gitignore filtering
  const [hideGitignored, setHideGitignored] = useState(false);
  const [gitIgnoredNames, setGitIgnoredNames] = useState<Set<string>>(new Set());

  // File watcher (auto-refresh)
  const [autoRefresh, setAutoRefresh] = useState(false);
  const autoRefreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ─── Sort state ─────────────────────────────────────────────────────────
  const [mainSortField, setMainSortField] = useState<SortField>("name");
  const [mainSortDir, setMainSortDir] = useState<SortDir>("asc");

  // ─── Dual-pane & VPS state ──────────────────────────────────────────────
  const [dualPaneMode, setDualPaneMode] = useState(false);
  const [vpsConnections, setVpsConnections] = useState<VpsConnection[]>([]);
  const [showVpsDialog, setShowVpsDialog] = useState(false);
  const [editingVpsConn, setEditingVpsConn] = useState<VpsConnection | null>(null);

  // Single-view VPS source (null = local)
  const [singleViewVps, setSingleViewVps] = useState<{ id: string; connection: VpsConnection } | null>(null);
  const isVpsMode = singleViewVps !== null;

  // Fetch VPS connections on mount
  const fetchVpsConnections = useCallback(async () => {
    try {
      const res = await fetch("/api/vps?action=connections");
      const data = await res.json();
      setVpsConnections(data.connections || []);
    } catch { setVpsConnections([]); }
  }, []);

  useEffect(() => { fetchVpsConnections(); }, [fetchVpsConnections]);

  // ─── Context menu + create/delete/rename ────────────────────────────────

  const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null);
  const [newEntry, setNewEntry] = useState<{ type: "file" | "folder"; inDir: string } | null>(null);
  const [renamingEntry, setRenamingEntry] = useState<FileEntry | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);

  const openCtxMenu = useCallback((e: React.MouseEvent, entry: FileEntry, dirPath: string) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY, entry, dirPath });
  }, []);

  const startNewEntry = useCallback((type: "file" | "folder", inDir: string) => {
    setNewEntry({ type, inDir });
    setCtxMenu(null);
  }, []);

  const startRename = useCallback((entry: FileEntry) => {
    setRenamingEntry(entry);
    setRenameValue(entry.name);
    setCtxMenu(null);
    setTimeout(() => renameInputRef.current?.select(), 30);
  }, []);

  const listRef = useRef<HTMLDivElement>(null);

  // ─── Keyboard navigation for list/grid views ────────────────────────────

  const [listFocusedIdx, setListFocusedIdx] = useState(-1);

  // ─── Fetch directory listing ─────────────────────────────────────────────

  const fetchDir = useCallback(async (dirPath: string, keepPreview = false) => {
    setLoading(true);
    setError(null);
    if (!keepPreview) { setPreview(null); setEditing(false); }
    try {
      if (singleViewVps) {
        // VPS mode
        const res = await fetch(`/api/vps?action=list&id=${singleViewVps.id}&path=${encodeURIComponent(dirPath)}`);
        const data = await res.json();
        if (data.error) { setError(data.error); setLoading(false); return; }
        setEntries(data.entries || []);
        setParentPath(data.parent || "/");
        setResolvedPath(data.path || dirPath);
        setCurrentPath(data.path || dirPath);
        setListFocusedIdx(-1);
      } else {
        // Local mode
        const res = await fetch(`/api/files?path=${encodeURIComponent(dirPath)}`);
        const data = (await res.json()) as DirListing & { error?: string; permissionDenied?: boolean };
        if (data.permissionDenied) {
          setEntries([]);
          setParentPath(data.parent || "");
          setResolvedPath(data.path || dirPath);
          setCurrentPath(data.path || dirPath);
          setError("Permission denied — macOS restricts access to this folder.");
          setLoading(false);
          return;
        }
        if (data.error) { setError(data.error); setLoading(false); return; }
        setEntries(data.entries || []);
        setParentPath(data.parent || "");
        setResolvedPath(data.path || dirPath);
        setCurrentPath(data.path || dirPath);
        setListFocusedIdx(-1);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    }
    setLoading(false);
  }, [singleViewVps]);

  const commitNewEntry = useCallback(async (name: string) => {
    if (!newEntry) return;
    const fullPath = newEntry.inDir.replace(/\/$/, "") + "/" + name;
    try {
      if (singleViewVps) {
        if (newEntry.type === "folder") {
          const res = await fetch("/api/vps", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "mkdir", id: singleViewVps.id, remotePath: fullPath }),
          });
          const data = await res.json();
          if (data.error) { console.error(data.error); return; }
        } else {
          // touch via ssh
          const res = await fetch("/api/vps", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "touch", id: singleViewVps.id, remotePath: fullPath }),
          });
          const data = await res.json();
          if (data.error) { console.error(data.error); return; }
        }
      } else {
        const action = newEntry.type === "folder" ? "mkdir" : "touch";
        const res = await fetch("/api/files", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, path: fullPath }),
        });
        const data = await res.json();
        if (data.error) { console.error(data.error); return; }
      }
      setNewEntry(null);
      await fetchDir(newEntry.inDir === resolvedPath ? resolvedPath : newEntry.inDir);
    } catch (err) { console.error(err); }
  }, [newEntry, resolvedPath, fetchDir, singleViewVps]);

  const commitRename = useCallback(async () => {
    if (!renamingEntry || !renameValue.trim() || renameValue === renamingEntry.name) {
      setRenamingEntry(null); return;
    }
    try {
      if (singleViewVps) {
        const res = await fetch("/api/vps", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "rename", id: singleViewVps.id, from: renamingEntry.path, to: renameValue.trim() }),
        });
        const data = await res.json();
        if (data.error) { console.error(data.error); setRenamingEntry(null); return; }
      } else {
        const res = await fetch("/api/files", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "rename", from: renamingEntry.path, to: renameValue.trim() }),
        });
        const data = await res.json();
        if (data.error) { console.error(data.error); setRenamingEntry(null); return; }
      }
      setRenamingEntry(null);
      fetchDir(resolvedPath);
    } catch (err) { console.error(err); setRenamingEntry(null); }
  }, [renamingEntry, renameValue, resolvedPath, fetchDir, singleViewVps]);

  const deleteEntry = useCallback(async (entry: FileEntry) => {
    const label = entry.isDirectory ? `folder "${entry.name}" and all its contents` : `"${entry.name}"`;
    if (!window.confirm(`Delete ${label}?`)) return;
    try {
      if (singleViewVps) {
        const res = await fetch("/api/vps", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "delete", id: singleViewVps.id, remotePath: entry.path }),
        });
        const data = await res.json();
        if (data.error) { console.error(data.error); return; }
      } else {
        const res = await fetch("/api/files", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "delete", path: entry.path }),
        });
        const data = await res.json();
        if (data.error) { console.error(data.error); return; }
      }
      if (preview?.filePath === entry.path) setPreview(null);
      fetchDir(resolvedPath);
    } catch (err) { console.error(err); }
  }, [resolvedPath, fetchDir, preview, singleViewVps]);

  useEffect(() => {
    if (singleViewVps) {
      fetchDir(singleViewVps.connection.defaultPath);
    } else {
      fetchDir("~");
    }
  }, [fetchDir]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Git status ──────────────────────────────────────────────────────────

  const fetchGitStatus = useCallback(async (dirPath: string) => {
    setGitLoading(true);
    try {
      const res = await fetch(`/api/files?git=1&path=${encodeURIComponent(dirPath)}`);
      const data = (await res.json()) as GitStatus;
      setGitStatus(data);
    } catch {
      setGitStatus({ isGitRepo: false });
    }
    setGitLoading(false);
  }, []);

  useEffect(() => {
    if (resolvedPath && !isVpsMode) fetchGitStatus(resolvedPath);
  }, [resolvedPath, fetchGitStatus, isVpsMode]);

  // ─── Load bookmarks on mount ────────────────────────────────────────────

  const fetchBookmarks = useCallback(async () => {
    try {
      const res = await fetch("/api/files", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "bookmark", subAction: "list" }) });
      const data = await res.json();
      setBookmarks(data.bookmarks || []);
    } catch { setBookmarks([]); }
  }, []);

  useEffect(() => { fetchBookmarks(); }, [fetchBookmarks]);

  // ─── Toggle bookmark ────────────────────────────────────────────────────

  const toggleBookmark = useCallback(async (entry: FileEntry) => {
    const isBookmarked = bookmarks.some((b) => b.path === entry.path);
    const subAction = isBookmarked ? "remove" : "add";
    try {
      const res = await fetch("/api/files", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "bookmark", subAction, filePath: entry.path }) });
      const data = await res.json();
      setBookmarks(data.bookmarks || []);
    } catch { /* ignore */ }
  }, [bookmarks]);

  // ─── Copy path helpers ──────────────────────────────────────────────────

  const copyPath = useCallback((entry: FileEntry) => {
    navigator.clipboard.writeText(entry.path).catch(() => {});
  }, []);

  const copyRelativePath = useCallback((entry: FileEntry) => {
    const relative = gitStatus?.repoRoot ? entry.path.replace(gitStatus.repoRoot + "/", "") : entry.path.replace(resolvedPath + "/", "");
    navigator.clipboard.writeText(relative).catch(() => {});
  }, [gitStatus, resolvedPath]);

  // ─── Diff viewer ────────────────────────────────────────────────────────

  const fetchDiff = useCallback(async (filePath: string, staged: boolean) => {
    try {
      const res = await fetch(`/api/files?diff=1&path=${encodeURIComponent(resolvedPath)}&file=${encodeURIComponent(filePath)}&staged=${staged ? "1" : "0"}`);
      const data = await res.json();
      setDiffContent(data.diff || "");
      setDiffFile(filePath);
    } catch { setDiffContent(null); }
  }, [resolvedPath]);

  // ─── Blame viewer ──────────────────────────────────────────────────────

  const fetchBlame = useCallback(async (filePath: string) => {
    try {
      // Get relative path for blame
      const relPath = gitStatus?.repoRoot ? filePath.replace(gitStatus.repoRoot + "/", "") : filePath;
      const res = await fetch(`/api/files?blame=1&path=${encodeURIComponent(resolvedPath)}&file=${encodeURIComponent(relPath)}`);
      const data = await res.json();
      setBlameLines(data.blame || []);
    } catch { setBlameLines(null); }
  }, [resolvedPath, gitStatus]);

  // ─── Symbols ────────────────────────────────────────────────────────────

  const fetchSymbols = useCallback(async (filePath: string) => {
    try {
      const res = await fetch(`/api/files?symbols=1&file=${encodeURIComponent(filePath)}`);
      const data = await res.json();
      setSymbols(data.symbols || []);
      setShowSymbols(true);
    } catch { setSymbols(null); }
  }, []);

  // ─── Project detection ──────────────────────────────────────────────────

  const fetchProjectInfo = useCallback(async (dirPath: string) => {
    try {
      const res = await fetch(`/api/files?project=1&path=${encodeURIComponent(dirPath)}`);
      const data = await res.json();
      if (data.type !== "unknown") setProjectInfo(data);
      else setProjectInfo(null);
    } catch { setProjectInfo(null); }
  }, []);

  useEffect(() => {
    if (resolvedPath) fetchProjectInfo(resolvedPath);
  }, [resolvedPath, fetchProjectInfo]);

  // ─── Language stats ─────────────────────────────────────────────────────

  const fetchLangStats = useCallback(async () => {
    try {
      const res = await fetch(`/api/files?langstats=1&path=${encodeURIComponent(resolvedPath)}`);
      const data = await res.json();
      setLangStats(data.stats || []);
      setShowLangStats(true);
    } catch { setLangStats(null); }
  }, [resolvedPath]);

  // ─── Gitignore-aware filtering ──────────────────────────────────────────

  const fetchGitIgnored = useCallback(async (dirPath: string) => {
    if (!gitStatus?.isGitRepo) { setGitIgnoredNames(new Set()); return; }
    try {
      const res = await fetch(`/api/files?gitignore=1&path=${encodeURIComponent(dirPath)}`);
      const data = await res.json();
      setGitIgnoredNames(new Set(data.ignored || []));
    } catch { setGitIgnoredNames(new Set()); }
  }, [gitStatus?.isGitRepo]);

  useEffect(() => {
    if (resolvedPath && hideGitignored) fetchGitIgnored(resolvedPath);
    else setGitIgnoredNames(new Set());
  }, [resolvedPath, hideGitignored, fetchGitIgnored]);

  // ─── File watcher (auto-refresh via polling) ────────────────────────────

  useEffect(() => {
    if (autoRefreshTimerRef.current) { clearInterval(autoRefreshTimerRef.current); autoRefreshTimerRef.current = null; }
    if (autoRefresh && resolvedPath) {
      autoRefreshTimerRef.current = setInterval(() => {
        fetchDir(resolvedPath, true);
        fetchGitStatus(resolvedPath);
      }, 3000);
    }
    return () => { if (autoRefreshTimerRef.current) clearInterval(autoRefreshTimerRef.current); };
  }, [autoRefresh, resolvedPath, fetchDir, fetchGitStatus]);

  // ─── Multi-file tabs ────────────────────────────────────────────────────

  const openInTab = useCallback((entry: { name: string; path: string; extension: string }, content: string, truncated: boolean) => {
    setOpenTabs((prev) => {
      const existing = prev.findIndex((t) => t.path === entry.path);
      if (existing >= 0) {
        setActiveTabIdx(existing);
        return prev.map((t, i) => i === existing ? { ...t, content, truncated } : t);
      }
      const newTabs = [...prev, { name: entry.name, path: entry.path, extension: entry.extension, content, truncated }];
      setActiveTabIdx(newTabs.length - 1);
      return newTabs;
    });
  }, []);

  const closeTab = useCallback((idx: number) => {
    setOpenTabs((prev) => {
      const next = prev.filter((_, i) => i !== idx);
      if (next.length === 0) {
        setActiveTabIdx(-1);
        setPreview(null);
      } else if (activeTabIdx >= next.length) {
        setActiveTabIdx(next.length - 1);
      } else if (idx <= activeTabIdx) {
        setActiveTabIdx(Math.max(0, activeTabIdx - 1));
      }
      return next;
    });
  }, [activeTabIdx]);

  const selectTab = useCallback((idx: number) => {
    setActiveTabIdx(idx);
    const tab = openTabs[idx];
    if (tab) {
      setPreview({ name: tab.name, content: tab.content, extension: tab.extension, truncated: tab.truncated, filePath: tab.path });
      setEditing(false);
    }
  }, [openTabs]);

  // ─── Search logic ────────────────────────────────────────────────────────

  const localFilteredEntries = useMemo(() => {
    if (!searchOpen || !searchQuery.trim() || searchQuery.trim().length < 1) return null;
    const q = searchQuery.toLowerCase();
    return entries.filter((e) => {
      if (!showHidden && e.name.startsWith(".")) return false;
      return e.name.toLowerCase().includes(q);
    });
  }, [searchOpen, searchQuery, entries, showHidden]);

  useEffect(() => {
    if (!searchOpen) return;
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    const q = searchQuery.trim();
    // AI mode requires longer queries (debounced more aggressively)
    const minLen = searchMode === "ai" ? 4 : 2;
    if (q.length < minLen) {
      setSearchResults([]);
      setSearchLoading(false);
      setSearchTotal(0);
      setAiSearchNote(null);
      return;
    }
    setSearchLoading(true);
    setAiSearchNote(null);
    // AI search costs an API call → wait longer before firing
    const debounce = searchMode === "ai" ? 600 : 150;
    searchTimerRef.current = setTimeout(async () => {
      try {
        const root = searchGlobal ? "~" : resolvedPath;
        if (searchMode === "ai") {
          const res = await fetch("/api/files-ai", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "nl-search", query: q, root }),
          });
          const data = await res.json();
          if (data.error) {
            setSearchResults([]);
            setSearchTotal(0);
            setAiSearchNote(data.error);
          } else {
            // Map AI results into SearchResultEntry shape
            const aiResults: SearchResultEntry[] = (data.results || []).map(
              (r: {
                path: string;
                name: string;
                isDirectory: boolean;
                size: number;
                modified: string;
                extension: string;
                reason: string;
                confidence: "high" | "medium" | "low";
              }) => ({
                path: r.path,
                name: r.name,
                isDirectory: r.isDirectory,
                size: r.size,
                modified: r.modified,
                extension: r.extension,
                score: r.confidence === "high" ? 100 : r.confidence === "medium" ? 60 : 30,
                reason: r.reason,
                confidence: r.confidence,
              })
            );
            setSearchResults(aiResults);
            setSearchTotal(aiResults.length);
            setAiSearchNote(data.note || null);
          }
        } else {
          const params = new URLSearchParams({ search: q, root, mode: searchMode });
          const res = await fetch(`/api/files?${params}`);
          const data = await res.json();
          if (data.results) {
            setSearchResults(data.results);
            setSearchTotal(data.total || data.results.length);
          }
        }
      } catch (err) {
        if (searchMode === "ai") {
          setAiSearchNote(err instanceof Error ? err.message : "AI search failed");
        }
      }
      setSearchLoading(false);
    }, debounce);
    return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current); };
  }, [searchQuery, searchMode, searchGlobal, searchOpen, resolvedPath]);

  useEffect(() => {
    if (searchOpen) {
      setTimeout(() => searchInputRef.current?.focus(), 50);
    } else {
      setSearchQuery(""); setSearchResults([]); setSearchTotal(0); setAiSearchNote(null);
    }
  }, [searchOpen]);

  // ─── File preview / editing ──────────────────────────────────────────────

  const openPreview = useCallback(async (entry: { name: string; path: string; extension: string }) => {
    setPreviewLoading(true);
    setEditing(false);
    setSaveStatus(null);
    setDiffContent(null); setBlameLines(null);
    // Reset any previous AI summary when opening a new file
    setAiSummary(null); setAiSummaryError(null); setAiSummaryFor(null);
    setPreview({ name: entry.name, content: "", extension: entry.extension, truncated: false, filePath: entry.path });
    try {
      let data: FileContent;
      if (singleViewVps) {
        const res = await fetch(`/api/vps?action=read&id=${singleViewVps.id}&path=${encodeURIComponent(entry.path)}`);
        data = await res.json();
      } else {
        const res = await fetch(`/api/files?path=${encodeURIComponent(entry.path)}&read=1`);
        data = await res.json();
      }
      if (data.error) {
        setPreview({ name: entry.name, content: `Error: ${data.error}`, extension: "", truncated: false, filePath: entry.path });
      } else {
        const content = data.content || "";
        const ext = data.extension || entry.extension;
        const trunc = data.truncated || false;
        setPreview({ name: entry.name, content, extension: ext, truncated: trunc, filePath: entry.path });
        openInTab(entry, content, trunc);
      }
    } catch {
      setPreview({ name: entry.name, content: "Failed to read file", extension: "", truncated: false, filePath: entry.path });
    }
    setPreviewLoading(false);
  }, [openInTab, singleViewVps]);

  // Fetch an AI-written summary of the currently-open file.
  const fetchAiSummary = useCallback(async (filePath: string) => {
    setAiSummaryLoading(true);
    setAiSummaryError(null);
    setAiSummary(null);
    setAiSummaryFor(filePath);
    try {
      const res = await fetch("/api/files-ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "summarize-file", path: filePath }),
      });
      const data = await res.json();
      if (data.error) {
        setAiSummaryError(data.error);
      } else if (data.summary) {
        setAiSummary(data.summary);
      } else {
        setAiSummaryError("No summary returned.");
      }
    } catch (err) {
      setAiSummaryError(err instanceof Error ? err.message : "Failed to summarize");
    }
    setAiSummaryLoading(false);
  }, []);

  const startEditing = useCallback(() => {
    if (!preview || isVpsMode) return;
    setEditing(true); setEditContent(preview.content); setSaveStatus(null);
    setTimeout(() => editTextareaRef.current?.focus(), 50);
  }, [preview, isVpsMode]);

  const cancelEditing = useCallback(() => {
    setEditing(false); setEditContent(""); setSaveStatus(null);
  }, []);

  const saveFile = useCallback(async () => {
    if (!preview?.filePath) return;
    setSaving(true); setSaveStatus(null);
    try {
      const res = await fetch("/api/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save", path: preview.filePath, content: editContent }),
      });
      const data = await res.json();
      if (data.saved) {
        setPreview((prev) => prev ? { ...prev, content: editContent } : prev);
        setEditing(false); setSaveStatus("saved");
        setTimeout(() => setSaveStatus(null), 2000);
        if (resolvedPath) fetchGitStatus(resolvedPath);
      } else { setSaveStatus("error"); }
    } catch { setSaveStatus("error"); }
    setSaving(false);
  }, [preview, editContent, resolvedPath, fetchGitStatus]);

  // ─── Open in Claude Code / OpenCode ─────────────────────────────────────

  const openInTool = useCallback((tool: "claude" | "opencode") => {
    const toolCmd = tool === "claude" ? "claude" : "opencode";
    if (singleViewVps) {
      const conn = singleViewVps.connection;
      const target = conn.username ? `${conn.username}@${conn.host}` : conn.host;
      const portArg = conn.port && conn.port !== 22 ? `-p ${conn.port}` : "";
      const keyArg = conn.keyPath ? `-i ${conn.keyPath}` : "";
      const sshCmd = `ssh ${portArg} ${keyArg} -t ${target} "cd ${resolvedPath} && ${toolCmd}"`.replace(/  +/g, " ");
      setSplitTerminal({ cwd: "~", command: sshCmd, label: `${tool === "claude" ? "Claude Code" : "OpenCode"} (${conn.label})` });
    } else {
      setSplitTerminal({ cwd: resolvedPath, command: toolCmd, label: tool === "claude" ? "Claude Code" : "OpenCode" });
    }
  }, [resolvedPath, singleViewVps]);

  // ─── Navigation ──────────────────────────────────────────────────────────

  const handleFileClick = useCallback((entry: FileEntry) => {
    if (entry.isDirectory) {
      fetchDir(entry.path);
      listRef.current?.scrollTo(0, 0);
      setSearchOpen(false);
      return;
    }
    if (isOpenableInBrowser(entry.extension)) {
      window.open(rawFileUrl(entry.path), "_blank", "noopener,noreferrer");
      return;
    }
    openPreview(entry);
  }, [fetchDir, openPreview]);

  const handleSearchResultClick = useCallback((result: SearchResultEntry) => {
    if (result.isDirectory) {
      fetchDir(result.path); setSearchOpen(false); listRef.current?.scrollTo(0, 0); return;
    }
    if (isOpenableInBrowser(result.extension)) {
      window.open(rawFileUrl(result.path), "_blank", "noopener,noreferrer"); return;
    }
    const parentDir = result.path.substring(0, result.path.lastIndexOf("/")) || "/";
    fetchDir(parentDir, true);
    openPreview({ name: result.name, path: result.path, extension: result.extension });
    setSearchOpen(false);
  }, [fetchDir, openPreview]);

  const handleGitFileClick = useCallback((filePath: string) => {
    if (!gitStatus?.repoRoot) return;
    const absPath = `${gitStatus.repoRoot}/${filePath}`;
    const ext = filePath.includes(".") ? "." + filePath.split(".").pop()!.toLowerCase() : "";
    const parentDir = absPath.substring(0, absPath.lastIndexOf("/")) || "/";
    fetchDir(parentDir, true);
    openPreview({ name: filePath.split("/").pop() || filePath, path: absPath, extension: ext });
    setGitOpen(false);
  }, [gitStatus, fetchDir, openPreview]);

  const goUp = useCallback(() => {
    if (singleViewVps) {
      const parent = resolvedPath === "/" ? "/" : resolvedPath.replace(/\/[^/]+\/?$/, "") || "/";
      fetchDir(parent);
    } else if (parentPath) {
      fetchDir(parentPath);
    }
  }, [parentPath, fetchDir, singleViewVps, resolvedPath]);
  const goHome = useCallback(() => {
    if (singleViewVps) {
      fetchDir(singleViewVps.connection.defaultPath);
    } else {
      fetchDir("~");
    }
  }, [fetchDir, singleViewVps]);
  const refresh = useCallback(() => {
    fetchDir(currentPath);
    if (resolvedPath) fetchGitStatus(resolvedPath);
  }, [currentPath, fetchDir, resolvedPath, fetchGitStatus]);

  useEffect(() => {
    if (!pendingItemId) return;
    clearPendingItem();
    const filePath = pendingItemId;
    const parentDir = filePath.substring(0, filePath.lastIndexOf("/")) || "/";
    const fileName = filePath.substring(filePath.lastIndexOf("/") + 1);
    const ext = fileName.includes(".") ? "." + fileName.split(".").pop()!.toLowerCase() : "";
    fetchDir(parentDir, true);
    if (isTextFile(ext) || ext === "") openPreview({ name: fileName, path: filePath, extension: ext });
  }, [pendingItemId, clearPendingItem, fetchDir, openPreview]);

  // ─── List/Grid keyboard navigation ──────────────────────────────────────

  const handleListKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!displayEntries || displayEntries.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setListFocusedIdx((prev) => Math.min(prev + 1, displayEntries.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setListFocusedIdx((prev) => Math.max(prev - 1, 0));
    } else if (e.key === "Enter" && listFocusedIdx >= 0) {
      e.preventDefault();
      handleFileClick(displayEntries[listFocusedIdx]);
    } else if (e.key === "Backspace") {
      e.preventDefault();
      goUp();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listFocusedIdx, goUp]);

  // ─── Drag and drop onto terminal ─────────────────────────────────────────

  const handleDragStart = useCallback((e: React.DragEvent, entry: FileEntry) => {
    // Stop the event from being swallowed by any parent drag handlers
    e.stopPropagation();
    // For directories, set a cd command. For files, set the quoted path.
    const dragText = entry.isDirectory ? `cd "${entry.path}"` : `"${entry.path}"`;
    e.dataTransfer.setData("text/plain", dragText);
    e.dataTransfer.setData("application/x-file-path", entry.path);
    e.dataTransfer.setData("application/x-is-directory", entry.isDirectory ? "1" : "0");
    e.dataTransfer.effectAllowed = "copy";
  }, []);

  // ─── Paste files from clipboard ───────────────────────────────────────────

  const [pasting, setPasting] = useState(false);
  const [pasteStatus, setPasteStatus] = useState<string | null>(null);

  const uploadFile = useCallback(async (file: File, destDir: string): Promise<{ uploaded?: boolean; name?: string; error?: string }> => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = (reader.result as string).split(",")[1]; // strip data URL prefix
        try {
          const res = await fetch("/api/files", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "upload",
              destDir,
              fileName: file.name,
              data: base64,
            }),
          });
          const data = await res.json();
          resolve(data);
        } catch (err) {
          resolve({ error: err instanceof Error ? err.message : "Upload failed" });
        }
      };
      reader.onerror = () => resolve({ error: "Failed to read file" });
      reader.readAsDataURL(file);
    });
  }, []);

  const handlePaste = useCallback(async (files: FileList | File[]) => {
    if (!files || files.length === 0) return;
    const destDir = resolvedPath || "~";
    setPasting(true);
    setPasteStatus(null);

    let succeeded = 0;
    let failed = 0;
    const fileArray = Array.from(files);

    for (const file of fileArray) {
      const result = await uploadFile(file, destDir);
      if (result.uploaded) succeeded++;
      else failed++;
    }

    setPasting(false);
    if (failed === 0) {
      setPasteStatus(`Pasted ${succeeded} file${succeeded !== 1 ? "s" : ""}`);
    } else {
      setPasteStatus(`Pasted ${succeeded}, failed ${failed}`);
    }
    // Refresh directory listing
    fetchDir(resolvedPath, true);
    // Clear status after a few seconds
    setTimeout(() => setPasteStatus(null), 3000);
  }, [resolvedPath, uploadFile, fetchDir]);

  const handlePasteEvent = useCallback((e: React.ClipboardEvent) => {
    const files = e.clipboardData?.files;
    if (files && files.length > 0) {
      e.preventDefault();
      handlePaste(files);
    }
  }, [handlePaste]);

  // Handle paste from context menu (uses async Clipboard API)
  const handlePasteFromClipboard = useCallback(async (destDir: string) => {
    try {
      // Try reading clipboard items via the async Clipboard API
      const clipboardItems = await navigator.clipboard.read();
      const files: File[] = [];

      for (const item of clipboardItems) {
        for (const type of item.types) {
          // Skip plain text — we only want file/binary content
          if (type === "text/plain" || type === "text/html") continue;
          const blob = await item.getType(type);
          // Determine filename from type
          const ext = type.split("/")[1]?.replace("jpeg", "jpg") || "bin";
          const name = `pasted-${Date.now()}.${ext}`;
          files.push(new globalThis.File([blob], name, { type }));
        }
      }

      if (files.length > 0) {
        // Override destination directory for context-menu paste
        setPasting(true);
        setPasteStatus(null);
        let succeeded = 0;
        let failed = 0;
        for (const file of files) {
          const result = await uploadFile(file, destDir);
          if (result.uploaded) succeeded++;
          else failed++;
        }
        setPasting(false);
        if (failed === 0) {
          setPasteStatus(`Pasted ${succeeded} file${succeeded !== 1 ? "s" : ""}`);
        } else {
          setPasteStatus(`Pasted ${succeeded}, failed ${failed}`);
        }
        fetchDir(resolvedPath, true);
        setTimeout(() => setPasteStatus(null), 3000);
      } else {
        // No file data in clipboard
        setPasteStatus("No file data in clipboard");
        setTimeout(() => setPasteStatus(null), 3000);
      }
    } catch {
      // Clipboard API denied or not available — show hint
      setPasteStatus("Use Cmd+V to paste (clipboard permission needed)");
      setTimeout(() => setPasteStatus(null), 4000);
    }
  }, [uploadFile, fetchDir, resolvedPath]);


  // ─── Filtered entries ────────────────────────────────────────────────────

  const filteredEntries = useMemo(() => {
    let filtered = showHidden ? entries : entries.filter((e) => !e.name.startsWith("."));
    if (hideGitignored && gitIgnoredNames.size > 0) {
      filtered = filtered.filter((e) => !gitIgnoredNames.has(e.name));
    }
    return sortFileEntries(filtered, mainSortField, mainSortDir);
  }, [entries, showHidden, hideGitignored, gitIgnoredNames, mainSortField, mainSortDir]);
  const isSearchActive = searchOpen && searchQuery.trim().length >= 2;

  const displayEntries = useMemo(() => {
    if (isSearchActive) return null;
    if (localFilteredEntries) return localFilteredEntries;
    return filteredEntries;
  }, [isSearchActive, localFilteredEntries, filteredEntries]);

  // Git grouping
  const gitStagedFiles = useMemo(() => gitStatus?.files?.filter((f) => f.staged) || [], [gitStatus]);
  const gitWorkingFiles = useMemo(() => gitStatus?.files?.filter((f) => f.working) || [], [gitStatus]);
  const gitChangedCount = gitStatus?.files?.length || 0;

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <>
    <WidgetWrapper
      title="Files"
      icon={<FolderOpen className="h-4 w-4" />}
      widgetType="files"
      expandRequested={expandRequested}
      onExpandHandled={onExpandHandled}
      forceExpand={!!splitTerminal}
      onExpandChange={(expanded) => { if (!expanded) setSplitTerminal(null); }}
      headerAction={
        <div className="flex items-center gap-0.5">
          {/* Search */}
          <button
            onClick={() => setSearchOpen(!searchOpen)}
            className={cn(
              "p-1 rounded-md transition-colors",
              searchOpen ? "text-foreground bg-muted" : "text-muted-foreground hover:text-foreground hover:bg-muted"
            )}
            title="Search files"
          >
            <Search className="h-3.5 w-3.5" />
          </button>
          {/* Toolbar toggle */}
          <button
            onClick={() => setShowToolbar(!showToolbar)}
            className={cn(
              "p-1 rounded-md transition-colors",
              showToolbar ? "text-primary bg-primary/10" : "text-muted-foreground hover:text-foreground hover:bg-muted"
            )}
            title={showToolbar ? "Hide toolbar" : "Show toolbar"}
          >
            <LayoutList className="h-3.5 w-3.5" />
          </button>
        </div>
      }
      sidePanel={
        splitTerminal ? (
          <div
            className="h-full"
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "copy";
              setDragOverTerminal(true);
            }}
            onDragLeave={() => setDragOverTerminal(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOverTerminal(false);
              const filePath = e.dataTransfer.getData("application/x-file-path") || e.dataTransfer.getData("text/plain");
              const isDir = e.dataTransfer.getData("application/x-is-directory") === "1";
              if (filePath) {
                // If directory, paste cd command; otherwise paste quoted path
                terminalPasteRef.current?.(isDir ? `cd "${filePath}"\n` : `"${filePath}" `);
              }
            }}
          >
            <div className={cn(
              "h-full transition-all rounded-lg",
              dragOverTerminal && "ring-2 ring-primary ring-offset-1"
            )}>
              <TerminalPanel
                cwd={splitTerminal.cwd}
                command={splitTerminal.command}
                label={splitTerminal.label}
                onClose={() => setSplitTerminal(null)}
                pasteRef={terminalPasteRef}
              />
            </div>
          </div>
        ) : undefined
      }
    >
      {monacoMode ? (
        <VscodeLayout
          rootPath={resolvedPath || "~"}
          gitStatus={gitStatus}
          projectInfo={projectInfo}
          onClose={() => setMonacoMode(false)}
          onRefreshGit={() => fetchGitStatus(resolvedPath)}
        />
      ) : dualPaneMode ? (
        <DualPaneExplorer
          vpsConnections={vpsConnections}
          onOpenVpsDialog={() => { setShowVpsDialog(true); setEditingVpsConn(null); }}
          initialLeftPath={resolvedPath || undefined}
        />
      ) : (
      <div className="flex flex-col h-full gap-1" onPaste={handlePasteEvent} tabIndex={-1}>
        {/* Paste status indicator */}
        {(pasting || pasteStatus) && (
          <div className="shrink-0 flex items-center gap-2 px-2 py-1 bg-primary/5 border border-primary/20 rounded-md text-[10px]">
            {pasting ? (
              <>
                <div className="h-3 w-3 border-[1.5px] border-primary/30 border-t-primary rounded-full animate-spin shrink-0" />
                <span className="text-primary">Pasting files…</span>
              </>
            ) : pasteStatus ? (
              <>
                <CheckCircle2 className="h-3 w-3 text-green-500 shrink-0" />
                <span className="text-green-600 dark:text-green-400">{pasteStatus}</span>
              </>
            ) : null}
          </div>
        )}
        {/* Collapsible toolbar */}
        {showToolbar && (
          <div className="shrink-0 flex flex-wrap items-center gap-0.5 px-1 py-1 bg-muted/30 border-b border-border rounded-md">
            {/* VS Code mode toggle */}
            <button
              onClick={() => setMonacoMode(!monacoMode)}
              className={cn(
                "px-1.5 py-0.5 rounded-md text-[10px] font-medium transition-colors",
                monacoMode ? "text-primary bg-primary/10 border border-primary/30" : "text-muted-foreground hover:text-foreground hover:bg-muted"
              )}
              title={monacoMode ? "Exit VS Code mode" : "VS Code mode"}
            >
              VS Code
            </button>
            {/* View toggle */}
            <ViewToggle view={viewMode} onChange={handleViewModeChange} />
            {/* Sort controls */}
            <select
              value={mainSortField}
              onChange={(e) => setMainSortField(e.target.value as SortField)}
              className="text-[10px] bg-muted/50 border border-border rounded px-1 py-0.5 outline-none h-6"
              title="Sort by"
            >
              <option value="name">Name</option>
              <option value="size">Size</option>
              <option value="modified">Modified</option>
              <option value="type">Type</option>
            </select>
            <button
              onClick={() => setMainSortDir(d => d === "asc" ? "desc" : "asc")}
              className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              title={mainSortDir === "asc" ? "Sort ascending" : "Sort descending"}
            >
              {mainSortDir === "asc" ? <ArrowDownAZ className="h-3.5 w-3.5" /> : <ArrowUpAZ className="h-3.5 w-3.5" />}
            </button>
            {/* Dual-pane toggle */}
            <button
              onClick={() => setDualPaneMode(!dualPaneMode)}
              className={cn(
                "p-1 rounded-md transition-colors",
                dualPaneMode ? "text-primary bg-primary/10" : "text-muted-foreground hover:text-foreground hover:bg-muted"
              )}
              title={dualPaneMode ? "Exit dual-pane mode" : "Dual-pane mode (side-by-side)"}
            >
              {dualPaneMode ? <PanelLeftClose className="h-3.5 w-3.5" /> : <PanelLeftOpen className="h-3.5 w-3.5" />}
            </button>
            {/* VPS connections */}
            <button
              onClick={() => { setShowVpsDialog(true); setEditingVpsConn(null); }}
              className={cn(
                "p-1 rounded-md transition-colors",
                vpsConnections.length > 0 ? "text-green-500 hover:text-green-400 hover:bg-muted" : "text-muted-foreground hover:text-foreground hover:bg-muted"
              )}
              title={`VPS Connections (${vpsConnections.length})`}
            >
              <Server className="h-3.5 w-3.5" />
            </button>
            {/* New file / folder */}
            {viewMode !== "recent" && (
              <>
                <button
                  onClick={() => startNewEntry("file", resolvedPath)}
                  className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  title="New file in current folder"
                >
                  <FilePlus className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => startNewEntry("folder", resolvedPath)}
                  className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  title="New folder in current folder"
                >
                  <FolderPlus className="h-3.5 w-3.5" />
                </button>
              </>
            )}
            {/* Claude Code */}
            <button
              onClick={() => openInTool("claude")}
              className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              title={`Open Claude Code in ${shortenPath(resolvedPath)}`}
            >
              <ClaudeIcon className="h-3.5 w-3.5" />
            </button>
            {/* OpenCode */}
            <button
              onClick={() => openInTool("opencode")}
              className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              title={`Open OpenCode in ${shortenPath(resolvedPath)}`}
            >
              <OpenCodeIcon className="h-3.5 w-3.5" />
            </button>
            {/* Git status */}
            {gitStatus?.isGitRepo && (
              <button
                onClick={() => setGitOpen(!gitOpen)}
                className={cn(
                  "p-1 rounded-md transition-colors flex items-center gap-1",
                  gitOpen ? "text-foreground bg-muted" : "text-muted-foreground hover:text-foreground hover:bg-muted"
                )}
                title={`Git: ${gitStatus.branch || "unknown"}`}
              >
                <GitBranch className="h-3.5 w-3.5" />
                {gitChangedCount > 0 && (
                  <span className="text-[9px] font-medium text-yellow-500">{gitChangedCount}</span>
                )}
              </button>
            )}
            {/* Git Actions */}
            {gitStatus?.isGitRepo && (
              <button
                onClick={() => setShowGitActions(!showGitActions)}
                className={cn(
                  "p-1 rounded-md transition-colors",
                  showGitActions ? "text-foreground bg-muted" : "text-muted-foreground hover:text-foreground hover:bg-muted"
                )}
                title="Git Actions (commit, stash, branch)"
              >
                <GitCommit className="h-3.5 w-3.5" />
              </button>
            )}
            {/* Bookmarks */}
            <button
              onClick={() => setShowBookmarks(!showBookmarks)}
              className={cn(
                "p-1 rounded-md transition-colors",
                showBookmarks ? "text-foreground bg-muted" : "text-muted-foreground hover:text-foreground hover:bg-muted"
              )}
              title="Pinned files"
            >
              <Bookmark className="h-3.5 w-3.5" />
            </button>
            {/* Language Stats */}
            {gitStatus?.isGitRepo && (
              <button
                onClick={() => { if (showLangStats) setShowLangStats(false); else fetchLangStats(); }}
                className={cn(
                  "p-1 rounded-md transition-colors",
                  showLangStats ? "text-foreground bg-muted" : "text-muted-foreground hover:text-foreground hover:bg-muted"
                )}
                title="Language statistics"
              >
                <BarChart3 className="h-3.5 w-3.5" />
              </button>
            )}
            {/* Hidden files */}
            <button
              onClick={() => setShowHidden(!showHidden)}
              className={cn(
                "p-1 rounded-md transition-colors",
                showHidden ? "text-foreground bg-muted" : "text-muted-foreground hover:text-foreground hover:bg-muted"
              )}
              title={showHidden ? "Hide hidden files" : "Show hidden files"}
            >
              {showHidden ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
            </button>
            {/* Gitignore-aware filtering */}
            {gitStatus?.isGitRepo && (
              <button
                onClick={() => setHideGitignored(!hideGitignored)}
                className={cn(
                  "p-1 rounded-md transition-colors",
                  hideGitignored ? "text-foreground bg-muted" : "text-muted-foreground hover:text-foreground hover:bg-muted"
                )}
                title={hideGitignored ? "Show gitignored files" : "Hide gitignored files"}
              >
                <Ban className="h-3.5 w-3.5" />
              </button>
            )}
            {/* Auto-refresh */}
            <button
              onClick={() => setAutoRefresh(!autoRefresh)}
              className={cn(
                "p-1 rounded-md transition-colors",
                autoRefresh ? "text-primary bg-primary/10" : "text-muted-foreground hover:text-foreground hover:bg-muted"
              )}
              title={autoRefresh ? "Stop auto-refresh" : "Auto-refresh (watch for changes)"}
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
            {/* Refresh */}
            <button
              onClick={refresh}
              className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded-md hover:bg-muted"
              title="Refresh"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            </button>
          </div>
        )}
        {/* Search bar */}
        {searchOpen && (
          <div className="shrink-0 space-y-1">
            <div className="flex items-center gap-1">
              <div className="relative flex-1">
                {searchMode === "ai" ? (
                  <Sparkles className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-primary pointer-events-none" />
                ) : (
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
                )}
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={
                    searchMode === "ai"
                      ? "Ask AI: \u201Cthe contract Mary sent me\u201D…"
                      : searchMode === "content"
                        ? "Search file contents..."
                        : "Search filenames..."
                  }
                  className="w-full pl-6 pr-2 py-1 text-xs bg-muted/40 border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary/50 placeholder:text-muted-foreground/50"
                  onKeyDown={(e) => { if (e.key === "Escape") setSearchOpen(false); }}
                />
                {searchLoading && (
                  <div className="absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 border-[1.5px] border-muted-foreground/30 border-t-primary rounded-full animate-spin" />
                )}
              </div>
              <button onClick={() => setSearchOpen(false)} className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="flex items-center gap-2 px-0.5">
              <button
                onClick={() => {
                  // Cycle: name → content → ai → name
                  const next = searchMode === "name" ? "content" : searchMode === "content" ? "ai" : "name";
                  setSearchMode(next);
                }}
                className={cn(
                  "flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded transition-colors",
                  searchMode === "ai"
                    ? "bg-primary/15 text-primary border border-primary/30"
                    : searchMode === "content"
                      ? "bg-primary/10 text-primary border border-primary/20"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted"
                )}
                title="Cycle search mode (filename → content → AI)"
              >
                {searchMode === "ai" ? (
                  <><Sparkles className="h-2.5 w-2.5" /> AI</>
                ) : searchMode === "content" ? (
                  <><FileSearch className="h-2.5 w-2.5" /> Content</>
                ) : (
                  <><FileSearch className="h-2.5 w-2.5" /> Filename</>
                )}
              </button>
              <button
                onClick={() => setSearchGlobal(!searchGlobal)}
                className={cn(
                  "flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded transition-colors",
                  searchGlobal ? "bg-primary/10 text-primary border border-primary/20" : "text-muted-foreground hover:text-foreground hover:bg-muted"
                )}
              >
                <Globe className="h-2.5 w-2.5" />
                {searchGlobal ? "Global" : "Current dir"}
              </button>
              {isSearchActive && !searchLoading && (
                <span className="text-[10px] text-muted-foreground ml-auto">
                  {searchResults.length}{searchTotal > searchResults.length ? ` of ${searchTotal}` : ""} result{searchResults.length !== 1 ? "s" : ""}
                </span>
              )}
            </div>
          </div>
        )}

        {/* Git panel */}
        {gitOpen && gitStatus?.isGitRepo && (
          <div className="shrink-0 max-h-[45%] flex flex-col border border-border rounded-md overflow-hidden bg-muted/10">
            <div className="flex items-center justify-between px-2 py-1.5 bg-muted/30 border-b border-border">
              <div className="flex items-center gap-2 min-w-0">
                <GitBranch className="h-3 w-3 text-muted-foreground shrink-0" />
                <span className="text-[11px] font-medium truncate">{gitStatus.branch}</span>
                {(gitStatus.ahead || 0) > 0 && <span className="text-[9px] text-green-500 shrink-0">↑{gitStatus.ahead}</span>}
                {(gitStatus.behind || 0) > 0 && <span className="text-[9px] text-orange-500 shrink-0">↓{gitStatus.behind}</span>}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button onClick={() => fetchGitStatus(resolvedPath)} className="text-muted-foreground hover:text-foreground p-0.5 rounded hover:bg-muted transition-colors" title="Refresh git status">
                  <RefreshCw className={cn("h-3 w-3", gitLoading && "animate-spin")} />
                </button>
                <button onClick={() => setGitOpen(false)} className="text-muted-foreground hover:text-foreground p-0.5 rounded hover:bg-muted transition-colors">
                  <X className="h-3 w-3" />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto scrollbar-thin">
              {gitChangedCount === 0 ? (
                <div className="flex items-center justify-center py-4 text-muted-foreground">
                  <span className="text-xs">Working tree clean</span>
                </div>
              ) : (
                <div className="py-0.5">
                  {gitStagedFiles.length > 0 && (
                    <div>
                      <div className="flex items-center gap-1.5 px-2 py-1 text-[10px] text-green-600 dark:text-green-400 font-medium uppercase tracking-wider">
                        <Plus className="h-2.5 w-2.5" /> Staged ({gitStagedFiles.length})
                      </div>
                      {gitStagedFiles.map((f) => (
                        <button key={`staged-${f.path}`} onClick={() => { handleGitFileClick(f.path); fetchDiff(f.path, true); }} className="w-full flex items-center gap-2 px-3 py-1 text-xs hover:bg-muted/50 transition-colors text-left">
                          <GitStatusBadge status={f.status} />
                          <span className="truncate flex-1 text-green-700 dark:text-green-300">{f.path}</span>
                          <Diff className="h-3 w-3 text-muted-foreground/50 shrink-0" />
                        </button>
                      ))}
                    </div>
                  )}
                  {gitWorkingFiles.length > 0 && (
                    <div>
                      <div className="flex items-center gap-1.5 px-2 py-1 text-[10px] text-yellow-600 dark:text-yellow-400 font-medium uppercase tracking-wider">
                        <Pencil className="h-2.5 w-2.5" /> Changes ({gitWorkingFiles.length})
                      </div>
                      {gitWorkingFiles.map((f) => (
                        <button key={`working-${f.path}`} onClick={() => { handleGitFileClick(f.path); fetchDiff(f.path, false); }} className="w-full flex items-center gap-2 px-3 py-1 text-xs hover:bg-muted/50 transition-colors text-left">
                          <GitStatusBadge status={f.status} />
                          <span className={cn("truncate flex-1", f.status === "?" ? "text-muted-foreground" : f.status === "D" ? "text-red-500 line-through" : "text-yellow-700 dark:text-yellow-300")}>{f.path}</span>
                          {f.status !== "?" && <Diff className="h-3 w-3 text-muted-foreground/50 shrink-0" />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            {gitStatus.lastCommit && (
              <div className="flex items-center gap-1.5 px-2 py-1 border-t border-border bg-muted/20 text-[9px] text-muted-foreground truncate">
                <GitCommit className="h-2.5 w-2.5 shrink-0" />
                <span className="truncate">{gitStatus.lastCommit}</span>
              </div>
            )}
          </div>
        )}

        {/* Git Actions panel */}
        {showGitActions && gitStatus?.isGitRepo && (
          <GitActionsPanel
            resolvedPath={resolvedPath}
            gitStatus={gitStatus}
            onRefreshGit={() => fetchGitStatus(resolvedPath)}
            onOpenTerminal={(cmd) => setSplitTerminal({ cwd: resolvedPath, command: cmd, label: "Git" })}
            onClose={() => setShowGitActions(false)}
          />
        )}

        {/* Bookmarks panel */}
        {showBookmarks && (
          <BookmarksPanel
            bookmarks={bookmarks}
            onNavigate={(p) => {
              // Navigate to dir or open file
              const isDir = bookmarks.find((b) => b.path === p)?.isDirectory;
              if (isDir) { fetchDir(p); setShowBookmarks(false); }
              else {
                const name = p.split("/").pop() || p;
                const ext = name.includes(".") ? "." + name.split(".").pop()!.toLowerCase() : "";
                openPreview({ name, path: p, extension: ext });
                setShowBookmarks(false);
              }
            }}
            onRemove={(p) => {
              fetch("/api/files", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "bookmark", subAction: "remove", filePath: p }) })
                .then((r) => r.json())
                .then((d) => setBookmarks(d.bookmarks || []))
                .catch(() => {});
            }}
            onClose={() => setShowBookmarks(false)}
          />
        )}

        {/* Language Stats */}
        {showLangStats && langStats && (
          <LanguageStatsBar stats={langStats} onClose={() => setShowLangStats(false)} />
        )}

        {/* Project Actions */}
        {showProject && projectInfo && (
          <ProjectActionsPanel
            project={projectInfo}
            onRunScript={(cmd) => setSplitTerminal({ cwd: resolvedPath, command: cmd, label: "Script" })}
            onClose={() => setShowProject(false)}
          />
        )}

        {/* AI Cleanup Assistant */}
        {cleanupFor && (
          <CleanupAssistantPanel
            folderPath={cleanupFor}
            onClose={() => setCleanupFor(null)}
            onDeleted={() => fetchDir(resolvedPath)}
          />
        )}

        {/* Diff viewer — image diff for image files, text diff otherwise */}
        {diffContent !== null && diffFile && (
          <div className="shrink-0 max-h-[45%] border border-border rounded-md overflow-hidden">
            {imageExtensions.has(("." + (diffFile.split(".").pop() || "")).toLowerCase()) && gitStatus?.repoRoot ? (
              <ImageDiffViewer filePath={diffFile} repoRoot={gitStatus.repoRoot} onClose={() => { setDiffContent(null); setDiffFile(null); }} />
            ) : (
              <DiffViewer diff={diffContent} onClose={() => { setDiffContent(null); setDiffFile(null); }} />
            )}
          </div>
        )}

        {/* Blame viewer */}
        {blameLines !== null && (
          <div className="shrink-0 max-h-[45%] border border-border rounded-md overflow-hidden">
            <BlameViewer blameLines={blameLines} onClose={() => setBlameLines(null)} />
          </div>
        )}

        {/* Symbol outline (shown beside preview) */}
        {showSymbols && symbols && (
          <div className="shrink-0 max-h-[30%] border border-border rounded-md overflow-hidden">
            <SymbolOutline
              symbols={symbols}
              onSelect={() => {
                // TODO: scroll to line in the preview textarea if editing
              }}
              onClose={() => { setShowSymbols(false); setSymbols(null); }}
            />
          </div>
        )}

        {/* Breadcrumb toolbar — hidden in recent view and during active search */}
        {viewMode !== "recent" && !isSearchActive && (
          <div className="flex items-center gap-1 shrink-0">
            {/* VPS source selector */}
            {vpsConnections.length > 0 && (
              <select
                value={singleViewVps ? singleViewVps.id : "local"}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === "local") {
                    setSingleViewVps(null);
                  } else {
                    const conn = vpsConnections.find((c) => c.id === val);
                    if (conn) setSingleViewVps({ id: val, connection: conn });
                  }
                }}
                className="text-[10px] bg-muted/50 border border-border rounded px-1 py-0.5 outline-none max-w-[90px] truncate shrink-0"
                title="File source"
              >
                <option value="local">Local</option>
                {vpsConnections.map((c) => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
            )}
            {isVpsMode && <Wifi className="h-3 w-3 text-green-500 shrink-0" />}
            <button onClick={goUp} disabled={!parentPath && resolvedPath === "/" && !isVpsMode} className="text-muted-foreground hover:text-foreground transition-colors p-0.5 rounded hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed shrink-0" title="Go up">
              <ArrowUp className="h-3.5 w-3.5" />
            </button>
            <button onClick={goHome} className="text-muted-foreground hover:text-foreground transition-colors p-0.5 rounded hover:bg-muted shrink-0" title="Home">
              <Home className="h-3.5 w-3.5" />
            </button>
            <PathJump currentPath={resolvedPath || "~"} onNavigate={fetchDir} />
            {/* Project detection indicator — local only */}
            {!isVpsMode && projectInfo && (
              <button
                onClick={() => setShowProject(!showProject)}
                className={cn(
                  "p-0.5 rounded transition-colors shrink-0",
                  showProject ? "text-primary bg-primary/10" : "text-muted-foreground hover:text-foreground hover:bg-muted"
                )}
                title={`${projectInfo.type} project: ${projectInfo.name}`}
              >
                <FolderCode className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )}

        {/* File preview panel — shown in list/grid/tree modes */}
        {preview && !isSearchActive && !gitOpen && viewMode !== "gallery" && viewMode !== "columns" && (
          <div className={cn("flex flex-col border border-border rounded-md overflow-hidden bg-muted/20", monacoMode ? "flex-1 min-h-0" : "shrink-0 max-h-[55%]")}>
            {/* Multi-file tabs */}
            <FileTabs tabs={openTabs} activeIdx={activeTabIdx} onSelect={selectTab} onClose={closeTab} />
            <div className="flex items-center justify-between px-2 py-1 bg-muted/40 border-b border-border">
              <span className="text-[10px] font-medium truncate">
                {preview.name}
                {saveStatus === "saved" && <span className="ml-2 text-green-500 text-[9px]">Saved</span>}
                {saveStatus === "error" && <span className="ml-2 text-red-500 text-[9px]">Save failed</span>}
              </span>
              <div className="flex items-center gap-1 shrink-0">
                {/* Blame button */}
                {!editing && !monacoMode && gitStatus?.isGitRepo && preview.filePath && isTextFile(preview.extension) && (
                  <button
                    onClick={() => { if (blameLines) setBlameLines(null); else if (preview.filePath) fetchBlame(preview.filePath); }}
                    className={cn("p-0.5 rounded hover:bg-muted transition-colors", blameLines ? "text-primary" : "text-muted-foreground hover:text-foreground")}
                    title="Toggle git blame"
                  >
                    <User className="h-3 w-3" />
                  </button>
                )}
                {/* Symbols/outline button */}
                {!editing && !monacoMode && preview.filePath && isTextFile(preview.extension) && (
                  <button
                    onClick={() => { if (showSymbols) { setShowSymbols(false); setSymbols(null); } else if (preview.filePath) fetchSymbols(preview.filePath); }}
                    className={cn("p-0.5 rounded hover:bg-muted transition-colors", showSymbols ? "text-primary" : "text-muted-foreground hover:text-foreground")}
                    title="Toggle symbol outline"
                  >
                    <ListTree className="h-3 w-3" />
                  </button>
                )}
                {/* AI summary button — text files and PDFs */}
                {!editing && !monacoMode && preview.filePath && (isTextFile(preview.extension) || preview.extension === ".pdf") && (
                  <button
                    onClick={() => {
                      if (aiSummary || aiSummaryError) {
                        // Toggle off
                        setAiSummary(null);
                        setAiSummaryError(null);
                        setAiSummaryFor(null);
                      } else if (preview.filePath) {
                        fetchAiSummary(preview.filePath);
                      }
                    }}
                    disabled={aiSummaryLoading}
                    className={cn(
                      "p-0.5 rounded hover:bg-muted transition-colors disabled:opacity-50",
                      (aiSummary || aiSummaryError) ? "text-primary" : "text-muted-foreground hover:text-foreground"
                    )}
                    title={aiSummary ? "Hide AI summary" : "Summarize with AI"}
                  >
                    {aiSummaryLoading ? (
                      <div className="h-3 w-3 border-[1.5px] border-muted-foreground/30 border-t-primary rounded-full animate-spin" />
                    ) : (
                      <Sparkles className="h-3 w-3" />
                    )}
                  </button>
                )}
                {!editing && !monacoMode && !preview.truncated && isTextFile(preview.extension) && (
                  <button onClick={startEditing} className="text-muted-foreground hover:text-foreground p-0.5 rounded hover:bg-muted transition-colors" title="Edit file">
                    <Pencil className="h-3 w-3" />
                  </button>
                )}
                {editing && !monacoMode && (
                  <>
                    <button onClick={saveFile} disabled={saving} className="text-green-600 hover:text-green-500 p-0.5 rounded hover:bg-muted transition-colors disabled:opacity-50" title="Save (Cmd+S)">
                      <Save className={cn("h-3 w-3", saving && "animate-pulse")} />
                    </button>
                    <button onClick={cancelEditing} className="text-muted-foreground hover:text-foreground p-0.5 rounded hover:bg-muted transition-colors" title="Cancel editing">
                      <Undo2 className="h-3 w-3" />
                    </button>
                  </>
                )}
                {/* Copy path */}
                {preview.filePath && (
                  <button onClick={() => navigator.clipboard.writeText(preview.filePath || "")} className="text-muted-foreground hover:text-foreground p-0.5 rounded hover:bg-muted transition-colors" title="Copy path">
                    <ClipboardCopy className="h-3 w-3" />
                  </button>
                )}
                <button onClick={() => { if (preview.filePath) window.open(rawFileUrl(preview.filePath), "_blank", "noopener,noreferrer"); }} className="text-muted-foreground hover:text-foreground p-0.5 rounded hover:bg-muted transition-colors" title="Open in new tab">
                  <ExternalLink className="h-3 w-3" />
                </button>
                <button onClick={() => { setPreview(null); setEditing(false); setMonacoMode(false); setDiffContent(null); setBlameLines(null); setShowSymbols(false); setSymbols(null); }} className="text-muted-foreground hover:text-foreground p-0.5 rounded hover:bg-muted transition-colors">
                  <X className="h-3 w-3" />
                </button>
              </div>
            </div>
            {/* AI summary panel — shown above the file content when active */}
            {(aiSummary || aiSummaryError || aiSummaryLoading) && aiSummaryFor === preview.filePath && (
              <div className="shrink-0 border-b border-border bg-primary/5 px-2 py-1.5 max-h-[40%] overflow-y-auto scrollbar-thin">
                <div className="flex items-center gap-1.5 mb-1 text-[10px] font-medium text-primary">
                  <Sparkles className="h-3 w-3" />
                  <span>AI summary</span>
                  {aiSummaryLoading && (
                    <div className="h-2.5 w-2.5 border-[1.5px] border-primary/30 border-t-primary rounded-full animate-spin ml-auto" />
                  )}
                  {!aiSummaryLoading && (
                    <button
                      onClick={() => { setAiSummary(null); setAiSummaryError(null); setAiSummaryFor(null); }}
                      className="ml-auto text-muted-foreground hover:text-foreground p-0.5 rounded hover:bg-muted transition-colors"
                      title="Hide summary"
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  )}
                </div>
                {aiSummaryError ? (
                  <div className="flex items-start gap-1.5 text-[11px] text-red-500">
                    <AlertCircle className="h-3 w-3 shrink-0 mt-0.5" />
                    <span>{aiSummaryError}</span>
                  </div>
                ) : aiSummary ? (
                  <div className="text-[11px] leading-relaxed text-foreground prose prose-sm dark:prose-invert max-w-none [&_p]:my-1 [&_ul]:my-1 [&_ul]:pl-4 [&_li]:my-0 [&_strong]:font-semibold [&_strong]:text-foreground [&_h1]:text-xs [&_h2]:text-xs [&_h3]:text-xs [&_code]:text-[10px] [&_code]:bg-muted [&_code]:px-1 [&_code]:rounded">
                    <ReactMarkdown>{aiSummary}</ReactMarkdown>
                  </div>
                ) : (
                  <div className="text-[11px] text-muted-foreground italic">
                    Reading the file…
                  </div>
                )}
              </div>
            )}
            <div className={cn("flex-1 overflow-hidden", monacoMode ? "min-h-0" : "overflow-auto p-2")}>
              {previewLoading ? (
                <div className="flex items-center gap-2 text-muted-foreground text-[10px] p-2">
                  <div className="h-3 w-3 border-2 border-muted-foreground/30 border-t-primary rounded-full animate-spin" />
                  Loading...
                </div>
              ) : monacoMode ? (
                <MonacoEditorPanel
                  content={preview.content}
                  extension={preview.extension}
                  filePath={preview.filePath}
                  readOnly={isVpsMode}
                  onSave={isVpsMode ? undefined : async (newContent) => {
                    if (!preview.filePath) return;
                    setSaving(true); setSaveStatus(null);
                    try {
                      const res = await fetch("/api/files", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ action: "save", path: preview.filePath, content: newContent }),
                      });
                      const data = await res.json();
                      if (data.saved) {
                        setPreview((prev) => prev ? { ...prev, content: newContent } : prev);
                        setSaveStatus("saved");
                        setTimeout(() => setSaveStatus(null), 2000);
                        if (resolvedPath) fetchGitStatus(resolvedPath);
                      } else { setSaveStatus("error"); }
                    } catch { setSaveStatus("error"); }
                    setSaving(false);
                  }}
                />
              ) : editing ? (
                <textarea
                  ref={editTextareaRef}
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "s" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); saveFile(); }
                    if (e.key === "Escape") cancelEditing();
                  }}
                  className="w-full h-full min-h-[200px] text-[10px] leading-relaxed font-mono bg-transparent border-none outline-none resize-none text-foreground"
                  spellCheck={false}
                />
              ) : (
                <HighlightedCode code={preview.content} extension={preview.extension} />
              )}
            </div>
            {preview.truncated && !editing && !monacoMode && (
              <div className="text-[9px] text-muted-foreground/60 px-2 py-0.5 border-t border-border bg-muted/20 text-center">
                File truncated (showing first 100KB)
              </div>
            )}
          </div>
        )}

        {/* Inline new-entry row (visible across all views) */}
        {newEntry && (
          <NewEntryRow
            type={newEntry.type}
            inDir={newEntry.inDir}
            onCommit={commitNewEntry}
            onCancel={() => setNewEntry(null)}
          />
        )}

        {/* ── Main content area ── */}
        {isSearchActive ? (
          /* Search results */
          <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto scrollbar-thin">
            {searchLoading && searchResults.length === 0 ? (
              <div className="flex items-center justify-center h-full text-muted-foreground">
                <div className="flex items-center gap-2">
                  <div className="h-4 w-4 border-2 border-muted-foreground/30 border-t-primary rounded-full animate-spin" />
                  <span className="text-xs">Searching...</span>
                </div>
              </div>
            ) : searchResults.length === 0 && !searchLoading ? (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-1 px-4 text-center">
                <span className="text-xs">{aiSearchNote || "No matches found"}</span>
                {searchMode === "ai" && !aiSearchNote && (
                  <span className="text-[10px] text-muted-foreground/60">
                    Try rephrasing — AI search looks at filenames, dates, and folder context.
                  </span>
                )}
              </div>
            ) : (
              <div className="space-y-0">
                {searchResults.map((result) => (
                  <div key={result.path} className="group flex items-start gap-2 px-2 py-1.5 rounded-md hover:bg-muted/60 transition-colors cursor-pointer" onClick={() => handleSearchResultClick(result)}>
                    <FileIcon entry={result} className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className={cn("text-xs truncate", result.isDirectory && "font-medium")}>{result.name}</span>
                        {result.confidence && (
                          <span
                            className={cn(
                              "text-[8px] uppercase font-bold px-1 py-px rounded shrink-0",
                              result.confidence === "high"
                                ? "bg-green-500/15 text-green-600 dark:text-green-400"
                                : result.confidence === "medium"
                                  ? "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400"
                                  : "bg-muted text-muted-foreground"
                            )}
                            title={`AI confidence: ${result.confidence}`}
                          >
                            {result.confidence}
                          </span>
                        )}
                        {!result.isDirectory && <span className="text-[9px] text-muted-foreground/50 shrink-0">{formatSize(result.size)}</span>}
                      </div>
                      <div className="text-[10px] text-muted-foreground/60 truncate">{shortenPath(result.path)}</div>
                      {result.reason && (
                        <div className="text-[10px] text-primary/80 mt-0.5 italic flex items-start gap-1">
                          <Sparkles className="h-2.5 w-2.5 shrink-0 mt-0.5" />
                          <span className="flex-1">{result.reason}</span>
                        </div>
                      )}
                      {result.matchLine && (
                        <div className="text-[10px] text-muted-foreground mt-0.5 truncate font-mono bg-muted/40 rounded px-1 py-0.5">
                          {result.matchLineNumber && <span className="text-muted-foreground/40 mr-1">L{result.matchLineNumber}:</span>}
                          {result.matchLine}
                        </div>
                      )}
                    </div>
                    {!result.isDirectory && (
                      <button onClick={(e) => { e.stopPropagation(); window.open(rawFileUrl(result.path), "_blank", "noopener,noreferrer"); }} className="p-0.5 rounded hover:bg-muted text-muted-foreground/0 group-hover:text-muted-foreground hover:!text-foreground transition-colors shrink-0 mt-0.5" title="Open in new tab">
                        <ExternalLink className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : viewMode === "recent" ? (
          <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto scrollbar-thin">
            <RecentView
              onFileClick={handleFileClick}
              onOpenParent={(dirPath) => {
                fetchDir(dirPath);
                handleViewModeChange("list");
                listRef.current?.scrollTo(0, 0);
              }}
            />
          </div>
        ) : viewMode === "gallery" ? (
          <div className="flex-1 min-h-0 overflow-hidden">
            {loading ? (
              <div className="flex items-center justify-center h-full text-muted-foreground">
                <div className="h-4 w-4 border-2 border-muted-foreground/30 border-t-primary rounded-full animate-spin" />
              </div>
            ) : (
              <GalleryView
                entries={displayEntries || filteredEntries}
                dirPath={resolvedPath}
                onFileClick={openPreview}
                onNavigate={(e) => { fetchDir(e.path); listRef.current?.scrollTo(0, 0); }}
                onContextMenu={openCtxMenu}
              />
            )}
          </div>
        ) : viewMode === "columns" ? (
          <div className="flex-1 min-h-0 overflow-hidden">
            <ColumnsView
              initialPath={resolvedPath || "~"}
              onContextMenu={openCtxMenu}
            />
          </div>
        ) : viewMode === "tree" ? (
          <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto scrollbar-thin">
            {loading ? (
              <div className="flex items-center justify-center h-full text-muted-foreground">
                <div className="h-4 w-4 border-2 border-muted-foreground/30 border-t-primary rounded-full animate-spin" />
              </div>
            ) : error ? (
              <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground text-center px-4">
                <span className="text-xs">{error}</span>
                <button onClick={goUp} className="text-xs text-primary hover:underline">Go back</button>
              </div>
            ) : (
              <TreeView
                rootPath={resolvedPath}
                rootEntries={filteredEntries}
                onFileClick={handleFileClick}
                onContextMenu={openCtxMenu}
              />
            )}
          </div>
        ) : viewMode === "grid" ? (
          <div
            ref={listRef}
            className="flex-1 min-h-0 overflow-y-auto scrollbar-thin focus:outline-none"
            tabIndex={0}
            onKeyDown={handleListKeyDown}
          >
            {loading && entries.length === 0 ? (
              <div className="flex items-center justify-center h-full text-muted-foreground">
                <div className="h-4 w-4 border-2 border-muted-foreground/30 border-t-primary rounded-full animate-spin" />
              </div>
            ) : error ? (
              <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground text-center px-4">
                <span className="text-xs">{error}</span>
                <button onClick={goUp} className="text-xs text-primary hover:underline">Go back</button>
              </div>
            ) : (
              <GridView
                entries={displayEntries || filteredEntries}
                selectedPath={listFocusedIdx >= 0 ? (displayEntries || filteredEntries)[listFocusedIdx]?.path : null}
                dirPath={resolvedPath}
                onFileClick={handleFileClick}
                onDragStart={handleDragStart}
                onContextMenu={openCtxMenu}
              />
            )}
          </div>
        ) : (
          /* Default: list view */
          <div
            ref={listRef}
            className="flex-1 min-h-0 overflow-y-auto scrollbar-thin focus:outline-none"
            tabIndex={0}
            onKeyDown={handleListKeyDown}
          >
            {loading && entries.length === 0 ? (
              <div className="flex items-center justify-center h-full text-muted-foreground">
                <div className="h-4 w-4 border-2 border-muted-foreground/30 border-t-primary rounded-full animate-spin" />
              </div>
            ) : error ? (
              <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground text-center px-4">
                <span className="text-xs">{error}</span>
                <button onClick={goUp} className="text-xs text-primary hover:underline">Go back</button>
              </div>
            ) : displayEntries && displayEntries.length === 0 ? (
              <div className="flex items-center justify-center h-full text-muted-foreground">
                <span className="text-xs">{localFilteredEntries ? "No matches" : "Empty directory"}</span>
              </div>
            ) : displayEntries ? (
              <div className="space-y-0">
                {displayEntries.map((entry, idx) => (
                    <div
                      key={entry.path}
                      draggable
                      onDragStart={(e) => handleDragStart(e, entry)}
                      onContextMenu={(e) => openCtxMenu(e, entry, resolvedPath)}
                      className={cn(
                        "group flex items-center gap-2 px-2 py-1 rounded-md hover:bg-muted/60 transition-colors cursor-grab active:cursor-grabbing",
                        listFocusedIdx === idx && "bg-primary/10 ring-1 ring-inset ring-primary/20"
                      )}
                      onClick={() => { setListFocusedIdx(idx); handleFileClick(entry); }}
                    >
                      <FileIcon entry={entry} className="h-3.5 w-3.5 shrink-0 pointer-events-none" />
                      <a
                        href={entry.isDirectory ? undefined : rawFileUrl(entry.path)}
                        className={cn("flex-1 text-xs truncate", entry.isDirectory && "font-medium")}
                        onClick={(e) => e.preventDefault()}
                        draggable={false}
                        tabIndex={-1}
                      >
                        {entry.name}
                      </a>
                      {!entry.isDirectory && (
                        <button onClick={(e) => { e.stopPropagation(); window.open(rawFileUrl(entry.path), "_blank", "noopener,noreferrer"); }} className="p-0.5 rounded hover:bg-muted text-muted-foreground/0 group-hover:text-muted-foreground hover:!text-foreground transition-colors shrink-0" title="Open in new tab">
                          <ExternalLink className="h-3 w-3" />
                        </button>
                      )}
                      <button
                        onClick={(e) => { e.stopPropagation(); deleteEntry(entry); }}
                        className="p-0.5 rounded hover:bg-muted text-muted-foreground/0 group-hover:text-red-400/60 hover:!text-red-400 transition-colors shrink-0"
                        title="Delete"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                      <span className="text-[9px] text-muted-foreground/60 shrink-0 hidden group-hover:block pointer-events-none">{entry.isDirectory ? "" : formatSize(entry.size)}</span>
                      <span className="text-[9px] text-muted-foreground/60 shrink-0 group-hover:hidden pointer-events-none">{formatDate(entry.modified)}</span>
                    </div>
                ))}
              </div>
            ) : null}
          </div>
        )}

        {/* Status bar */}
        <div className="shrink-0 text-[9px] text-muted-foreground/60 flex items-center justify-between px-1">
          {isSearchActive ? (
            <span>{searchResults.length} result{searchResults.length !== 1 ? "s" : ""}{searchTotal > searchResults.length ? ` (${searchTotal} total)` : ""}</span>
          ) : viewMode === "recent" ? (
            <span>Recent files</span>
          ) : (
            <>
              <span>
                {localFilteredEntries ? `${localFilteredEntries.length}/${filteredEntries.length} items` : `${filteredEntries.length} items`}
                {hideGitignored && gitIgnoredNames.size > 0 && ` (${gitIgnoredNames.size} gitignored)`}
              </span>
              <div className="flex items-center gap-2">
                {autoRefresh && <span className="text-primary flex items-center gap-0.5"><RotateCcw className="h-2 w-2 animate-spin" />watching</span>}
                {openTabs.length > 1 && <span>{openTabs.length} tabs</span>}
                {!showHidden && entries.length > filteredEntries.length && (
                  <span>{entries.length - filteredEntries.length} hidden</span>
                )}
                {projectInfo && <span className="flex items-center gap-0.5"><Package className="h-2.5 w-2.5" />{projectInfo.type}</span>}
                {gitStatus?.isGitRepo && (
                  <span className="flex items-center gap-1">
                    <GitBranch className="h-2.5 w-2.5" />
                    {gitStatus.branch}
                    {(gitStatus.ahead || 0) > 0 && <span className="text-green-500">↑{gitStatus.ahead}</span>}
                    {(gitStatus.behind || 0) > 0 && <span className="text-orange-500">↓{gitStatus.behind}</span>}
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      </div>
      )}
    </WidgetWrapper>

    {/* VPS Connection dialog portal */}
    {showVpsDialog && (
      <VpsConnectionDialog
        connections={vpsConnections}
        editingConn={editingVpsConn}
        onClose={() => { setShowVpsDialog(false); setEditingVpsConn(null); }}
        onSaved={fetchVpsConnections}
      />
    )}

    {/* Context menu portal */}
    {ctxMenu && (
      <FileContextMenu
        state={ctxMenu}
        onClose={() => setCtxMenu(null)}
        onNewFile={(inDir) => startNewEntry("file", inDir)}
        onNewFolder={(inDir) => startNewEntry("folder", inDir)}
        onRename={startRename}
        onDelete={deleteEntry}
        onCopyPath={copyPath}
        onCopyRelativePath={copyRelativePath}
        onToggleBookmark={toggleBookmark}
        onCleanup={(entry) => { setCleanupFor(entry.path); setCtxMenu(null); }}
        onPaste={handlePasteFromClipboard}
        isBookmarked={ctxMenu ? bookmarks.some((b) => b.path === ctxMenu.entry.path) : false}
      />
    )}

    {/* Rename dialog portal */}
    {renamingEntry && (
      <RenameDialog
        entry={renamingEntry}
        value={renameValue}
        onChange={setRenameValue}
        onCommit={commitRename}
        onCancel={() => setRenamingEntry(null)}
        inputRef={renameInputRef}
      />
    )}
    </>
  );
}
