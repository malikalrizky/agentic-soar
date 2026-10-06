# Phase 1 investigations query Coralogix only

Phase 1 still proves agentic investigation (next step depends on prior evidence), but CrowdStrike and Wiz are out of scope. Multi-vendor MCP and the internal gateway wait until after a GO. A reader of the long-term diagram would otherwise assume Phase 1 already fans out to endpoint and cloud tools.

**Status:** superseded by [[0002-phase-1-isolated-mock-poc]]

Phase 1 does not use Coralogix at all. Vendor-narrowed production SIEM was the wrong boundary; the POC is fully isolated from production security systems.

**Considered Options:**
- Real read-only CrowdStrike, Wiz, and Coralogix
- Recorded branchy stubs for CS/Wiz plus real Coralogix
- Coralogix only (chosen)

**Consequences:**
- “Correlate across multiple sources” cannot mean multiple security vendors in Phase 1. It must mean multiple distinct Coralogix queries/datasets whose later queries depend on earlier evidence, or that success criterion is dropped.
- GO/NO-GO cannot claim Pi works against CrowdStrike or Wiz.
