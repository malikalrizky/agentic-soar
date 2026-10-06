import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { InvestigationResult, TestAlert } from "./schema.ts";

export function resultPath(alertFileOrId: string, outDir: string): string {
  const base = basename(alertFileOrId).replace(/\.json$/i, "");
  return join(outDir, `${base}.result.json`);
}

export function loadAlert(path: string): TestAlert {
  const raw = JSON.parse(readFileSync(path, "utf8")) as TestAlert;
  if (typeof raw.type !== "string" || typeof raw.timestamp !== "string") {
    throw new Error("alert requires type and timestamp");
  }
  return raw;
}

export function writeResultFile(
  path: string,
  result: InvestigationResult,
  sessionFile?: string | null,
): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(result, null, 2)}\n`);
  appendFileSync(join(dirname(path), "results.jsonl"), `${JSON.stringify(result)}\n`);
  if (sessionFile) {
    writeFileSync(`${path}.session`, `${sessionFile}\n`);
  }
}
