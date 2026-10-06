import { describe, expect, test } from "bun:test";
import { handleTelemetryTool } from "../src/mcp-server.ts";
import { loadTestWorld } from "../src/world.ts";

describe("mcp handlers", () => {
  test("handleTelemetryTool query_authentication forwards user filter", () => {
    const w = loadTestWorld("testdata/world.json");
    const rows = handleTelemetryTool("query_authentication", { user: "bob" }, w) as { ip: string }[];
    expect(rows.some((r) => r.ip === "10.0.0.8")).toBe(true);
  });

  test("unknown tool name throws", () => {
    const w = loadTestWorld("testdata/world.json");
    expect(() => handleTelemetryTool("isolate_host", {}, w)).toThrow();
  });
});
