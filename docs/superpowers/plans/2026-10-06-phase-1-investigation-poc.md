# Phase 1 Investigation POC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a local, unattended Test Alert → Pi RPC → mock telemetry MCP → Investigation Result file pipeline, plus a nine-alert corpus, so we can GO/NO-GO Pi as a SOC investigation engine.

**Architecture:** A small Bun/TypeScript host spawns one Node `pi --mode rpc` child at a time, never stuffing telemetry into the prompt. A stdio MCP server (also Bun) exposes query tools over one shared Test World (`exposure: direct`). Caps (10 minutes or 15 tool calls) abort the run and emit `alert_disposition: error`. No production systems, no gateway, no database.

**Tech Stack:** Bun ≥ 1.4.2 (host, MCP server, `bun test`), TypeScript, `@modelcontextprotocol/sdk` (stdio MCP), `@earendil-works/pi-coding-agent` (`RpcClient` only — do not embed `createAgentSession`), `Bun.serve` for `POST /investigate`. Pi CLI remains Node.js 22.19+ on PATH.

**Spec:** `docs/architecture-discovery.md` and `docs/phase-1-design.md` (language in `GLOSSARY.md`).

## Global Constraints

- Host and MCP: Bun ≥ 1.4.2. Pi child: Node.js 22.19+ `pi` on PATH (do not reimplement Pi in Bun).
- Drive Pi with CLI RPC only; do not use the in-process SDK session factory.
- No PostgreSQL, queues, n8n, ADK, Kubernetes, MCP Gateway, or production SIEM/CrowdStrike/Wiz/Coralogix.
- Phase 1 is read-only: never call or mock containment APIs.
- One Investigation at a time on one Pi child; failed runs are not resumed.
- MCP server `telemetry` must set `"exposure": "direct"` (Pi default `codemode` hides tools from the model).
- Disable Pi builtin `bash`, `edit`, `write` (`--no-builtin-tools`).
- Caps: 10 minutes wall clock or 15 tool calls, whichever first → `alert_disposition: "error"`.
- Confidence values: `low` | `medium` | `high`.
- Freeze one model for the corpus; record `model_id` on every result.
- Test Alerts live under `testdata/alerts/`; Test World is one file, not per-alert golden traces.

## File structure

- `src/schema.ts` — types, JSON extract, `parseInvestigationResult`, `errorResult`
- `src/constants.ts` — `INVESTIGATION_WALL_MS = 600_000`, `INVESTIGATION_MAX_TOOL_CALLS = 15`
- `src/world.ts` — load `testdata/world.json`, filter queries
- `src/mcp-server.ts` — stdio MCP wrapping world query handlers
- `src/pi-host.ts` — spawn/control Pi RPC, count tool events, abort
- `src/investigate.ts` — alert → prompt → parse → write JSONL
- `src/cli.ts` — `bun src/cli.ts <alert.json>`
- `src/http.ts` — `POST /investigate`, 409 if busy
- `prompts/investigation.md` — SOC investigator system prompt (replace Pi coding default)
- `testdata/world.json` — one Test World
- `testdata/alerts/01.json` … `09.json`
- `.pi/mcp.json` — local stdio `telemetry` server, `exposure: direct`
- `docs/phase-1-scoring.md` — GO sheet for the nine runs
- `tests/*.test.ts`

## Review Focus

These are pinned to tasks below (not left as “manual only”).

1. Unknown user/host query returns `[]`, not an error — so Pi can switch datasets. Task 2.
2. Second overlapping `POST /investigate` returns 409, does not start a second Pi. Task 6.
3. Pi child exit before `agent_settled` writes `errorResult`, does not call resume/continue. Task 4.
4. Model text that is not a JSON object becomes `alert_disposition: "error"`. Task 1.
5. Fifteenth tool event aborts even if wall clock is under 10 minutes. Task 4.

---

### Task 1: Schema and error results

