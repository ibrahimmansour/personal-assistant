import { NextRequest } from "next/server";
import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { homedir } from "os";

const DATA_DIR = join(homedir(), ".personal-assistant");

function rulesFile(profile: string): string {
  if (profile === "work") return join(DATA_DIR, "email-rules.json");
  return join(DATA_DIR, `email-rules-${profile}.json`);
}

export interface EmailRule {
  field: "from" | "fromAddress" | "subject";
  operator: "contains" | "equals" | "matches";
  value: string;
}

export interface EmailGroup {
  id: string;
  name: string;
  color: string;
  rules: EmailRule[];
}

interface EmailRulesData {
  groups: EmailGroup[];
}

const DEFAULT_GROUPS: EmailGroup[] = [
  {
    id: "github",
    name: "GitHub",
    color: "purple",
    rules: [
      { field: "fromAddress", operator: "contains", value: "github.com" },
      { field: "fromAddress", operator: "contains", value: "github.tools.sap" },
    ],
  },
  {
    id: "jira",
    name: "Jira",
    color: "blue",
    rules: [
      { field: "fromAddress", operator: "contains", value: "jira" },
      { field: "fromAddress", operator: "contains", value: "atlassian" },
    ],
  },
  {
    id: "automated",
    name: "Automated",
    color: "gray",
    rules: [
      { field: "fromAddress", operator: "contains", value: "noreply" },
      { field: "fromAddress", operator: "contains", value: "no-reply" },
      { field: "fromAddress", operator: "contains", value: "notifications" },
      { field: "fromAddress", operator: "contains", value: "mailer-daemon" },
    ],
  },
];

async function readData(profile: string): Promise<EmailRulesData> {
  try {
    const raw = await readFile(rulesFile(profile), "utf-8");
    return JSON.parse(raw);
  } catch {
    // First load — write defaults and return them
    const data = { groups: DEFAULT_GROUPS };
    await writeData(profile, data);
    return data;
  }
}

async function writeData(profile: string, data: EmailRulesData): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(rulesFile(profile), JSON.stringify(data, null, 2));
}

export async function GET(request: NextRequest) {
  const profile = request.nextUrl.searchParams.get("profile") || "work";
  const data = await readData(profile);
  return Response.json(data);
}

export async function POST(request: NextRequest) {
  const profile = new URL(request.url).searchParams.get("profile") || "work";
  const body = await request.json();
  const action = body.action as string;
  const data = await readData(profile);

  switch (action) {
    case "add-group": {
      const { name, color, rules } = body;
      const id = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        || `group-${Date.now()}`;
      // Prevent duplicate IDs
      const existingIds = new Set(data.groups.map((g) => g.id));
      const uniqueId = existingIds.has(id) ? `${id}-${Date.now()}` : id;
      data.groups.push({
        id: uniqueId,
        name,
        color: color || "gray",
        rules: rules || [],
      });
      break;
    }

    case "update-group": {
      const { id, name, color, rules } = body;
      const idx = data.groups.findIndex((g) => g.id === id);
      if (idx === -1) {
        return Response.json({ error: "Group not found" }, { status: 404 });
      }
      if (name !== undefined) data.groups[idx].name = name;
      if (color !== undefined) data.groups[idx].color = color;
      if (rules !== undefined) data.groups[idx].rules = rules;
      break;
    }

    case "delete-group": {
      const { id } = body;
      data.groups = data.groups.filter((g) => g.id !== id);
      break;
    }

    case "add-rule": {
      const { groupId, rule } = body;
      const group = data.groups.find((g) => g.id === groupId);
      if (!group) {
        return Response.json({ error: "Group not found" }, { status: 404 });
      }
      group.rules.push(rule);
      break;
    }

    case "remove-rule": {
      const { groupId, ruleIndex } = body;
      const group = data.groups.find((g) => g.id === groupId);
      if (!group) {
        return Response.json({ error: "Group not found" }, { status: 404 });
      }
      group.rules.splice(ruleIndex, 1);
      break;
    }

    case "reorder-groups": {
      const { groupIds } = body;
      const groupMap = new Map(data.groups.map((g) => [g.id, g]));
      data.groups = (groupIds as string[])
        .map((id) => groupMap.get(id))
        .filter(Boolean) as EmailGroup[];
      break;
    }

    case "save-all": {
      const { groups: newGroups } = body;
      data.groups = newGroups || [];
      break;
    }

    default:
      return Response.json({ error: `Unknown action: ${action}` }, { status: 400 });
  }

  await writeData(profile, data);
  return Response.json(data);
}
