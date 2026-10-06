# Phase 3 Architecture Update — Security Tool Layer

## Important Architecture Change

We are refining the **Phase 3** architecture.

Previously, we were considering MCP Gateway / external integration mechanisms as the primary way for Pi to access security systems.

We now want to pursue and validate this architecture instead:

```text
Pi
 ↓
Security Tool Layer
 ↓
GCP Secret Manager
 ↓
Security APIs
```

The **Security Tool Layer** is a thin security/integration boundary. It is NOT another SOAR or workflow engine.

MCP Gateway is **deferred** and is not part of the current design.

The overall roadmap does not change:

```text
Phase 0 → Validate Pi as the SOAR core
Phase 1 → Isolated agentic investigation POC
Phase 2 → Agent evaluation
Phase 3 → Real integrations + secure tool layer
Phase 4 → Controlled automated response
Phase 5 → Production deployment & scale
Phase 6 → Knowledge / advanced agent architecture
```

Phase 1 and Phase 2 are unchanged.

---

## Current Environment

- Pi is **planned** to run on a VM; it is not deployed yet.
- GCP Secret Manager is already available.
- Most security integrations use long-lived API credentials.
- Future integrations may include Coralogix, CrowdStrike, Wiz, Cloudflare, Google APIs, etc.
- Long term, the agent may perform autonomous security actions.

---

## Brainstorm Objective

Determine the **smallest secure implementation** of the Security Tool Layer.

Do not reopen the overall decision unless you find a fundamental flaw.

Focus on:

### 1. Security Tool Layer responsibilities

Determine what belongs here:

- tool execution
- API authentication
- GCP Secret Manager access
- request validation
- response validation
- secret redaction
- authorization
- audit logging
- retries/timeouts
- rate limiting
- idempotency
- error handling

Classify each as:

```text
MUST HAVE NOW
FUTURE
NOT PART OF THIS LAYER
```

Avoid unnecessary infrastructure.

### 2. Pi integration

Determine the best way for Pi to invoke the Security Tool Layer:

- custom tools
- extensions
- SDK
- RPC
- HTTP/gRPC
- another mechanism

Verify against current Pi documentation/source.

Pi **1.0.4+** has native MCP (`.pi/mcp.json`, stdio/HTTP, `exposure: direct` required or tools stay hidden in `codemode`). Phase 1 used that for local telemetry. **MCP Gateway is still deferred.** Do not treat native MCP as a Gateway, and do not treat “tool call” as the model issuing raw HTTP. From the model, MCP and Pi `registerTool` are both tool calls; the difference is where the handler runs. Prefer Pi MCP → Security Tool Layer (separate process, secrets stay there) over in-process Pi tools that hold vendor credentials.

### 3. Secret management

Determine how the Tool Layer should:

- authenticate to GCP Secret Manager
- retrieve credentials
- cache credentials, if appropriate
- handle rotation
- handle revocation
- handle Secret Manager failures

Because Pi is planned for a VM, evaluate the appropriate GCP-native identity mechanism for that VM. Do not assume the identity approach is already decided.

### 4. Secret exposure

Pi should preferably never receive raw API credentials.

Determine how to prevent secrets from appearing in:

- Pi session/history
- LLM context
- tool results
- logs
- errors
- traces
- audit records

Treat redaction as **defense-in-depth**, not the primary secret-management mechanism.

### 5. Tool design

Prefer narrowly scoped tools:

```text
crowdstrike_get_device()
coralogix_search()
wiz_get_finding()
```

over:

```text
arbitrary_http_request()
```

Explain the security and maintainability implications.

### 6. Future autonomous response

Eventually:

```text
Pi reasoning
 ↓
Tool request
 ↓
Authorization / policy
 ↓
Security Tool Layer
 ↓
Security action
```

Determine where future capabilities should live:

- RBAC
- action allowlists
- approval requirements
- risk controls
- rate limits
- kill switch
- audit
- idempotency

Do not build a complex policy engine yet unless justified.

### 7. Failure handling

Determine safe behavior for:

- Secret Manager unavailable
- missing/expired credentials
- API 401/403
- API rate limits
- API timeout
- malformed tool responses
- invalid tool requests
- unauthorized actions

### 8. Keep the layer thin

We do NOT want:

```text
Pi
 ↓
Security Platform
 ↓
SOAR
 ↓
Workflow Engine
 ↓
Policy Engine
 ↓
Integration Engine
 ↓
API Gateway
```

We want approximately:

```text
Pi
 ↓
Security Tool Layer
 ↓
Security APIs
```

with GCP Secret Manager used for credentials.

Every additional component must justify its existence.

---

## Phase 3 Target

The minimum Phase 3 architecture should be evaluated around:

```text
Pi
 ↓
Security Tool Layer
 ↓
GCP Secret Manager
 ↓
Real Security APIs
```

Start with **read-only integrations**.

Phase 1 remains completely isolated:

```text
Pi
 ↓
Mock Security Tools
 ↓
Representative Telemetry
```

No production credentials, production Coralogix, MCP Gateway, PostgreSQL, or distributed infrastructure in Phase 1.

---

## Required Output

Give me:

1. **Recommended Phase 3 architecture**
2. **Security Tool Layer responsibilities**
3. **Pi integration approach**
4. **Secret lifecycle**
5. **Trust boundaries**
6. **Threat model**
7. **Minimum implementation**
8. **Future autonomous-response evolution**
9. **Risks/tradeoffs**
10. **KEEP / CHANGE / DEFER / REJECT decisions**

Challenge the implementation details, but do not reopen the overall Security Tool Layer decision unless there is a fundamental flaw.

The objective is:

> **Build the smallest secure boundary that keeps credentials and privileged security API access outside Pi while allowing Pi to operate as the Agentic SOAR core.**