**Files:**
- Create: `package.json`, `tsconfig.json`, `.gitignore` (no `vitest.config.ts`; no `tsx`). If the repo already has a Node/vitest `package.json`, replace it.
- Create: `src/schema.ts`, `src/constants.ts`
- Test: `tests/schema.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `export type AlertDisposition = "true_positive" | "false_positive" | "benign_true_positive" | "insufficient_evidence" | "error"`
  - `export type RecommendedPosture = "no_action" | "monitor" | "needs_human" | "recommend_containment"`
  - `export type Confidence = "low" | "medium" | "high"`
  - `export type TestAlert = { type: string; timestamp: string; user?: string; host?: string; source_ip?: string; process?: string; hash?: string }`
  - `export type EvidenceItem = { claim: string; source: "alert" | "telemetry"; dataset?: string }`
  - `export type InvestigationResult = { alert_disposition: AlertDisposition; recommended_posture: RecommendedPosture; confidence: Confidence; model_id: string; summary: string; supporting_evidence: EvidenceItem[]; assumptions: string[]; investigation_steps: string[]; entities: string[]; recommended_next_step: string }`
  - `export function extractJsonObject(text: string): unknown`
  - `export function parseInvestigationResult(raw: unknown, modelId: string): InvestigationResult`
  - `export function errorResult(modelId: string, summary: string): InvestigationResult` — disposition `error`, posture `needs_human`, confidence `low`, empty evidence/steps/entities except `summary` and `assumptions: []`

Use `import { test, expect } from "bun:test"`.

```ts
test("parseInvestigationResult accepts a full valid object and sets model_id from the argument", () => {
  const result = parseInvestigationResult({
    alert_disposition: "false_positive",
    recommended_posture: "no_action",
    confidence: "low",
    summary: "VPN from office",
    supporting_evidence: [{ claim: "auth from 10.0.0.8", source: "telemetry", dataset: "authentication" }],
    assumptions: [],
    investigation_steps: ["queried auth"],
    entities: ["bob"],
    recommended_next_step: "close",
  }, "frozen-model");
  expect(result.model_id).toBe("frozen-model");
  expect(result.alert_disposition).toBe("false_positive");
});

test("parseInvestigationResult throws on invalid alert_disposition", () => {
  expect(() => parseInvestigationResult({ alert_disposition: "maybe", recommended_posture: "no_action", confidence: "low", summary: "x", supporting_evidence: [], assumptions: [], investigation_steps: [], entities: [], recommended_next_step: "x" }, "m")).toThrow();
});

test("extractJsonObject reads the last JSON object in fenced markdown", () => {
  expect(extractJsonObject("notes\n```json\n{\"alert_disposition\":\"error\",\"recommended_posture\":\"needs_human\",\"confidence\":\"low\",\"summary\":\"s\",\"supporting_evidence\":[],\"assumptions\":[],\"investigation_steps\":[],\"entities\":[],\"recommended_next_step\":\"n\"}\n```")).toEqual(expect.objectContaining({ alert_disposition: "error" }));
});

test("extractJsonObject on plain prose throws", () => {
  expect(() => extractJsonObject("sorry I cannot")).toThrow();
});

