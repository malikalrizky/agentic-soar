import { resolve } from "node:path";
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
    if (run.aborted) {
      result = errorResult(run.modelId, "cap: 10m or 15 tool calls");
    } else {
      try {
        result = parseInvestigationResult(extractJsonObject(run.text), run.modelId);
      } catch {
        result = errorResult(run.modelId, "invalid investigation json");
      }
    }
  } catch (err) {
    if (err instanceof PiHostError) {
      result = errorResult(err.modelId, err.message);
    } else {
      throw err;
    }
  }
  writeResultFile(resultPath(persistKey, outDir), result, sessionFile);
  return result;
}
