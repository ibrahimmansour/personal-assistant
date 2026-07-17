"use client";

import { WidgetWrapper } from "@/components/widget-wrapper";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  StickyNote,
  Plus,
  Search,
  ArrowLeft,
  Trash2,
  Pin,
  PinOff,
  Copy,
  Loader2,
  AlertCircle,
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  ListChecks,
  Code,
  Quote,
  Highlighter,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Minus,
  Undo2,
  Redo2,
  MoreHorizontal,
  CloudUpload,
  CloudDownload,
  Cloud,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useEffect, useState, useCallback, useRef } from "react";
import { useProfile } from "@/components/profile-context";
import { useWidgetNavFor } from "@/components/widget-nav-context";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TiptapUnderline from "@tiptap/extension-underline";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Placeholder from "@tiptap/extension-placeholder";
import Highlight from "@tiptap/extension-highlight";
import TextAlign from "@tiptap/extension-text-align";

// ─── Types ───────────────────────────────────────────────────────────────────

interface Note {
  id: string;
  title: string;
  content: string;
  pinned: boolean;
  folder: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function formatDate(isoStr: string): string {
  const date = new Date(isoStr);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  if (isToday) {
    return date.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  }
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) {
    return "Yesterday";
  }
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ─── Toolbar Button ──────────────────────────────────────────────────────────

function ToolbarButton({
  onClick,
  active,
  disabled,
  title,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onMouseDown={(e) => {
        e.preventDefault(); // Prevent focus loss
        onClick();
      }}
      disabled={disabled}
      title={title}
      className={cn(
        "p-1 rounded transition-colors",
        active
          ? "bg-primary/15 text-primary"
          : "text-muted-foreground hover:text-foreground hover:bg-muted",
        disabled && "opacity-30 cursor-not-allowed"
      )}
    >
      {children}
    </button>
  );
}

// ─── Editor Toolbar ──────────────────────────────────────────────────────────

function EditorToolbar({ editor }: { editor: ReturnType<typeof useEditor> | null }) {
  if (!editor) return null;

  const iconSize = "h-3.5 w-3.5";

  return (
    <div className="flex items-center gap-0.5 flex-wrap pb-2 border-b border-border mb-2">
      {/* Undo / Redo */}
      <ToolbarButton
        onClick={() => editor.chain().focus().undo().run()}
        disabled={!editor.can().undo()}
        title="Undo"
      >
        <Undo2 className={iconSize} />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().redo().run()}
        disabled={!editor.can().redo()}
        title="Redo"
      >
        <Redo2 className={iconSize} />
      </ToolbarButton>

      <div className="w-px h-4 bg-border mx-0.5" />

      {/* Headings */}
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        active={editor.isActive("heading", { level: 1 })}
        title="Heading 1"
      >
        <Heading1 className={iconSize} />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        active={editor.isActive("heading", { level: 2 })}
        title="Heading 2"
      >
        <Heading2 className={iconSize} />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        active={editor.isActive("heading", { level: 3 })}
        title="Heading 3"
      >
        <Heading3 className={iconSize} />
      </ToolbarButton>

      <div className="w-px h-4 bg-border mx-0.5" />

      {/* Inline formatting */}
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBold().run()}
        active={editor.isActive("bold")}
        title="Bold"
      >
        <Bold className={iconSize} />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleItalic().run()}
        active={editor.isActive("italic")}
        title="Italic"
      >
        <Italic className={iconSize} />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        active={editor.isActive("underline")}
        title="Underline"
      >
        <UnderlineIcon className={iconSize} />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleStrike().run()}
        active={editor.isActive("strike")}
        title="Strikethrough"
      >
        <Strikethrough className={iconSize} />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHighlight().run()}
        active={editor.isActive("highlight")}
        title="Highlight"
      >
        <Highlighter className={iconSize} />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleCode().run()}
        active={editor.isActive("code")}
        title="Inline code"
      >
        <Code className={iconSize} />
      </ToolbarButton>

      <div className="w-px h-4 bg-border mx-0.5" />

      {/* Lists */}
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        active={editor.isActive("bulletList")}
        title="Bullet list"
      >
        <List className={iconSize} />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        active={editor.isActive("orderedList")}
        title="Numbered list"
      >
        <ListOrdered className={iconSize} />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleTaskList().run()}
        active={editor.isActive("taskList")}
        title="Checklist"
      >
        <ListChecks className={iconSize} />
      </ToolbarButton>

      <div className="w-px h-4 bg-border mx-0.5" />

      {/* Block */}
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        active={editor.isActive("blockquote")}
        title="Quote"
      >
        <Quote className={iconSize} />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        active={editor.isActive("codeBlock")}
        title="Code block"
      >
        <span className="text-[10px] font-mono font-bold leading-none px-0.5">{"{}"}</span>
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().setHorizontalRule().run()}
        title="Horizontal rule"
      >
        <Minus className={iconSize} />
      </ToolbarButton>

      <div className="w-px h-4 bg-border mx-0.5" />

      {/* Alignment */}
      <ToolbarButton
        onClick={() => editor.chain().focus().setTextAlign("left").run()}
        active={editor.isActive({ textAlign: "left" })}
        title="Align left"
      >
        <AlignLeft className={iconSize} />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().setTextAlign("center").run()}
        active={editor.isActive({ textAlign: "center" })}
        title="Align center"
      >
        <AlignCenter className={iconSize} />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().setTextAlign("right").run()}
        active={editor.isActive({ textAlign: "right" })}
        title="Align right"
      >
        <AlignRight className={iconSize} />
      </ToolbarButton>
    </div>
  );
}

