# Agentic SOAR (Phase 1 POC)

Isolated Test Alert → Pi RPC → local telemetry MCP → Investigation Result.

Requires Bun 1.4.2+, Gerbang running (`gerbang start` / `gerbang login`), and a Pi CLI that loads `.pi/mcp.json` (1.0.4+). The host is Bun. `RpcClient` always starts the child with `node <cli.js>`, so `PI_CLI` must be a JavaScript entry, not a bare `pi` name on PATH.

The frozen model is **DeepSeek V4.1 Flash** via Gerbang (`dk/openrouter/deepseek/deepseek-v4.1-flash`). The host starts `gerbang proxy --application agentic-soar` when adapter env is unset.

```bash
bun install
bun test
export PI_CLI=/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js
bun src/cli.ts testdata/alerts/02.json
```

Override the model only if you also have that id on Gerbang: `export PI_MODEL=dk/openrouter/...`

Results land in `var/results/` (plus `.session` sidecar). Score them with `docs/phase-1-scoring.md`. Diagrams: [`docs/visuals.md`](docs/visuals.md) (GitLab) and [`docs/visuals/index.html`](docs/visuals/index.html) (browser).

HTTP trigger: `bun src/http.ts` then `POST /investigate` with `{ "alert": { ... } }`.

Not in Phase 1: production Coralogix/SIEM, CrowdStrike, Wiz, MCP Gateway, PostgreSQL, n8n, remediation.

## Phase 2 Security Tool Layer (disabled by default)

`.pi/mcp.json` lists a second stdio MCP `security` with `"disabled": true`. Phase 1 scoring keeps using the Test World only.

To enable a live read-only Coralogix search (after ADC or a GCE instance SA can access Secret Manager):

1. Set `"disabled": false` on `mcpServers.security`.
2. Put Coralogix credentials in GSM as JSON: `{"apiKey":"...","endpoint":"https://api.<region>.coralogix.com"}`.
3. Export `TOOL_LAYER_GCP_PROJECT` and `TOOL_LAYER_CORALOGIX_SECRET` in the shell that starts the host (the MCP child inherits them; do not put them in Pi/`createPiClient` env).
4. Keep `PI_CLI` on Pi 1.0.4+ JS entry.

Pi and the security MCP share the OS user; `--no-builtin-tools` is part of keeping vendor keys out of the model process.
