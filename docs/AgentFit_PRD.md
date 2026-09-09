# AgentFit PRD

Version: 1.0
Status: Implementation baseline
Updated: 2026-09-04

## 1. Product definition

AgentFit is an embedded capability-routing and quality-control layer for office AI Agents. It is not a standalone Agent or another Skill marketplace.

The user describes work in natural language. AgentFit turns that request into an executable workflow, reuses suitable capabilities already available in the host, discovers only missing capabilities, hands ordered execution to the host Agent, and checks the final artifact before the task is considered complete.

## 2. Target user and problem

The primary user is new to using AI Agents for office work. They can describe the business outcome they want, but they generally do not know:

- what Skills, MCP servers, tools, or plugins are;
- which installed capability matches a task;
- how multiple capabilities should be ordered;
- when a new component is actually necessary;
- how to specify a good PPT, report, spreadsheet, proposal, or meeting output;
- how to verify whether the final artifact is usable.

The core problem is not a lack of tools. It is the gap between a natural-language work request and a result that meets the user's real acceptance criteria.

### 2.1 User layers and first paid use case

AgentFit is designed around three user layers:

- **Business requester**: knows the decision or deliverable needed, but should not have to understand MCP, Skill, plugin, or host-specific setup.
- **Team lead / AI champion**: wants repeatable workflows, visible permission boundaries, and evidence that a result can be trusted before rolling it out.
- **Platform / IT owner**: needs a verifiable inventory of what the host actually exposes, controlled installation, audit-friendly approvals, and privacy-preserving learning.

The first paid use case is public competitive research: a new enterprise user asks the main Agent to compare competitors and produce a decision-ready brief. The product must make the difference between “the host has no web research capability” and “the host did not expose an inventory” explicit. `unknown` is a stop-and-collect-evidence state, not a negative capability claim. This use case is narrow enough to pilot and broad enough to prove routing, HITL, evidence quality, and reuse.

## 3. Product promise

> Say what work you want. AgentFit finds the smallest usable capability path, lets the host Agent execute it, and checks the result.

AgentFit should reduce technical choices for beginners. Terms such as Skill, MCP, plugin, manifest, and permission detail appear only when they affect a decision or when the user asks to inspect them.

## 4. End-to-end loop

```text
Natural-language request
→ infer outcome and acceptance criteria
→ decompose required capabilities
→ inspect capabilities exposed by the current host
→ reuse an accepted historical workflow when compatible
→ identify capability gaps
→ discover external components only for those gaps
→ ask before every new installation
→ show the final assignments and ask before formal execution
→ host Agent executes the ordered assignments
→ AgentFit evaluates the artifact
→ host Agent revises failed checks, at most twice
→ record an accepted workflow for future reuse
```

## 5. Module design

### Module 1: Task routing and outcome loop

Responsibilities:

- infer deliverable, audience, research depth, freshness, source types, runtime, and data sensitivity;
- apply useful defaults when the user has not specified details;
- ask only when a missing answer materially changes the result;
- decompose the minimum workflow required to create the deliverable;
- distinguish workflow stages from installable components;
- match each stage against the host capability inventory;
- send ordered assignments to the host Agent;
- evaluate the final artifact and issue concrete revision actions.

For `制作一份关于机器人行业最新发展的 PPT`, the default workflow is:

```text
research with traceable sources
→ host-Agent evidence synthesis
→ editable PPTX production
→ source, narrative, editability, and visual QA
```

### Module 2: Work memory and reuse

Automatically stored local observations may include:

- capability IDs and controlled business-domain labels;
- deliverable, audience, language, data scope, and web tendency;
- opaque project scope and timestamps;
- component IDs, types, versions, and sources used in a workflow;
- quality-check outcomes and controlled correction categories;
- workflows that passed AgentFit checks and were accepted by the user.

The store must not contain raw task text, task files, credentials, customer names, or project codes. A component is not promoted merely because it was used. Only an accepted workflow can receive the strongest reuse priority.

Users can inspect or erase AgentFit learning. Native host memory remains separate.

### Module 3: Capability discovery and catalog evolution

Discovery order:

1. accepted historical component for the same capability;
2. installed and enabled compatible component;
3. host-native capability;
4. external discovery for the unresolved gap only.

WorkBuddy can use its native Skill search plus GitHub. Codex and Claude Code use GitHub. Candidates may be Skills, MCP servers, tools, plugins, extensions, or installable open-source projects.

Daily external research is an optional catalog-maintenance feature, not part of normal task completion and not enabled with local learning. It should notify the user only when a new candidate materially improves a recurring workflow.

## 6. Capability inventory contract

The host adapter supplies only components actually exposed in the current runtime:

```json
{
  "components": [
    {
      "id": "research-mcp",
      "name": "Research MCP",
      "type": "mcp",
      "version": "1.2.0",
      "source": "host-runtime",
      "capabilityIds": ["research-with-citations"],
      "outputs": ["cited research brief"],
      "hostPlatforms": ["codex"],
      "permissions": ["public-network"],
      "riskLevel": "low",
      "enabled": true,
      "setupCost": 0
    }
  ]
}
```

The envelope around this list is part of the contract:

```json
{
  "version": 1,
  "hostPlatform": "claude-code",
  "source": "host-runtime",
  "mode": "verified",
  "observedAt": "2026-09-08T00:00:00Z",
  "components": []
}
```

