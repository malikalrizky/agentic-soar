import { describe, expect, test } from "bun:test";
import { errorResult } from "../src/schema.ts";
import { scoreInvestigation } from "../src/score.ts";
import { loadTestWorld } from "../src/world.ts";

describe("score", () => {
  test("unknown tool names are not known", () => {
    const world = loadTestWorld("testdata/world.json");
    const result = errorResult("m", "cap");
    expect(
      scoreInvestigation(result, world, ["query_authentication", "query_host"]).toolsWereKnown,
    ).toBe(false);
    expect(scoreInvestigation(result, world, ["query_authentication"]).toolsWereKnown).toBe(true);
  });

  test("telemetry evidence on the empty nobody slice is invented", () => {
    const world = loadTestWorld("testdata/world.json");
    const result = {
      ...errorResult("m", "ok"),
      alert_disposition: "false_positive" as const,
      supporting_evidence: [
        { claim: "nobody logged in from SG", source: "telemetry" as const, dataset: "authentication" },
      ],
    };
    expect(scoreInvestigation(result, world, ["query_authentication"], { user: "nobody" }).inventedEvidence).toBe(
      true,
    );
    expect(scoreInvestigation(result, world, ["query_authentication"], { user: "bob" }).inventedEvidence).toBe(
      false,
    );
  });
});