test("errorResult uses alert_disposition error and recommended_posture needs_human", () => {
  const r = errorResult("m", "child exited");
  expect(r.alert_disposition).toBe("error");
  expect(r.recommended_posture).toBe("needs_human");
  expect(r.confidence).toBe("low");
  expect(r.model_id).toBe("m");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/schema.test.ts`
Expected: FAIL (modules missing)

- [ ] **Step 3: Implement `src/schema.ts` and `src/constants.ts`**

`INVESTIGATION_WALL_MS = 600_000`, `INVESTIGATION_MAX_TOOL_CALLS = 15`. Validate with a small zod schema (or equivalent predicates). `parseInvestigationResult` overwrites any incoming `model_id` with the `modelId` argument. `extractJsonObject`: last ````json` fence if present, else first `{`… last `}` parse.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/schema.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add package.json tsconfig.json .gitignore src/schema.ts src/constants.ts tests/schema.test.ts
git commit -m "feat: add investigation result schema"
```

---

### Task 2: Test World queries

**Files:**
- Create: `testdata/world.json`, `src/world.ts`
- Test: `tests/world.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1
- Produces:
  - `export type TestWorld` — loaded JSON
  - `export function loadTestWorld(path: string): TestWorld`
  - `export function queryAuthentication(world: TestWorld, filter: { user?: string; ip?: string }): AuthEvent[]`
  - `export function queryEndpoint(world: TestWorld, filter: { host?: string; user?: string }): EndpointEvent[]`
  - `export function queryProcess(world: TestWorld, filter: { host?: string; hash?: string }): ProcessEvent[]`
  - `export function queryIp(world: TestWorld, filter: { ip?: string }): IpEvent[]`
  - `export function queryUser(world: TestWorld, filter: { user?: string }): UserRecord[]`
  - `export function queryRelatedAlerts(world: TestWorld, filter: { user?: string; host?: string; ip?: string }): RelatedAlert[]`
  - `export function queryAssets(world: TestWorld, filter: { hostname?: string; user?: string }): Asset[]`
  - Record shapes: include at least `user`, `host`, `ip`, `timestamp`, and type-specific fields (`src_geo`, `process_name`, `hash`, `is_known_office`, `role`). Missing filter fields mean “no constraint”. AND when multiple fields set.

`testdata/world.json` must contain **one** world with at least:

| Slice | Facts (minimum) |
|---|---|
| `alice` | Auth from `203.0.113.10` (geo `SG`) then `198.51.100.4` (geo `US`) 40 minutes later; endpoint `alice-mbp`; process `weird.exe` hash `aa` *not* in known-good |
| `bob` | Auth from `10.0.0.8` (`is_known_office: true`); endpoint `bob-win`; no `weird.exe` |
| `scanner-svc` | Repeated auth + process `backup-agent` marked known-good; related alerts titled `scanner` |

- [ ] **Step 1: Write the failing tests** in `tests/world.test.ts`

```ts
test("alice auth and bob auth are different slices", () => {
  const w = loadTestWorld("testdata/world.json");
  const alice = queryAuthentication(w, { user: "alice" });
  const bob = queryAuthentication(w, { user: "bob" });
  expect(alice.some((e) => e.ip === "203.0.113.10")).toBe(true);
  expect(bob.some((e) => e.is_known_office === true)).toBe(true);
  expect(alice.map((e) => e.ip).sort()).not.toEqual(bob.map((e) => e.ip).sort());
});

test("unknown user returns empty array", () => {
  const w = loadTestWorld("testdata/world.json");
  expect(queryAuthentication(w, { user: "nobody" })).toEqual([]);
  expect(queryProcess(w, { host: "no-such-host" })).toEqual([]);
});

test("alice process hash aa is not on bob", () => {
  const w = loadTestWorld("testdata/world.json");
  expect(queryProcess(w, { hash: "aa" }).every((p) => p.host === "alice-mbp")).toBe(true);
  expect(queryProcess(w, { host: "bob-win" }).some((p) => p.hash === "aa")).toBe(false);
});
```

- [ ] **Step 2: Run** `bun test tests/world.test.ts` — Expected: FAIL

- [ ] **Step 3: Implement `loadTestWorld` and the seven query functions in `src/world.ts`; write `testdata/world.json`**

Do not add per-alert “expected tool path” fields.

- [ ] **Step 4: Run** `bun test tests/world.test.ts` — Expected: PASS

- [ ] **Step 5: Commit** `feat: add shared test world queries`

---

### Task 3: Telemetry MCP handlers

**Files:**
- Create: `src/mcp-server.ts`
- Test: `tests/mcp-handlers.test.ts`
- Create: `.pi/mcp.json`

**Interfaces:**
- Consumes: Task 2 query functions and `loadTestWorld`
- Produces:
  - `export const TELEMETRY_TOOLS = ["query_authentication","query_endpoint","query_process","query_ip","query_user","query_related_alerts","query_assets"] as const`
  - `export function handleTelemetryTool(name: string, args: Record<string, unknown>, world: TestWorld): unknown` — dispatches to the matching query; unknown name throws
  - stdio MCP in `src/mcp-server.ts` when run as main: load `testdata/world.json` (path from `WORLD_PATH` or default), register the seven tools
  - `.pi/mcp.json`:

```json
{
  "mcpServers": {
    "telemetry": {
      "command": "bun",
      "args": ["src/mcp-server.ts"],
      "exposure": "direct"
    }
  }
}
```

- [ ] **Step 1: Write the failing tests**

```ts
test("handleTelemetryTool query_authentication forwards user filter", () => {
  const w = loadTestWorld("testdata/world.json");
  const rows = handleTelemetryTool("query_authentication", { user: "bob" }, w) as { ip: string }[];
  expect(rows.some((r) => r.ip === "10.0.0.8")).toBe(true);
});

test("unknown tool name throws", () => {
  const w = loadTestWorld("testdata/world.json");
  expect(() => handleTelemetryTool("isolate_host", {}, w)).toThrow();
});
```

- [ ] **Step 2: Run** `bun test tests/mcp-handlers.test.ts` — Expected: FAIL

- [ ] **Step 3: Implement `handleTelemetryTool` and MCP stdio `main` using `@modelcontextprotocol/sdk` Server + StdioServerTransport.** Tools are read-only JSON results. No write/isolate tools.

- [ ] **Step 4: Run** `bun test tests/mcp-handlers.test.ts` — Expected: PASS

- [ ] **Step 5: Commit** `feat: add local telemetry MCP handlers`

---

### Task 4: Pi RPC host and caps

**Files:**
- Create: `src/pi-host.ts`
- Test: `tests/pi-host.test.ts`

**Interfaces:**
- Consumes: `INVESTIGATION_WALL_MS`, `INVESTIGATION_MAX_TOOL_CALLS`, `errorResult` (only if you choose to throw instead — prefer throwing `PiHostError` and let Task 5 map to `errorResult`)
- Produces:
  - `export type PiRunOk = { text: string; modelId: string; sessionFile: string | null; toolCallCount: number; aborted: boolean }`
  - `export class PiHostError extends Error { constructor(message: string, readonly modelId: string) }`
  - `export type RpcClientLike = { start(): Promise<void>; promptAndWait(message: string): Promise<void>; abort(): Promise<void>; getState(): Promise<{ model?: { id?: string }; sessionFile?: string }>; onEvent(handler: (e: { type: string }) => void): () => void; close(): Promise<void> }`
  - `export function countToolCall(event: { type: string }): boolean` — `true` for event types that mean a tool started (`tool_execution_start` or whatever the installed `RpcClient` emits — **read the installed package types** and pin one type in the test)
  - `export async function runPiInvestigation(client: RpcClientLike, prompt: string, now?: () => number, wait?: (ms: number, signal: AbortSignal) => Promise<void>): Promise<PiRunOk>`
    - subscribe before `promptAndWait`
    - abort when `toolCallCount >= 15` or elapsed `>= 600_000`
    - if `abort()` is missing on the installed client, `close()` the child (same as abort for Phase 1)
    - child throw/exit: throw `PiHostError`
    - `aborted: true` when cap fired
    - `modelId` from `getState().model.id` or `"unknown"`
  - `export function piSpawnArgs(opts: { sessionDir: string; systemPromptPath: string }): string[]` returns `["--mode","rpc","--no-builtin-tools","-a","--session-dir", sessionDir, "--system-prompt", systemPromptPath]`

Do not implement resume/`--continue`. Each `runPiInvestigation` is a new conversation on the client (call `newSession` if present on the real client before prompt; if the like-type has it, include `newSession(): Promise<void>`).

- [ ] **Step 1: Write the failing tests** with a fake `RpcClientLike`

```ts
test("piSpawnArgs disables builtin tools and sets rpc", () => {
  expect(piSpawnArgs({ sessionDir: "/s", systemPromptPath: "/p" })).toEqual([
    "--mode", "rpc", "--no-builtin-tools", "-a", "--session-dir", "/s", "--system-prompt", "/p",
  ]);
});

test("fifteenth tool event calls abort and sets aborted", async () => {
  const fake = makeFakeClient({ toolEvents: 15, text: "ignored" });
  const out = await runPiInvestigation(fake, "go");
  expect(fake.abortCalls).toBe(1);
  expect(out.aborted).toBe(true);
  expect(out.toolCallCount).toBe(15);
});

test("child failure throws PiHostError and does not call newSession after fail", async () => {
  const fake = makeFakeClient({ fail: true });
  await expect(runPiInvestigation(fake, "go")).rejects.toBeInstanceOf(PiHostError);
  expect(fake.continueCalls).toBe(0);
});
```

`makeFakeClient` is test-local. Emit 15 `{ type: "<pinned tool-start type>" }` then resolve prompt.

- [ ] **Step 2: Run** `bun test tests/pi-host.test.ts` — Expected: FAIL

- [ ] **Step 3: Implement `src/pi-host.ts`.** Factory that constructs real `RpcClient` from `@earendil-works/pi-coding-agent` with `cliPath: "pi"` and `args: piSpawnArgs(...)` lives here as `export function createPiClient(opts): RpcClientLike` wrapping the real client. If `RpcClient` constructor shape differs, adapt in this one function only.

- [ ] **Step 4: Run** `bun test tests/pi-host.test.ts` — Expected: PASS

- [ ] **Step 5: Commit** `feat: add Pi RPC host with investigation caps`

---

### Task 5: Investigate orchestration

**Files:**
- Create: `src/investigate.ts`, `prompts/investigation.md`
- Test: `tests/investigate.test.ts`

**Interfaces:**
- Consumes: `TestAlert`, `extractJsonObject`, `parseInvestigationResult`, `errorResult`, `runPiInvestigation`, `PiHostError`, `PiRunOk`
- Produces:
  - `export function formatAlertPrompt(alert: TestAlert): string` — JSON of the alert plus instruction to investigate via tools and emit one JSON object matching `InvestigationResult` minus `model_id`
  - `export async function runInvestigation(alert: TestAlert, client: RpcClientLike, write: (result: InvestigationResult) => void): Promise<InvestigationResult>`
    - `prompt = formatAlertPrompt(alert)`
    - on `PiHostError` → `errorResult(err.modelId, err.message)`, `write`, return
    - on `aborted` → `errorResult(modelId, "cap: 10m or 15 tool calls")` **without** parsing model text
    - else `parseInvestigationResult(extractJsonObject(text), modelId)`; on throw → `errorResult(modelId, "invalid investigation json")`
    - `write` always called once

`prompts/investigation.md`: SOC analyst, read-only, cite Evidence vs assumptions, no containment, JSON schema field list. Used as `--system-prompt`.

- [ ] **Step 1: Write the failing tests**

```ts
test("invalid model JSON becomes error disposition", async () => {
  const client = makeFakeClient({ text: "not json", aborted: false });
  const written: InvestigationResult[] = [];
  const r = await runInvestigation({ type: "suspicious_login", timestamp: "2026-01-01T00:00:00Z", user: "bob" }, client, (x) => written.push(x));
  expect(r.alert_disposition).toBe("error");
  expect(written).toHaveLength(1);
});

test("aborted run does not parse model text", async () => {
  const client = makeFakeClient({
    text: JSON.stringify({ alert_disposition: "true_positive", recommended_posture: "recommend_containment", confidence: "high", summary: "should ignore", supporting_evidence: [], assumptions: [], investigation_steps: [], entities: [], recommended_next_step: "x" }),
    aborted: true,
  });
  const r = await runInvestigation({ type: "suspicious_login", timestamp: "2026-01-01T00:00:00Z", user: "alice" }, client, () => {});
  expect(r.alert_disposition).toBe("error");
  expect(r.summary).toMatch(/cap/i);
});
```

The fake must satisfy `runPiInvestigation` **or** `runInvestigation` should accept `runPi: typeof runPiInvestigation` as an injected function. **Inject it:** `runInvestigation(alert, deps: { runPi: typeof runPiInvestigation; client: RpcClientLike }, write)`. Then tests pass a stub `runPi`.

Revised produces: `runInvestigation(alert: TestAlert, deps: { runPi: (client: RpcClientLike, prompt: string) => Promise<PiRunOk>; client: RpcClientLike }, write: (result: InvestigationResult) => void): Promise<InvestigationResult>`

- [ ] **Step 2: Run** `bun test tests/investigate.test.ts` — Expected: FAIL

- [ ] **Step 3: Implement `formatAlertPrompt`, `runInvestigation`, and `prompts/investigation.md`**

- [ ] **Step 4: Run** `bun test tests/investigate.test.ts` — Expected: PASS

- [ ] **Step 5: Commit** `feat: orchestrate investigation result parse and errors`

---

### Task 6: CLI and HTTP trigger

**Files:**
- Create: `src/cli.ts`, `src/http.ts`, `src/write-result.ts`
- Test: `tests/http.test.ts`, `tests/cli.test.ts`

**Interfaces:**
- Consumes: `runInvestigation`, `TestAlert`, `InvestigationResult`
- Produces:
  - `export function resultPath(alertFileOrId: string, outDir: string): string` — `outDir/<basename>.result.json`
  - `export function writeResultFile(path: string, result: InvestigationResult): void` — pretty JSON, also append one line to `outDir/results.jsonl`
  - `export function loadAlert(path: string): TestAlert`
  - `export function createInvestigateHandler(opts: { busy: { current: boolean }; run: (alert: TestAlert) => Promise<InvestigationResult> }): (req: Request) => Promise<Response>`
    - only `POST /investigate`
    - body `{ "alert": TestAlert }`
    - missing/invalid JSON → 400
    - `busy.current` true → 409 `{ "error": "investigation_in_progress" }` without calling `run`
    - else set busy, 200 `{ "result": InvestigationResult }`, clear busy in `finally`
  - CLI: read alert path argv[2], `createPiClient`, `runInvestigation`, `writeResultFile` under `var/results/`

- [ ] **Step 1: Write the failing tests**

```ts
test("POST /investigate 409 when busy", async () => {
  const handler = createInvestigateHandler({ busy: { current: true }, run: async () => { throw new Error("should not run"); } });
  const { status, body } = await invoke(handler, "POST", "/investigate", { alert: { type: "suspicious_login", timestamp: "2026-01-01T00:00:00Z" } });
  expect(status).toBe(409);
  expect(body.error).toBe("investigation_in_progress");
});

test("POST /investigate 400 on empty body", async () => {
  const handler = createInvestigateHandler({ busy: { current: false }, run: async () => errorResult("m", "n") });
  const { status } = await invoke(handler, "POST", "/investigate", null);
  expect(status).toBe(400);
});

test("loadAlert reads testdata shape", () => {
  // write a temp json file in the test
});
```

`invoke` is a tiny test helper: `Bun.serve({ port: 0, fetch: handler })` then `fetch`, then `server.stop()`.

- [ ] **Step 2: Run** `bun test tests/http.test.ts tests/cli.test.ts` — Expected: FAIL

- [ ] **Step 3: Implement write/load helpers, HTTP handler, CLI. `src/http.ts` `main` uses `Bun.serve` on `PORT` or 8787.**

- [ ] **Step 4: Run** `bun test tests/http.test.ts tests/cli.test.ts` — Expected: PASS

- [ ] **Step 5: Commit** `feat: add test alert CLI and HTTP trigger`

---

### Task 7: Nine Test Alerts and branchiness

**Files:**
- Create: `testdata/alerts/01.json` … `09.json`
- Test: `tests/branchiness.test.ts`
- Create: `docs/phase-1-scoring.md`

**Interfaces:**
- Consumes: Task 2 queries, `TestAlert`
- Produces: nine alerts (3 identity, 3 endpoint/process, 3 noisy-benign), mixed TP/FP/branch; scoring markdown table (id, type, expected_disposition_hint, usable, agentic, invented_evidence)

Alerts (exact `type` / identity fields):

| File | type | keys | Hint (for scorers, not given to Pi) |
|---|---|---|---|
| `01.json` | `suspicious_login` | user `alice` | likely TP identity |
| `02.json` | `suspicious_login` | user `bob` | likely FP office VPN |
| `03.json` | `suspicious_login` | user `alice`, source_ip `198.51.100.4` | branch: auth then process |
| `04.json` | `malware_process` | host `alice-mbp`, hash `aa` | likely TP endpoint |
| `05.json` | `malware_process` | host `bob-win` | likely FP / insufficient |
| `06.json` | `malware_process` | host `alice-mbp` | branch: process then auth |
| `07.json` | `noisy_scanner` | user `scanner-svc` | benign true positive |
| `08.json` | `noisy_scanner` | host `scanner-host` (add this host to world as backup-agent only) | benign |
| `09.json` | `suspicious_login` | user `nobody` | insufficient_evidence |

- [ ] **Step 1: Write the failing tests**

```ts
test("first authentication query is not unique across 01 02 07", () => {
  const w = loadTestWorld("testdata/world.json");
  const a = JSON.stringify(queryAuthentication(w, { user: "alice" }));
  const b = JSON.stringify(queryAuthentication(w, { user: "bob" }));
  const s = JSON.stringify(queryAuthentication(w, { user: "scanner-svc" }));
  expect(new Set([a, b, s]).size).toBe(3);
});

test("nine alerts exist and nobody has empty auth", () => {
  const files = readdirSync("testdata/alerts").filter((f) => f.endsWith(".json"));
  expect(files).toHaveLength(9);
  const w = loadTestWorld("testdata/world.json");
  expect(queryAuthentication(w, { user: "nobody" })).toEqual([]);
});
```

- [ ] **Step 2: Run** `bun test tests/branchiness.test.ts` — Expected: FAIL

- [ ] **Step 3: Add `scanner-host` to the world if missing; write nine alert files; write `docs/phase-1-scoring.md` with GO rules copied from the spec (≥6/9 usable, ≥6/9 agentic, zero invented Evidence).**

- [ ] **Step 4: Run** `bun test tests/branchiness.test.ts` — Expected: PASS

- [ ] **Step 5: Commit** `test: add nine test alerts and branchiness check`

---

### Task 8: README smoke path

**Files:**
- Create: `README.md`
- Modify: `package.json` scripts `"investigate": "bun src/cli.ts"`, `"serve": "bun src/http.ts"`, `"test": "bun test"`
- Create: `var/.gitkeep`, ignore `var/results/` and `var/pi-sessions/` in `.gitignore`

**Interfaces:**
- Consumes: CLI, MCP config
- Produces: README with: requires `bun` and `pi` on PATH and a working `pi auth`; from repo root `bun test` then `bun src/cli.ts testdata/alerts/02.json`; results in `var/results/`; how to score using `docs/phase-1-scoring.md`; explicit non-goals (no production SIEM).

- [ ] **Step 1: Write a test that package.json scripts exist**

```ts
test("package.json has investigate and test scripts", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  expect(pkg.scripts.investigate).toMatch(/cli/);
  expect(pkg.scripts.test).toMatch(/bun test/);
});
```

in `tests/pkg.test.ts`

- [ ] **Step 2: Run** `bun test tests/pkg.test.ts` — Expected: FAIL if scripts missing

- [ ] **Step 3: Add scripts, gitignore, README. Do not call a real model in CI.**

- [ ] **Step 4: Run** `bun test` — Expected: all unit tests PASS

- [ ] **Step 5: Commit** `docs: add phase 1 smoke instructions`

---

## Self-review notes

- Spec GO/NO-GO and nine-case corpus: Task 7 + scoring doc; host does not auto-score agentic vs playbook.
- Smoke with live Pi is documented, not a unit test (needs credentials).
- `countToolCall` event type is pinned from installed `RpcClient` types in Task 4 — that is the Unknown abort/event name from the spec.
- No production integrations in any task.
