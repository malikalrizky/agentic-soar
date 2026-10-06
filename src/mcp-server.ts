import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { pathToFileURL } from "node:url";
import {
  datasetFromToolName,
  loadTestWorld,
  queryDataset,
  TELEMETRY_TOOLS,
  type TelemetryDatasetName,
  type TestWorld,
} from "./world.ts";

export { TELEMETRY_TOOLS };

const TOOL_SCHEMAS: Record<TelemetryDatasetName, Record<string, z.ZodType>> = {
  authentication: { user: z.string().optional(), ip: z.string().optional() },
  endpoint: { host: z.string().optional(), user: z.string().optional() },
  process: { host: z.string().optional(), hash: z.string().optional() },
  ip: { ip: z.string().optional() },
  user: { user: z.string().optional() },
  related_alerts: {
    user: z.string().optional(),
    host: z.string().optional(),
    ip: z.string().optional(),
  },
  assets: { hostname: z.string().optional(), user: z.string().optional() },
};

export function handleTelemetryTool(
  name: string,
  args: Record<string, unknown>,
  world: TestWorld,
): unknown {
  return queryDataset(world, datasetFromToolName(name), args);
}

export async function startTelemetryMcpServer(worldPath: string): Promise<void> {
  const world = loadTestWorld(worldPath);
  const server = new McpServer({ name: "telemetry", version: "0.1.0" });
  for (const name of TELEMETRY_TOOLS) {
    const dataset = datasetFromToolName(name);
    server.registerTool(
      name,
      { description: `Read-only query: ${name}`, inputSchema: TOOL_SCHEMAS[dataset] },
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
