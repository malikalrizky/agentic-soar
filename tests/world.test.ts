import { describe, expect, test } from "bun:test";
import { loadTestWorld, queryDataset } from "../src/world.ts";

describe("world", () => {
  test("alice auth and bob auth are different slices", () => {
    const w = loadTestWorld("testdata/world.json");
    const alice = queryDataset(w, "authentication", { user: "alice" }) as { ip: string }[];
    const bob = queryDataset(w, "authentication", { user: "bob" }) as {
      ip: string;
      is_known_office: boolean;
    }[];
    expect(alice.some((e) => e.ip === "203.0.113.10")).toBe(true);
    expect(bob.some((e) => e.is_known_office === true)).toBe(true);
    expect(alice.map((e) => e.ip).sort()).not.toEqual(bob.map((e) => e.ip).sort());
  });

  test("unknown user returns empty array", () => {
    const w = loadTestWorld("testdata/world.json");
    expect(queryDataset(w, "authentication", { user: "nobody" })).toEqual([]);
    expect(queryDataset(w, "process", { host: "no-such-host" })).toEqual([]);
  });

  test("alice process hash aa is not on bob", () => {
    const w = loadTestWorld("testdata/world.json");
    const byHash = queryDataset(w, "process", { hash: "aa" }) as { host: string }[];
    const bob = queryDataset(w, "process", { host: "bob-win" }) as { hash: string }[];
    expect(byHash.every((p) => p.host === "alice-mbp")).toBe(true);
    expect(bob.some((p) => p.hash === "aa")).toBe(false);
  });

  test("ip query ignores unrelated filter keys", () => {
    const w = loadTestWorld("testdata/world.json");
    const withHash = queryDataset(w, "ip", { ip: "10.0.0.8", hash: "aa" });
    const without = queryDataset(w, "ip", { ip: "10.0.0.8" });
    expect(withHash).toEqual(without);
  });
});
