# Phase 1 drives Pi through CLI RPC, not the in-process SDK and not a Python-only host

Pi’s CLI already loads MCP from `.pi/mcp.json`. The TypeScript SDK does not load MCP unless the host adds `createMcpExtension()`. RPC is the documented long-lived, language-agnostic control plane (`pi --mode rpc`). A small host can spawn one Pi child, prompt, wait for `agent_settled`, and abort on our caps. JSON/print mode cannot accept later commands (including abort). In-process SDK couples our service to Node, session internals, and extension wiring we do not need yet.

Python is a valid RPC client (docs include a minimal example) but is not required. Prefer the maintained TypeScript `RpcClient` if the integration service is Node/Bun; any language is fine if someone already owns a JSONL client.

**Status:** accepted
