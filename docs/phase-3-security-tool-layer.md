# Phase 3: Security Tool Layer (design)

**Status:** accepted. Not an implementation plan. Not a production-SIEM authorization. ADR: [[0005-phase-3-security-tool-layer]].

Phase 1 stays isolated (Test World MCP). Phase 2 (eval) is unchanged and not designed here.

Language: [[GLOSSARY]]. Phase 1: [[phase-1-design]], [[phase-1-result]]. Brief: `pre-brainstorm.md` (Phase 3).

No fundamental flaw in “use a Security Tool Layer.” Pi 1.0.4 already has native MCP; that makes a **separate MCP process** the smallest way to keep vendor keys out of Pi. MCP Gateway stays deferred.

Honest limit: same OS user as Pi can still hit Secret Manager if it has a client and a tool that can run code. Phase 3 relies on **no such tool** (`--no-builtin-tools`) plus secrets never placed in Pi env. That is process isolation, not a hostile multi-tenant VM.

---

## 1. Recommended Phase 3 architecture

```text
Test Alert or later intake
        ↓
Existing Bun host (RpcClient → node $PI_CLI --mode rpc)
        ↓
Pi 1.0.4+  (--no-builtin-tools, exposure: direct)
        ├── stdio MCP "telemetry"  → Test World      (unchanged)
        └── stdio MCP "security"   → Security Tool Layer (new process)
                    ↓
            GCP Secret Manager  (ADC on laptop; GCE instance SA on VM)
                    ↓
            Coralogix read API only
```

Host, caps, Investigation Result schema, and Gerbang → `dk/openrouter/deepseek/deepseek-v4.1-flash` stay as Phase 1 unless a later change says otherwise.

Pi never gets Coralogix keys, never calls Secret Manager, never speaks vendor HTTP. The Tool Layer is not a SOAR, workflow engine, policy engine, or gateway product.

---

## 2. Security Tool Layer responsibilities

| Concern | Class |
|---|---|
| Tool execution (registered tools only) | MUST HAVE NOW |
| Vendor API authentication (after SM fetch) | MUST HAVE NOW |
| GCP Secret Manager access | MUST HAVE NOW |
| Request validation (schema, limits, time window) | MUST HAVE NOW |
| Response bounding (max rows/bytes) | MUST HAVE NOW |
| Secret-shaped redaction in results/errors/logs | MUST HAVE NOW (defense in depth) |
| Timeouts on SM and vendor HTTP | MUST HAVE NOW |
| One retry on 429/5xx (Retry-After / backoff) | MUST HAVE NOW |
| Structured error to Pi (no empty-hit lie) | MUST HAVE NOW |
| Audit log (local, structured: tool, arg hash, timing, status) | MUST HAVE NOW |
| Authorization / RBAC / approvals | FUTURE (Phase 4 actions) |
| Rate limiter service | FUTURE (host 15-call cap + timeouts are enough) |
| Idempotency keys | FUTURE (writes) |
| Network MCP / mTLS | FUTURE (split host) |
| Dedicated OS user for the MCP child | FUTURE |
| Incident store, playbooks, n8n, queues | NOT PART OF THIS LAYER |
| Investigation orchestration / result files | NOT PART OF THIS LAYER (Bun host) |
| Model, sessions, Gerbang | NOT PART OF THIS LAYER (Pi) |
| MCP Gateway | NOT PART OF THIS LAYER (deferred) |
| Policy engine | NOT PART OF THIS LAYER |

---

## 3. Pi integration approach

**KEEP:** Phase 1 control plane: Bun `RpcClient`, `pi --mode rpc`, `--no-builtin-tools`, `-a` for project MCP, `exposure: direct`.

**Tool plane:** native MCP stdio. New `.pi/mcp.json` server (name `security` or similar), `command`/`args` to a **new** process in this repo. Not `src/mcp-server.ts`. Not in-process `pi.registerTool()` for vendor calls (handler would share the Pi process). Not SDK `createMcpExtension()` (RPC CLI already loads `.pi/mcp.json`). Not HTTP/gRPC for the minimum.

Default Pi MCP exposure is `codemode` (tools hidden from the model). Phase 3 must set `direct` again.

Model-visible name: `mcp__<server>__coralogix_search`. Prompt/docs must use that, or Flash will invent `query_host` again.

Repo `package.json` still pins Pi **0.87.1**; real MCP is the **1.0.4 CLI** via `PI_CLI`. Phase 3 must not spawn the 0.87.1 child.

---

## 4. Secret lifecycle

**Identity**

- Laptop (allowed for first real call): Application Default Credentials.
- VM target: GCE attached service account with `secretmanager.secretAccessor` on **one** secret. No JSON key files in the repo or in Pi env.

**Secret**

- One GSM secret for Coralogix (API key or small JSON). Project/secret id are Tool Layer config, not prompt text.
- Layer fetches with the official GCP client; caches **in memory** with a short TTL; never writes the value to disk.
- Rotation: new secret version; TTL expiry or 401/403 busts cache and refetches.
- Revoke: disable the version in GSM and restart the MCP process (kills in-memory copy).
- SM down / missing secret: fail closed (tool error). Do not fall back to env files or Phase 1 world data.

Pi env must not contain the Coralogix key. Do not put `${CORALOGIX_API_KEY}` in `.pi/mcp.json`.

---

## 5. Trust boundaries

```text
[untrusted for vendor keys]
  LLM context, Pi session JSONL, Investigation Result, operator prompt
  Pi Node process (Gerbang/model tokens may live here)
       |  stdio MCP (tool args / bounded results only)
[trusted for vendor keys]
  Security Tool Layer process
       |  GCP ADC / metadata SA
  Secret Manager
       |  HTTPS
  Coralogix
```

