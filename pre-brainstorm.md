I want to design and document an in-house agentic SOAR for SOC alert triage and investigation.

**Do not implement anything yet.** This task is for architecture discovery, technical validation, and a phased implementation plan.

The most important principle is to avoid over-engineering before we prove that the core agentic investigation approach works.

---

# 1. Overall Objective

The long-term vision is:

```text
SIEM / Coralogix
        ↓
Agentic SOAR
        ↓
Pi
        ↓
Security Tool Layer
        ↓
GCP Secret Manager
        ↓
Security APIs
(CrowdStrike / Wiz / Coralogix / etc.)
```

MCP Gateway is deferred. Pi 1.0.4+ has native MCP; Phase 3 still keeps vendor credentials out of Pi via a thin Security Tool Layer.

The goal is to determine whether Pi can serve as the AI investigation engine behind an in-house SOC automation platform.

However, **do not design or implement the entire SOAR now**.

The immediate goal is to validate the smallest useful architecture that can answer:

> Can Pi perform meaningful, multi-step SOC investigation against real or representative security telemetry and produce a useful investigation result?

---

# 2. Scope Separation

Clearly separate:

### Current scope
- Phase 0: Architecture / Pi integration discovery
- Phase 1: SOC investigation POC

### Future vision
- Phase 2 onward

Do not spend implementation-level effort designing future phases. They should remain architectural/high-level only.

The project must have explicit **GO / NO-GO gates** so that we can stop if Pi does not provide enough value.

---

# 3. Phase 0: Pi Integration Discovery

First research Pi's actual current capabilities using authoritative sources such as its official repository, documentation, source code, SDK documentation, RPC documentation, and relevant issues/discussions where necessary.

Do not assume APIs or capabilities that have not been verified.

Determine:

### Pi runtime
- How Pi is normally run.
- Whether Pi can run as a long-lived process/service.
- How external applications can start, control, or communicate with Pi.
- Available SDK/API/RPC interfaces.
- How sessions are created, resumed, and persisted.
- Whether multiple investigations can be handled safely.
- Whether Pi supports concurrent sessions/workloads.
- What state Pi itself maintains.
- What happens if the Pi process restarts.

### External integration
Determine the simplest reliable mechanism for:

```text
External system
      ↓
Pi
      ↓
Investigation
      ↓
Structured result
```

Specifically determine:

- How an external service can submit an investigation request.
- How alert context can be passed to Pi.
- How the investigation can be started.
- How progress/session state is maintained.
- How the final result can be retrieved.
- Whether RPC, SDK, subprocess, HTTP, or another mechanism is most appropriate.

Do not assume Python is required.

Python may be a good candidate for the integration service, but explicitly compare the simplest viable approaches, including the language/runtime that Pi itself supports best.

Evaluate based on:

- simplicity
- maintainability
- reliability
- Pi compatibility
- operational complexity
- development effort
- extensibility

Challenge the Python assumption if another approach is materially better.

### MCP

Determine Pi's actual MCP capabilities, including:

- MCP support
- local MCP servers
- remote MCP servers
- supported transport mechanisms
- authentication considerations
- tool invocation behavior
- whether Pi can dynamically use multiple tools during an investigation

Pi **1.0.4+** has native MCP (`.pi/mcp.json`, stdio/HTTP, `exposure: direct` or tools stay hidden in `codemode`). Phase 1 used that for local telemetry.

Long-term, prefer:

```text
Pi (native MCP / tool calls)
 ↓
Security Tool Layer
 ↓
GCP Secret Manager
 ↓
CrowdStrike / Wiz / Coralogix / other security systems
```

MCP Gateway is **deferred**. From the model, MCP and Pi `registerTool` are both tool calls; the difference is where the handler runs. Prefer Pi MCP → Security Tool Layer (separate process, secrets stay there) over in-process Pi tools that hold vendor credentials.

**MCP connectivity itself is not the primary Phase 1 success criterion.** The question is whether Pi can use security telemetry/tools effectively during investigation.