// ─── Note Editor Content ─────────────────────────────────────────────────────

function NoteEditorContent({
  note,
  onSave,
}: {
  note: Note;
  onSave: (id: string, title: string, content: string) => void;
}) {
  const [title, setTitle] = useState(note.title);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      TiptapUnderline,
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder: "Start writing..." }),
      Highlight.configure({ multicolor: false }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
    ],
    content: note.content,
    editorProps: {
      attributes: {
        class: "outline-none min-h-[100px] prose-sm",
      },
    },
    onUpdate: ({ editor: ed }) => {
      // Debounced auto-save
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        onSave(note.id, title, ed.getHTML());
      }, 800);
    },
  });

  // Save title changes (debounced)
  useEffect(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      if (editor) {
        onSave(note.id, title, editor.getHTML());
      }
    }, 800);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title]);

  // Flush pending save on unmount
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        if (editor) {
          onSave(note.id, title, editor.getHTML());
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-col h-full">
      {/* Title input */}
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Note title"
        className="text-sm font-semibold bg-transparent border-none outline-none placeholder:text-muted-foreground mb-2 w-full"
      />

      <div className="text-[10px] text-muted-foreground mb-2">
        {formatDate(note.updatedAt)}
        {note.pinned && (
          <span className="inline-flex items-center gap-0.5 ml-2">
            <Pin className="h-2.5 w-2.5" /> Pinned
          </span>
        )}
      </div>

      {/* Toolbar */}
      <EditorToolbar editor={editor} />

      {/* Editor */}
      <ScrollArea className="flex-1 -mx-1 px-1">
        <EditorContent editor={editor} className="notes-editor" />
      </ScrollArea>
    </div>
  );
}

// ─── Notes Widget (List + Editor) ────────────────────────────────────────────

