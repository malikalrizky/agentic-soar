# Issue tracker: Jira (acli)

Issues for this repo live in **Jira**. Site, project key, and board URL are **not** committed — read them from `docs/agents/issue-tracker.local.md` (gitignored). Copy from `docs/agents/issue-tracker.local.example.md` if missing.

## Tooling

- Create and update work items with **`acli jira workitem …`** while authenticated to the site named in the local override.
- Check session with `acli jira auth status`. Switch with `acli jira auth switch --site <site-from-local>` if needed.
- Do **not** use GitHub Issues for this work.

## Hierarchy

- Default program parent: Epic named in the local override (create if missing).
- Stories / Tasks nest under that Epic via Jira parent links.
- For blocking: use Jira native links when available; otherwise put **Blocked by** keys in the description.

## When a skill says "publish to the issue tracker"

1. Load `docs/agents/issue-tracker.local.md` first. If it is missing, stop and ask the human to create it from the example.
2. Draft titles and bodies first; quiz the human on the breakdown.
3. Require **explicit human approval** before any `acli jira workitem create`.
4. Write ticket prose with engineer-writing + antislop (no template theater, no invented scope).
5. Create Epic first when needed, then children with `--parent <EPIC-KEY>`.
6. Apply triage labels from `docs/agents/triage-labels.md` (e.g. `ready-for-agent`) via `--label` when creating or updating.
7. Return keys and browse URLs (build browse URLs from the local site).

## When a skill says "fetch the relevant ticket"

```bash
acli jira workitem view <KEY>
# or
acli jira workitem search --jql 'key = <PROJECT>-123' --json
```

Use the project key from the local override.

## Wayfinding notes

Frontier / claim / resolve are Jira status and assignee changes, not local files. Prefer JQL scoped to the local project key and parent Epic.
