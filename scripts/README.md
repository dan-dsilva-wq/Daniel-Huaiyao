# Overnight AI Experiment Scripts

These scripts let Claude Code work autonomously on Rise overnight.

## Scripts

| Script | Description |
|--------|-------------|
| `overnight-hardened.ps1` | **v2.0** - Task queue, quality gates, morning reports |
| `overnight-simple.ps1` | v1.0 - Basic loop with generic prompts |
| `overnight-simple.sh` | v1.0 - Bash version |

---

## v2.0: Overnight Hardened (Recommended)

The hardened version includes:

- **Task Queue** - Pre-defined tasks instead of "pick anything"
- **Quality Gates** - TypeScript, lint, and build checks before commit
- **Smart Staging** - Only stages allowed files, blocks sensitive ones
- **Stop Conditions** - Auto-stops on consecutive failures/no-ops
- **Risk Tiers** - Filter tasks by low/medium/high risk
- **Morning Reports** - Summary of what happened overnight
- **Persistent State** - Tracks progress across loops

### Quick Start

```powershell
cd C:\Users\dan-d\Projects\Website\Daniel\rise
.\scripts\overnight-hardened.ps1
```

### Usage

```powershell
# Default run with tasks.json
.\scripts\overnight-hardened.ps1

# Custom task file
.\scripts\overnight-hardened.ps1 -TaskFile "my-tasks.json"

# Allow medium-risk tasks
.\scripts\overnight-hardened.ps1 -RiskLevel "medium"

# Short test run (5 loops)
.\scripts\overnight-hardened.ps1 -MaxLoops 5

# Goal-oriented mode (work toward specific goal)
.\scripts\overnight-hardened.ps1 -Goal "Add dark mode support"

# Dry run (no actual changes)
.\scripts\overnight-hardened.ps1 -DryRun
```

### Task Queue (tasks.json)

Pre-populate with specific tasks:

```json
{
  "tasks": [
    {
      "id": "1",
      "description": "Add loading spinner to project creation",
      "risk": "low",
      "status": "pending",
      "maxFiles": 3
    }
  ],
  "config": {
    "riskLevel": "low",
    "allowSchemaChanges": false,
    "allowDependencyChanges": false,
    "maxFilesPerTask": 3
  }
}
```

Task statuses: `pending` → `in_progress` → `completed` | `failed` | `skipped`

### Risk Levels

| Level | Allowed Changes |
|-------|----------------|
| **low** | UI polish, accessibility, loading states, error messages, code cleanup |
| **medium** | New small features, API route changes, up to 5 files |
| **high** | Database changes, dependencies, core logic (manual only) |

### Quality Gates

Before each commit, the script runs:
1. `npx tsc --noEmit` (TypeScript)
2. `npm run lint` (ESLint)
3. `npm run build` (Next.js build)

If any fail, changes are reverted and the task is marked failed.

### Stop Conditions

The experiment auto-stops when:
- 3 consecutive failures
- 3 consecutive no-ops (no changes)
- Max loops reached
- All tasks completed

### Output Files

```
scripts/
├── state.json          # Current experiment state
├── logs/
│   └── overnight-YYYYMMDD.log
└── reports/
    └── overnight-report-YYYYMMDD.md
```

### Morning Report Example

```markdown
# Overnight Report - 2026-02-04

## Summary
- Started: 11:00 PM
- Ended: 6:30 AM
- Loops: 28
- Commits: 22
- Completed: 8
- Failed: 2

## Completed Tasks
- [x] Add hover states to ProjectCard
- [x] Improve error messages in auth forms
...

## AI Observations
- Loop 5: Noticed auth forms could use better validation
- Loop 8: MilestoneList has accessibility issues
```

---

## v1.0: Simple Scripts

### overnight-simple.sh / overnight-simple.ps1

Basic autonomous loop:

```bash
# Bash
cd /c/Users/dan-d/Projects/Website/Daniel/rise
bash scripts/overnight-simple.sh

# PowerShell
.\scripts\overnight-simple.ps1
```

Features:
- 30 loops, 30 seconds between each
- Generic "pick one improvement" prompt
- Creates experimental branch
- No quality gates

---

## After Running

**See what was built:**
```bash
git log --oneline master..HEAD
```

**Review changes in detail:**
```bash
git diff master..HEAD
```

**Keep the good stuff:**
```bash
git checkout master
git cherry-pick <commit-hash>  # Pick specific commits
# OR
git merge experimental/overnight-XXXXX  # Keep everything
```

**Discard everything:**
```bash
git checkout master
git branch -D experimental/overnight-XXXXX
```

---

## Tips

- **First time?** Run with `-MaxLoops 3` to test
- **Add your own tasks** to `tasks.json` before running
- **Check logs** in `scripts/logs/` for full output
- **Review reports** in `scripts/reports/` each morning
- Lower `PAUSE_SECONDS` in script if you have headroom

## Troubleshooting

**"No tasks available"**
- Check `tasks.json` has pending tasks at the selected risk level
- Use `-RiskLevel medium` if all low-risk tasks are done

**Quality gates failing**
- Run `npm run build` manually to see errors
- Fix any TypeScript/lint errors before starting

**Script stops early**
- Check `state.json` for `consecutiveFailures` count
- Review logs for error details

---

## Cost

Uses your Claude Code subscription, not API credits.
The $200/month Max plan has generous limits but isn't unlimited.
A full 30-loop run uses several hours of typical usage.
