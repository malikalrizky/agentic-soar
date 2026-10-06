# Phase 3 Security Tool Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a second stdio MCP process that runs `coralogix_search` with Secret Manager credentials, without putting vendor keys in Pi or breaking the Phase 1 Test World MCP.

**Architecture:** Keep the Bun RPC host and `telemetry` MCP. New `src/security-mcp.ts` process registers one tool. Core logic is injected (fake SM + fake HTTP in tests). Committed `.pi/mcp.json` lists `security` with `"disabled": true` so nine-alert scoring does not see production tools. Enabling the server is a config flip, not a second product.

**Tech Stack:** Bun ≥ 1.4.2, TypeScript, `@modelcontextprotocol/sdk` 1.31.0, `zod`, `@google-cloud/secret-manager` (GSM adapter only), `bun test`. Pi 1.0.4 CLI via `PI_CLI` unchanged.

**Spec:** `docs/phase-3-security-tool-layer.md` (ADR `docs/adr/0005-phase-3-security-tool-layer.md`)

## Global Constraints

- Host: Bun ≥ 1.4.2. Pi child: Node `PI_CLI` 1.0.4+ JS entry (`RpcClient` always `node <cli.js>`).
- Drive Pi with CLI RPC only; do not use in-process `registerTool()` for vendor auth.
- One tool: `coralogix_search`. No CrowdStrike, Wiz, Gateway, write APIs, `arbitrary_http_request`.
- Do not put Coralogix keys in Pi env, `.pi/mcp.json` `env`, tool results, errors, or audit bodies.
- Do not fall back to env files or `testdata/world.json` when SM or Coralogix fail.
- Fail closed: vendor/SM failure is `{ ok: false, error: { code, message } }`, never `hits: []`.
- `--no-builtin-tools` stays on. Do not raise the 15-call cap.
- Test World MCP stays `src/mcp-server.ts` with the existing tool names.
- `security` MCP stays disabled in the committed `.pi/mcp.json`.
- No live GSM or Coralogix in `bun test`.

## File structure

- `src/security/constants.ts` — limits and TTL values below
- `src/security/types.ts` — args, credentials, layer result, `SecretSource`
- `src/security/redact.ts` — `redactSecrets`, `boundHits`
- `src/security/audit.ts` — `argHash`, `auditLine`
- `src/security/secrets.ts` — `MemoryTtlSecretCache`
- `src/security/coralogix.ts` — `extractHits`, `coralogixDataprimeSearch`
- `src/security/search.ts` — `parseSearchArgs`, `handleCoralogixSearch`
- `src/security/gsm.ts` — `GsmSecretSource` wrapping `SecretManagerServiceClient`
- `src/security-mcp.ts` — stdio MCP `security`, tool `coralogix_search`
- Modify: `.pi/mcp.json`, `prompts/investigation.md`, `README.md`
- Test: `tests/security-*.test.ts`, `tests/mcp-json.test.ts`
- Do not modify `src/mcp-server.ts` handlers or Phase 1 result schema

Pinned constants (`src/security/constants.ts`):

```ts
export const CORALOGIX_TOOL = "coralogix_search";
export const MAX_QUERY_CHARS = 2000;
export const MAX_WINDOW_MS = 86_400_000;
export const DEFAULT_LIMIT = 10;
export const MAX_LIMIT = 20;
export const MAX_RESULT_BYTES = 32_768;
export const SECRET_TTL_MS = 300_000;
export const HTTP_TIMEOUT_MS = 15_000;
export const RETRY_BACKOFF_MS = 250;
export const RETRY_AFTER_CAP_MS = 5_000;
```

Pinned types (`src/security/types.ts`):

```ts
export type SecretSource = { get(): Promise<string> };
export type CoralogixCredentials = { apiKey: string; endpoint: string };
export type SearchArgs = { query: string; start: string; end: string; limit: number };
export type LayerErrorCode =
  | "invalid_request"
  | "secret_unavailable"
  | "vendor_auth"
  | "vendor_timeout"
  | "vendor_error";
export type LayerResult =
  | { ok: true; hitCount: number; hits: unknown[]; truncated: boolean }
  | { ok: false; error: { code: LayerErrorCode; message: string } };
```

