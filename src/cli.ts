import { basename, resolve } from "node:path";
import { runInvestigation } from "./investigate.ts";
import { loadAlert, resultPath } from "./write-result.ts";

export async function main(argv = process.argv): Promise<string> {
  const alertPath = argv[2];
  if (!alertPath) {
    throw new Error("usage: bun src/cli.ts <alert.json>");
  }
  const alert = loadAlert(alertPath);
  const persistKey = basename(alertPath).replace(/\.json$/i, "");
  const outDir = resolve("var/results");
  await runInvestigation(alert, persistKey, { outDir });
  return resultPath(persistKey, outDir);
}

if (import.meta.main) {
  await main();
}
