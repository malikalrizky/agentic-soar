# Phase 3 talks to vendors through a Security Tool Layer MCP, not MCP Gateway and not in-process Pi tools

Phase 3 adds real read-only Coralogix via a **new stdio MCP process** in this repo. That process fetches credentials from GCP Secret Manager (ADC on a laptop; GCE instance SA on a VM) and calls Coralogix. Pi keeps the Phase 1 RPC host, `--no-builtin-tools`, and the Test World MCP. Vendor keys never go in Pi env, `.pi/mcp.json`, sessions, or tool results.

Native MCP on Pi 1.0.4 is the tool plane. MCP Gateway stays deferred. In-process `registerTool()` is rejected for vendor auth because it shares the Pi process.

The layer is not a SOAR, workflow engine, or policy engine. Writes, extra vendors, HTTP MCP, and a dedicated OS user wait.

**Status:** accepted

**Considered Options:**
- Pi → MCP Gateway → vendors (deferred)
- Pi `registerTool()` / extension that holds vendor keys (rejected)
- Pi → Security Tool Layer (stdio MCP) → Secret Manager → Coralogix read (chosen)

**Consequences:**
- Phase 1 isolation still holds until the new MCP is configured; mock and prod must not share tool names.
- Same OS user as Pi can still hit Secret Manager if we ever enable bash or a GSM tool. `--no-builtin-tools` is part of the boundary.
- `PI_CLI` must be the 1.0.4+ JS entry, not the 0.87.1 npm pin.

Design: [[phase-3-security-tool-layer]].
