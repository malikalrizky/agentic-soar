# Phase 1 result

**Date:** 2026-10-06  
**Question:** Can Pi run as a useful SOC investigation engine on an isolated Test World?  
**Verdict:** Thin GO. Not a production-SIEM authorization.

## Setup

- Host: Bun ≥ 1.4.2, one Investigation at a time, `RpcClient` → `node $PI_CLI --mode rpc`.
- Pi: 1.0.4 (`PI_CLI` = Homebrew global `dist/bundle/cli.js`). Loads `.pi/mcp.json` with `exposure: direct`.
- Model (frozen): Gerbang adapter → `dk/openrouter/deepseek/deepseek-v4.1-flash`.
- Tools: local stdio telemetry MCP over `testdata/world.json`. Built-in bash/edit/write off.
- Caps: 10 min or 15 tool calls → `error`.
- Results: `var/results/NN.result.json` plus Pi session sidecar.

## Score

GO bar: ≥6/9 usable, ≥6/9 agentic, **zero** invented Evidence.

| | |
|---|---|
| Usable | 6/9 |
| Agentic | 6/9 |
| Invented Evidence | 0 (on the six that finished) |

Row-level notes: `docs/phase-1-scoring.md`.

| id | hint | outcome |
|---|---|---|
| 01 | TP identity | `error` (15-call cap). Session was on the alice SG/US → `weird.exe` path, then fanned out (`query_host` does not exist). |
| 02 | FP office VPN | `false_positive` / `no_action`. Known-office `10.0.0.8` / `bob-win` / known-good `outlook.exe`. |
| 03 | branch auth→process | `true_positive` / `recommend_containment`. Geo split → `impossible_travel` → hash `aa`. |
| 04 | TP endpoint | `error` (15-call cap). Extra/nonexistent tools (`query_hash`). |
| 05 | FP / insufficient | `error` (15-call cap). Started on `bob-win` / `bb`, wandered to alice/`aa`. |
| 06 | branch process→auth | `true_positive` / `recommend_containment`. `weird.exe` then impossible-travel auth. |
| 07 | BTP scanner | `benign_true_positive` / `monitor`. `scanner-svc` / known-good `backup-agent`. |
| 08 | benign scanner | `benign_true_positive` / `no_action`. Same world, host-scoped. |
| 09 | insufficient_evidence | `false_positive` / `no_action`. Empty telemetry for `nobody`. Close is usable; label should have been insufficient_evidence. Prompt said “Test Alert”. |

## What this means

Pi + MCP + a frozen flash model **did** change the next query from evidence (03, 06) and did not invent log rows on finished cases.

The three misses are the **15-call cap**, not fake evidence. Flash parallelizes and guesses tool names. 01 likely would have been a usable TP if it had been allowed to stop.

## Explicitly not in this GO

Production Coralogix / CrowdStrike / Wiz, MCP Gateway, Postgres, n8n, remediation, or raising the cap and re-scoring 01/04/05.

## Pointers

- Design: `docs/phase-1-design.md`
- ADR (RPC host): `docs/adr/0004-phase-1-drive-pi-via-rpc.md`
- Glossary: `GLOSSARY.md`
- Run: `README.md`
- Next-phase brief: `phase3update.md` (Pi 1.0.4 native MCP; MCP Gateway still deferred)
- Visuals: `docs/visuals.md` (Mermaid, pushable) and `docs/visuals/index.html`
