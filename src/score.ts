import type { InvestigationResult } from "./schema.ts";
import {
  queryDataset,
  TELEMETRY_TOOLS,
  type TestWorld,
} from "./world.ts";

export type InvestigationScore = {
  inventedEvidence: boolean;
  toolsWereKnown: boolean;
};

export function scoreInvestigation(
  result: InvestigationResult,
  world: TestWorld,
  sessionToolNames: string[],
  subject: { user?: string } = {},
): InvestigationScore {
  const known = new Set(TELEMETRY_TOOLS);
  const toolsWereKnown = sessionToolNames.every((name) => known.has(name));
  const inventedEvidence = result.supporting_evidence.some((item) => {
    if (item.source !== "telemetry") return false;
    if (!item.dataset) return true;
    let rows: unknown[];
    try {
      rows = queryDataset(world, item.dataset, subject.user ? { user: subject.user } : {});
    } catch {
      return true;
    }
    return subject.user !== undefined && rows.length === 0;
  });
  return { inventedEvidence, toolsWereKnown };
}