export function NotesWidget() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<Record<string, boolean>>({});
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_lastSync, setLastSync] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const { activeProfile } = useProfile();
  const { expandRequested, onExpandHandled, pendingItemId, clearPendingItem, pendingSearchQuery, clearPendingSearch } =
    useWidgetNavFor("notes");

  // Handle navigation from command palette
  useEffect(() => {
    if (pendingItemId) {
      setSelectedId(pendingItemId);
      clearPendingItem();
    }
  }, [pendingItemId, clearPendingItem]);

  const fetchNotes = useCallback(async (search?: string) => {
    try {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams();
      params.set("profile", activeProfile);
      if (search) params.set("search", search);
      const res = await fetch(`/api/notes?${params}`);
      const data = await res.json();
      if (data.error) {
        setError(data.error);
        return;
      }
      setNotes(data.notes);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch notes");
    } finally {
      setLoading(false);
    }
  }, [activeProfile]);

  // Handle search from AI actions
  useEffect(() => {
    if (pendingSearchQuery) {
      setSearchQuery(pendingSearchQuery);
      setShowSearch(true);
      fetchNotes(pendingSearchQuery);
      clearPendingSearch();
    }
  }, [pendingSearchQuery, clearPendingSearch, fetchNotes]);

  useEffect(() => {
    setNotes([]);
    setSelectedId(null);
    setError(null);
    fetchNotes();
  }, [fetchNotes]);

  useEffect(() => {
    if (showSearch && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [showSearch]);

  const createNote = useCallback(async () => {
    try {
      const res = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create", title: "Untitled", content: "", profile: activeProfile }),
      });
      const data = await res.json();
      if (data.notes) setNotes(data.notes);
      if (data.note) setSelectedId(data.note.id);
    } catch {}
  }, [activeProfile]);

  const saveNote = useCallback(async (id: string, title: string, content: string) => {
    try {
      const res = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update", id, title, content, profile: activeProfile }),
      });
      const data = await res.json();
      if (data.notes) setNotes(data.notes);
    } catch {}
  }, [activeProfile]);

  const deleteNote = useCallback(async (id: string) => {
    try {
      const res = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", id, profile: activeProfile }),
      });
      const data = await res.json();
      if (data.notes) setNotes(data.notes);
      setSelectedId(null);
    } catch {}
  }, [activeProfile]);

  const pinNote = useCallback(async (id: string, pinned: boolean) => {
    // Optimistic update
    setNotes((prev) =>
      prev.map((n) => (n.id === id ? { ...n, pinned } : n))
    );
    try {
      const res = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "pin", id, pinned, profile: activeProfile }),
      });
      const data = await res.json();
      if (data.notes) setNotes(data.notes);
    } catch {}
  }, [activeProfile]);

  const duplicateNote = useCallback(async (id: string) => {
    try {
      const res = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "duplicate", id, profile: activeProfile }),
      });
      const data = await res.json();
      if (data.notes) setNotes(data.notes);
      if (data.note) setSelectedId(data.note.id);
    } catch {}
  }, [activeProfile]);

  const handleSearch = useCallback(
    (query: string) => {
      setSearchQuery(query);
      fetchNotes(query || undefined);
    },
    [fetchNotes]
  );

  // ─── Sync Functions ──────────────────────────────────────────────────────────

  const fetchSyncStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/notes/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "status", profile: activeProfile }),
      });
      const data = await res.json();
      if (data.statuses) {
        const map: Record<string, boolean> = {};
        for (const s of data.statuses) {
          map[s.noteId] = s.synced;
        }
        setSyncStatus(map);
        setLastSync(data.lastFullSync);
      }
    } catch {}
  }, [activeProfile]);

  useEffect(() => {
    fetchSyncStatus();
  }, [fetchSyncStatus, notes]);

  const syncPushAll = useCallback(async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/notes/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "push", profile: activeProfile }),
      });
      const data = await res.json();
      if (data.error) {
        setError(data.error);
      } else {
        await fetchSyncStatus();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  }, [activeProfile, fetchSyncStatus]);

  const syncPullAll = useCallback(async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/notes/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "pull", profile: activeProfile }),
      });
      const data = await res.json();
      if (data.error) {
        setError(data.error);
      } else if (data.notes) {
        setNotes(data.notes);
        await fetchSyncStatus();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  }, [activeProfile, fetchSyncStatus]);

  // Determine view state
  const selectedNote = selectedId ? notes.find((n) => n.id === selectedId) : null;
  const pinnedNotes = notes.filter((n) => n.pinned);
  const unpinnedNotes = notes.filter((n) => !n.pinned);

  // Build headerAction based on whether we're in editor or list view
  const headerAction = selectedNote ? (
    <NoteEditorActions
      note={selectedNote}
      onBack={() => {
        setSelectedId(null);
        fetchNotes(searchQuery || undefined);
      }}
      onDelete={deleteNote}
      onPin={pinNote}
      onDuplicate={duplicateNote}
    />
  ) : (
    <div className="flex items-center gap-1">
      <button
        onClick={() => setShowSearch(!showSearch)}
        className={cn(
          "text-muted-foreground hover:text-foreground transition-colors p-1 rounded-md hover:bg-muted",
          showSearch && "text-primary bg-primary/10"
        )}
        title="Search notes"
      >
        <Search className="h-3.5 w-3.5" />
      </button>
      <button
        onClick={syncPushAll}
        disabled={syncing}
        className={cn(
          "text-muted-foreground hover:text-foreground transition-colors p-1 rounded-md hover:bg-muted",
          syncing && "animate-pulse"
        )}
        title="Push all notes to Google Docs"
      >
        <CloudUpload className="h-3.5 w-3.5" />
      </button>
      <button
        onClick={syncPullAll}
        disabled={syncing}
        className={cn(
          "text-muted-foreground hover:text-foreground transition-colors p-1 rounded-md hover:bg-muted",
          syncing && "animate-pulse"
        )}
        title="Pull changes from Google Docs"
      >
        <CloudDownload className="h-3.5 w-3.5" />
      </button>
      <button
        onClick={createNote}
        className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded-md hover:bg-muted"
        title="New note"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  );

  return (
    <WidgetWrapper
      title="Notes"
      widgetType="notes"
      icon={<StickyNote className="h-4 w-4" />}
      expandRequested={expandRequested}
      onExpandHandled={onExpandHandled}
      headerAction={headerAction}
    >
      {selectedNote ? (
        <NoteEditorContent
          key={selectedNote.id}
          note={selectedNote}
          onSave={saveNote}
        />
      ) : (
        <div className="flex flex-col h-full">
          {/* Search bar */}
          {showSearch && (
            <div className="mb-2">
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => handleSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setShowSearch(false);
                    setSearchQuery("");
                    fetchNotes();
                  }
                }}
                placeholder="Search notes..."
                className="w-full text-xs bg-muted/50 border border-border rounded-md px-3 py-1.5 placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          )}

          {/* Note count */}
          {!loading && !error && (
            <p className="text-[10px] text-muted-foreground mb-2">
              {notes.length} note{notes.length !== 1 ? "s" : ""}
              {searchQuery && ` matching "${searchQuery}"`}
            </p>
          )}

          {loading && notes.length === 0 ? (
            <div className="flex items-center justify-center flex-1">
              <div className="flex flex-col items-center gap-2 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span className="text-xs">Loading notes...</span>
              </div>
            </div>
          ) : error ? (
            <div className="flex items-center justify-center flex-1">
              <div className="flex flex-col items-center gap-2 text-muted-foreground text-center px-4">
                <AlertCircle className="h-5 w-5 text-destructive" />
                <span className="text-xs">{error}</span>
              </div>
            </div>
          ) : notes.length === 0 ? (
            <div className="flex items-center justify-center flex-1 text-muted-foreground">
              <div className="text-center">
                <StickyNote className="h-8 w-8 mx-auto mb-2 opacity-30" />
                <p className="text-sm">No notes yet</p>
                <button
                  onClick={createNote}
                  className="text-xs text-primary hover:underline mt-1"
                >
                  Create your first note
                </button>
              </div>
            </div>
          ) : (
            <ScrollArea className="flex-1 -mx-1 px-1">
              <div className="space-y-0.5">
                {/* Pinned section */}
                {pinnedNotes.length > 0 && (
                  <>
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wider px-1 pb-1 flex items-center gap-1">
                      <Pin className="h-2.5 w-2.5" />
                      Pinned
                    </div>
                    {pinnedNotes.map((note) => (
                      <NoteListItem
                        key={note.id}
                        note={note}
                        onClick={() => setSelectedId(note.id)}
                        onDelete={deleteNote}
                        isSynced={syncStatus[note.id]}
                      />
                    ))}
                    {unpinnedNotes.length > 0 && (
                      <div className="text-[10px] text-muted-foreground uppercase tracking-wider px-1 pt-2 pb-1">
                        Notes
                      </div>
                    )}
                  </>
                )}
                {/* Regular notes */}
                {unpinnedNotes.map((note) => (
                  <NoteListItem
                    key={note.id}
                    note={note}
                    onClick={() => setSelectedId(note.id)}
                    onDelete={deleteNote}
                    isSynced={syncStatus[note.id]}
                  />
                ))}
              </div>
            </ScrollArea>
          )}
        </div>
      )}
    </WidgetWrapper>
  );
}

