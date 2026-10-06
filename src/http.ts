import { join } from "node:path";
import { errorResult, parseTestAlert, type InvestigationResult, type TestAlert } from "./schema.ts";
import { runInvestigation } from "./investigate.ts";

const docsRoot = join(import.meta.dir, "../docs");

export type DocsAccess = "off" | "loopback" | "private";

export function parseDocsAccess(raw: string | undefined): DocsAccess {
  if (raw === "off" || raw === "loopback" || raw === "private") return raw;
  return "private";
}

function normalizeIp(address: string): string {
  return address.replace(/^\[|\]$/g, "").replace(/^::ffff:/i, "");
}

function isLoopback(ip: string): boolean {
  if (ip === "::1") return true;
  if (ip === "127.0.0.1") return true;
  const m = /^127\.(\d+)\.(\d+)\.(\d+)$/.exec(ip);
  return m !== null;
}

function isPrivateV4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return false;
  }
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

function isPrivateV6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
  if (lower.startsWith("fe80:")) return true;
  return false;
}

/** Loopback / RFC1918 / ULA / link-local. Used to hide /docs from public clients. */
export function isDocsClientAllowed(
  address: string | null | undefined,
  access: DocsAccess,
): boolean {
  if (access === "off") return false;
  if (!address) return false;
  const ip = normalizeIp(address);
  if (isLoopback(ip)) return true;
  if (access === "loopback") return false;
  return isPrivateV4(ip) || isPrivateV6(ip);
}

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

export function createHttpHandler(opts: {
  run: (alert: TestAlert) => Promise<InvestigationResult>;
  docsAccess?: DocsAccess;
}): (req: Request, clientAddress?: string | null) => Promise<Response> {
  const investigate = createInvestigateHandler(opts);
  const docsAccess = opts.docsAccess ?? "private";
  return async (req: Request, clientAddress?: string | null) => {
    const url = new URL(req.url);
    const wantsDocs =
      req.method === "GET" &&
      (url.pathname === "/docs" || url.pathname === "/docs/" || url.pathname === "/openapi.yaml");
    if (wantsDocs) {
      if (!isDocsClientAllowed(clientAddress, docsAccess)) {
        return Response.json({ error: "not_found" }, { status: 404 });
      }
      if (url.pathname === "/openapi.yaml") {
        return new Response(Bun.file(join(docsRoot, "openapi.yaml")), {
          headers: { "content-type": "application/yaml; charset=utf-8" },
        });
      }
      return new Response(Bun.file(join(docsRoot, "api/index.html")), {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
    return investigate(req);
  };
}

export async function startHttpServer(port = Number(process.env.PORT ?? 8787)): Promise<void> {
  const handler = createHttpHandler({
    run: (alert) => runInvestigation(alert, `${alert.type}-${alert.timestamp}`),
    docsAccess: parseDocsAccess(process.env.DOCS_ACCESS),
  });
  Bun.serve({
    port,
    fetch(req, server) {
      return handler(req, server.requestIP(req)?.address ?? null);
    },
  });
}

if (import.meta.main) {
  await startHttpServer();
}
