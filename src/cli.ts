import { resolve } from "node:path";
import { runInvestigation } from "./investigate.ts";
import { createPiClient, runPiInvestigation } from "./pi-host.ts";
import { loadAlert, resultPath, writeResultFile } from "./write-result.ts";

export async function main(argv = process.argv): Promise<string> {
  const alertPath = argv[2];
  if (!alertPath) {
    throw new Error("usage: bun src/cli.ts <alert.json>");
  }
  const alert = loadAlert(alertPath);
  const client = createPiClient({
    sessionDir: resolve("var/pi-sessions"),
    systemPromptPath: resolve("prompts/investigation.md"),
  });
  try {
    const out = resultPath(alertPath, resolve("var/results"));
    const result = await runInvestigation(alert, { runPi: runPiInvestigation, client }, (r, sessionFile) => {
      writeResultFile(out, r, sessionFile);
    });
    return out;
  } finally {
    await client.close();
  }
}

if (import.meta.main) {
  await main();
}