---

# 4. Phase 0 Deployment Philosophy

For Phase 0 and Phase 1, prefer the simplest possible deployment.

The default hypothesis should be:

```text
Single Pi process/server
+
Native Pi session state
+
Small integration service
```

Do **not** introduce PostgreSQL, distributed queues, multiple Pi workers, or other distributed infrastructure unless the research shows that they are actually required for the POC.

Do not assume Pi needs PostgreSQL for its own session state.

However, explicitly verify Pi's actual persistence/session model before finalizing this decision.

The long-term production architecture may require:

- durable external state
- PostgreSQL or another database
- multiple Pi workers
- queues
- concurrency management
- recovery mechanisms
- HA

But these are future concerns.

For Phase 1, optimize for **learning speed and architectural simplicity**, not production scale.

---

# 5. Phase 1: SOC Investigation POC

The Phase 1 POC should validate this flow:

```text
Coralogix / representative SIEM alert
              ↓
      Small integration service
              ↓
             Pi
              ↓
      Security telemetry/tools
              ↓
     Multi-step investigation
              ↓
      Structured investigation result
```

The integration service should remain intentionally small.

It should:

1. Receive an alert.
2. Normalize/prepare the alert context.
3. Start or invoke the Pi investigation.
4. Provide Pi with the necessary context.
5. Allow Pi to access the required security telemetry/tools.
6. Receive the investigation result.
7. Log/store the result sufficiently for evaluation.

It must **not** become a general-purpose SOAR engine.

Do not build:

- generic workflow builders
- drag-and-drop orchestration
- a custom n8n replacement
- complex incident-management systems
- large-scale distributed infrastructure

---

# 6. Phase 1 Investigation Test

Use real or representative SOC alerts.

Prefer several representative alert types rather than one carefully constructed example.

The investigation should test whether Pi can:

1. Understand the initial alert.
2. Determine what information is missing.
3. Decide which telemetry/tools are relevant.
4. Perform multiple investigation steps.
5. Use the results of one tool call to determine subsequent actions.
6. Adapt its investigation based on evidence.
7. Correlate information across multiple sources.
8. Distinguish relevant from irrelevant evidence.
9. Reach a defensible conclusion.
10. Explain why it reached that conclusion.
11. Produce a structured result for a SOC analyst.

The investigation must **not** simply follow a hardcoded sequence such as:

```text
Alert
→ call tool A
→ call tool B
→ call tool C
→ verdict
```

That would only prove workflow automation.

The important experiment is whether Pi can perform **agentic investigation**, where the next investigation step depends on evidence discovered during the previous step.

---

# 7. Phase 1 Output

Define a structured investigation result containing at minimum:

```text
Verdict
Confidence
Summary
Supporting evidence
Investigation steps
Relevant entities / indicators
Recommended next step
```

The exact schema can be proposed during the design.

The output should be useful to a SOC analyst reviewing the alert.

Phase 1 should remain **read-only**.

No autonomous destructive or security-impacting remediation should be performed.

For example, Pi may recommend:

> Isolate endpoint X.

But it should not actually isolate the endpoint in Phase 1.

---

# 8. Phase 1 Success Criteria

Define measurable/testable success criteria.

At minimum:

### Integration
- A real or representative SIEM alert can reach Pi.
- Pi can maintain the investigation context.
- Pi can access the required security telemetry/tools.
- Pi can return a structured result.

### Investigation capability
- Pi performs multi-step investigations.
- Tool calls are selected based on investigation context.
- Pi adapts based on returned evidence.
- Pi can correlate evidence across multiple sources.
- Pi does not simply execute a predefined workflow.

### Investigation quality
- Verdict is useful to a SOC analyst.
- Supporting evidence is traceable.
- Conclusions are reasonably defensible.
- Pi distinguishes evidence from assumptions.
- Pi does not invent unsupported facts.

### Operational practicality
- The architecture is simple enough to operate.
- Investigation latency is reasonable.
- Resource consumption is understood.
- Failures can be detected and handled at a basic level.

