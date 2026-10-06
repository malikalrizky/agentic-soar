import { resolve } from "node:path";
import { INVESTIGATION_CAP_SUMMARY } from "./constants.ts";
import {
  errorResult,
  extractJsonObject,
  parseInvestigationResult,
  type InvestigationResult,
  type TestAlert,
} from "./schema.ts";
import { PiHostError, runPiInvestigation, type PiRunOk } from "./pi-host.ts";
import { resultPath, writeResultFile } from "./write-result.ts";

function formatAlertPrompt(alert: TestAlert): string {
  return [
    "Investigate this Test Alert using telemetry tools. Next steps must depend on evidence.",
    "Return one Investigation Result JSON object (no model_id).",
    JSON.stringify(alert),
  ].join("\n");
}

export type InvestigationDeps = {
  runPi?: (prompt: string) => Promise<PiRunOk>;
  outDir?: string;
};

export function investigationResultFromRun(run: PiRunOk | PiHostError): InvestigationResult {
  if (run instanceof PiHostError) {
    return errorResult(run.modelId, run.message);
  }
  if (run.aborted) {
    return errorResult(run.modelId, INVESTIGATION_CAP_SUMMARY);
  }
  try {
    return parseInvestigationResult(extractJsonObject(run.text), run.modelId);
  } catch {
    return errorResult(run.modelId, "invalid investigation json");
  }
}

export async function runInvestigation(
  alert: TestAlert,
  persistKey: string,
  deps: InvestigationDeps = {},
): Promise<InvestigationResult> {
  const prompt = formatAlertPrompt(alert);
  const outDir = deps.outDir ?? resolve("var/results");
  const runPi = deps.runPi ?? runPiInvestigation;
  let result: InvestigationResult;
  let sessionFile: string | null = null;
  try {
    const run = await runPi(prompt);
    sessionFile = run.sessionFile;
    result = investigationResultFromRun(run);
  } catch (err) {
    if (err instanceof PiHostError) {
      result = investigationResultFromRun(err);
    } else {
      throw err;
    }
  }
  writeResultFile(resultPath(persistKey, outDir), result, sessionFile);
  return result;
}
