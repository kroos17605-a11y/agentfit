# AgentFit WorkBuddy package

This directory is the WorkBuddy-facing AgentFit package. Its Skill folder follows the documented `skills/<skill-name>/SKILL.md` convention and carries the same local core scripts as the Codex and Claude Code packages.

## Import and use

1. Import the Skill package through the WorkBuddy Skill development/import flow available to your account.
2. Start a normal office or knowledge-work task in natural language. AgentFit inventories WorkBuddy's exposed capabilities, reuses compatible or previously successful components, and searches only unresolved gaps.
3. For a WorkBuddy catalog candidate, use the generated native “查找 Skill” handoff. The package does not claim a marketplace API or mark the candidate as installed.
4. AgentFit shows the final assignments and asks before formal execution. WorkBuddy executes only after confirmation; AgentFit then checks the artifact and records only passed, user-accepted workflows for strong reuse.

## External research and installation

- GitHub research runs automatically only for capability gaps; it is read-only and README-first.
- `--auto-learn` stores abstract work patterns locally without raw task text or files. The store is inspectable and erasable. Daily external research is separate, disabled by default, and requires an explicit opt-in.
- The WorkBuddy adapter generates confirmed install handoffs; it does not automate undocumented marketplace installation calls.
