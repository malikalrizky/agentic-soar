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

function match<T extends Record<string, unknown>>(row: T, filter: Record<string, unknown>): boolean {
  for (const [key, value] of Object.entries(filter)) {
    if (value === undefined) continue;
    if (row[key] !== value) return false;
  }
  return true;
}

export function loadTestWorld(path: string): TestWorld {
  return JSON.parse(readFileSync(path, "utf8")) as TestWorld;
}

export function queryAuthentication(
  world: TestWorld,
  filter: { user?: string; ip?: string },
): AuthEvent[] {
  return world.authentication.filter((row) => match(row, filter));
}

export function queryEndpoint(
  world: TestWorld,
  filter: { host?: string; user?: string },
): EndpointEvent[] {
  return world.endpoint.filter((row) => match(row, filter));
}

export function queryProcess(
  world: TestWorld,
  filter: { host?: string; hash?: string },
): ProcessEvent[] {
  return world.process.filter((row) => match(row, filter));
}

export function queryIp(world: TestWorld, filter: { ip?: string }): IpEvent[] {
  return world.ip.filter((row) => match(row, filter));
}

export function queryUser(world: TestWorld, filter: { user?: string }): UserRecord[] {
  return world.user.filter((row) => match(row, filter));
}

export function queryRelatedAlerts(
  world: TestWorld,
  filter: { user?: string; host?: string; ip?: string },
): RelatedAlert[] {
  return world.related_alerts.filter((row) => match(row, filter));
}

export function queryAssets(
  world: TestWorld,
  filter: { hostname?: string; user?: string },
): Asset[] {
  return world.assets.filter((row) => match(row, filter));
}
