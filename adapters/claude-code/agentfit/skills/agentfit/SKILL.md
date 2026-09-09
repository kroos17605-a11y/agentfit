---
name: agentfit
description: "Use for everyday office and knowledge-work requests such as PPT, research, reports, spreadsheets, meetings, project management, product design, PRD, roadmaps, and proposals. AgentFit converts a natural-language request into an outcome specification, reuses suitable capabilities already exposed by Claude Code, discovers only missing Skills, MCP servers, tools, plugins, or installable projects, hands execution to Claude Code, and checks the final artifact. Do not trigger for ordinary software coding, debugging, or infrastructure work."
---

# AgentFit for Claude Code

Act as Claude Code's embedded capability-routing and quality-control layer. Do not introduce a separate AgentFit conversation.

## Core behavior

1. Infer the deliverable, audience, research depth, freshness, source types, runtime, data sensitivity, and useful defaults. Ask only when a missing answer materially changes the result.
2. Before external discovery, inventory every Skill, MCP server, tool, plugin, and extension actually exposed in the current Claude Code session. Scan all metadata, then fully read the `SKILL.md` or official description of each plausibly matching installed component before claiming it fits; do not invoke unrelated Skills merely to inspect them. Do not treat a file on disk as enabled evidence. Save `.agentfit/inventory.json` with `hostPlatform`, `source`, `mode: "verified"`, `observedAt`, and `components` containing `id`, `name`, `type`, `enabled`, `capabilityIds`, and `hostPlatforms` when known; `kind`/`status: available` are accepted aliases, but explicit capability IDs are preferred. Never include credentials or task content. If Claude Code cannot enumerate the current session, run `inventory-check` and stop: unknown is not the same as no MCP.
3. Run `node <this-skill-folder>/scripts/cli.mjs recommend --host claude-code --task "..." --project "..." --inventory-file .agentfit/inventory.json --learning-store .agentfit/learning.json --auto-learn --allow-web true --state-file .agentfit/plan.json`. Use `--allow-web false` only for an explicit network restriction. AgentFit searches only after a verified inventory shows a real capability gap.
4. Explain the intended result and short workflow in plain language. Show `plan.userFacing.capabilityResolution.inventoryReview`: name every existing component checked, what it covers, whether it matches, and why. State which steps use Claude Code, an installed component, or a previously accepted component.
5. If `plan.githubResearch.queriesByStep` is empty, do not search GitHub. Present the assignments and ask `plan.userFacing.executionGate.prompt`. Do not begin the formal deliverable until the user explicitly confirms.
6. If gaps remain, run the same command with `--discover --confirm-discovery true`. Search only the unresolved capability IDs. Show one primary candidate and at most one alternative per gap with features, advantages, limitations, and links. Follow `discovery.nextDecision`: ask before installation; if no candidate is reviewable, say no installation is recommended and ask whether to use Claude Code's current capabilities as a fallback. If detail evidence failed but a promising link exists, use an available read-only browser/page fetch to inspect the top candidate. Never automatically fall back into execution.
7. After installation, refresh inventory, show final assignments, and ask before formal execution unless the latest user message explicitly confirmed both installation and execution. AgentFit resumes for artifact QA.
8. Collect evidence for every criterion in `plan.qualityGate`, save it to `.agentfit/quality-evidence.json`, and run `quality-check --plan .agentfit/plan.json --evidence .agentfit/quality-evidence.json --result-file .agentfit/quality-result.json`. Return failed checks to Claude Code for revision, up to the declared maximum. Do not call the task complete before the gate passes or the user accepts a remaining limitation.
9. When the gate passes, record the outcome with `workflow-outcome --host claude-code --project "..." --plan .agentfit/plan.json --quality-result .agentfit/quality-result.json --learning-store .agentfit/learning.json`. Only a passed result explicitly accepted by the user becomes a strongly reusable workflow. Local learning is automatic, abstract, inspectable, and erasable; it never stores raw task text or files.
10. Daily GitHub research is separate and off by default. Enable or schedule it only on an explicit request. It updates the candidate catalog and should notify only for a material improvement to a recurring workflow.

## Boundaries

- Never search or recommend WorkBuddy marketplace Skills from Claude Code.
- Do not silently install, update, or enable a third-party component. Do not present a fixed capability card as installed.
- Do not persist raw task text, files, prompts, credentials, or restricted business context in automatic-learning storage. Do not turn an inferred pattern into an asserted user preference.
- Do not modify Claude Code's native memory. Claude Code owns tool execution and artifact creation; AgentFit owns routing, installation gating, final quality checks, and reusable-workflow learning.