Do not turn Phase 1 into a production-readiness or model-evaluation program. That work is Phase 2 (accuracy, evidence quality, cost, analyst agreement).

---

# 9. Phase 1 GO / NO-GO

At the end of Phase 1, explicitly answer:

> **Is Pi sufficiently capable of acting as a SOC investigation engine to justify building the rest of the agentic SOAR around it?**

Define clear GO / NO-GO criteria.

Examples of NO-GO conditions:

- Pi cannot reliably perform multi-step investigation.
- Tool usage is too rigid or unreliable.
- Results are consistently unsupported or hallucinated.
- Investigation quality is not materially better than deterministic workflows.
- Operational complexity outweighs the benefit.
- Latency/cost is unacceptable.

Do not assume the project must continue.

The purpose of Phase 1 is to validate the hypothesis.

---

# 10. Future Architecture: High Level Only

If Phase 1 succeeds, describe the possible future roadmap at a high level.

### Phase 2: Agent Evaluation

Evaluate:

- verdict accuracy
- false positives / false negatives
- evidence quality
- investigation completeness
- hallucinations / unsupported claims
- tool-selection quality
- latency
- cost
- analyst agreement
- regression testing
- representative evaluation datasets

---

### Phase 3: Real integrations + Security Tool Layer

Phase 1 and Phase 2 stay as written. Phase 3 is **not** a control plane or a second SOAR.

```text
Pi
 ↓
Security Tool Layer
 ↓
GCP Secret Manager
 ↓
Real Security APIs
```

The Security Tool Layer is a thin security/integration boundary. Start **read-only**. Pi should preferably never receive raw API credentials.

Pi is planned to run on a VM (not deployed yet). GCP Secret Manager is already available. Most integrations use long-lived API credentials.

Classify each responsibility as MUST HAVE NOW / FUTURE / NOT PART OF THIS LAYER:

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

Prefer Pi MCP → Security Tool Layer over in-process tools with vendor credentials. Evaluate VM identity for Secret Manager; do not assume it is decided. Redaction is defense-in-depth, not the secret store.

Prefer narrow tools (`crowdstrike_get_device`, `coralogix_search`) over `arbitrary_http_request()`.

Do not build:

```text
Pi → Security Platform → SOAR → Workflow Engine → Policy Engine → Integration Engine → API Gateway
```

Every extra component must justify itself.

Durable incident state (lifecycle, escalation, human approval, investigation history, whether PostgreSQL belongs) is **not** Phase 3. That stays with later production/control-plane work. Pi session files and SOAR incident state remain separate; PostgreSQL is not Pi’s session backend.

---

### Phase 4: Controlled Automated Response

Introduce carefully controlled remediation.

Maintain a strict separation between:

```text
LLM reasoning
      ≠
authorization/policy
      ≠
security action
```

Pi can recommend an action, but deterministic authorization/policy should determine whether that action is allowed.

Examples:

- endpoint isolation
- IOC blocking
- account disabling
- credential/token revocation

Start with low-risk actions and require appropriate human/policy controls.

---

### Phase 5: Production & Scale

Evaluate:

- multiple Pi workers
- HA
- queues
- concurrency
- retries
- rate limiting
- RBAC
- secret management
- monitoring
- cost controls
- failure recovery
- auditability

Only introduce distributed infrastructure when justified by actual requirements.

---

### Phase 6: Knowledge & Advanced Agent Architecture

Treat long-term knowledge management as a separate architectural problem.

Do **not** assume Jira is Pi's primary knowledge base.

Evaluate how Pi should eventually access organizational/security knowledge such as:

- historical investigations
- incident conclusions
- detection knowledge
- SOC runbooks
- security policies
- asset context
- threat intelligence
- known investigation patterns

Potential approaches can later be evaluated, such as:

- PostgreSQL + pgvector
- OpenSearch
- dedicated vector databases
- Git-based knowledge
- object storage + retrieval/indexing
- knowledge graphs

