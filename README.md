# Agentic SOAR

Isolated Test Alert → Pi RPC → local telemetry MCP → Investigation Result.

Goal: a SOAR platform built as a thin host around Pi.
Phase 1 is triage and Investigation: alert in, tools, disposition out.
Next Phase: case management, playbooks/skills, and remediation/skills.

## Prerequisites

| Tool | Version / notes |
|---|---|
| Bun | ≥ 1.4.2 (host, MCP server, tests) |
| Node.js | ≥ 22.19 required (`package.json` engines). Recommended locally: **26.10.0** (verified). Keep any non-EOL Node that meets the floor. |
| Gerbang | Logged in (`gerbang start` / `gerbang login`). Must be on PATH so the host can run `gerbang proxy`. |
| Pi CLI | 1.0.4+ JavaScript entry that loads project `.pi/mcp.json`. `RpcClient` always spawns `node <cli.js>`, so a bare `pi` binary on PATH is not enough. |

This repo pins `@earendil-works/pi-coding-agent` at 0.87.1 for the TypeScript `RpcClient` only. That pin is not a substitute for a 1.0.4+ `PI_CLI`.

Frozen model: DeepSeek V4.1 Flash via Gerbang (`dk/openrouter/deepseek/deepseek-v4.1-flash`). When `GERBANG_ADAPTER_*` / `OPENAI_*` adapter env is unset, the host runs `gerbang proxy --application agentic-soar` and reads `OPENAI_BASE_URL` / `OPENAI_API_KEY` from its stdout.

## Setup

```bash
bun install
export PI_CLI=/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js
```

Adjust `PI_CLI` to wherever your global Pi 1.0.4+ `dist/bundle/cli.js` lives. If `PI_CLI` is unset, the host falls back to `node_modules/.../bundle/cli.js` from the 0.87.1 dependency pin — wrong for MCP project config.

Confirm Gerbang before the first live run:

```bash
gerbang login   # if needed
gerbang start
```

## Run

```bash
bun test
bun src/cli.ts testdata/alerts/02.json
# or: bun run investigate testdata/alerts/02.json
```

Results land in `var/results/` (plus a `.session` sidecar). Score with [`docs/phase-1-scoring.md`](docs/phase-1-scoring.md).

### HTTP API

Raw `Bun.serve`. Default port `8787` (`PORT` to override). Machine-readable contract: [`docs/openapi.yaml`](docs/openapi.yaml).

`/docs` and `/openapi.yaml` are internal-only (loopback + private IPs). Public clients get `404`. Set `DOCS_ACCESS=off` to disable, or `loopback` for localhost only. Behind a public reverse proxy the peer IP is usually the proxy — also filter paths at the gateway.

```bash
bun src/http.ts
# or: bun run serve
# browser docs (from this machine / private network): http://127.0.0.1:8787/docs
open http://127.0.0.1:8787/docs
```

`POST /investigate` — body `{ "alert": TestAlert }`. One investigation at a time; a second overlapping request gets `409`.

| Status | Body |
|---|---|
| 200 | `{ "result": InvestigationResult }` |
| 400 | `{ "error": "invalid_json" }` or `{ "error": "invalid_alert" }` |
| 404 | `{ "error": "not_found" }` (wrong method/path) |
| 409 | `{ "error": "investigation_in_progress" }` |
| 500 | `{ "result": InvestigationResult }` with `alert_disposition: "error"` |

`TestAlert` required fields: `type`, `timestamp`. Optional: `user`, `host`, `source_ip`, `process`, `hash`.

```bash
curl -s -X POST http://127.0.0.1:8787/investigate \
  -H 'content-type: application/json' \
  -d '{"alert":{"type":"suspicious_login","timestamp":"2026-01-01T09:00:00Z","user":"bob"}}'
```

### Optional env

| Variable | Purpose |
|---|---|
| `PI_CLI` | Path to Pi 1.0.4+ `cli.js` |
| `PI_MODEL` | Override frozen model id (must exist on Gerbang) |
| `GERBANG_ADAPTER_BASE_URL` / `GERBANG_ADAPTER_API_KEY` | Skip `gerbang proxy` when already set |
| `OPENAI_BASE_URL` / `OPENAI_API_KEY` | Same as adapter env (accepted aliases) |
| `PORT` | HTTP listen port (default 8787) |
| `DOCS_ACCESS` | `private` (default), `loopback`, or `off` — who may load `/docs` and `/openapi.yaml` |
| `WORLD_PATH` | Test World JSON for the telemetry MCP (default `testdata/world.json`) |

## Docs

- HTTP OpenAPI: [`docs/openapi.yaml`](docs/openapi.yaml)
- Phase 1 result: [`docs/phase-1-result.md`](docs/phase-1-result.md)
- Scoring: [`docs/phase-1-scoring.md`](docs/phase-1-scoring.md)
- Glossary: [`GLOSSARY.md`](GLOSSARY.md)
- Diagrams: [`docs/visuals.md`](docs/visuals.md) (GitLab) and [`docs/visuals/index.html`](docs/visuals/index.html) (browser)
- Next design: [`docs/phase-2-security-tool-layer.md`](docs/phase-2-security-tool-layer.md)

## Out of scope (Phase 1)

Production Coralogix/SIEM, CrowdStrike, Wiz, MCP Gateway, PostgreSQL, n8n, remediation.

## Phase 2 Security Tool Layer (disabled by default)

`.pi/mcp.json` lists a second stdio MCP `security` with `"disabled": true`. Phase 1 scoring keeps using the Test World only.

To enable a live read-only Coralogix search (after ADC or a GCE instance SA can access Secret Manager):

1. Set `"disabled": false` on `mcpServers.security`.
2. Put Coralogix credentials in GSM as JSON: `{"apiKey":"...","endpoint":"https://api.<region>.coralogix.com"}`.
3. Export `TOOL_LAYER_GCP_PROJECT` and `TOOL_LAYER_CORALOGIX_SECRET` in the shell that starts the host (the MCP child inherits them; do not put them in Pi/`createPiClient` env).
4. Keep `PI_CLI` on Pi 1.0.4+ JS entry.

Pi and the security MCP share the OS user; `--no-builtin-tools` is part of keeping vendor keys out of the model process.

First live smoke (ADC/GSM, local enable only, pass/fail): [`docs/phase-2-coralogix-smoke.md`](docs/phase-2-coralogix-smoke.md).
