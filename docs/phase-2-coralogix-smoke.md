# Phase 2: first live Coralogix smoke

Ops checklist. Not an authorization to raise the tool cap, re-score Phase 1, or build Phase 3. Design: [[phase-2-security-tool-layer]]. ADR: [[0005-phase-2-security-tool-layer]].

Committed `.pi/mcp.json` keeps `"disabled": true` on `security`. Enable only in a **local** edit; do not push `disabled: false`.

## Pass bar

| Step | Pass |
|---|---|
| B — direct `handleCoralogixSearch` | `ok: true` (empty `hits` is fine); stderr audit has `argHash`, no query text, no API key |
| Fail-closed | Wrong/missing `TOOL_LAYER_*` → `secret_unavailable` (or tool error), **not** `hits: []` |
| C — host Investigation | Result/session shows `coralogix_search` / `mcp__security__coralogix_search`; Evidence cites it; no key in result/session/audit |
| Revert | Local mcp edit restored to `disabled: true` |

## Preflight

1. `PI_CLI` points at Pi 1.0.4+ `dist/bundle/cli.js` (not the 0.87.1 pin). If `PI_CLI` is unset, the repo's pinned `node_modules` copy (0.87.1) is used — that version does not load `.pi/mcp.json`, so MCP tools silently never appear in the session.
2. Gerbang up (`gerbang start` / login as usual).
3. ADC can call Secret Manager (`gcloud auth application-default login` on a laptop; GCE SA on a VM).
4. GSM secret exists as JSON: `{"apiKey":"…","endpoint":"https://api.<region>.coralogix.com"}`.
4b. Pi trusts this project (`~/.pi/agent/trust.json` maps the repo path to `true`). Without it Pi ignores `.pi/mcp.json` entirely — `pi mcp list` prints "ignored because the project is not trusted". Verify with `pi mcp list` from the repo root: both `telemetry` and `security` should show `connected`.
5. In the shell that will run Bun:

```bash
export TOOL_LAYER_GCP_PROJECT=…   # GCP project id
export TOOL_LAYER_CORALOGIX_SECRET=…  # secret id (name), not the key value
```

Do not put Coralogix keys in Pi env, `createPiClient` env, or `.pi/mcp.json` `env`.

## Step B — direct call

Throwaway one-shot from the repo root. Adjust the DataPrime `query` if your tenant rejects it; empty hits on HTTP 200 still pass. The DataPrime query is a plain string (`.source`-style leading dot is invalid — use `source logs | limit 10`).

```bash
bun <<'EOF'
import { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import { handleCoralogixSearch } from "./src/security.ts";

const project = process.env.TOOL_LAYER_GCP_PROJECT?.trim();
const secretId = process.env.TOOL_LAYER_CORALOGIX_SECRET?.trim();
if (!project || !secretId) throw new Error("export TOOL_LAYER_GCP_PROJECT and TOOL_LAYER_CORALOGIX_SECRET");

const client = new SecretManagerServiceClient();
async function getSecret() {
  const [version] = await client.accessSecretVersion({
    name: `projects/${project}/secrets/${secretId}/versions/latest`,
  });
  const data = version.payload?.data;
  if (data == null) throw new Error("empty secret payload");
  return typeof data === "string" ? data : Buffer.from(data).toString("utf8");
}

const end = new Date();
const start = new Date(end.getTime() - 15 * 60 * 1000);
const out = await handleCoralogixSearch(
  {
    query: "source logs | limit 10",
    start: start.toISOString(),
    end: end.toISOString(),
    limit: 5,
  },
  { getSecret, fetch },
);
console.log(JSON.stringify(out, null, 2));
EOF
```

Expect stdout `ok: true` and one stderr JSON audit line (`tool`, `argHash`, `durationMs`, `status`, plus `httpStatus`/`errorCode` on failure). Reject if the key or full query appears there.

Note: the Coralogix DataPrime HTTP API responds with **NDJSON** (`application/x-ndjson`) — separate JSON lines for `queryId`, `result` (with `result.results`), and `statistics`. The parser in `src/security.ts` splits lines and extracts hits from the `result.results` line; single-JSON responses still work. Regression tests: `tests/security.test.ts` ("NDJSON body…" / "empty NDJSON body…").

## Fail-closed (once)

Unset both `TOOL_LAYER_*` vars (or point `TOOL_LAYER_CORALOGIX_SECRET` at a missing secret id) and re-run the Step B snippet.

Expect `ok: false` with `error.code` `secret_unavailable`, or a thrown missing-env error before the call. Never treat empty hits as success here.

## Step C — host Investigation

1. Locally set `.pi/mcp.json` → `mcpServers.security.disabled` to `false`. Leave `telemetry` on.
2. Write a one-off alert JSON somewhere outside git (or `/tmp`), e.g. ask for a short Coralogix lookback and an Investigation Result. Do not commit it.
3. Run:

```bash
bun src/cli.ts /path/to/local-smoke-alert.json
```