`mode: verified` means the host inspected the current session, including an intentionally empty result. `partial` and `unknown` mean AgentFit cannot tell whether an unlisted MCP or tool is available. Unknown inventory is never treated as a negative capability assertion: it blocks gap-only discovery and asks the host to complete the session inventory first. This prevents a new Claude Code user from being told that web crawling is unavailable merely because the adapter failed to inspect the main Agent's tools.

Filesystem presence alone does not prove that a component is enabled. When the host cannot verify availability, AgentFit must classify it as unknown instead of silently routing work to it.

## 7. Matching policy

For each workflow stage, matching priority is:

1. deliverable fit;
2. research-depth fit;
3. freshness fit;
4. source-type fit;
5. runtime fit;
6. minimality.

Within equivalent matches, an accepted historical component is preferred. A broad Agent or platform must not outrank a focused component merely because it exposes more features.

## 8. Interaction policy for beginners

The default user-facing response contains:

- AgentFit's plain-language understanding of the requested result;
- the short workflow;
- which steps will use existing capabilities;
- which capability is missing, if any;
- one recommended external option per gap, with an optional alternative;
- a clear installation question only when installation is needed.
- a final execution question before research, writing, PPT, spreadsheet, or other deliverable production begins.

Technical evidence remains available as progressive detail. AgentFit must not present a large unranked catalog to a beginner.

Installed low-risk components can be used within the user's stated task without a second installation confirmation. New installations always require confirmation. Sensitive-data access, paid services, external accounts, or high-risk writes require action-time confirmation even when the component is already installed.

Task decomposition, inventory review, and read-only candidate discovery may run automatically. They do not authorize production work. When no external candidate is reviewable, AgentFit must explain which existing components were checked and ask whether to use the host Agent's fallback workflow; it must not silently continue.

## 9. Quality gates

Common checks:

- the artifact exists and is accessible;
- requested format and editability are correct;
- output structure fits the audience and decision purpose;
- research claims and charts have traceable sources;
- the result does not fabricate missing evidence.

PPT-specific checks:

- real editable PPTX, not only an outline, PDF, or image deck;
- rendered pages have no overflow, overlap, or unreadable charts;
- storyline, conclusions, speaker notes, and source appendix are present when required.

Spreadsheet-specific checks:

- field types, missing values, duplicates, formulas, and calculation results are checked;
- the delivered file remains editable and uses the requested format.

AgentFit can return the work to the host Agent for at most two automatic revision attempts. Remaining failures require a user decision.

## 10. Responsibility boundary

AgentFit owns task interpretation, capability matching, workflow order, installation gating, final quality checks, and reusable-workflow learning.

The host Agent owns tool invocation and artifact production. Installing a component transfers execution to the host, but it does not end the AgentFit lifecycle. AgentFit resumes for final evaluation.

## 10.1 Presentation and product acceptance artifacts

The project maintains a self-contained HTML delivery set for product review. The positioning page is written for a buyer rather than an internal engineering audience; the product map shows roles, mainline flow, state transitions, HITL nodes, capability/tool layers, and data movement; the existing demo is the interactive prototype; and the evaluation page defines endpoint and sub-capability rubrics, golden and adversarial benchmark sets, and the split between deterministic code checks, semantic judge checks, and human review. These artifacts are linked from `output/index.html` and should be reviewed together because no single artifact proves product value on its own.

The benchmark catalog is executable and reviewable: `evals/agentfit-benchmark-cases.mjs` contains six golden cases and eight adversarial/boundary cases with fixed briefs, inventory evidence, expected states, rubrics, and evaluator owners. `npm run eval:cases` runs deterministic assertions and explicitly labels cases that still require Judge or human review instead of treating them as automated passes.

## 11. Success metrics

Primary product metrics require recorded user testing:

- task-to-usable-artifact success rate;
- percentage of tasks completed with existing components;
- unnecessary-installation rate;
- first-pass quality-gate pass rate;
- user revision count before acceptance;
- successful workflow reuse rate;
- time from natural-language request to accepted artifact.

Offline routing accuracy and unit-test pass rate are engineering signals, not proof of user value.

## 12. Delivery roadmap

### P0: Closed-loop foundation

- capability inventory contract;
- installed-component matching;
- gap-only discovery;
- ordered host execution handoff;
- PPT, report, spreadsheet, and generic quality gates;
- accepted-workflow recording and reuse.

### P1: Host-native inventory adapters

- Codex runtime capability enumeration;
- Claude Code runtime capability enumeration;
- WorkBuddy native Skill and tool inventory handoff;
- permission and enabled-state verification.

The adapter must emit the inventory envelope from the current session rather than infer availability from files on disk. `inventory-check` is the diagnostic fallback when a host cannot enumerate its live tools.

### P2: Better outcome understanding

- audience and usage-scenario defaults;
- concise clarification policy;
- user correction categorization;
- artifact-specific evaluators and renderer integrations.

### P3: Catalog evolution

- background candidate refresh;
- regression and security monitoring for installed components;
- optional high-value notifications for recurring workflows;
- no default daily news feed.

## 13. Current implementation status

Implemented in the platform-neutral core:

- task requirement inference and workflow decomposition;
- capability inventory normalization and installed-component matching;
- accepted historical workflow priority;
- gap-only GitHub query generation;
- install confirmation and verified staged-copy boundary;
- quality-gate contracts and revision actions;
- accepted-workflow outcome storage;
- host execution handoff.

Still host-dependent or requiring live validation:

- authoritative enumeration of enabled components in all three hosts;
- actual multi-tool execution by each host Agent;
- artifact evidence collection and renderer-based PPT checks;
- end-to-end user studies and product success metrics;
- WorkBuddy CLI validation on a machine with CodeBuddy installed.
