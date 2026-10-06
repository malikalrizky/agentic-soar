# Phase 1 is an isolated POC on representative telemetry

Phase 1 answers whether Pi can run a useful agentic Investigation. It does not validate production SIEM intake, vendor APIs, or the MCP Gateway. A local test trigger plus representative Telemetry Datasets is enough; production Coralogix, CrowdStrike, Wiz, credentials, webhooks, PostgreSQL, n8n, and remediation stay out.

**Status:** accepted

**Considered Options:**
- Production read-only Coralogix (rejected)
- Coralogix-only production queries (ADR-0001, superseded)
- Isolated local trigger + mock/representative Telemetry Datasets (chosen)

**Consequences:**
- GO/NO-GO cannot claim production integration works.
- Correlation means combining Evidence from multiple Telemetry Datasets in the test environment, not wiring real vendors.
- The test trigger must not be mistaken for the future SIEM path.