Mock telemetry MCP stays a **separate** trust domain: no production credentials, no GSM.

Audit logs: tool name, hashed args, timing, HTTP status. Not headers, not secrets, not full hits.

Same-user VM/laptop: Pi *could* call GSM if we gave it bash or a GSM tool. Boundary is the **tool allowlist**, not Linux MAC. Call that out in ops docs when the VM exists.

---

## 6. Threat model

| Threat | Phase 3 control |
|---|---|
| Prompt injection → extra vendor reads | One read-only tool; query limits; 15-call cap (host) |
| Prompt injection → containment / delete | No mutating tools; read-only Coralogix credential |
| Vendor key in session / LLM / result | Key never returned; redaction of secret-shaped strings in payloads |
| Vendor key in Pi env or `mcp.json` | SM fetch inside Tool Layer only |
| Empty error mistaken for “no logs” | Structured tool error, not `[]` |
| Flash invents tools / fans out | Tiny catalog; `direct` list is the truth; cap is a finding |
| ADC theft on laptop | Accept for min; VM SA + no user keys later |
| Log PII in session files | Truncation; still treat sessions as sensitive |
| Tool Layer as confused deputy (HTTP) | Stdio only for min; no listen port |
| Pi 0.87.1 child, no MCP | `PI_CLI` must be 1.0.4+ JS entry |

---

## 7. Minimum implementation

In this repo, design-only until implementation is requested:

1. New stdio MCP process (not the Test World server).
2. One tool: `coralogix_search` (query, time range, hard max limit).
3. GSM client + in-memory TTL cache + 401 bust.
4. Coralogix **read** HTTP with timeouts; one 429/5xx retry.
5. Validate args; bound and redact results; structured errors.
6. Local structured audit log (stdout or `var/` file).
7. `.pi/mcp.json`: second server, `exposure: direct`. Keep `telemetry`.
8. Host unchanged except config if the child cwd/env must not leak keys.
9. `--no-builtin-tools` remains mandatory.
10. No CrowdStrike, Wiz, Gateway, Postgres, n8n, writes.

Success for the *layer*: Pi can run an Investigation that calls `coralogix_search`, Evidence cites tool results, keys never appear in session/result/audit. Success is **not** “beat Phase 1 GO on production alerts.”

---

## 8. Future autonomous-response evolution

```text
Pi reasoning → tool request → (Phase 4) authorization/policy → Tool Layer → vendor action
```

| Capability | Lives where | When |
|---|---|---|
| RBAC / allowlists / approvals / risk | **In front of** the Tool Layer (host or tiny policy check), not a new SOAR | Phase 4 |
| Mutating tools | Tool Layer, registered only after policy exists | Phase 4 |
| Rate limits / kill switch | Host abort + “disable mutating tools” flag; optional GSM revoke | Phase 4 |
| Audit of actions | Same audit log, richer fields | Phase 4 |
| Idempotency | Tool Layer on writes | Phase 4 |
| Second vendor tools | Same MCP process, new names | After Coralogix is boring |
| HTTP MCP / split VM | Transport change only | When something other than this Pi must call the layer |
| Dedicated OS user | Ops | When the VM is real and we care about same-user GSM |

Do not build a policy engine in Phase 3.

---

## 9. Risks / tradeoffs

- **Same-user GSM.** Smallest deploy; weaker than split identity. Mitigate with tool surface, not theater.
- **One Coralogix search** may be too coarse for real investigations. Add tools only with evidence.
- **Raw-ish JSON** (bounded) vs a SOC schema: we accepted vendor JSON to avoid a fake SIEM model. Prompt may need field hints.
- **15-call cap** still kills fan-out. Layer does not raise the cap.
- **Laptop ADC** is a person-shaped credential. Fine for a first call; not the production story.
- **Sessions contain log excerpts.** Redaction is not a DLP product.
- **Two MCP servers** add a little prompt weight. Better than mixing mock and prod in one catalog.

---

## 10. KEEP / CHANGE / DEFER / REJECT

**KEEP**

- Pi as Investigation core; Bun RPC host; one Investigation at a time.
- Native MCP, `exposure: direct`, `--no-builtin-tools`.
- Isolated Test World MCP and Phase 1 corpus.
- Gerbang + frozen Flash until eval says otherwise.
- Thin Tool Layer (execute, auth via SM, validate, bound, redact, timeout, audit).
- Vendor-narrow tools; no `arbitrary_http_request`.
- Fail closed; never fake empty Evidence.
- Read-only first.

**CHANGE** (from older discovery drafts)

- Phase 3 path is Tool Layer + SM, **not** MCP Gateway.
- “Do not assume Pi has MCP” is false for 1.0.4.
- Discovery doc’s “Phase 3 = SOAR control plane” is the wrong label for this work (Incident still later).
- Prefer MCP child over in-process Pi tools for vendor credentials.

**DEFER**

- MCP Gateway, CrowdStrike, Wiz, Cloudflare, Google APIs.
- HTTP MCP, gRPC, split service, Cloud Run.
- Policy engine, RBAC, approvals, kill switch, write tools, idempotency.
- Postgres / Incident, n8n, queues, multi-worker Pi.
- Dedicated OS user / separate SA per process.
- Cloud Logging as the audit sink.
- Raising the 15-call cap (host/eval concern).

**REJECT** (for this layer / this phase)

- Reopening “do we need a Tool Layer.”
- In-process vendor keys in Pi.
- Generic HTTP tool for the model.
- Serving mock and production under the same tool names.
- Empty hits on vendor failure.
- Disk cache or env fallback for Coralogix keys.
- Building a SOAR / workflow / integration platform under the layer.
