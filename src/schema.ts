import { z } from "zod";

export type AlertDisposition =
  | "true_positive"
  | "false_positive"
  | "benign_true_positive"
  | "insufficient_evidence"
  | "error";

export type RecommendedPosture =
  | "no_action"
  | "monitor"
  | "needs_human"
  | "recommend_containment";

export type Confidence = "low" | "medium" | "high";

export type TestAlert = {
  type: string;
  timestamp: string;
  user?: string;
  host?: string;
  source_ip?: string;
  process?: string;
  hash?: string;
};

export type EvidenceItem = {
  claim: string;
  source: "alert" | "telemetry";
  dataset?: string;
};

export type InvestigationResult = {
  alert_disposition: AlertDisposition;
  recommended_posture: RecommendedPosture;
  confidence: Confidence;
  model_id: string;
  summary: string;
  supporting_evidence: EvidenceItem[];
  assumptions: string[];
  investigation_steps: string[];
  entities: string[];
  recommended_next_step: string;
};

const evidenceItemSchema = z.object({
  claim: z.string(),
  source: z.enum(["alert", "telemetry"]),
  dataset: z.string().optional(),
});

const investigationResultSchema = z.object({
  alert_disposition: z.enum([
    "true_positive",
    "false_positive",
    "benign_true_positive",
    "insufficient_evidence",
    "error",
  ]),
  recommended_posture: z.enum([
    "no_action",
    "monitor",
    "needs_human",
    "recommend_containment",
  ]),
  confidence: z.enum(["low", "medium", "high"]),
  summary: z.string(),
  supporting_evidence: z.array(evidenceItemSchema),
  assumptions: z.array(z.string()),
  investigation_steps: z.array(z.string()),
  entities: z.array(z.string()),
  recommended_next_step: z.string(),
  model_id: z.string().optional(),
});

export function extractJsonObject(text: string): unknown {
  const fences = [...text.matchAll(/```json\s*([\s\S]*?)```/g)];
  const lastFence = fences.at(-1)?.[1];
  if (lastFence !== undefined) {
    return JSON.parse(lastFence);
  }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new Error("no JSON object in text");
  }
  return JSON.parse(text.slice(start, end + 1));
}

export function parseInvestigationResult(raw: unknown, modelId: string): InvestigationResult {
  const parsed = investigationResultSchema.parse(raw);
  return { ...parsed, model_id: modelId };
}

export function errorResult(modelId: string, summary: string): InvestigationResult {
  return {
    alert_disposition: "error",
    recommended_posture: "needs_human",
    confidence: "low",
    model_id: modelId,
    summary,
    supporting_evidence: [],
    assumptions: [],
    investigation_steps: [],
    entities: [],
    recommended_next_step: "",
  };
}
