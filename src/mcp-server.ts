import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { pathToFileURL } from "node:url";
import {
  loadTestWorld,
  queryAssets,
  queryAuthentication,
  queryEndpoint,
  queryIp,
  queryProcess,
  queryRelatedAlerts,
  queryUser,
  type TestWorld,
} from "./world.ts";

export const TELEMETRY_TOOLS = [
  "query_authentication",
  "query_endpoint",
  "query_process",
  "query_ip",
  "query_user",
  "query_related_alerts",
  "query_assets",
] as const;

function str(args: Record<string, unknown>, key: string): string | undefined {
  const v = args[key];
  return typeof v === "string" ? v : undefined;
}

export function handleTelemetryTool(
  name: string,
  args: Record<string, unknown>,
  world: TestWorld,
): unknown {
  switch (name) {
    case "query_authentication":
      return queryAuthentication(world, { user: str(args, "user"), ip: str(args, "ip") });
    case "query_endpoint":
      return queryEndpoint(world, { host: str(args, "host"), user: str(args, "user") });
    case "query_process":
      return queryProcess(world, { host: str(args, "host"), hash: str(args, "hash") });
    case "query_ip":
      return queryIp(world, { ip: str(args, "ip") });
    case "query_user":
      return queryUser(world, { user: str(args, "user") });
    case "query_related_alerts":
      return queryRelatedAlerts(world, {
        user: str(args, "user"),
        host: str(args, "host"),
        ip: str(args, "ip"),
      });
    case "query_assets":
      return queryAssets(world, { hostname: str(args, "hostname"), user: str(args, "user") });
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

const optionalStrings = {
  user: z.string().optional(),
  host: z.string().optional(),
  ip: z.string().optional(),
  hash: z.string().optional(),
  hostname: z.string().optional(),
};

export async function startTelemetryMcpServer(worldPath: string): Promise<void> {
  const world = loadTestWorld(worldPath);
  const server = new McpServer({ name: "telemetry", version: "0.1.0" });
  for (const name of TELEMETRY_TOOLS) {
    server.registerTool(
      name,
      { description: `Read-only query: ${name}`, inputSchema: optionalStrings },
      async (args) => {
        const result = handleTelemetryTool(name, args as Record<string, unknown>, world);
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
      },
    );
  }
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  await startTelemetryMcpServer(process.env.WORLD_PATH ?? "testdata/world.json");
}
