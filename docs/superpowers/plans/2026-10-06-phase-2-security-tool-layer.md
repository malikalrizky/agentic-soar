# Phase 2 Security Tool Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a second stdio MCP process that runs `coralogix_search` with Secret Manager credentials, without putting vendor keys in Pi or breaking the Phase 1 Test World MCP.

**Architecture:** One deep module `handleCoralogixSearch` owns validate, cache, vendor HTTP, redact, bound, audit, fail-closed errors. Tests and the MCP adapter cross that seam. Two real adapters: `getSecret` (GSM vs fake) and `fetch` (network vs fake). Do not add files whose deletion only moves helpers. Do not share Tool names with Test World queries (ADR-0005). Committed `.pi/mcp.json` lists `security` with `"disabled": true`.

**Tech Stack:** Bun ≥ 1.4.2, TypeScript, `@modelcontextprotocol/sdk` 1.31.0, `zod`, `@google-cloud/secret-manager` (MCP process only), `bun test`. Pi 1.0.4 CLI via `PI_CLI` unchanged.

**Spec:** `docs/phase-2-security-tool-layer.md` (ADR `docs/adr/0005-phase-2-security-tool-layer.md`). Module rule: `.cursor/rules/deep-modules.mdc`.

## Global Constraints

- Host: Bun ≥ 1.4.2. Pi child: Node `PI_CLI` 1.0.4+ JS entry (`RpcClient` always `node <cli.js>`).
- Drive Pi with CLI RPC only; do not use in-process `registerTool()` for vendor auth.
- One tool: `coralogix_search`. No CrowdStrike, Wiz, Gateway, write Tools, `arbitrary_http_request`.
- Do not put Coralogix keys in Pi env, `.pi/mcp.json` `env`, tool results, errors, or audit bodies.
- Do not fall back to env files or `testdata/world.json` when SM or Coralogix fail.
- Fail closed: vendor/SM failure is `{ ok: false, error: { code, message } }`, never `hits: []`.
- `--no-builtin-tools` stays on. Do not raise the 15-call cap.
- Test World MCP stays `src/mcp-server.ts` with the existing query names.
- `security` MCP stays disabled in the committed `.pi/mcp.json`.
- No live GSM or Coralogix in `bun test`.
- Callers and tests use `handleCoralogixSearch`. Do not export redact/cache/HTTP helpers for tests.

## File structure

- `src/security.ts` — the module: types, limits, `handleCoralogixSearch`
- `src/security-mcp.ts` — stdio MCP adapter (like `http.ts` for Investigation)
- Modify: `.pi/mcp.json`, `prompts/investigation.md`, `README.md`
- Test: `tests/security.test.ts`, `tests/mcp-json.test.ts`
- Do not add `src/security/*.ts` pass-through files. Do not modify Test World handlers or Phase 1 result schema. Do not put GSM/Coralogix names on `createPiClient` env.

Pinned limits (private to `src/security.ts`, not a second module):

```ts
const MAX_QUERY_CHARS = 2000;
const MAX_WINDOW_MS = 86_400_000;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 20;
const MAX_RESULT_BYTES = 32_768;
const SECRET_TTL_MS = 300_000;
const HTTP_TIMEOUT_MS = 15_000;
const RETRY_BACKOFF_MS = 250;
const RETRY_AFTER_CAP_MS = 5_000;
```

Pinned interface (`src/security.ts`):

```ts
export type LayerErrorCode =
  | "invalid_request"
  | "secret_unavailable"
  | "vendor_auth"
  | "vendor_timeout"
  | "vendor_error";

export type LayerResult =
  | { ok: true; hitCount: number; hits: unknown[]; truncated: boolean }
  | { ok: false; error: { code: LayerErrorCode; message: string } };

export type SecurityDeps = {
  getSecret: () => Promise<string>;
  fetch: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  audit?: (line: string) => void;
};

export async function handleCoralogixSearch(
  raw: Record<string, unknown>,
  deps: SecurityDeps,
): Promise<LayerResult>;
```

`getSecret` returns GSM payload JSON `{"apiKey":"…","endpoint":"https://api.<region>.coralogix.com"}`. Cache that string in memory for `SECRET_TTL_MS` using `deps.now ?? Date.now`. 401/403 busts the cache and calls `getSecret` once more inside the same invocation.

