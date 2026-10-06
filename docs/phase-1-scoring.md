# Phase 1 scoring

Nine Test Alerts. Scored after `bun src/cli.ts testdata/alerts/NN.json` on 2026-10-06.

Frozen model: `dk/openrouter/deepseek/deepseek-v4.1-flash` via Gerbang.

**GO:** ≥6/9 usable, ≥6/9 agentic, and **zero** invented facts presented as Evidence.

**NO-GO:** playbook-like tool use, invented Evidence, quality no better than a hardcoded workflow, or this setup is not worth operating.

A GO does not authorize production SIEM integration.

| id | type | expected_disposition_hint | usable | agentic | invented_evidence | actual |
|---|---|---|---|---|---|---|
| 01 | suspicious_login | likely TP identity | no | no | no | `error` (15 tool-call cap). Session had the right alice SG/US + `weird.exe` trail, then kept fanning out (`query_host` does not exist). |
| 02 | suspicious_login | likely FP office VPN | yes | yes | no | `false_positive` / `no_action`. Known-office `10.0.0.8` / `bob-win` / known-good `outlook.exe`. |
| 03 | suspicious_login | branch: auth then process | yes | yes | no | `true_positive` / `recommend_containment`. Auth geo split → `impossible_travel` → `weird.exe` hash `aa`. |
| 04 | malware_process | likely TP endpoint | no | no | no | `error` (15 tool-call cap). Process `aa` on `alice-mbp` then extra invented-shaped tools (`query_hash`) and retries. |
| 05 | malware_process | likely FP / insufficient | no | no | no | `error` (15 tool-call cap). Started on `bob-win` / hash `bb`, then wandered into alice/`aa`. |
| 06 | malware_process | branch: process then auth | yes | yes | no | `true_positive` / `recommend_containment`. `weird.exe` first, then alice impossible-travel auth. |
| 07 | noisy_scanner | benign true positive | yes | yes | no | `benign_true_positive` / `monitor`. `scanner-svc` / `scanner-host` / known-good `backup-agent`. |
| 08 | noisy_scanner | benign | yes | yes | no | `benign_true_positive` / `no_action`. Same world, host-scoped. Empty `query_ip` for `10.0.0.50` is true (IP table has no that row). |
| 09 | suspicious_login | insufficient_evidence | yes | yes | no | `false_positive` / `no_action`. User `nobody` empty in every dataset. Hint was `insufficient_evidence`; close/no-action is still usable. Prompt calling it a Test Alert leaked into the write-up. |

Hints are for scorers only. Do not paste them into Pi.

## Verdict

**Thin GO:** 6/9 usable, 6/9 agentic, 0 invented Evidence on the six finished results.

The three misses (01, 04, 05) are the 15-call cap, not hallucinated logs. Flash issued parallel/retry queries (including tool names that are not in the MCP). 01 in particular was on a correct TP path and never wrote a result.

This GO does **not** authorize production SIEM. Next: raise or batch the tool cap, or stop the model from probing missing tools, before treating 01/04/05 as re-runs.