## Review Focus

1. Missing/invalid `query`/`start`/`end` does not call `SecretSource.get` or `fetch` — Task 5.
2. HTTP 500 is `{ ok: false, error.code: "vendor_error" }`, not empty hits — Task 5.
3. Successful hits that contain the API key string are redacted before return — Task 1 + Task 5.
4. Audit JSON has `argHash` (64 hex) and no `query` field and no API key — Task 2 + Task 5.
5. Committed `.pi/mcp.json` keeps `telemetry`, adds `security` with `disabled: true` and no `env` keys — Task 6.

---

### Task 1: Redact and bound

**Files:**
- Create: `src/security/constants.ts`, `src/security/redact.ts`
- Test: `tests/security-redact.test.ts`

**Interfaces:**
- Consumes: constants
- Produces:
  - `export function redactSecrets(text: string, extras: string[]): string` — replace each extra substring with `[REDACTED]`; also replace matches of `/(?:api[_-]?key|token|secret)\s*[:=]\s*["']?[A-Za-z0-9_\-]{16,}/gi` with `api_key=[REDACTED]`
  - `export function boundHits(hits: unknown[], maxHits: number, maxBytes: number): { hits: unknown[]; truncated: boolean }` — cap length to `maxHits`, then drop trailing hits until `JSON.stringify(hits)` length ≤ `maxBytes` (empty array if even one hit is too large)

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, test } from "bun:test";
import { boundHits, redactSecrets } from "../src/security/redact.ts";

test("redactSecrets replaces extras and key-shaped assignments", () => {
  const out = redactSecrets(`hello cx-secret-key-value token=abcdefghijklmnop`, ["cx-secret-key-value"]);
  expect(out).not.toContain("cx-secret-key-value");
  expect(out).toContain("[REDACTED]");
  expect(out).not.toMatch(/abcdefghijklmnop/);
});

