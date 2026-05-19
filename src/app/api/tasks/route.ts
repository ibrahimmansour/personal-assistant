import { NextRequest } from "next/server";
import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { homedir } from "os";

const DATA_DIR = join(homedir(), ".personal-assistant");

function tasksFile(profile: string): string {
  if (profile === "work") return join(DATA_DIR, "tasks.json");
  return join(DATA_DIR, `tasks-${profile}.json`);
}

interface Task {
  id: string;
  title: string;
  completed: boolean;
  priority: "low" | "medium" | "high";
  createdAt: string;
  completedAt?: string;
  folder?: string;
  /** Additional context / requirements for this task (markdown) */
  context?: string;
  /** Implementation summary populated by OpenCode after completion (markdown) */
  summary?: string;
}

interface TaskFolder {
  id: string;
  name: string;
  color?: string;
  /** Optional working directory for AI integrations (e.g. opencode) */
  cwd?: string;
}

interface TasksData {
  tasks: Task[];
  folders: TaskFolder[];
}

async function readData(profile: string): Promise<TasksData> {
  try {
    const raw = await readFile(tasksFile(profile), "utf-8");
    const parsed = JSON.parse(raw);
    // Handle legacy format (plain array of tasks)
    if (Array.isArray(parsed)) {
      return { tasks: parsed, folders: [] };
    }
    return { tasks: parsed.tasks || [], folders: parsed.folders || [] };
  } catch {
    return { tasks: [], folders: [] };
  }
}

async function writeData(profile: string, data: TasksData): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(tasksFile(profile), JSON.stringify(data, null, 2));
}

// GET: list tasks and folders
export async function GET(request: NextRequest) {
  try {
    const profile = request.nextUrl.searchParams.get("profile") || "work";
    const data = await readData(profile);
    return Response.json({ tasks: data.tasks, folders: data.folders });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to read tasks", tasks: [], folders: [] },
      { status: 500 }
    );
  }
}

// POST: create, update, delete tasks and folders
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action } = body;
    const profile = body.profile || "work";
    const data = await readData(profile);

    switch (action) {
      case "add": {
        const newTask: Task = {
          id: crypto.randomUUID(),
          title: body.title,
          completed: false,
          priority: body.priority || "medium",
          createdAt: new Date().toISOString(),
          folder: body.folder || undefined,
        };
        data.tasks.unshift(newTask);
        await writeData(profile, data);
        return Response.json({ task: newTask, tasks: data.tasks, folders: data.folders });
      }

      case "toggle": {
        data.tasks = data.tasks.map((t) =>
          t.id === body.id
            ? {
                ...t,
                completed: !t.completed,
                completedAt: !t.completed ? new Date().toISOString() : undefined,
              }
            : t
        );
        await writeData(profile, data);
        return Response.json({ tasks: data.tasks, folders: data.folders });
      }

      case "delete": {
        data.tasks = data.tasks.filter((t) => t.id !== body.id);
        await writeData(profile, data);
        return Response.json({ tasks: data.tasks, folders: data.folders });
      }

      case "update": {
        data.tasks = data.tasks.map((t) =>
          t.id === body.id
            ? {
                ...t,
                title: body.title ?? t.title,
                priority: body.priority ?? t.priority,
                folder: body.folder !== undefined ? (body.folder || undefined) : t.folder,
                context: body.context !== undefined ? (body.context || undefined) : t.context,
                summary: body.summary !== undefined ? (body.summary || undefined) : t.summary,
              }
            : t
        );
        await writeData(profile, data);
        return Response.json({ tasks: data.tasks, folders: data.folders });
      }

      case "updateSummary": {
        // Dedicated action for OpenCode /PA command to post implementation summaries.
        // Accepts taskId + summary, optionally looked up by title if id not provided.
        let taskId = body.id || body.taskId;
        if (!taskId && body.title) {
          const match = data.tasks.find(
            (t) => t.title.toLowerCase() === body.title.toLowerCase()
          );
          taskId = match?.id;
        }
        if (!taskId) {
          return Response.json({ error: "Task not found" }, { status: 404 });
        }
        data.tasks = data.tasks.map((t) =>
          t.id === taskId ? { ...t, summary: body.summary || t.summary } : t
        );
        await writeData(profile, data);
        return Response.json({ tasks: data.tasks, folders: data.folders });
      }

      case "reorder": {
        const idOrder = body.ids as string[];
        const taskMap = new Map(data.tasks.map((t) => [t.id, t]));
        const reordered = idOrder.map((id) => taskMap.get(id)!).filter(Boolean);
        const remaining = data.tasks.filter((t) => !idOrder.includes(t.id));
        data.tasks = [...reordered, ...remaining];
        await writeData(profile, data);
        return Response.json({ tasks: data.tasks, folders: data.folders });
      }

      // ─── Folder actions ──────────────────────────────────────
      case "addFolder": {
        const newFolder: TaskFolder = {
          id: crypto.randomUUID(),
          name: body.name || "New Folder",
          color: body.color || undefined,
        };
        data.folders.push(newFolder);
        await writeData(profile, data);
        return Response.json({ folder: newFolder, tasks: data.tasks, folders: data.folders });
      }

      case "renameFolder": {
        data.folders = data.folders.map((f) =>
          f.id === body.id ? { ...f, name: body.name ?? f.name, color: body.color !== undefined ? body.color : f.color } : f
        );
        await writeData(profile, data);
        return Response.json({ tasks: data.tasks, folders: data.folders });
      }

      case "updateFolder": {
        data.folders = data.folders.map((f) =>
          f.id === body.id
            ? {
                ...f,
                name: body.name ?? f.name,
                color: body.color !== undefined ? body.color : f.color,
                cwd: body.cwd !== undefined ? (body.cwd || undefined) : f.cwd,
              }
            : f
        );
        await writeData(profile, data);
        return Response.json({ tasks: data.tasks, folders: data.folders });
      }

      case "deleteFolder": {
        data.folders = data.folders.filter((f) => f.id !== body.id);
        // Unassign tasks from the deleted folder
        data.tasks = data.tasks.map((t) =>
          t.folder === body.id ? { ...t, folder: undefined } : t
        );
        await writeData(profile, data);
        return Response.json({ tasks: data.tasks, folders: data.folders });
      }

      default:
        return Response.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to update tasks" },
      { status: 500 }
    );
  }
}
