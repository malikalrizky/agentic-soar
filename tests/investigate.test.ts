import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { errorResult, type InvestigationResult } from "../src/schema.ts";
import { runInvestigation } from "../src/investigate.ts";
import type { PiRunOk } from "../src/pi-host.ts";
import { PiHostError } from "../src/pi-host.ts";
import { resultPath } from "../src/write-result.ts";

function tmpOut(): string {
  return mkdtempSync(join(tmpdir(), "inv-"));
}

function readWritten(outDir: string, persistKey: string): InvestigationResult {
  const path = resultPath(persistKey, outDir);
  return JSON.parse(readFileSync(path, "utf8")) as InvestigationResult;
}

describe("investigate", () => {
  test("invalid model JSON becomes error disposition and is persisted", async () => {
    const outDir = tmpOut();
    const runPi = async (): Promise<PiRunOk> => ({
      text: "not json",
      modelId: "frozen-model",
      sessionFile: null,
      toolCallCount: 1,
      aborted: false,
    });
    const r = await runInvestigation(
      { type: "suspicious_login", timestamp: "2026-01-01T00:00:00Z", user: "bob" },
      "01",
      { runPi, outDir },
    );
    expect(r.alert_disposition).toBe("error");
    expect(readWritten(outDir, "01").alert_disposition).toBe("error");
  });

  test("aborted run does not parse model text", async () => {
    const outDir = tmpOut();
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
      "cap",
      { runPi, outDir },
    );
    expect(r.alert_disposition).toBe("error");
    expect(r.summary).toMatch(/cap/i);
    expect(readWritten(outDir, "cap").summary).toMatch(/cap/i);
  });

  test("PiHostError becomes error result", async () => {
    const outDir = tmpOut();
    const runPi = async (): Promise<PiRunOk> => {
      throw new PiHostError("child exited", "m");
    };
    const r = await runInvestigation(
      { type: "suspicious_login", timestamp: "2026-01-01T00:00:00Z" },
      "err",
      { runPi, outDir },
    );
    expect(r).toEqual(errorResult("m", "child exited"));
    expect(readWritten(outDir, "err")).toEqual(r);
  });
});
