# Agentic SOAR (Phase 1 POC)

Isolated Test Alert → Pi RPC → local telemetry MCP → Investigation Result.

Requires **Bun 1.4.2+** and a **Pi CLI that loads `.pi/mcp.json`** (current pi.dev install). The host is Bun. `RpcClient` always starts the child with `node <cli.js>`, so `PI_CLI` must be a JavaScript entry, not a bare `pi` name on PATH.

```bash
bun install
bun test
export PI_CLI=/absolute/path/to/pi/cli.js   # node-spawnable entry with MCP
export PI_MODEL=provider/id                 # freeze one model for all nine alerts
bun src/cli.ts testdata/alerts/02.json
```

If `PI_CLI` is unset, the host uses this repo’s `@earendil-works/pi-coding-agent` `dist/bundle/cli.js` (0.87.1 has no MCP). For the POC, point `PI_CLI` at a Pi build that lists the telemetry tools.

Results land in `var/results/` (plus `.session` sidecar). Score them with `docs/phase-1-scoring.md`.

HTTP trigger: `bun src/http.ts` then `POST /investigate` with `{ "alert": { ... } }`.

Not in Phase 1: production Coralogix/SIEM, CrowdStrike, Wiz, MCP Gateway, PostgreSQL, n8n, remediation.
