# Phase 1 design (isolated POC)

**Status:** accepted (Phase 1). Phase 0 is how we drive Pi, not whether this POC shape is right.

Phase 1 answers: **Can Pi function as a useful SOC investigation engine?** It does not answer whether production SIEM, vendor APIs, or an MCP Gateway work.

## Architecture

```text
Test Alert (CLI or POST /investigate)
        ↓
Small integration service
        ↓
pi --mode rpc  (one child; one Investigation at a time)
        ↓
Local stdio MCP → Telemetry Datasets over one Test World
        ↓
Investigation Result (JSONL/files) + Pi session file (review only)
```

The integration service receives a Test Alert, starts one Investigation, gives Pi the alert context, and stores the Investigation Result. It is not a SOAR, workflow engine, or production intake path.

## What is in

- One Pi RPC child; native JSONL session files for review (no resume on failure)
- Small Bun ≥ 1.4.2 TypeScript integration service (`RpcClient`); Pi child is still the Node `pi` CLI
- Local/test trigger (HTTP or CLI)
- One Test World; Telemetry Datasets are queries over it
- Local stdio MCP, **direct** exposure (Pi’s default MCP exposure is `codemode`, which hides tools from the model)
- Built-in `bash` / `edit` / `write` disabled — Pi has no permission sandbox
- Unattended Investigation; read-only; no containment

## What is out

Production Coralogix/SIEM, production security APIs and credentials, production webhooks, CrowdStrike, Wiz, MCP Gateway, PostgreSQL, n8n, queues, multiple Pi workers, Kubernetes, HA, durable Incident state, knowledge base, automated response.

## Investigation (what we are actually testing)

Not “Pi can call an API.” The path must be able to change after Evidence returns:

Alert → missing info → query a Telemetry Dataset → Evidence → choose next query → correlate → Alert Disposition + Recommended Posture → Investigation Result.

A fixed tool A→B→C sequence is a failed experiment, even if the mock APIs look like CrowdStrike.

## Result schema (minimum)

- `alert_disposition`: `true_positive` | `false_positive` | `benign_true_positive` | `insufficient_evidence` | `error`
- `recommended_posture`: `no_action` | `monitor` | `needs_human` | `recommend_containment`
- `confidence`: `low` | `medium` | `high` (analyst-facing, not calibrated)
- `model_id` (whatever Pi was already configured to use; frozen for the nine cases)
- `summary`
- `supporting_evidence` (cited; assumptions listed separately)
- `investigation_steps`
- `entities`
- `recommended_next_step`

## Corpus and scoring

Nine Test Alerts: three types (suspicious login/identity; endpoint/process; noisy benign), mixing TP, FP, and at least one that must branch. Engineering checks that after a typical first query, at least two different next steps are reasonable.

SOC (or that hat) scores usable Alert Disposition + cited Evidence. Engineering scores agentic vs playbook.

**GO:** ≥6/9 usable, ≥6/9 agentic, and **zero** invented facts presented as Evidence (re-run after a fix if that happens).

**NO-GO:** rigid/playbook tool use, invented Evidence, quality no better than a hardcoded workflow, or even this small setup is not worth operating.

Crash or cap: Investigation is `error`; re-inject as a new Investigation. No resume, no queue.

Hard cap per Investigation: **10 minutes wall clock or 15 tool calls**, whichever first.

A GO does **not** authorize production SIEM or vendor integration.

## Future (not designed in Phase 1)

Phase 3 target is now Pi → Security Tool Layer → Secret Manager → vendor APIs (`pre-brainstorm.md`). MCP Gateway is deferred. Evaluation is still Phase 2. Incident/response/scale/knowledge stay later.
