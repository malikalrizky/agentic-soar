import { errorResult, type InvestigationResult, type TestAlert } from "./schema.ts";
import { runInvestigation } from "./investigate.ts";
import { createPiClient, runPiInvestigation } from "./pi-host.ts";
import { resultPath, writeResultFile } from "./write-result.ts";

export function createInvestigateHandler(opts: {
  busy: { current: boolean };
  run: (alert: TestAlert) => Promise<InvestigationResult>;
}): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    const url = new URL(req.url);
    if (req.method !== "POST" || url.pathname !== "/investigate") {
      return Response.json({ error: "not_found" }, { status: 404 });
    }
    if (opts.busy.current) {
      return Response.json({ error: "investigation_in_progress" }, { status: 409 });
    }
    opts.busy.current = true;
    try {
      let parsed: unknown;
      try {
        parsed = await req.json();
      } catch {
        return Response.json({ error: "invalid_json" }, { status: 400 });
      }
      const alert = (parsed as { alert?: TestAlert } | null)?.alert;
      if (!alert || typeof alert.type !== "string" || typeof alert.timestamp !== "string") {
        return Response.json({ error: "invalid_alert" }, { status: 400 });
      }
      const result = await opts.run(alert);
      return Response.json({ result });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return Response.json({ result: errorResult("unknown", message) }, { status: 500 });
    } finally {
      opts.busy.current = false;
    }
  };
}

const busy = { current: false };

export async function startHttpServer(port = Number(process.env.PORT ?? 8787)): Promise<void> {
  const handler = createInvestigateHandler({
    busy,
    run: async (alert) => {
      const client = createPiClient({
        sessionDir: "var/pi-sessions",
        systemPromptPath: "prompts/investigation.md",
      });
      try {
        return await runInvestigation(alert, { runPi: runPiInvestigation, client }, (result, sessionFile) => {
          writeResultFile(resultPath(`${alert.type}-${alert.timestamp}.json`, "var/results"), result, sessionFile);
        });
      } finally {
        await client.close();
      }
    },
  });
  Bun.serve({ port, fetch: handler });
}

if (import.meta.main) {
  await startHttpServer();
}
