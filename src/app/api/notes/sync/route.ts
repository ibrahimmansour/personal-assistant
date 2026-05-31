import { NextRequest } from "next/server";
import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import { getGoogleToken } from "@/lib/google-token";

export const dynamic = "force-dynamic";

const DATA_DIR = join(homedir(), ".personal-assistant");
const SYNC_FILE = join(DATA_DIR, "notes-sync.json");
const FOLDER_NAME = "Personal Assistant Notes";

interface Note {
  id: string;
  title: string;
  content: string;
  pinned: boolean;
  folder: string;
  createdAt: string;
  updatedAt: string;
}

interface SyncMapping {
  noteId: string;
  docId: string;
  lastSyncedAt: string; // ISO timestamp of last successful sync
}

interface SyncState {
  folderId: string | null;
  mappings: SyncMapping[];
  lastFullSync: string | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function readSyncState(): Promise<SyncState> {
  try {
    const raw = await readFile(SYNC_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return { folderId: null, mappings: [], lastFullSync: null };
  }
}

async function writeSyncState(state: SyncState): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(SYNC_FILE, JSON.stringify(state, null, 2));
}

function notesFile(profile: string): string {
  if (profile === "work") return join(DATA_DIR, "notes.json");
  return join(DATA_DIR, `notes-${profile}.json`);
}

async function readNotes(profile: string): Promise<Note[]> {
  try {
    const raw = await readFile(notesFile(profile), "utf-8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function writeNotes(profile: string, notes: Note[]): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(notesFile(profile), JSON.stringify(notes, null, 2));
}

// ─── Google Drive Helpers ────────────────────────────────────────────────────

async function driveRequest(path: string, options?: RequestInit & { upload?: boolean }) {
  const token = await getGoogleToken();
  const baseUrl = options?.upload
    ? "https://www.googleapis.com/upload/drive/v3"
    : "https://www.googleapis.com/drive/v3";
  const res = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      ...options?.headers,
      Authorization: `Bearer ${token}`,
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Drive API ${res.status}: ${text.slice(0, 300)}`);
  }
  // Some calls (like delete) return no content
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return res.json();
  }
  return res.text();
}

/** Get or create the sync folder in Google Drive */
async function getOrCreateFolder(state: SyncState): Promise<string> {
  // Check if stored folder still exists
  if (state.folderId) {
    try {
      const folder = await driveRequest(`/files/${state.folderId}?fields=id,trashed`);
      if (!folder.trashed) return state.folderId;
    } catch {
      // Folder deleted or inaccessible, create a new one
    }
  }

  // Search for existing folder
  const q = encodeURIComponent(`name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  const search = await driveRequest(`/files?q=${q}&fields=files(id)`);
  if (search.files && search.files.length > 0) {
    return search.files[0].id;
  }

  // Create folder
  const folder = await driveRequest("/files", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: FOLDER_NAME,
      mimeType: "application/vnd.google-apps.folder",
    }),
  });
  return folder.id;
}

