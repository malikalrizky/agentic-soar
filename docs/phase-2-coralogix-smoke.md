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

1. `PI_CLI` points at Pi 1.0.4+ `dist/bundle/cli.js` (not the 0.87.1 pin).
2. Gerbang up (`gerbang start` / login as usual).
3. ADC can call Secret Manager (`gcloud auth application-default login` on a laptop; GCE SA on a VM).
4. GSM secret exists as JSON: `{"apiKey":"…","endpoint":"https://api.<region>.coralogix.com"}`.
5. In the shell that will run Bun:

```bash
export TOOL_LAYER_GCP_PROJECT=…   # GCP project id
export TOOL_LAYER_CORALOGIX_SECRET=…  # secret id (name), not the key value
```

Do not put Coralogix keys in Pi env, `createPiClient` env, or `.pi/mcp.json` `env`.

## Step B — direct call (no Pi)

Throwaway one-shot from the repo root. Adjust the DataPrime `query` if your tenant rejects it; empty hits on HTTP 200 still pass.

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

Expect stdout `ok: true` and one stderr JSON audit line (`tool`, `argHash`, `durationMs`, `status`). Reject if the key or full query appears there.

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
