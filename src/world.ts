import { readFileSync } from "node:fs";

export type AuthEvent = {
  user: string;
  host: string;
  ip: string;
  timestamp: string;
  src_geo: string;
  is_known_office: boolean;
};

export type EndpointEvent = {
  user: string;
  host: string;
  ip: string;
  timestamp: string;
};

export type ProcessEvent = {
  user: string;
  host: string;
  ip: string;
  timestamp: string;
  process_name: string;
  hash: string;
  known_good: boolean;
};

export type IpEvent = {
  ip: string;
  user: string;
  host: string;
  timestamp: string;
  src_geo: string;
};

export type UserRecord = {
  user: string;
  host: string;
  ip: string;
  timestamp: string;
  role: string;
};

export type RelatedAlert = {
  user: string;
  host: string;
  ip: string;
  timestamp: string;
  title: string;
};

export type Asset = {
  hostname: string;
  user: string;
  host: string;
  ip: string;
  timestamp: string;
  role: string;
};

export type TestWorld = {
  authentication: AuthEvent[];
  endpoint: EndpointEvent[];
  process: ProcessEvent[];
  ip: IpEvent[];
  user: UserRecord[];
  related_alerts: RelatedAlert[];
  assets: Asset[];
};

export const TELEMETRY_DATASETS = [
  "authentication",
  "endpoint",
  "process",
  "ip",
  "user",
  "related_alerts",
  "assets",
] as const;

export type TelemetryDatasetName = (typeof TELEMETRY_DATASETS)[number];

export const TELEMETRY_TOOLS = TELEMETRY_DATASETS.map((name) => `query_${name}`);

const FILTER_KEYS: Record<TelemetryDatasetName, readonly string[]> = {
  authentication: ["user", "ip"],
  endpoint: ["host", "user"],
  process: ["host", "hash"],
  ip: ["ip"],
  user: ["user"],
  related_alerts: ["user", "host", "ip"],
  assets: ["hostname", "user"],
};

function isDataset(name: string): name is TelemetryDatasetName {
  return (TELEMETRY_DATASETS as readonly string[]).includes(name);
}

export function datasetFromToolName(name: string): TelemetryDatasetName {
  if (!name.startsWith("query_")) {
    throw new Error(`unknown tool: ${name}`);
  }
  const dataset = name.slice("query_".length);
  if (!isDataset(dataset)) {
    throw new Error(`unknown tool: ${name}`);
  }
  return dataset;
}

function match<T extends Record<string, unknown>>(row: T, filter: Record<string, unknown>): boolean {
  for (const [key, value] of Object.entries(filter)) {
    if (value === undefined) continue;
    if (row[key] !== value) return false;
  }
  return true;
}

function pickFilter(name: TelemetryDatasetName, filter: Record<string, unknown>): Record<string, string> {
  const picked: Record<string, string> = {};
  for (const key of FILTER_KEYS[name]) {
    const value = filter[key];
    if (typeof value === "string") picked[key] = value;
  }
  return picked;
}

export function loadTestWorld(path: string): TestWorld {
  return JSON.parse(readFileSync(path, "utf8")) as TestWorld;
}

export function queryDataset(
  world: TestWorld,
  name: string,
  filter: Record<string, unknown> = {},
): unknown[] {
  if (!isDataset(name)) {
    throw new Error(`unknown dataset: ${name}`);
  }
  const rows = world[name] as Record<string, unknown>[];
  const picked = pickFilter(name, filter);
  return rows.filter((row) => match(row, picked));
}
