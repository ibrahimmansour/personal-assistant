import { NextRequest } from "next/server";
import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { homedir } from "os";

const DATA_DIR = join(homedir(), ".personal-assistant");

function notesFile(profile: string): string {
  if (profile === "work") return join(DATA_DIR, "notes.json");
  return join(DATA_DIR, `notes-${profile}.json`);
}

interface Note {
  id: string;
  title: string;
  content: string; // HTML from Tiptap
  pinned: boolean;
  folder: string;
  createdAt: string;
  updatedAt: string;
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

/** Sort: pinned first, then by updatedAt descending */
function sortNotes(notes: Note[]): Note[] {
  return [...notes].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });
}

// GET: list notes, optionally filtered by folder
export async function GET(request: NextRequest) {
  try {
    const profile = request.nextUrl.searchParams.get("profile") || "work";
    const folder = request.nextUrl.searchParams.get("folder");
    const search = request.nextUrl.searchParams.get("search");
    let notes = await readNotes(profile);

    if (folder && folder !== "All Notes") {
      notes = notes.filter((n) => n.folder === folder);
    }

    if (search) {
      const q = search.toLowerCase();
      notes = notes.filter(
        (n) =>
          n.title.toLowerCase().includes(q) ||
          n.content.toLowerCase().includes(q)
      );
    }

    notes = sortNotes(notes);

    // Derive folder list
    const folders = Array.from(new Set(notes.map((n) => n.folder).filter(Boolean)));

    return Response.json({ notes, folders });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to read notes", notes: [] },
      { status: 500 }
    );
  }
}

// POST: create, update, delete, pin, move
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action } = body;
    const profile = body.profile || "work";
    let notes = await readNotes(profile);

    switch (action) {
      case "create": {
        const newNote: Note = {
          id: crypto.randomUUID(),
          title: body.title || "Untitled",
          content: body.content || "",
          pinned: false,
          folder: body.folder || "",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        notes.unshift(newNote);
        await writeNotes(profile, notes);
        return Response.json({ note: newNote, notes: sortNotes(notes) });
      }

      case "update": {
        notes = notes.map((n) =>
          n.id === body.id
            ? {
                ...n,
                title: body.title ?? n.title,
                content: body.content ?? n.content,
                folder: body.folder ?? n.folder,
                updatedAt: new Date().toISOString(),
              }
            : n
        );
        await writeNotes(profile, notes);
        const updated = notes.find((n) => n.id === body.id);
        return Response.json({ note: updated, notes: sortNotes(notes) });
      }

      case "delete": {
        notes = notes.filter((n) => n.id !== body.id);
        await writeNotes(profile, notes);
        return Response.json({ notes: sortNotes(notes) });
      }

      case "pin": {
        notes = notes.map((n) =>
          n.id === body.id
            ? { ...n, pinned: body.pinned ?? !n.pinned, updatedAt: new Date().toISOString() }
            : n
        );
        await writeNotes(profile, notes);
        return Response.json({ notes: sortNotes(notes) });
      }

      case "duplicate": {
        const source = notes.find((n) => n.id === body.id);
        if (!source) {
          return Response.json({ error: "Note not found" }, { status: 404 });
        }
        const dup: Note = {
          ...source,
          id: crypto.randomUUID(),
          title: source.title + " (Copy)",
          pinned: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        notes.unshift(dup);
        await writeNotes(profile, notes);
        return Response.json({ note: dup, notes: sortNotes(notes) });
      }

      default:
        return Response.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to update notes" },
      { status: 500 }
    );
  }
}