Vendor call (implementation, not exported): `POST ${endpoint}/api/v1/dataprime/query` with `Authorization: Bearer ${apiKey}`, body `{ query, metadata: { startDate: start, endDate: end } }`, `AbortSignal.timeout(HTTP_TIMEOUT_MS)`. One retry on 429 or ≥500 (`Retry-After` seconds if numeric, else `RETRY_BACKOFF_MS`, cap `RETRY_AFTER_CAP_MS`). Fetch throw → `vendor_timeout`. Hits from `result.results` or `hits`, else wrap the parsed object. Cap to `limit` then `MAX_RESULT_BYTES`. Redact `apiKey` and key-shaped assignments. Audit one JSON line (stderr by default): `tool`, `argHash` (SHA-256 hex of canonical parsed args), `durationMs`, `status`, optional `httpStatus` / `errorCode`. No `query`, no secrets.

Args: `query` non-empty ≤ `MAX_QUERY_CHARS`; `start`/`end` finite `Date.parse`; `end > start`; window ≤ `MAX_WINDOW_MS`; `limit` default 10, clamp 1..20. Invalid → `invalid_request` without `getSecret` or `fetch`.

## Review Focus

1. Invalid args do not call `getSecret` or `fetch` — Task 1.
2. HTTP 500 after retry is `vendor_error`, not empty hits — Task 1.
3. Hits containing the API key are redacted; audit has `argHash` and no query/key — Task 1.
4. 401 refetches secret once; TTL reuse does not call `getSecret` again until `SECRET_TTL_MS` — Task 2.
5. Committed `.pi/mcp.json` keeps `telemetry`, adds `security` with `disabled: true` and no `env` — Task 3.

---

### Task 1: Fail-closed search through one seam

**Files:**
- Create: `src/security.ts`
- Test: `tests/security.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `handleCoralogixSearch`, `LayerResult`, `LayerErrorCode`, `SecurityDeps`

Shared test helper (same file, later tasks add cases):

```ts
const ARGS = { query: "source logs", start: "2026-01-01T00:00:00Z", end: "2026-01-01T01:00:00Z" };
const SECRET = `{"apiKey":"cx-secret-key-value","endpoint":"https://api.eu2.coralogix.com"}`;
```

- [ ] **Step 1: Write the failing tests**

```ts
test("invalid args do not fetch secret or vendor", async () => {
  let gets = 0;
  let fetches = 0;
  const out = await handleCoralogixSearch({}, {
    getSecret: async () => { gets += 1; return SECRET; },
    fetch: (async () => { fetches += 1; return new Response("{}"); }) as typeof fetch,
  });
  expect(out).toEqual({ ok: false, error: { code: "invalid_request", message: "invalid_request" } });
  expect(gets).toBe(0);
  expect(fetches).toBe(0);
});

test("HTTP 500 is vendor_error not empty hits", async () => {
  const out = await handleCoralogixSearch(ARGS, {
    getSecret: async () => SECRET,
    fetch: (async () => new Response("nope", { status: 500 })) as typeof fetch,
    sleep: async () => {},
  });
  expect(out.ok).toBe(false);
  if (!out.ok) expect(out.error.code).toBe("vendor_error");
});

test("ok hits redact the api key and audit has no query", async () => {
  const lines: string[] = [];
  const out = await handleCoralogixSearch(ARGS, {
    getSecret: async () => SECRET,
    fetch: (async () =>
      new Response(JSON.stringify({ result: { results: [{ msg: "cx-secret-key-value" }] } }), {
        status: 200,
      })) as typeof fetch,
    audit: (s) => lines.push(s),
  });
  expect(out.ok).toBe(true);
  if (out.ok) {
    expect(JSON.stringify(out.hits)).not.toContain("cx-secret-key-value");
    expect(out.hitCount).toBe(1);
  }
  expect(lines).toHaveLength(1);
  expect(lines[0]).not.toContain("source logs");
  expect(lines[0]).not.toContain("cx-secret-key-value");
  expect(JSON.parse(lines[0]).argHash).toMatch(/^[0-9a-f]{64}$/);
});