// ─── Note Editor Actions (header buttons for editor view) ────────────────────

function NoteEditorActions({
  note,
  onBack,
  onDelete,
  onPin,
  onDuplicate,
}: {
  note: Note;
  onBack: () => void;
  onDelete: (id: string) => void;
  onPin: (id: string, pinned: boolean) => void;
  onDuplicate: (id: string) => void;
}) {
  const [showActions, setShowActions] = useState(false);
  const actionsRef = useRef<HTMLDivElement>(null);

  // Close actions dropdown on outside click
  useEffect(() => {
    if (!showActions) return;
    const handleClick = (e: MouseEvent) => {
      if (actionsRef.current && !actionsRef.current.contains(e.target as Node)) {
        setShowActions(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showActions]);

  return (
    <div className="flex items-center gap-1">
      <button
        onClick={onBack}
        className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded-md hover:bg-muted"
        title="Back to notes"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
      </button>
      <div className="relative" ref={actionsRef}>
        <button
          onClick={() => setShowActions(!showActions)}
          className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded-md hover:bg-muted"
          title="Actions"
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </button>
        {showActions && (
          <div className="absolute right-0 top-full mt-1 z-50 bg-popover border border-border rounded-lg shadow-lg py-1 min-w-[150px]">
            <button
              onClick={() => {
                onPin(note.id, !note.pinned);
                setShowActions(false);
              }}
              className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-muted transition-colors text-left"
            >
              {note.pinned ? (
                <PinOff className="h-3.5 w-3.5" />
              ) : (
                <Pin className="h-3.5 w-3.5" />
              )}
              {note.pinned ? "Unpin" : "Pin to top"}
            </button>
            <button
              onClick={() => {
                onDuplicate(note.id);
                setShowActions(false);
              }}
              className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-muted transition-colors text-left"
            >
              <Copy className="h-3.5 w-3.5" />
              Duplicate
            </button>
            <Separator className="my-1" />
            <button
              onClick={() => {
                onDelete(note.id);
                setShowActions(false);
              }}
              className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-muted transition-colors text-left text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Note List Item ──────────────────────────────────────────────────────────

function NoteListItem({ note, onClick, onDelete, isSynced }: { note: Note; onClick: () => void; onDelete: (id: string) => void; isSynced?: boolean }) {
  const preview = stripHtml(note.content).slice(0, 100);

  return (
    <div
      onClick={onClick}
      className="p-2.5 rounded-lg hover:bg-muted/50 transition-colors cursor-pointer group"
    >
      <div className="flex items-start gap-1">
        <p className="text-sm font-medium truncate flex-1 group-hover:text-primary transition-colors">
          {note.title || "Untitled"}
        </p>
        {isSynced && (
          <span title="Synced to Google Docs" className="shrink-0 mt-0.5">
            <Cloud className="h-3 w-3 text-muted-foreground" />
          </span>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete(note.id);
          }}
          className="text-muted-foreground hover:text-destructive p-0.5 transition-all opacity-0 group-hover:opacity-100 shrink-0"
          title="Delete note"
        >
          <Trash2 className="h-3 w-3" />
        </button>
        <span className="text-[10px] text-muted-foreground shrink-0 mt-0.5">
          {formatDate(note.updatedAt)}
        </span>
      </div>
      {preview && (
        <p className="text-xs text-muted-foreground truncate mt-0.5">
          {preview}
        </p>
      )}
    </div>
  );
}
