import { describe, expect, test } from "bun:test";
import { loadTestWorld, queryAuthentication, queryProcess } from "../src/world.ts";

describe("world", () => {
  test("alice auth and bob auth are different slices", () => {
    const w = loadTestWorld("testdata/world.json");
    const alice = queryAuthentication(w, { user: "alice" });
    const bob = queryAuthentication(w, { user: "bob" });
    expect(alice.some((e) => e.ip === "203.0.113.10")).toBe(true);
    expect(bob.some((e) => e.is_known_office === true)).toBe(true);
    expect(alice.map((e) => e.ip).sort()).not.toEqual(bob.map((e) => e.ip).sort());
  });

  test("unknown user returns empty array", () => {
    const w = loadTestWorld("testdata/world.json");
    expect(queryAuthentication(w, { user: "nobody" })).toEqual([]);
    expect(queryProcess(w, { host: "no-such-host" })).toEqual([]);
  });

  test("alice process hash aa is not on bob", () => {
    const w = loadTestWorld("testdata/world.json");
    expect(queryProcess(w, { hash: "aa" }).every((p) => p.host === "alice-mbp")).toBe(true);
    expect(queryProcess(w, { host: "bob-win" }).some((p) => p.hash === "aa")).toBe(false);
  });
});
