import { describe, expect, test } from "bun:test";
import { errorResult, type InvestigationResult } from "../src/schema.ts";
import { runInvestigation } from "../src/investigate.ts";
import type { PiRunOk } from "../src/pi-host.ts";
import { PiHostError, type RpcClientLike } from "../src/pi-host.ts";

const dummyClient = {} as RpcClientLike;

describe("investigate", () => {
  test("invalid model JSON becomes error disposition", async () => {
    const runPi = async (): Promise<PiRunOk> => ({
      text: "not json",
      modelId: "frozen-model",
      sessionFile: null,
      toolCallCount: 1,
      aborted: false,
    });
    const written: InvestigationResult[] = [];
    const r = await runInvestigation(
      { type: "suspicious_login", timestamp: "2026-01-01T00:00:00Z", user: "bob" },
      { runPi, client: dummyClient },
      (x) => written.push(x),
    );
    expect(r.alert_disposition).toBe("error");
    expect(written).toHaveLength(1);
  });

  test("aborted run does not parse model text", async () => {
    const runPi = async (): Promise<PiRunOk> => ({
      text: JSON.stringify({
        alert_disposition: "true_positive",
        recommended_posture: "recommend_containment",
        confidence: "high",
        summary: "should ignore",
        supporting_evidence: [],
        assumptions: [],
        investigation_steps: [],
        entities: [],
        recommended_next_step: "x",
      }),
      modelId: "frozen-model",
      sessionFile: null,
      toolCallCount: 15,
      aborted: true,
    });
    const r = await runInvestigation(
      { type: "suspicious_login", timestamp: "2026-01-01T00:00:00Z", user: "alice" },
      { runPi, client: dummyClient },
      () => {},
    );
    expect(r.alert_disposition).toBe("error");
    expect(r.summary).toMatch(/cap/i);
  });

  test("PiHostError becomes error result", async () => {
    const runPi = async (): Promise<PiRunOk> => {
      throw new PiHostError("child exited", "m");
    };
    const r = await runInvestigation(
      { type: "suspicious_login", timestamp: "2026-01-01T00:00:00Z" },
      { runPi, client: dummyClient },
      () => {},
    );
    expect(r).toEqual(errorResult("m", "child exited"));
  });
});
