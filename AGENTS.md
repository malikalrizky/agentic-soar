# Agentic SOAR

## Learned User Preferences
- Prefer visuals in git: Mermaid in `docs/visuals.md` (source of truth for MRs) and `docs/visuals/index.html` for a local/browser view. Cursor Canvas is optional and is not pushed.

## Notes
- Deep modules when changing `src/` / `tests/`: `.cursor/rules/deep-modules.mdc`.
- Phase 1 isolated POC: thin GO. Details in `docs/phase-1-result.md`.
- Pi 1.0.4 has native MCP; MCP Gateway is deferred. Next numbered phase is the Security Tool Layer (`docs/phase-2-security-tool-layer.md`). Agent evaluation is deferred.

## Agent skills

### Issue tracker

Jira via acli (site/project in local override, not committed). See `docs/agents/issue-tracker.md`.

### Triage labels

Default roles: needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: root `GLOSSARY.md` + `docs/adr/`. See `docs/agents/domain.md`.

<!-- antislop:start -->
## antislop
For UI, copy, people, mobile layout, or code comments work, read `~/.cursor/skills/antislop/SKILL.md` (core) and then the skill for the task:
- UI / visual: `~/.cursor/skills/antislop-ui/SKILL.md`
- Copy & text: `~/.cursor/skills/antislop-copywriting/SKILL.md`
- People: `~/.cursor/skills/antislop-human/SKILL.md`
- Mobile / responsive: `~/.cursor/skills/antislop-layoutmobile/SKILL.md`
- Code comments: `~/.cursor/skills/antislop-code/SKILL.md`
Before starting, ask the user when antislop applies: during the work, or after it is done.
To update later: `npx skills update` (this machine uses the skills-directory layout, release 3.2.19).
<!-- antislop:end -->
