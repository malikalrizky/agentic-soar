import { readdirSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import { loadTestWorld, queryDataset } from "../src/world.ts";

describe("branchiness", () => {
  test("first authentication query is not unique across 01 02 07", () => {
    const w = loadTestWorld("testdata/world.json");
    const a = JSON.stringify(queryDataset(w, "authentication", { user: "alice" }));
    const b = JSON.stringify(queryDataset(w, "authentication", { user: "bob" }));
    const s = JSON.stringify(queryDataset(w, "authentication", { user: "scanner-svc" }));
    expect(new Set([a, b, s]).size).toBe(3);
  });

  test("nine alerts exist and nobody has empty auth", () => {
    const files = readdirSync("testdata/alerts").filter((f) => f.endsWith(".json"));
    expect(files).toHaveLength(9);
    const w = loadTestWorld("testdata/world.json");
    expect(queryDataset(w, "authentication", { user: "nobody" })).toEqual([]);
  });
});