/** Upload a note as a Google Doc (create or update) */
async function pushNoteToDoc(note: Note, docId: string | null, folderId: string): Promise<string> {
  const htmlContent = `<!DOCTYPE html><html><head><title>${escapeHtml(note.title)}</title></head><body>${note.content}</body></html>`;
  const blob = new Blob([htmlContent], { type: "text/html" });

  if (docId) {
    // Update existing doc content using Drive API media upload
    const token = await getGoogleToken();
    const res = await fetch(
      `https://www.googleapis.com/upload/drive/v3/files/${docId}?uploadType=media`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "text/html",
        },
        body: blob,
        cache: "no-store",
      }
    );
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Drive update failed: ${res.status}: ${text.slice(0, 200)}`);
    }
    // Also update the title via metadata
    await driveRequest(`/files/${docId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: note.title || "Untitled" }),
    });
    return docId;
  } else {
    // Create new doc using multipart upload
    const token = await getGoogleToken();
    const metadata = JSON.stringify({
      name: note.title || "Untitled",
      mimeType: "application/vnd.google-apps.document",
      parents: [folderId],
    });

    const boundary = "notes_sync_boundary";
    const body = [
      `--${boundary}\r\n`,
      "Content-Type: application/json; charset=UTF-8\r\n\r\n",
      metadata + "\r\n",
      `--${boundary}\r\n`,
      "Content-Type: text/html\r\n\r\n",
      htmlContent + "\r\n",
      `--${boundary}--`,
    ].join("");

    const res = await fetch(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": `multipart/related; boundary=${boundary}`,
        },
        body,
        cache: "no-store",
      }
    );
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Drive create failed: ${res.status}: ${text.slice(0, 200)}`);
    }
    const data = await res.json();
    return data.id;
  }
}

/** Pull a Google Doc's content as HTML */
async function pullDocContent(docId: string): Promise<string> {
  const token = await getGoogleToken();
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${docId}/export?mimeType=text/html`,
    {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    }
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Drive export failed: ${res.status}: ${text.slice(0, 200)}`);
  }
  const html = await res.text();
  // Extract body content from the full HTML document Google returns
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  return bodyMatch ? bodyMatch[1] : html;
}

/** Get metadata for a doc (modifiedTime) */
async function getDocMetadata(docId: string): Promise<{ name: string; modifiedTime: string } | null> {
  try {
    return await driveRequest(`/files/${docId}?fields=name,modifiedTime,trashed`);
  } catch {
    return null;
  }
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ─── Route Handler ───────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const state = await readSyncState();
    return Response.json({
      synced: state.mappings.length,
      lastFullSync: state.lastFullSync,
      mappings: state.mappings,
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to read sync state" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action } = body;
    const profile = body.profile || "work";

    switch (action) {
      case "push": {
        // Push all local notes to Google Docs
        const notes = await readNotes(profile);
        const state = await readSyncState();
        const folderId = await getOrCreateFolder(state);
        state.folderId = folderId;

        const results: { noteId: string; docId: string; title: string }[] = [];

        for (const note of notes) {
          const existing = state.mappings.find((m) => m.noteId === note.id);
          const docId = await pushNoteToDoc(note, existing?.docId || null, folderId);

          // Update mapping
          const mapping: SyncMapping = {
            noteId: note.id,
            docId,
            lastSyncedAt: new Date().toISOString(),
          };
          const idx = state.mappings.findIndex((m) => m.noteId === note.id);
          if (idx >= 0) state.mappings[idx] = mapping;
          else state.mappings.push(mapping);

          results.push({ noteId: note.id, docId, title: note.title });
        }

        state.lastFullSync = new Date().toISOString();
        await writeSyncState(state);

        return Response.json({ success: true, synced: results.length, results });
      }

      case "pull": {
        // Pull changes from Google Docs back to local notes
        const notes = await readNotes(profile);
        const state = await readSyncState();
        let updated = 0;

        for (const mapping of state.mappings) {
          const noteIdx = notes.findIndex((n) => n.id === mapping.noteId);
          if (noteIdx < 0) continue;

          const meta = await getDocMetadata(mapping.docId);
          if (!meta || (meta as any).trashed) continue;

          // Only pull if remote is newer than last sync
          const remoteModified = new Date(meta.modifiedTime).getTime();
          const lastSynced = new Date(mapping.lastSyncedAt).getTime();
          if (remoteModified <= lastSynced) continue;

          const content = await pullDocContent(mapping.docId);
          notes[noteIdx] = {
            ...notes[noteIdx],
            title: meta.name,
            content,
            updatedAt: new Date().toISOString(),
          };
          mapping.lastSyncedAt = new Date().toISOString();
          updated++;
        }

        await writeNotes(profile, notes);
        state.lastFullSync = new Date().toISOString();
        await writeSyncState(state);

        return Response.json({ success: true, updated, notes });
      }

      case "push-one": {
        // Push a single note
        const { noteId } = body;
        const notes = await readNotes(profile);
        const note = notes.find((n) => n.id === noteId);
        if (!note) {
          return Response.json({ error: "Note not found" }, { status: 404 });
        }

        const state = await readSyncState();
        const folderId = await getOrCreateFolder(state);
        state.folderId = folderId;

        const existing = state.mappings.find((m) => m.noteId === noteId);
        const docId = await pushNoteToDoc(note, existing?.docId || null, folderId);

        const mapping: SyncMapping = {
          noteId,
          docId,
          lastSyncedAt: new Date().toISOString(),
        };
        const idx = state.mappings.findIndex((m) => m.noteId === noteId);
        if (idx >= 0) state.mappings[idx] = mapping;
        else state.mappings.push(mapping);

        await writeSyncState(state);
        return Response.json({ success: true, docId });
      }

      case "pull-one": {
        // Pull a single note from Google Docs
        const { noteId } = body;
        const notes = await readNotes(profile);
        const noteIdx = notes.findIndex((n) => n.id === noteId);
        if (noteIdx < 0) {
          return Response.json({ error: "Note not found" }, { status: 404 });
        }

        const state = await readSyncState();
        const mapping = state.mappings.find((m) => m.noteId === noteId);
        if (!mapping) {
          return Response.json({ error: "Note not synced yet. Push it first." }, { status: 400 });
        }

        const meta = await getDocMetadata(mapping.docId);
        if (!meta || (meta as any).trashed) {
          return Response.json({ error: "Google Doc not found or deleted" }, { status: 404 });
        }

        const content = await pullDocContent(mapping.docId);
        notes[noteIdx] = {
          ...notes[noteIdx],
          title: meta.name,
          content,
          updatedAt: new Date().toISOString(),
        };
        mapping.lastSyncedAt = new Date().toISOString();

        await writeNotes(profile, notes);
        await writeSyncState(state);
        return Response.json({ success: true, note: notes[noteIdx] });
      }

      case "status": {
        // Get sync status for each note
        const notes = await readNotes(profile);
        const state = await readSyncState();

        const statuses = notes.map((note) => {
          const mapping = state.mappings.find((m) => m.noteId === note.id);
          return {
            noteId: note.id,
            synced: !!mapping,
            docId: mapping?.docId || null,
            lastSyncedAt: mapping?.lastSyncedAt || null,
          };
        });

        return Response.json({ statuses, lastFullSync: state.lastFullSync });
      }

      case "unlink": {
        // Remove sync mapping (doesn't delete the Google Doc)
        const { noteId } = body;
        const state = await readSyncState();
        state.mappings = state.mappings.filter((m) => m.noteId !== noteId);
        await writeSyncState(state);
        return Response.json({ success: true });
      }

      default:
        return Response.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sync failed";
    if (message === "GOOGLE_AUTH_REQUIRED") {
      return Response.json(
        { error: "Google authentication required. Please connect your Google account in Settings." },
        { status: 401 }
      );
    }
    return Response.json({ error: message }, { status: 500 });
  }
}
