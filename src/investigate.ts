import {
  errorResult,
  extractJsonObject,
  parseInvestigationResult,
  type InvestigationResult,
  type TestAlert,
} from "./schema.ts";
import { PiHostError, type PiRunOk, type RpcClientLike } from "./pi-host.ts";

export function formatAlertPrompt(alert: TestAlert): string {
  return [
    "Investigate this Test Alert using telemetry tools. Next steps must depend on evidence.",
    "Return one Investigation Result JSON object (no model_id).",
    JSON.stringify(alert),
  ].join("\n");
}

export async function runInvestigation(
  alert: TestAlert,
  deps: {
    runPi: (client: RpcClientLike, prompt: string) => Promise<PiRunOk>;
    client: RpcClientLike;
  },
  write: (result: InvestigationResult, sessionFile: string | null) => void,
): Promise<InvestigationResult> {
  const prompt = formatAlertPrompt(alert);
  let result: InvestigationResult;
  let sessionFile: string | null = null;
  try {
    const run = await deps.runPi(deps.client, prompt);
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
  write(result, sessionFile);
  return result;
}
