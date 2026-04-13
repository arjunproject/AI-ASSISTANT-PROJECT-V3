## Baseline History

Local baseline history is a fail-closed restore mechanism for known-good system states.

### Goal

When experiments, feature work, cleanup, or refactors make the system worse, we restore back to a known-good local baseline without depending on a remote repository.

### Commands

- `npm run baseline:create -- --label stage7-stable`
- `npm run baseline:list`
- `npm run baseline:restore -- --id <baseline-id>`
- `npm run baseline:restore -- --dry-run`

### Managed Paths

These paths are captured and restored as part of a baseline:

- `src`
- `tests`
- `dist`
- `package.json`
- `package-lock.json`
- `tsconfig.json`
- `.gitignore`
- `.env` if present
- `.env.example` if present
- `.runtime/access` if present
- `.runtime/ai` if present
- `tools/baseline-history`

### Intentionally Excluded

These paths are intentionally not restored because they are volatile or hold live operational data:

- `.runtime/logs`
- `.runtime/status`
- `.runtime/lock`
- `.runtime/mirror`
- `.runtime/whatsapp`
- ad-hoc screenshot or log artifacts under `.runtime`

### Notes

- Baseline snapshots are stored under `.baseline-history/` and ignored by git.
- Restore only touches managed paths.
- Baseline creation also stores manifest, git metadata, and a health capture for that snapshot.