The goal is to determine the right retrieval architecture based on actual requirements.

Jira should primarily remain a **human workflow/ticketing system**, while useful information from Jira may become one source of knowledge.

Only introduce a dedicated knowledge system when the investigation/evaluation phases demonstrate that persistent organizational knowledge materially improves Pi's performance.

If a single-agent Pi architecture proves insufficient, then evaluate specialized/multi-agent approaches and technologies such as Google ADK.

Do not introduce multi-agent orchestration merely because it is available.

---

# 11. Technology Principles

Use these principles throughout the design:

### 1. Pi is the agent runtime
Do not unnecessarily introduce another agent framework.

### 2. MCP is the security capability boundary
Pi should access security systems through a Security Tool Layer on native MCP (credentials in that process / Secret Manager), not by holding vendor keys in Pi. MCP Gateway stays deferred.

### 3. Keep the integration layer small
The integration service should connect SIEM events to Pi without becoming another workflow engine.

### 4. No n8n initially
Do not introduce n8n merely for webhook/event plumbing if the integration service can perform that role more simply.

### 5. No Google ADK initially
Do not introduce ADK unless a later requirement demonstrates that Pi alone is insufficient.

### 6. No general-purpose workflow engine
The objective is an agentic investigation system, not an n8n replacement.

### 7. Avoid premature distributed architecture
Start with the simplest architecture that can validate the hypothesis.

### 8. Separate reasoning from authorization and action
The LLM should never implicitly become the security authorization layer.

### 9. Challenge assumptions
If an architectural assumption appears unnecessary, fragile, or overly complex, explicitly challenge it and propose a simpler alternative.

---

# 12. Research Quality Requirements

Use current authoritative information about Pi.

Prioritize:

1. Official Pi documentation
2. Official Pi repository/source code
3. Official SDK/RPC documentation
4. Relevant official issues/discussions
5. Other reliable technical sources when necessary

For every important capability, clearly distinguish:

- **Confirmed**: directly supported by authoritative documentation/source.
- **Inferred**: reasonable conclusion from the implementation/documentation.
- **Assumption**: proposed architecture that still needs validation.
- **Unknown**: insufficient evidence; requires testing.

Do not invent APIs, SDK methods, RPC endpoints, session behavior, MCP capabilities, or persistence mechanisms.

If documentation is unclear, say so and propose a small experiment to validate it.

---

# 13. Expected Deliverable

Produce an architecture/discovery document containing:

## Executive Summary

Explain:

- the problem
- proposed direction
- what we are validating
- why Phase 1 is intentionally small

## Current Scope

Clearly define Phase 0 and Phase 1.

## Phase 0 Findings

Document:

- Pi runtime model
- SDK/RPC capabilities
- session model
- persistence model
- external integration options
- MCP capabilities
- recommended integration approach
- recommended Phase 1 deployment model

## Phase 1 Design

Document:

- architecture
- data flow
- alert flow
- Pi interaction
- security-tool interaction
- investigation lifecycle
- structured result
- test scenarios
- success criteria
- GO / NO-GO gate

## Future Vision

Summarize Phases 2–6 only at a high level.

Do not prematurely design their implementation.

## Key Architectural Decisions

Explicitly list decisions and the reasoning behind them.

## Risks / Unknowns

List anything that must still be validated.

## What We Are NOT Building Yet

Explicitly list:

- PostgreSQL / durable SOAR database
- distributed Pi workers
- queue infrastructure
- n8n
- Google ADK
- general-purpose workflow engine
- automated remediation
- dedicated knowledge base
- multi-agent architecture

unless Phase 0 research demonstrates that something is unexpectedly required for Phase 1.

## Final Recommendation

End with:

1. Recommended Phase 1 architecture.
2. Why it is the simplest useful architecture.
3. What exactly needs to be proven.
4. Phase 1 GO / NO-GO criteria.
5. What should happen only if Phase 1 succeeds.

**Do not write implementation code.**
The output should be an architecture and discovery document that can later be handed to an engineering team for implementation.