test("zero hits on 200 is ok not an error", async () => {
  const out = await handleCoralogixSearch(ARGS, {
    getSecret: async () => SECRET,
    fetch: (async () =>
      new Response(JSON.stringify({ result: { results: [] } }), { status: 200 })) as typeof fetch,
  });
  expect(out).toEqual({ ok: true, hitCount: 0, hits: [], truncated: false });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/security.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement `handleCoralogixSearch` in `src/security.ts`**

Put redact, bound, audit hash, JSON secret parse, DataPrime POST, and error mapping in this file. Do not re-export those helpers. If redaction yields non-JSON, return `vendor_error`, not empty hits.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/security.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/security.ts tests/security.test.ts
git commit -m "feat: fail-closed coralogix_search behind one interface"
```

---

### Task 2: Cache, 401 refetch, retry (same module)

**Files:**
- Modify: `src/security.ts`
- Test: `tests/security.test.ts`

**Interfaces:**
- Consumes: `handleCoralogixSearch` / `SecurityDeps` from Task 1
- Produces: same (deeper implementation)

- [ ] **Step 1: Write the failing tests** (append to `tests/security.test.ts`)

```ts
test("getSecret is reused until TTL then refetched", async () => {
  let gets = 0;
  let t = 0;
  const deps = {
    getSecret: async () => { gets += 1; return SECRET; },
    fetch: (async () =>
      new Response(JSON.stringify({ result: { results: [] } }), { status: 200 })) as typeof fetch,
    now: () => t,
  };
  await handleCoralogixSearch(ARGS, deps);
  await handleCoralogixSearch(ARGS, deps);
  expect(gets).toBe(1);
  t = 300_001;
  await handleCoralogixSearch(ARGS, deps);
  expect(gets).toBe(2);
});

test("401 invalidates cache and refetches secret once", async () => {
  let gets = 0;
  let n = 0;
  const out = await handleCoralogixSearch(ARGS, {
    getSecret: async () => { gets += 1; return SECRET; },
    fetch: (async () => {
      n += 1;
      return n === 1
        ? new Response("no", { status: 401 })
        : new Response(JSON.stringify({ result: { results: [] } }), { status: 200 });
    }) as typeof fetch,
  });
  expect(out.ok).toBe(true);
  expect(gets).toBe(2);
  expect(n).toBe(2);
});

test("500 retries once then vendor_error; 401 is not that retry", async () => {
  let n = 0;
  let slept = 0;
  await handleCoralogixSearch(ARGS, {
    getSecret: async () => SECRET,
    fetch: (async () => { n += 1; return new Response("x", { status: 500 }); }) as typeof fetch,
    sleep: async (ms) => { slept = ms; },
  });
  expect(n).toBe(2);
  expect(slept).toBe(250);

  n = 0;
  await handleCoralogixSearch(ARGS, {
    getSecret: async () => SECRET,
    fetch: (async () => { n += 1; return new Response("no", { status: 401 }); }) as typeof fetch,
    sleep: async () => { throw new Error("no 5xx sleep on 401"); },
  });
  expect(n).toBe(2); // 401 path: first call + post-invalidate retry, both 401 → vendor_auth
});
```

The last case: first 401 busts cache, second 401 → `{ ok: false, error.code: "vendor_auth" }`, `n === 2`, `sleep` unused. Split into two tests if that is clearer; do not retry 401 as 5xx (no `sleep`).

Also: fetch throw → `vendor_timeout`; `getSecret` throw or non-JSON payload → `secret_unavailable`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/security.test.ts`
Expected: FAIL on new cases

- [ ] **Step 3: Deepen `handleCoralogixSearch` in `src/security.ts`**

In-memory TTL only. 401/403: invalidate, `getSecret`, one more POST. Still 401/403 → `vendor_auth`. Do not write secrets to disk.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/security.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/security.ts tests/security.test.ts
git commit -m "feat: TTL cache and 401 refetch for coralogix_search"
```

---

### Task 3: MCP adapter and isolation config

**Files:**
- Create: `src/security-mcp.ts`
- Modify: `.pi/mcp.json`, `prompts/investigation.md`, `README.md`
- Test: `tests/mcp-json.test.ts`, `tests/security.test.ts` (name clash), `tests/pi-host.test.ts`

**Interfaces:**
- Consumes: `handleCoralogixSearch`
- Produces: stdio MCP server name `security`, tool name `coralogix_search` only

`.pi/mcp.json`:

```json
{
  "mcpServers": {
    "telemetry": {
      "command": "bun",
      "args": ["src/mcp-server.ts"],
      "exposure": "direct"
    },
    "security": {
      "command": "bun",
      "args": ["src/security-mcp.ts"],
      "exposure": "direct",
      "disabled": true
    }
  }
}
```

No `env` block. MCP handler: `JSON.stringify(await handleCoralogixSearch(args, deps))`. Process entry: `getSecret` via `@google-cloud/secret-manager` `accessSecretVersion` on `projects/${TOOL_LAYER_GCP_PROJECT}/secrets/${TOOL_LAYER_CORALOGIX_SECRET}/versions/latest`. Missing env → `getSecret` rejects (`secret_unavailable`). `fetch` is global fetch. Audit → stderr. Do not add `TOOL_LAYER_*` to `createPiClient` env (child inherits the shell).

Prompt: listed tools only; Test World is `query_*`; if `coralogix_search` / `mcp__security__coralogix_search` is listed it is read-only production search, cite as Evidence, never ask for keys.

README: enable by `"disabled": false`; ADC or GCE SA; secret JSON shape; `TOOL_LAYER_GCP_PROJECT` + `TOOL_LAYER_CORALOGIX_SECRET`; `PI_CLI` 1.0.4+; one sentence that Pi and the MCP share the OS user.

- [ ] **Step 1: Write the failing tests**

```ts
test("mcp.json keeps telemetry and disables security without env secrets", () => {
  const cfg = JSON.parse(readFileSync(".pi/mcp.json", "utf8"));
  expect(cfg.mcpServers.telemetry.args).toEqual(["src/mcp-server.ts"]);
  expect(cfg.mcpServers.telemetry.exposure).toBe("direct");
  expect(cfg.mcpServers.security.args).toEqual(["src/security-mcp.ts"]);
  expect(cfg.mcpServers.security.exposure).toBe("direct");
  expect(cfg.mcpServers.security.disabled).toBe(true);
  expect(cfg.mcpServers.security.env).toBeUndefined();
  expect(JSON.stringify(cfg)).not.toMatch(/CORALOGIX|apiKey|API_KEY/);
});

test("Test World tools stay query_* and do not include coralogix_search", async () => {
  const { TELEMETRY_TOOLS } = await import("../src/mcp-server.ts");
  expect([...TELEMETRY_TOOLS]).not.toContain("coralogix_search");
  expect(TELEMETRY_TOOLS).toContain("query_authentication");
});

test("createPiClient spawn env stays Gerbang/Pi only", () => {
  const src = readFileSync("src/pi-host.ts", "utf8");
  expect(src).not.toMatch(/CORALOGIX|SECRET_MANAGER|TOOL_LAYER/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/mcp-json.test.ts tests/security.test.ts tests/pi-host.test.ts`
Expected: FAIL on mcp.json

- [ ] **Step 3: Implement `src/security-mcp.ts`, config, prompt, README**

`bun add @google-cloud/secret-manager`. GSM client stays in this adapter, not exported from `src/security.ts`.

- [ ] **Step 4: Run full suite**

Run: `bun test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/security-mcp.ts .pi/mcp.json prompts/investigation.md README.md package.json package-lock.json tests/mcp-json.test.ts tests/pi-host.test.ts tests/security.test.ts
git commit -m "feat: stdio security MCP disabled by default"
```

---

## Spec coverage

| Spec item | Task |
|---|---|
| New stdio MCP, not Test World server | 3 |
| One tool `coralogix_search` | 3 |
| GSM + in-memory TTL + 401 bust | 2–3 |
| Coralogix read HTTP, timeout, one 429/5xx retry | 1–2 |
| Validate args; bound; redact | 1 |
| Structured errors; no empty-hit lie | 1 |
| Audit hashed args, no secrets | 1 |
| `.pi/mcp.json` second server `direct`; keep telemetry | 3 |
| No keys in Pi env | 3 |
| `--no-builtin-tools` | existing `pi-host` test |
| `disabled: true` Phase 1 isolation | 3 |
| Deep module / two adapters only | 1–3 |
