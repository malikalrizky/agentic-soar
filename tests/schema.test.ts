import { describe, expect, test } from "bun:test";
import { errorResult, extractJsonObject, parseInvestigationResult } from "../src/schema.ts";

describe("schema", () => {
  test("parseInvestigationResult accepts a full valid object and sets model_id from the argument", () => {
    const result = parseInvestigationResult({
      alert_disposition: "false_positive",
      recommended_posture: "no_action",
      confidence: "low",
      summary: "VPN from office",
      supporting_evidence: [{ claim: "auth from 10.0.0.8", source: "telemetry", dataset: "authentication" }],
      assumptions: [],
      investigation_steps: ["queried auth"],
      entities: ["bob"],
      recommended_next_step: "close",
    }, "frozen-model");
    expect(result.model_id).toBe("frozen-model");
    expect(result.alert_disposition).toBe("false_positive");
  });

  test("parseInvestigationResult throws on invalid alert_disposition", () => {
    expect(() => parseInvestigationResult({ alert_disposition: "maybe", recommended_posture: "no_action", confidence: "low", summary: "x", supporting_evidence: [], assumptions: [], investigation_steps: [], entities: [], recommended_next_step: "x" }, "m")).toThrow();
  });

  test("extractJsonObject reads the last JSON object in fenced markdown", () => {
    expect(extractJsonObject("notes\n```json\n{\"alert_disposition\":\"error\",\"recommended_posture\":\"needs_human\",\"confidence\":\"low\",\"summary\":\"s\",\"supporting_evidence\":[],\"assumptions\":[],\"investigation_steps\":[],\"entities\":[],\"recommended_next_step\":\"n\"}\n```")).toEqual(expect.objectContaining({ alert_disposition: "error" }));
  });

  test("extractJsonObject on plain prose throws", () => {
    expect(() => extractJsonObject("sorry I cannot")).toThrow();
  });

  test("errorResult uses alert_disposition error and recommended_posture needs_human", () => {
    const r = errorResult("m", "child exited");
    expect(r.alert_disposition).toBe("error");
    expect(r.recommended_posture).toBe("needs_human");
    expect(r.confidence).toBe("low");
    expect(r.model_id).toBe("m");
  });
});