test("boundHits truncates by count then by bytes", () => {
  const many = boundHits([1, 2, 3, 4], 2, 32_768);
  expect(many.hits).toEqual([1, 2]);
  expect(many.truncated).toBe(true);
  const huge = boundHits(["x".repeat(100)], 20, 10);
  expect(huge.hits).toEqual([]);
  expect(huge.truncated).toBe(true);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/security-redact.test.ts`
Expected: FAIL (module not found or export missing)

- [ ] **Step 3: Implement `redactSecrets` and `boundHits` plus constants file**

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/security-redact.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/security/constants.ts src/security/redact.ts tests/security-redact.test.ts
git commit -m "feat: redact and bound security tool payloads"
```

---

### Task 2: Audit line

**Files:**
- Create: `src/security/audit.ts`
- Test: `tests/security-audit.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1 except we will reuse `argHash` in Task 5
- Produces:
  - `export function argHash(args: unknown): string` — SHA-256 hex of `JSON.stringify(args)`
  - `export type AuditRecord = { tool: string; argHash: string; durationMs: number; status: "ok" | "error"; httpStatus?: number; errorCode?: string }`
  - `export function auditLine(record: AuditRecord): string` — one JSON object, keys only those fields

- [ ] **Step 1: Write the failing tests**

```ts
test("argHash is 64 hex and stable", () => {
  const h = argHash({ query: "a", start: "2026-01-01T00:00:00Z", end: "2026-01-01T01:00:00Z", limit: 10 });
  expect(h).toMatch(/^[0-9a-f]{64}$/);
  expect(argHash({ query: "a", start: "2026-01-01T00:00:00Z", end: "2026-01-01T01:00:00Z", limit: 10 })).toBe(h);
});

test("auditLine is JSON without query or secret fields", () => {
  const line = auditLine({
    tool: "coralogix_search",
    argHash: "a".repeat(64),
    durationMs: 12,
    status: "ok",
    httpStatus: 200,
  });
  const obj = JSON.parse(line) as Record<string, unknown>;
  expect(obj.tool).toBe("coralogix_search");
  expect(obj.query).toBeUndefined();
  expect(obj.apiKey).toBeUndefined();
  expect(JSON.stringify(obj)).not.toContain("cx-");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/security-audit.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `argHash` and `auditLine` in `src/security/audit.ts`** using `node:crypto` `createHash("sha256")`

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/security-audit.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/security/audit.ts tests/security-audit.test.ts
git commit -m "feat: hash tool args for security audit lines"
```

---

### Task 3: In-memory secret cache

**Files:**
- Create: `src/security/types.ts` (`SecretSource` and `CoralogixCredentials` only if not already added; add remaining types here if Task 1 did not)
- Create: `src/security/secrets.ts`
- Test: `tests/security-secrets.test.ts`

**Interfaces:**
- Consumes: `SECRET_TTL_MS`, `SecretSource`
- Produces:
  - `export function parseCoralogixSecret(payload: string): CoralogixCredentials` — `JSON.parse`; require string `apiKey` and string `endpoint`; throw `Error("invalid secret json")` otherwise
  - `export class MemoryTtlSecretCache { constructor(source: SecretSource, ttlMs: number, now: () => number); get(): Promise<string>; invalidate(): void }` — no disk I/O

- [ ] **Step 1: Write the failing tests**

```ts
test("parseCoralogixSecret reads apiKey and endpoint", () => {
  expect(parseCoralogixSecret(`{"apiKey":"k","endpoint":"https://api.eu2.coralogix.com"}`)).toEqual({
    apiKey: "k",
    endpoint: "https://api.eu2.coralogix.com",
  });
  expect(() => parseCoralogixSecret("not-json")).toThrow("invalid secret json");
  expect(() => parseCoralogixSecret(`{"apiKey":"k"}`)).toThrow("invalid secret json");
});

test("MemoryTtlSecretCache reuses until TTL then refetches; invalidate busts", async () => {
  let n = 0;
  let t = 0;
  const cache = new MemoryTtlSecretCache({ get: async () => { n += 1; return "v" + n; } }, 100, () => t);
  expect(await cache.get()).toBe("v1");
  expect(await cache.get()).toBe("v1");
  t = 101;
  expect(await cache.get()).toBe("v2");
  cache.invalidate();
  expect(await cache.get()).toBe("v3");
  expect(n).toBe(3);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/security-secrets.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `parseCoralogixSecret` and `MemoryTtlSecretCache` in `src/security/secrets.ts`**

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/security-secrets.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/security/types.ts src/security/secrets.ts tests/security-secrets.test.ts
git commit -m "feat: cache GSM payloads in memory with TTL"
```

---

### Task 4: Coralogix DataPrime HTTP

**Files:**
- Create: `src/security/coralogix.ts`
- Test: `tests/security-coralogix.test.ts`

**Interfaces:**
- Consumes: `HTTP_TIMEOUT_MS`, `RETRY_BACKOFF_MS`, `RETRY_AFTER_CAP_MS`, `CoralogixCredentials`, `SearchArgs`
- Produces:
  - `export function extractHits(parsed: unknown): unknown[]` — if `parsed` is object and `result.results` is an array, return it; else if `hits` is an array, return it; else return `[parsed]`
  - `export type VendorResponse = { status: number; bodyText: string }`
  - `export async function coralogixDataprimeSearch(creds: CoralogixCredentials, args: SearchArgs, deps: { fetch: typeof fetch; sleep: (ms: number) => Promise<void> }): Promise<VendorResponse>`
    - `POST` `${creds.endpoint.replace(/\/$/, "")}/api/v1/dataprime/query`
    - headers `Authorization: Bearer ${creds.apiKey}`, `Content-Type: application/json`
    - body JSON `{ query: args.query, metadata: { startDate: args.start, endDate: args.end } }`
    - `AbortSignal.timeout(HTTP_TIMEOUT_MS)`
    - On status 429 or ≥500, `sleep` once: `Retry-After` seconds if that header is a number, else `RETRY_BACKOFF_MS`, cap wait at `RETRY_AFTER_CAP_MS`, then fetch once more
    - On other statuses (including 401), return immediately
    - If fetch throws (timeout/network), throw `Error("vendor_timeout")`

- [ ] **Step 1: Write the failing tests**

```ts
test("extractHits prefers result.results", () => {
  expect(extractHits({ result: { results: [{ a: 1 }] } })).toEqual([{ a: 1 }]);
  expect(extractHits({ hits: [1] })).toEqual([1]);
  expect(extractHits({ x: 1 })).toEqual([{ x: 1 }]);
});

test("coralogixDataprimeSearch posts Bearer token and retries once on 500", async () => {
  const calls: RequestInfo[] = [];
  let n = 0;
  const fetchFn = (async (input: RequestInfo) => {
    calls.push(input);
    n += 1;
    return new Response("{}", { status: n === 1 ? 500 : 200 });
  }) as typeof fetch;
  let slept = 0;
  const out = await coralogixDataprimeSearch(
    { apiKey: "k", endpoint: "https://api.eu2.coralogix.com" },
    { query: "source logs | limit 1", start: "2026-01-01T00:00:00Z", end: "2026-01-01T01:00:00Z", limit: 10 },
    { fetch: fetchFn, sleep: async (ms) => { slept = ms; } },
  );
  expect(n).toBe(2);
  expect(slept).toBe(250);
  expect(out.status).toBe(200);
  const req = calls[0] as Request;
  expect(String(req.url ?? calls[0])).toContain("/api/v1/dataprime/query");
});

test("401 is not retried as 5xx", async () => {
  let n = 0;
  const fetchFn = (async () => {
    n += 1;
    return new Response("no", { status: 401 });
  }) as typeof fetch;
  const out = await coralogixDataprimeSearch(
    { apiKey: "k", endpoint: "https://api.eu2.coralogix.com" },
    { query: "q", start: "2026-01-01T00:00:00Z", end: "2026-01-01T01:00:00Z", limit: 10 },
    { fetch: fetchFn, sleep: async () => { throw new Error("should not sleep"); } },
  );
  expect(n).toBe(1);
  expect(out.status).toBe(401);
});
```

If `fetch` is called with a URL string not a `Request`, assert the string URL and that the init headers include `Authorization: Bearer k`. Do not invent a second retry loop.

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/security-coralogix.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `extractHits` and `coralogixDataprimeSearch` in `src/security/coralogix.ts`**

Pass `Authorization` on every attempt. Do not log `apiKey`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/security-coralogix.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/security/coralogix.ts tests/security-coralogix.test.ts
git commit -m "feat: call Coralogix DataPrime with one 5xx retry"
```

---

### Task 5: `handleCoralogixSearch`

**Files:**
- Create: `src/security/search.ts`
- Test: `tests/security-search.test.ts`

**Interfaces:**
- Consumes: Task 1–4 exports, `SearchArgs`, `LayerResult`, `MemoryTtlSecretCache`, `parseCoralogixSecret`
- Produces:
  - `export function parseSearchArgs(raw: Record<string, unknown>): SearchArgs` — `query` non-empty string ≤ `MAX_QUERY_CHARS`; `start`/`end` parseable by `Date.parse`; `end > start`; `end - start ≤ MAX_WINDOW_MS`; `limit` optional number, default `DEFAULT_LIMIT`, clamp 1..`MAX_LIMIT`. Throw `Error("invalid_request")` on failure.
  - `export async function handleCoralogixSearch(raw: Record<string, unknown>, deps: { secrets: MemoryTtlSecretCache; fetch: typeof fetch; sleep: (ms: number) => Promise<void>; audit?: (line: string) => void; now?: () => number }): Promise<LayerResult>`
    - Invalid args: return `{ ok: false, error: { code: "invalid_request", message: "invalid_request" } }` **without** `secrets.get` or `fetch`. Still write an audit line `status: "error", errorCode: "invalid_request"` if `audit` is set.
    - `secrets.get` → `parseCoralogixSecret`; parse throw → `secret_unavailable`
    - `coralogixDataprimeSearch`; `vendor_timeout` throw → `{ ok: false, error.code: "vendor_timeout" }`
    - 401/403: `secrets.invalidate()`, `get` again, one more `coralogixDataprimeSearch`; still 401/403 → `vendor_auth`
    - 429 after retry already done inside HTTP helper; if still 429/5xx → `vendor_error`
    - 2xx: `JSON.parse` body (`vendor_error` if not JSON); `extractHits`; slice to `args.limit`; `boundHits(..., MAX_LIMIT, MAX_RESULT_BYTES)`; `redactSecrets(JSON.stringify(hits), [creds.apiKey])` then `JSON.parse` back to array (if parse fails, `hits: []` **and** `truncated: true` is wrong — instead return `vendor_error` so we never pretend the redacted payload was empty evidence)
    - 2xx with zero hits: `{ ok: true, hitCount: 0, hits: [], truncated: false }` is allowed
    - Always `audit` one line on stderr via `deps.audit ?? ((s) => process.stderr.write(s + "\n"))` using `argHash` of parsed args (or raw if parse failed)
    - Redact `message` with `redactSecrets(message, [apiKey if known])`

- [ ] **Step 1: Write the failing tests**

Use a `MemoryTtlSecretCache` whose `get` increments a counter. Fake `fetch` as in Task 4.

```ts
test("invalid args do not fetch secret or vendor", async () => {
  let gets = 0;
  let fetches = 0;
  const secrets = new MemoryTtlSecretCache({ get: async () => { gets += 1; return `{"apiKey":"k","endpoint":"https://x"}`; } }, 60_000, Date.now);
  const out = await handleCoralogixSearch({}, {
    secrets,
    fetch: (async () => { fetches += 1; return new Response("{}"); }) as typeof fetch,
    sleep: async () => {},
  });
  expect(out).toEqual({ ok: false, error: { code: "invalid_request", message: "invalid_request" } });
  expect(gets).toBe(0);
  expect(fetches).toBe(0);
});

test("HTTP 500 is vendor_error not empty hits", async () => {
  const secrets = new MemoryTtlSecretCache({
    get: async () => `{"apiKey":"k","endpoint":"https://api.eu2.coralogix.com"}`,
  }, 60_000, Date.now);
  const out = await handleCoralogixSearch(
    { query: "q", start: "2026-01-01T00:00:00Z", end: "2026-01-01T01:00:00Z" },
    {
      secrets,
      fetch: (async () => new Response("nope", { status: 500 })) as typeof fetch,
      sleep: async () => {},
    },
  );
  expect(out.ok).toBe(false);
  if (!out.ok) expect(out.error.code).toBe("vendor_error");
});

test("ok hits redact the api key and audit has no query", async () => {
  const lines: string[] = [];
  const secrets = new MemoryTtlSecretCache({
    get: async () => `{"apiKey":"cx-secret-key-value","endpoint":"https://api.eu2.coralogix.com"}`,
  }, 60_000, Date.now);
  const out = await handleCoralogixSearch(
    { query: "source logs", start: "2026-01-01T00:00:00Z", end: "2026-01-01T01:00:00Z" },
    {
      secrets,
      fetch: (async () =>
        new Response(JSON.stringify({ result: { results: [{ msg: "cx-secret-key-value" }] } }), { status: 200 })) as typeof fetch,
      sleep: async () => {},
      audit: (s) => lines.push(s),
    },
  );
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
```

Add one more test: first vendor 401, second `get` returns a new key, second fetch 200 → `ok: true`, `get` called twice.

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/security-search.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `parseSearchArgs` and `handleCoralogixSearch` in `src/security/search.ts`**

ISO strings: require `Date.parse` finite. Do not call Coralogix on invalid args.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/security-search.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/security/search.ts src/security/types.ts tests/security-search.test.ts
git commit -m "feat: fail-closed coralogix_search handler"
```

---

### Task 6: MCP process, config, GSM adapter, docs

**Files:**
- Create: `src/security/gsm.ts`, `src/security-mcp.ts`
- Modify: `.pi/mcp.json`, `prompts/investigation.md`, `README.md`
- Test: `tests/security-mcp.test.ts`, `tests/mcp-json.test.ts`, `tests/pi-host.test.ts` (env keys)

**Interfaces:**
- Consumes: `handleCoralogixSearch`, `MemoryTtlSecretCache`, `SECRET_TTL_MS`
- Produces:
  - `export function gsmResourceName(project: string, secretId: string): string` → `projects/${project}/secrets/${secretId}/versions/latest`
  - `export class GsmSecretSource implements SecretSource { constructor(project: string, secretId: string, access: (name: string) => Promise<string>); get(): Promise<string> }`
  - `export async function startSecurityMcpServer(deps: { secrets: MemoryTtlSecretCache; fetch: typeof fetch }): Promise<void>` — `McpServer({ name: "security", version: "0.1.0" })`, register **only** `coralogix_search` with zod strings `query`, `start`, `end` and optional `limit` number; handler returns MCP text `JSON.stringify(await handleCoralogixSearch(args, deps))`; `StdioServerTransport`; if `process.argv[1]` is main, build cache from env `TOOL_LAYER_GCP_PROJECT` and `TOOL_LAYER_CORALOGIX_SECRET` via `@google-cloud/secret-manager` `accessSecretVersion`. Missing env → still start, but `get()` rejects so tools return `secret_unavailable` (no world.json fallback).
  - `createPiClient` env object remains only `GERBANG_*` and `PI_*` (no code change unless a key slipped in)

`.pi/mcp.json` after edit:

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

No `env` block. Prompt: add a bullet that tools are only those listed; Test World tools are `query_*`; if `coralogix_search` appears it is read-only production search (`mcp__security__coralogix_search`) and must be cited as Evidence, never asked for keys.

README: Phase 3 enable = set `security.disabled` to `false`; ADC or GCE SA; GSM secret JSON `{"apiKey":"...","endpoint":"https://api.<region>.coralogix.com"}`; env `TOOL_LAYER_GCP_PROJECT`, `TOOL_LAYER_CORALOGIX_SECRET` on the **MCP process only** (document they inherit from the shell — do not add them in `createPiClient`); `PI_CLI` must be 1.0.4+; same-user GSM caveat one sentence.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/mcp-json.test.ts
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

// tests/security-mcp.test.ts
test("gsmResourceName", () => {
  expect(gsmResourceName("p", "coralogix")).toBe("projects/p/secrets/coralogix/versions/latest");
});

test("TELEMETRY_TOOLS unchanged and security tool is only coralogix_search", async () => {
  const { TELEMETRY_TOOLS } = await import("../src/mcp-server.ts");
  expect(TELEMETRY_TOOLS).toContain("query_authentication");
  expect(TELEMETRY_TOOLS).not.toContain("coralogix_search");
  expect(CORALOGIX_TOOL).toBe("coralogix_search");
});

// tests/pi-host.test.ts extra:
test("createPiClient-related spawn env names stay Gerbang/Pi only", () => {
  const src = readFileSync("src/pi-host.ts", "utf8");
  expect(src).not.toMatch(/CORALOGIX|SECRET_MANAGER|TOOL_LAYER/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/mcp-json.test.ts tests/security-mcp.test.ts tests/pi-host.test.ts`
Expected: FAIL on mcp.json assertions

- [ ] **Step 3: Implement GSM wrapper, MCP entry, config, prompt, README**

`bun add @google-cloud/secret-manager`. Wire `GsmSecretSource.get` to `client.accessSecretVersion({ name: gsmResourceName(...) })` and decode payload bytes as UTF-8. Do not write payload to disk.

- [ ] **Step 4: Run full suite**

Run: `bun test`
Expected: PASS (existing Phase 1 tests included)

- [ ] **Step 5: Commit**

```bash
git add src/security/gsm.ts src/security-mcp.ts .pi/mcp.json prompts/investigation.md README.md package.json bun.lock package-lock.json tests/mcp-json.test.ts tests/security-mcp.test.ts tests/pi-host.test.ts
git commit -m "feat: stdio security MCP disabled by default"
```

---

## Spec coverage (self-review)

| Spec item | Task |
|---|---|
| New stdio MCP, not `src/mcp-server.ts` | 6 |
| One tool `coralogix_search` | 5–6 |
| GSM + in-memory TTL + 401 bust | 3, 5 |
| Coralogix read HTTP, timeout, one 429/5xx retry | 4 |
| Validate args; bound; redact | 1, 5 |
| Structured errors; no empty-hit lie | 5 |
| Audit hashed args, no secrets | 2, 5 |
| `.pi/mcp.json` second server `direct`; keep telemetry | 6 |
| Host unchanged / no keys in Pi env | 6 |
| `--no-builtin-tools` | already Task-free (existing test) |
| `disabled: true` Phase 1 isolation | 6 |
| No policy engine / writes / Gateway | omitted on purpose |
