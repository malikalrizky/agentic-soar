# Agentic SOAR (Phase 1 POC)

Isolated Test Alert → Pi RPC → local telemetry MCP → Investigation Result.

Requires **Bun 1.4.2+**, **Gerbang running** (`gerbang start` / `gerbang login`), and a **Pi CLI that loads `.pi/mcp.json`** (1.0.4+). The host is Bun. `RpcClient` always starts the child with `node <cli.js>`, so `PI_CLI` must be a JavaScript entry, not a bare `pi` name on PATH.

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
