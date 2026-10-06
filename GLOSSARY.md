# Agentic SOAR

Language for SOC alert triage and investigation. Implementation (Pi, MCP, files, APIs) does not belong here.

## Language

**Alert**:
A single detection event that can start an Investigation. In Phase 1 this is a representative Test Alert, not a production SIEM event.
_Avoid_: ticket, incident, case, event (when you mean the detection)

**Test Alert**:
An injected, representative Alert used only to exercise an Investigation. It is not proof of production SIEM intake.
_Avoid_: webhook, Coralogix alert, production alert

**Investigation**:
One unattended agentic run against one Alert, producing one Investigation Result.
_Avoid_: session, playbook run, workflow, incident, job

**Incident**:
A durable SOC case that may contain many Alerts and Investigations. Out of Phase 1.
_Avoid_: using this word for an Investigation or an Alert

**Investigation Result**:
The structured packet an Investigation must emit for a human to review: Alert Disposition, Recommended Posture, Confidence, summary, evidence, steps, entities, and recommended next step.
_Avoid_: verdict (as a single field), ticket, report

**Alert Disposition**:
Closed judgment of whether the triggering Alert was a correct detection: `true_positive`, `false_positive`, `benign_true_positive`, `insufficient_evidence`, or `error`.
_Avoid_: verdict (alone), severity, risk

**Recommended Posture**:
Closed judgment of what should happen next in the environment: `no_action`, `monitor`, `needs_human`, or `recommend_containment`. Independent of Alert Disposition. Phase 1 does not execute containment.
_Avoid_: remediation, action (when you mean a recommended posture), verdict

**Evidence**:
A cited fact obtained during the Investigation (from the Alert or from a Telemetry Dataset), distinct from an assumption.
_Avoid_: telemetry, log, finding (when you have not cited it)

**Telemetry Dataset**:
A logical slice of security data the Investigation may query (authentication, endpoint, process, IP, user, related alerts, assets). In Phase 1 these are representative/local, not production vendors.
_Avoid_: source (when you mean a vendor), CrowdStrike, Wiz, Coralogix, tool (when you mean the data)

**Test World**:
One shared representative environment the Telemetry Datasets query. Test Alerts select different slices of that world; they do not each ship a scripted tool path.
_Avoid_: fixture pack (per Alert), playbook, golden trace

**Confidence**:
An analyst-facing estimate on the Investigation Result: `low`, `medium`, or `high`. Not a calibrated probability until a later evaluation phase.
_Avoid_: score, probability, certainty
