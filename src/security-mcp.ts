import { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { handleCoralogixSearch, type SecurityDeps } from "./security.ts";

function gsmResourceName(project: string, secretId: string): string {
  return `projects/${project}/secrets/${secretId}/versions/latest`;
}

const gsmClient = new SecretManagerServiceClient();

async function gsmGetSecret(): Promise<string> {
  const project = process.env.TOOL_LAYER_GCP_PROJECT?.trim();
  const secretId = process.env.TOOL_LAYER_CORALOGIX_SECRET?.trim();
  if (!project || !secretId) {
    throw new Error("TOOL_LAYER_GCP_PROJECT and TOOL_LAYER_CORALOGIX_SECRET required");
  }
  const [version] = await gsmClient.accessSecretVersion({
    name: gsmResourceName(project, secretId),
  });
  const data = version.payload?.data;
  if (data == null) {
    throw new Error("empty secret payload");
  }
  if (typeof data === "string") return data;
  return Buffer.from(data).toString("utf8");
}

export async function startSecurityMcpServer(deps: SecurityDeps): Promise<void> {
  const server = new McpServer({ name: "security", version: "0.1.0" });
  server.registerTool(
    "coralogix_search",
    {
      description: "Read-only Coralogix DataPrime search",
      inputSchema: {
        query: z.string(),
        start: z.string(),
        end: z.string(),
        limit: z.number().optional(),
      },
    },
    async (args) => {
      const result = await handleCoralogixSearch(args as Record<string, unknown>, deps);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
        isError: !result.ok,
      };
    },
  );
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  await startSecurityMcpServer({
    getSecret: gsmGetSecret,
    fetch,
  });
}
