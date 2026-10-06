# Visuals

Committed diagrams for GitLab / GitHub / Cursor preview. Local HTML: open [`visuals/index.html`](visuals/index.html).

- [Roadmap](#roadmap)
- [Phase 1 runtime](#phase-1-runtime)
- [Codebase](#codebase)
- [POC score](#poc-score)
- [Phase 2 tool layer](#phase-2-tool-layer)

Source numbers: [`phase-1-scoring.md`](phase-1-scoring.md), [`phase-1-result.md`](phase-1-result.md). Architecture intent: [`pre-brainstorm.md`](../pre-brainstorm.md).

## Roadmap

```mermaid
graph LR
  P0[Phase 0 Pi as core]
  P1[Phase 1 isolated POC]
  P2[Phase 2 tool layer]
  P3[Phase 3 response]
  P4[Phase 4 scale]
  P5[Phase 5 knowledge]
  P0 --> P1
  P1 --> P2
  P2 --> P3
  P3 --> P4
  P4 --> P5
```

Eval (accuracy, cost, analyst agreement) is **deferred**, not a numbered phase. Run it after real vendor queries exist.

Phase 1 is a **thin GO**. That does not authorize production SIEM.

## Phase 1 runtime

```mermaid
graph TB
  Alert[Test Alert CLI or POST]
  Host[Bun host]
  Gerbang[Gerbang proxy]
  Pi[Pi 1.0.4 RPC child]
  MCP[stdio MCP direct]
  World[Test World]
  Out[result JSON]
  Alert --> Host
  Host --> Pi
  Gerbang --> Pi
  Pi --> MCP
  MCP --> World
  Pi --> Out
```

Frozen model: `dk/openrouter/deepseek/deepseek-v4.1-flash`. Caps: 10 min or 15 tool calls.

MCP here is **Pi native** (`.pi/mcp.json`). Not MCP Gateway.

## Codebase

```mermaid
graph TB
  subgraph entry
    cli[cli.ts]
    http[http.ts]
  end
  subgraph investigation
    inv[investigate.ts]
    schema[schema.ts]
    write[write-result.ts]
  end
  subgraph piChild
    host[pi-host.ts]
    gbg[gerbang.ts]
    ext[gerbang-dk.mjs]
  end
  subgraph telemetry
    mcp[mcp-server.ts]
    world[world.ts]
  end
  cli --> inv
  http --> inv
  inv --> host
  inv --> schema
  inv --> write
  host --> gbg
  host --> ext
  mcp --> world
```

Host is Bun. Pi child is Node. `RpcClient` always `spawn(node, [PI_CLI, ...])`.

## POC score

GO bar: ≥6/9 usable, ≥6/9 agentic, zero invented Evidence.

```mermaid
graph LR
  Yes[usable 6]
  No[cap error 3]
```

| id | usable | agentic | invented | actual |
|---|---|---|---|---|
| 01 | no | no | no | cap; alice TP path unfinished |
| 02 | yes | yes | no | FP office VPN |
| 03 | yes | yes | no | TP auth then process |
| 04 | no | no | no | cap |
| 05 | no | no | no | cap; wandered |
| 06 | yes | yes | no | TP process then auth |
| 07 | yes | yes | no | BTP scanner |
| 08 | yes | yes | no | BTP scanner |
| 09 | yes | yes | no | empty nobody; labeled FP |

## Phase 2 tool layer

```mermaid
graph TB
  Pi[Pi native MCP]
  Layer[Security Tool Layer]
  SM[GCP Secret Manager]
  APIs[Vendor APIs]
  Pi --> Layer
  Layer --> SM
  Layer --> APIs
```

MCP Gateway deferred. Secrets stay in the layer, not in Pi sessions. Narrow tools, not `arbitrary_http_request`.
