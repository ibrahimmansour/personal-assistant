import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import { existsSync } from "fs";

const DATA_DIR = join(homedir(), ".personal-assistant");
const CONFIG_FILE = join(DATA_DIR, "config.json");

export interface AppConfig {
  github: {
    token: string;
    username: string;
    apiUrl: string; // e.g. https://github.wdf.sap.corp/api/v3
  };
  githubCom: {
    token: string;
    username: string;
  };
  google: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
  };
  jira: {
    baseUrl: string;
    cookies: string;
  };
  ollama: {
    url: string;
    model: string;
  };
  weather: {
    location: string;
  };
}

const DEFAULT_CONFIG: AppConfig = {
  github: { token: "", username: "", apiUrl: "https://api.github.com" },
  githubCom: { token: "", username: "" },
  google: { clientId: "", clientSecret: "", redirectUri: "http://localhost:4444/api/google/auth/callback" },
  jira: { baseUrl: "", cookies: "" },
  ollama: { url: "http://localhost:11434", model: "llama3.2" },
  weather: { location: "" },
};

export async function getConfig(): Promise<AppConfig> {
  try {
    if (!existsSync(CONFIG_FILE)) {
      return { ...DEFAULT_CONFIG };
    }
    const raw = await readFile(CONFIG_FILE, "utf-8");
    const stored = JSON.parse(raw);
    // Merge with defaults so new fields are always present
    return deepMerge(DEFAULT_CONFIG as unknown as Record<string, unknown>, stored) as unknown as AppConfig;
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export async function saveConfig(config: AppConfig): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), "utf-8");
}

/**
 * Get a config value as if it were an env var.
 * This allows gradual migration - code can call getConfigEnv("GITHUB_TOKEN")
 * and it will check config.json first, then fall back to process.env.
 */
export async function getConfigEnv(key: string): Promise<string> {
  const config = await getConfig();
  const map: Record<string, string> = {
    GITHUB_TOKEN: config.github.token,
    GITHUB_USERNAME: config.github.username,
    GITHUB_API_URL: config.github.apiUrl,
    GITHUB_COM_TOKEN: config.githubCom.token,
    GITHUB_COM_USERNAME: config.githubCom.username,
    GOOGLE_CLIENT_ID: config.google.clientId,
    GOOGLE_CLIENT_SECRET: config.google.clientSecret,
    GOOGLE_REDIRECT_URI: config.google.redirectUri,
    JIRA_COOKIES: config.jira.cookies,
    OLLAMA_URL: config.ollama.url,
    OLLAMA_MODEL: config.ollama.model,
  };

  return map[key] || process.env[key] || "";
}

function deepMerge(defaults: Record<string, unknown>, overrides: Record<string, unknown>): Record<string, unknown> {
  const result = { ...defaults };
  for (const key of Object.keys(overrides)) {
    const val = overrides[key];
    if (val && typeof val === "object" && !Array.isArray(val) && typeof defaults[key] === "object") {
      result[key] = deepMerge(defaults[key] as Record<string, unknown>, val as Record<string, unknown>);
    } else if (val !== undefined) {
      result[key] = val;
    }
  }
  return result;
}
