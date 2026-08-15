import fs from "node:fs/promises";
import path from "node:path";
import * as dfs from "dataforseo-client";

type JsonRecord = Record<string, unknown>;

export interface DataForSeoConfig {
  baseUrl: string;
  envFile: string | null;
  password: string;
  username: string;
}

export interface DataForSeoApis {
  aiOptimization: dfs.AiOptimizationApi;
  config: DataForSeoConfig;
  contentAnalysis: dfs.ContentAnalysisApi;
  dataforseoLabs: dfs.DataforseoLabsApi;
  keywordsData: dfs.KeywordsDataApi;
  onPage: dfs.OnPageApi;
  rest: (endpoint: string, payload: unknown, method?: string) => Promise<unknown>;
  serp: dfs.SerpApi;
}

const isRecord = (value: unknown): value is JsonRecord => typeof value === "object" && value !== null;

export const readString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const splitEnvLine = (line: string): [string, string] | null => {
  const trimmed = line.trim();
  if (trimmed.length === 0 || trimmed.startsWith("#")) return null;
  const separatorIndex = trimmed.indexOf("=");
  if (separatorIndex < 1) return null;
  return [trimmed.slice(0, separatorIndex), trimmed.slice(separatorIndex + 1)];
};

async function findUp(fileName: string, startDir: string): Promise<string | null> {
  let currentDir = path.resolve(startDir);
  const rootDir = path.parse(currentDir).root;

  while (true) {
    const candidate = path.join(currentDir, fileName);
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // Keep walking upward until we reach the filesystem root.
    }

    if (currentDir === rootDir) return null;
    currentDir = path.dirname(currentDir);
  }
}

async function readEnvFile(filePath: string): Promise<Record<string, string>> {
  const raw = await fs.readFile(filePath, "utf8");
  const entries = raw
    .split(/\r?\n/)
    .map(splitEnvLine)
    .filter((entry): entry is [string, string] => entry !== null);
  return Object.fromEntries(entries);
}

export async function loadDataForSeoConfig(startDir = process.cwd()): Promise<DataForSeoConfig> {
  const envFile = await findUp(".env", startDir);
  const fileEnv = envFile ? await readEnvFile(envFile) : {};

  const username = readString(process.env.DATAFORSEO_USERNAME) ?? readString(fileEnv.DATAFORSEO_USERNAME);
  const password = readString(process.env.DATAFORSEO_PASSWORD) ?? readString(fileEnv.DATAFORSEO_PASSWORD);

  if (!username || !password) {
    throw new Error("Missing DATAFORSEO_USERNAME or DATAFORSEO_PASSWORD in process.env or the nearest .env file.");
  }

  return {
    baseUrl: "https://api.dataforseo.com",
    envFile,
    password,
    username,
  };
}

function createAuthenticatedFetch(config: DataForSeoConfig) {
  return (url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const token = Buffer.from(`${config.username}:${config.password}`).toString("base64");
    return fetch(url, {
      ...init,
      headers: {
        ...(init?.headers ?? {}),
        Authorization: `Basic ${token}`,
      },
    });
  };
}

export async function createDataForSeoApis(startDir = process.cwd()): Promise<DataForSeoApis> {
  const config = await loadDataForSeoConfig(startDir);
  const fetchImpl = createAuthenticatedFetch(config);

  const rest = async (endpoint: string, payload: unknown, method = "POST"): Promise<unknown> => {
    const response = await fetch(`${config.baseUrl}${endpoint}`, {
      method,
      headers: {
        Authorization: `Basic ${Buffer.from(`${config.username}:${config.password}`).toString("base64")}`,
        "Content-Type": "application/json",
      },
      body: method === "GET" ? undefined : JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`DataForSEO REST request failed: ${response.status}`);
    }

    return response.json();
  };

  return {
    aiOptimization: new dfs.AiOptimizationApi(config.baseUrl, { fetch: fetchImpl }),
    config,
    contentAnalysis: new dfs.ContentAnalysisApi(config.baseUrl, {
      fetch: fetchImpl,
    }),
    dataforseoLabs: new dfs.DataforseoLabsApi(config.baseUrl, {
      fetch: fetchImpl,
    }),
    keywordsData: new dfs.KeywordsDataApi(config.baseUrl, { fetch: fetchImpl }),
    onPage: new dfs.OnPageApi(config.baseUrl, { fetch: fetchImpl }),
    rest,
    serp: new dfs.SerpApi(config.baseUrl, { fetch: fetchImpl }),
  };
}

export function getTaskResults(response: unknown): JsonRecord[] {
  if (!isRecord(response)) return [];
  const tasks = response.tasks;
  if (!Array.isArray(tasks)) return [];

  return tasks.flatMap((task) => {
    if (!isRecord(task) || !Array.isArray(task.result)) return [];
    return task.result.filter(isRecord);
  });
}

export function getNestedItems(result: JsonRecord): JsonRecord[] {
  const items = result.items;
  return Array.isArray(items) ? items.filter(isRecord) : [];
}

export function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(readString).filter((item): item is string => item !== null);
}

export function readRecord(value: unknown): JsonRecord | null {
  return isRecord(value) ? value : null;
}
