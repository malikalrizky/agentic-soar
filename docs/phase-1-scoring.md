# Phase 1 scoring

Nine Test Alerts. Score after each `bun src/cli.ts testdata/alerts/NN.json`.

**GO:** ≥6/9 usable, ≥6/9 agentic, and **zero** invented facts presented as Evidence.

**NO-GO:** playbook-like tool use, invented Evidence, quality no better than a hardcoded workflow, or this setup is not worth operating.

A GO does not authorize production SIEM integration.

| id | type | expected_disposition_hint | usable | agentic | invented_evidence |
|---|---|---|---|---|---|
| 01 | suspicious_login | likely TP identity | | | |
| 02 | suspicious_login | likely FP office VPN | | | |
| 03 | suspicious_login | branch: auth then process | | | |
| 04 | malware_process | likely TP endpoint | | | |
| 05 | malware_process | likely FP / insufficient | | | |
| 06 | malware_process | branch: process then auth | | | |
| 07 | noisy_scanner | benign true positive | | | |
| 08 | noisy_scanner | benign | | | |
| 09 | suspicious_login | insufficient_evidence | | | |

Hints are for scorers only. Do not paste them into Pi.
