import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { errorResult } from "../src/schema.ts";
import {
  createHttpHandler,
  createInvestigateHandler,
  isDocsClientAllowed,
  parseDocsAccess,
} from "../src/http.ts";
import { loadAlert, resultPath, writeResultFile } from "../src/write-result.ts";

async function invoke(
  handler: (req: Request) => Promise<Response>,
  method: string,
  path: string,
  body: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const req = new Request(`http://127.0.0.1${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === null || body === undefined ? undefined : JSON.stringify(body),
  });
  const res = await handler(req);
  let parsed: Record<string, unknown> = {};
  try {
    parsed = (await res.json()) as Record<string, unknown>;
  } catch {
    parsed = {};
  }
  return { status: res.status, body: parsed };
}

async function invokeRaw(
  handler: (req: Request, clientAddress?: string | null) => Promise<Response>,
  method: string,
  path: string,
  clientAddress: string | null = "127.0.0.1",
): Promise<{ status: number; contentType: string; text: string; body?: Record<string, unknown> }> {
  const res = await handler(new Request(`http://127.0.0.1${path}`, { method }), clientAddress);
  const text = await res.text();
  let body: Record<string, unknown> | undefined;
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    body = undefined;
  }
  return {
    status: res.status,
    contentType: res.headers.get("content-type") ?? "",
    text,
    body,
  };
}

describe("http", () => {
  test("POST /investigate 400 on empty body", async () => {
    const handler = createInvestigateHandler({
      run: async () => errorResult("m", "n"),
    });
    const { status } = await invoke(handler, "POST", "/investigate", null);
    expect(status).toBe(400);
  });

  test("POST /investigate 400 on invalid alert", async () => {
    const handler = createInvestigateHandler({
      run: async () => errorResult("m", "n"),
    });
    const { status, body } = await invoke(handler, "POST", "/investigate", { alert: { type: 1 } });
    expect(status).toBe(400);
    expect(body.error).toBe("invalid_alert");
  });

  test("GET /docs and /openapi.yaml serve browser docs for internal clients", async () => {
    const handler = createHttpHandler({
      run: async () => errorResult("m", "n"),
      docsAccess: "private",
    });
    const docs = await invokeRaw(handler, "GET", "/docs", "10.0.0.5");
    expect(docs.status).toBe(200);
    expect(docs.contentType).toContain("text/html");
    expect(docs.text).toContain("openapi.yaml");
    const spec = await invokeRaw(handler, "GET", "/openapi.yaml", "127.0.0.1");
    expect(spec.status).toBe(200);
    expect(spec.contentType).toContain("yaml");
    expect(spec.text).toContain("openapi:");
  });

  test("GET /docs 404 for public clients", async () => {
    const handler = createHttpHandler({
      run: async () => errorResult("m", "n"),
      docsAccess: "private",
    });
    const docs = await invokeRaw(handler, "GET", "/docs", "8.8.8.8");
    expect(docs.status).toBe(404);
    expect(docs.body?.error).toBe("not_found");
  });

  test("GET /docs 404 when DOCS_ACCESS=off", async () => {
    const handler = createHttpHandler({
      run: async () => errorResult("m", "n"),
      docsAccess: "off",
    });
    const docs = await invokeRaw(handler, "GET", "/docs", "127.0.0.1");
    expect(docs.status).toBe(404);
  });

  test("isDocsClientAllowed and parseDocsAccess", () => {
    expect(parseDocsAccess(undefined)).toBe("private");
    expect(parseDocsAccess("off")).toBe("off");
    expect(isDocsClientAllowed("127.0.0.1", "loopback")).toBe(true);
    expect(isDocsClientAllowed("10.1.2.3", "loopback")).toBe(false);
    expect(isDocsClientAllowed("10.1.2.3", "private")).toBe(true);
    expect(isDocsClientAllowed("8.8.8.8", "private")).toBe(false);
    expect(isDocsClientAllowed("127.0.0.1", "off")).toBe(false);
  });

  test("overlapping POST /investigate starts run once", async () => {
    let entered = 0;
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const handler = createInvestigateHandler({
      run: async () => {
        entered += 1;
        await held;
        return errorResult("m", "ok");
      },
    });
    const body = { alert: { type: "suspicious_login", timestamp: "2026-01-01T00:00:00Z" } };
    const p1 = invoke(handler, "POST", "/investigate", body);
    const p2 = invoke(handler, "POST", "/investigate", body);
    await Bun.sleep(20);
    expect(entered).toBe(1);
    release();
    const results = await Promise.all([p1, p2]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  });
});

describe("write-result", () => {
  test("resultPath uses basename plus .result.json", () => {
    expect(resultPath("testdata/alerts/02.json", "var/results")).toBe("var/results/02.result.json");
  });

  test("loadAlert reads testdata shape", () => {
    const dir = mkdtempSync(join(tmpdir(), "alert-"));
    const path = join(dir, "a.json");
    writeFileSync(
      path,
      JSON.stringify({ type: "suspicious_login", timestamp: "2026-01-01T00:00:00Z", user: "bob" }),
    );
    expect(loadAlert(path)).toEqual({
      type: "suspicious_login",
      timestamp: "2026-01-01T00:00:00Z",
      user: "bob",
    });
  });

  test("writeResultFile writes json and jsonl", () => {
    const dir = mkdtempSync(join(tmpdir(), "out-"));
    const path = join(dir, "02.result.json");
    const result = errorResult("m", "n");
    writeResultFile(path, result, "/s.jsonl");
    expect(JSON.parse(readFileSync(path, "utf8")).summary).toBe("n");
    expect(readFileSync(`${path}.session`, "utf8").trim()).toBe("/s.jsonl");
  });
});