4. Check `var/results/` and the session sidecar: tool name used, Evidence cites tool output, no API key strings.
5. Restore `"disabled": true` (or discard the local mcp edit).

Flash may also call Test World `query_*`. That does not fail the smoke if Coralogix was called and cited.

## After smoke — jot (not a full eval)

If Step C passed, note in a few lines (ticket or personal notes):

- Did Flash invent tool names or fan out toward the 15-call cap?
- Was the DataPrime query usable as Evidence, or too coarse?
- Any key-shaped strings in session/result/audit?

### 2026-10-20 live run (passed)

- Step B: `ok:true`, HTTP 200, audit stderr clean (no key, no query text). Fail-closed: `secret_unavailable` ✓. Step C: Flash called `mcp__telemetry__query_related_alerts` then `mcp__security__coralogix_search` with a real DataPrime query; Evidence cited `dataset: coralogix`; no key-shaped strings. No tool-name invention, no runaway fan-out (2 calls total). DataPrime query was usable as Evidence (search + zero-hit statement), not too coarse.
- Environment used: project `prj-dev-securityf79f29`, secret `tool-layer-coralogix-secret` (asia-southeast2), endpoint `https://api.ap3.coralogix.com` (verified live, HTTP 200).
- Found & fixed during the run: (1) DataPrime HTTP returns NDJSON, not single JSON — parser split added in `src/security.ts` + 2 regression tests; (2) unset `PI_CLI` falls back to the 0.87.1 pin which silently ignores `.pi/mcp.json` — set `PI_CLI` to the 1.0.4+ bundle (see Preflight); (3) project must be trusted in `~/.pi/agent/trust.json` or `.pi/mcp.json` is ignored.

### 2026-10-20 GCE VM run (DEVSECOPS-3089, passed with one model-quality finding)

Host: `dev-test-opsagent-001` (Ubuntu 20.04, asia-southeast2-a), SA `dev-test-opsagent-sa@prj-dev-securityf79f29.iam.gserviceaccount.com`, access via `gcloud compute ssh --tunnel-through-iap`. SA has `roles/secretmanager.secretAccessor` on `tool-layer-coralogix-secret` (scoped to that secret) and `roles/aiplatform.user` on the project.

- Step B on VM: `ok:true`, HTTP 200 via SA identity (no ADC, no key file). Fail-closed: `secret_unavailable` ✓.
- Step C on VM: `PI_PROVIDER=google-vertex` runs Pi's builtin Vertex provider against `gemini-2.5-flash` (region `asia-southeast1`; the project is region-restricted — us-central1 models 404). Investigation ran end-to-end and called every MCP tool, including `mcp__security__coralogix_search` twice.
- Model-quality finding (not a plumbing failure): gemini sent `query:"smoke_test"` — a raw keyword, not valid DataPrime — which Coralogix correctly rejected (HTTP 400 → `vendor_error`). The laptop run (DeepSeek) wrote valid DataPrime. The Tool Layer behaved correctly: secret fetch via SA worked, vendor call executed, error mapped to a structured code, Investigation degraded to `insufficient_evidence` instead of inventing results. Candidate follow-up: teach the model to write DataPrime (prompt example) or accept raw terms.
- Ops notes: Pi and the MCP servers share the OS user (both spawned from the same Pi child); env needed on the VM: `TOOL_LAYER_GCP_PROJECT`, `TOOL_LAYER_CORALOGIX_SECRET`, `PI_PROVIDER=google-vertex`, `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION=asia-southeast1`, `PI_CLI` → 1.0.4+ bundle (Node ≥22 required for `enableCompileCache`; Node 20 fails at import). `pi` symlinked to `/usr/local/bin/pi`, Bun at `~/.bun/bin`. Vertex quota for Anthropic models (`claude-haiku-5-5`) is zero on this project — requests need a quota increase before use; gemini-2.5-flash works today.
- Re-run after the `invalid_query` fix (commit `3038812`): gemini now self-corrects in-session — raw keyword → `filter "x"` → `filter text("x")` → `filter $m.message contains "x"` → `filter $m.message ~= "x"`, each retry guided by the vendor compile error. It converged toward valid syntax but never hit the exact form (`filter $m.message == 'x'` is the correct operator — verified live, HTTP 200 with a keypath warning on this dataset). Disposition stayed `benign_true_positive` (medium) without inventing evidence. Takeaway: the feedback loop works; a one-line operator hint (`==`, no `contains`/`~=`) in the prompt example would likely close the gap.

Full agent evaluation stays deferred. Do not re-score the nine Phase 1 alerts unless someone asks.

## Appendix — GSM bootstrap

Laptop:

```bash
gcloud auth application-default login
# create secret (once); payload = JSON with apiKey + endpoint
# grant your user (or the ADC principal) secretmanager.secretAccessor on that secret
```

VM target later: GCE attached SA with `secretmanager.secretAccessor` on **one** secret; no JSON key files in the repo.

Rotation: new GSM version; restart the MCP process to drop the in-memory cache. Revoke: disable the version in GSM and restart.
