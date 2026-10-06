import { readFileSync } from "node:fs";
import { expect, test } from "bun:test";

test("mcp.json keeps telemetry and disables security without env secrets", () => {
  const cfg = JSON.parse(readFileSync(".pi/mcp.json", "utf8"));
  expect(cfg.mcpServers.telemetry.args).toEqual(["src/mcp-server.ts"]);
  expect(cfg.mcpServers.telemetry.exposure).toBe("direct");
  expect(cfg.mcpServers.security.args).toEqual(["src/security-mcp.ts"]);
  expect(cfg.mcpServers.security.exposure).toBe("direct");
  expect(cfg.mcpServers.security.disabled).toBe(true);
  expect(cfg.mcpServers.security.env).toBeUndefined();
  expect(JSON.stringify(cfg)).not.toMatch(/CORALOGIX|apiKey|API_KEY/);
});

test("Test World tools stay query_* and do not include coralogix_search", async () => {
  const { TELEMETRY_TOOLS } = await import("../src/mcp-server.ts");
  expect([...TELEMETRY_TOOLS]).not.toContain("coralogix_search");
  expect(TELEMETRY_TOOLS).toContain("query_authentication");
});
