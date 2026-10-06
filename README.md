# Agentic SOAR (Phase 1 POC)

Isolated Test Alert → Pi RPC → local telemetry MCP → Investigation Result.

Requires **Bun 1.4.2+** (latest at authoring) and **`pi`** on PATH with `pi auth` already working. The host is Bun; Pi still runs as its Node CLI child.

```bash
bun install
bun test
bun src/cli.ts testdata/alerts/02.json
```

Results land in `var/results/`. Score them with `docs/phase-1-scoring.md`.

HTTP trigger: `bun src/http.ts` then `POST /investigate` with `{ "alert": { ... } }`.

Not in Phase 1: production Coralogix/SIEM, CrowdStrike, Wiz, MCP Gateway, PostgreSQL, n8n, remediation.
