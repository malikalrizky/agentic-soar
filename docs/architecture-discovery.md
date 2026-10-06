# Agentic SOAR: architecture discovery

Sources for Pi: [earendil-works/pi](https://github.com/earendil-works/pi) README, `packages/coding-agent/docs/{rpc,sdk,cli,cli-integration,mcp,sessions}.md` (main, fetched 2026-10-06). Evidence labels: **Confirmed** / **Inferred** / **Assumption** / **Unknown**.

Language: [[GLOSSARY]]. Phase 1 detail: [[phase-1-design]]. Decisions: [[0002-phase-1-isolated-mock-poc]], [[0003-test-world-not-golden-traces]], [[0004-phase-1-drive-pi-via-rpc]].

## Executive summary

SOC alert triage today is either a human or a fixed playbook. We want to know whether **Pi** (the Earendil coding-agent harness, not a SOC product) can run a useful **Investigation**: choose the next query from Evidence, correlate, and emit a structured **Investigation Result**.

We are not building a SOAR. Phase 1 is an isolated POC: Test Alert in, mock Telemetry Datasets, result files out. Production Coralogix, CrowdStrike, Wiz, MCP Gateway, PostgreSQL, n8n, and remediation stay out.

Phase 1 is small so a NO-GO is cheap.

## Current scope

**Phase 0**: Verify Pi runtime, RPC/SDK, sessions, MCP, and the simplest host. Done below from docs; a few items stay **Unknown** until a smoke run.

**Phase 1**: Nine Test Alerts against one Test World. GO if Pi is a useful investigation engine on that corpus. GO does not authorize production integration.

## Phase 0 findings

### Runtime

| Topic | Finding | Status |
|---|---|---|
| How Pi runs | Node 22.19+ CLI `pi`. Interactive TUI, `--print`, `--mode json`, `--mode rpc`. | Confirmed |
| Long-lived process | RPC mode stays up until stdin closes. Not an HTTP server. | Confirmed |
| External control | JSONL commands on stdin, responses/events on stdout. SDK embeds in Node/Bun. | Confirmed |
| Concurrent Investigations | SDK rejects a second `prompt()` during a run unless steer/follow-up. RPC `prompt` can queue. Phase 1 is **one Investigation at a time**. | Confirmed (serialize); Unknown (multi-session workers) |
| Restart | Default sessions are JSONL files (`~/.pi/agent/sessions/` or `--session-dir`). `--no-session` is ephemeral and cannot resume after exit. | Confirmed |
| Permissions | No built-in FS/network/credential sandbox. Runs as the launching user. | Confirmed |

PostgreSQL is **not** Pi’s session store. **Confirmed** (files or in-memory). Distributed queues/workers are **not** required for Phase 1.

### Integration options

| Approach | Fit | Verdict |
|---|---|---|
| Interactive TUI | Human in the loop | Out (Phase 1 is unattended) |
| `--print` | Final text only; no tool event stream | Too weak to score “agentic” |
| `--mode json` | One-shot JSONL events, then exit | Fine for a single run; no in-process abort command |
| `--mode rpc` | Long-lived; `prompt`, wait for `agent_settled`, session commands | **Chosen** |
| TypeScript SDK | In-process; MCP **not** loaded unless `createMcpExtension()` | Heavier than we need |
| Python host | Valid RPC client (docs example); Python is not required | Optional, not preferred |

**Recommended Phase 1 host:** Bun ≥ 1.4.2 TypeScript service (CLI + optional `POST /investigate`) that spawns Node `pi --mode rpc`, sends the Test Alert as the prompt, counts tool events, aborts on 10 minutes or 15 tool calls, writes the Investigation Result. Use the maintained TypeScript `RpcClient`. Python/JSONL remains valid, not preferred.

Do not pre-fetch Telemetry Dataset results into the prompt. That would make Pi a summarizer.

### MCP

| Topic | Finding | Status |
|---|---|---|
| Support | Built-in CLI extension. Stdio and streamable HTTP. SSE rejected. | Confirmed |
| Config | `~/.pi/agent/mcp.json` and project `.pi/mcp.json` (trusted projects). | Confirmed |
| SDK | Must add MCP (and often `codemode` / `tool_search`) explicitly. | Confirmed |
| Default exposure | **`codemode`**: tools are **not** declared to the model. | Confirmed |
| Phase 1 | One local **stdio** MCP, **`exposure: direct`**, small tool list. No MCP Gateway. | Assumption (config); Confirmed (capability) |
| Auth | HTTP OAuth / headers exist; unused in Phase 1. | Confirmed |

### Tool risk

Default tools include `bash`, `edit`, `write`. Combined with no sandbox, Pi is a coding agent with a shell. Phase 1 must disable those (`--no-builtin-tools` or `--exclude-tools`) and keep only the telemetry MCP tools. **Confirmed** need; **Assumption** that `--no-builtin-tools` plus project MCP is sufficient (smoke-test).

## Phase 1 design

See [[phase-1-design]] for the agreed flow, schema, corpus, caps, and GO numbers.

Data flow:

1. Operator injects a Test Alert (not a production webhook).
2. Integration service starts or reuses one RPC child, **new Investigation** (new Pi session). Failed runs are not resumed.
3. Pi queries Telemetry Datasets over one Test World via local MCP.
4. Next query must be allowed to change after Evidence.
5. Host validates/parses a structured Investigation Result. Missing/invalid JSON after the cap → `alert_disposition: error`.
6. Store result JSONL + copy/path of the Pi session file for scoring.

## Future vision (high level only)

- **Phase 2**: Security Tool Layer (stdio MCP, Secret Manager, Coralogix read). Incident/control plane stays later. Pi session state is not Incident state.
- **Deferred**: evaluation (accuracy, hallucinations, cost, analyst agreement) after real vendor queries exist. Not a numbered gate.
- **Phase 3**: Controlled response: reasoning ≠ authorization ≠ action.
- **Phase 4**: Scale (workers, queues, HA) only when required.
- **Phase 5**: Knowledge retrieval; multi-agent/ADK only if single-agent Pi fails.

Production path after GO was originally: SIEM → integration → Pi → **MCP Gateway** → vendors. **Superseded for Phase 2** by [[phase-2-security-tool-layer]] / [[0005-phase-2-security-tool-layer]]: Pi → Security Tool Layer (stdio MCP) → GCP Secret Manager → Coralogix read. MCP Gateway stays deferred. Pi 1.0.4 already has native MCP; that is not a Gateway.

## Key architectural decisions

1. Isolated POC; no production security systems ([[0002-phase-1-isolated-mock-poc]]).
2. One Test World, not per-alert golden traces ([[0003-test-world-not-golden-traces]]).
3. Drive Pi via RPC ([[0004-phase-1-drive-pi-via-rpc]]).
4. Alert-scoped Investigation; Incident is out of Phase 1.
5. Two closed fields: Alert Disposition and Recommended Posture.
6. GO needs both SOC-usable quality and engineering “agentic” scores.
7. MCP Gateway, n8n, ADK, Postgres, multi-agent: out until a later phase proves the need.

## Risks / unknowns

- **Unknown:** exact abort RPC command name/behavior under our version: verify with `pi --help` / rpc-commands on the installed binary.
- **Unknown:** whether `direct` MCP tools + `--no-builtin-tools` is enough for the model to call only telemetry tools.
- **Unknown:** structured-output reliability; we may need a second “format this transcript” prompt. That is still not a playbook of **investigation** steps.
- **Assumption:** a shared Test World can be written so the second query is not obvious from the Alert title.
- **Risk:** Pi’s coding-agent prompt/persona fights SOC investigation. Mitigate with `--append-system-prompt` / `--system-prompt`. **Inferred**.
- **Risk:** invented Evidence. GO rule: any case that cites a fact not in the Alert or a tool result is NO-GO until re-run clean.
- **Risk:** default `codemode` exposure makes it look like Pi “has MCP” but never calls datasets. Must set `direct`.

## What we are not building yet

PostgreSQL / durable SOAR DB; distributed Pi workers; queues; n8n; Google ADK; general-purpose workflow engine; automated remediation; dedicated knowledge base; multi-agent architecture; MCP Gateway; production Coralogix/CrowdStrike/Wiz; production webhooks.

None of these is required by Pi for Phase 1 (**Confirmed** for Postgres/queues; **Confirmed** MCP Gateway is our invention).

## Final recommendation

1. **Phase 1 architecture:** Test trigger → small integration service → one `pi --mode rpc` child (serialized Investigations) → local stdio MCP (`direct`) over one Test World → Investigation Result files. Disable shell/write tools.

2. **Why it is the simplest useful architecture:** It uses Pi’s documented control plane and MCP, avoids production credentials, and still tests branching tool use. JSON-only or prompt-stuffed telemetry would not.

3. **What must be proven:** On nine Test Alerts, Pi investigates dynamically, correlates across Telemetry Datasets, cites Evidence, and produces a result an analyst can use.

4. **GO / NO-GO:** ≥6/9 usable, ≥6/9 agentic, zero invented Evidence. Caps: 10 minutes or 15 tool calls → `error`. Crash → `error`, re-inject. GO does not mean “integrate Coralogix.”

5. **Only if Phase 1 succeeds:** Phase 2 Security Tool Layer (`docs/phase-2-security-tool-layer.md`); evaluation is deferred until real queries exist; then Incident state; then any remediation behind policy. MCP Gateway is not the next integration path.

**Do not write implementation code until this document is accepted.** First engineering step after acceptance is a smoke: RPC prompt, local MCP `direct` tool, builtin tools off, one fake query, structured result parsed.