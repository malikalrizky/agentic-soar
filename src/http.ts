import { errorResult, parseTestAlert, type InvestigationResult, type TestAlert } from "./schema.ts";
import { runInvestigation } from "./investigate.ts";

export function createInvestigateHandler(opts: {
  run: (alert: TestAlert) => Promise<InvestigationResult>;
}): (req: Request) => Promise<Response> {
  let busy = false;
  return async (req: Request) => {
    const url = new URL(req.url);
    if (req.method !== "POST" || url.pathname !== "/investigate") {
      return Response.json({ error: "not_found" }, { status: 404 });
    }
    if (busy) {
      return Response.json({ error: "investigation_in_progress" }, { status: 409 });
    }
    busy = true;
    try {
      let parsed: unknown;
      try {
        parsed = await req.json();
      } catch {
        return Response.json({ error: "invalid_json" }, { status: 400 });
      }
      let alert: TestAlert;
      try {
        alert = parseTestAlert((parsed as { alert?: unknown } | null)?.alert);
      } catch {
        return Response.json({ error: "invalid_alert" }, { status: 400 });
      }
      const result = await opts.run(alert);
      return Response.json({ result });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return Response.json({ result: errorResult("unknown", message) }, { status: 500 });
    } finally {
      busy = false;
    }
  };
}

export async function startHttpServer(port = Number(process.env.PORT ?? 8787)): Promise<void> {
  const handler = createInvestigateHandler({
    run: (alert) => runInvestigation(alert, `${alert.type}-${alert.timestamp}`),
  });
  Bun.serve({ port, fetch: handler });
}

if (import.meta.main) {
  await startHttpServer();
}
