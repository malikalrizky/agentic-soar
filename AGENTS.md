# Agentic SOAR

## Learned User Preferences
- Prefer visuals in git: Mermaid in `docs/visuals.md` (source of truth for MRs) and `docs/visuals/index.html` for a local/browser view. Cursor Canvas is optional and is not pushed.

## Notes
- Phase 1 isolated POC: thin GO. Details in `docs/phase-1-result.md`.
- Pi 1.0.4 has native MCP; MCP Gateway is deferred. Phase 3 target is Security Tool Layer (`pre-brainstorm.md`).

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
