import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { errorResult } from "../src/schema.ts";
import { createInvestigateHandler } from "../src/http.ts";
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

describe("http", () => {
  test("POST /investigate 409 when busy", async () => {
    const handler = createInvestigateHandler({
      busy: { current: true },
      run: async () => {
        throw new Error("should not run");
      },
    });
    const { status, body } = await invoke(handler, "POST", "/investigate", {
      alert: { type: "suspicious_login", timestamp: "2026-01-01T00:00:00Z" },
    });
    expect(status).toBe(409);
    expect(body.error).toBe("investigation_in_progress");
  });

  test("POST /investigate 400 on empty body", async () => {
    const handler = createInvestigateHandler({
      busy: { current: false },
      run: async () => errorResult("m", "n"),
    });
    const { status } = await invoke(handler, "POST", "/investigate", null);
    expect(status).toBe(400);
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
    writeResultFile(path, result);
    expect(JSON.parse(readFileSync(path, "utf8")).summary).toBe("n");
  });
});
