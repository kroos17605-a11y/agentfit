# AgentFit Layer

AgentFit is an **embedded capability-routing and quality-control layer**, not a standalone chat product or another marketplace. A user simply says what work they want to do. AgentFit turns that request into an outcome specification, reuses suitable capabilities already available in the host, discovers only missing capabilities, hands ordered execution to the host Agent, and checks the final artifact.

The current product contract is documented in [docs/AgentFit_PRD.md](docs/AgentFit_PRD.md).

## What runs locally

- `src/` is the platform-neutral core: task-to-workflow routing, installed-capability resolution, gap-only discovery, progressive local learning, accepted-workflow reuse, artifact quality gates, source-policy enforcement, and install-request state creation.
- `adapters/` contains distributable host packages. Each package carries the same core scripts after `npm run package:adapters`.
- Every eligible task records only a local, abstract work observation when `--auto-learn` is used. Daily external research is separate and off by default. A concrete install still requires an exact, user-confirmed manifest; the implementation never guesses a repository or target directory.

## User-facing Skill explanations and links

AgentFit does not begin with a bare list of technical components. Each recommendation first explains the intended result and short workflow in user language. It then shows:

- what the capability does and when it is useful;
- why it fits the current task;
- key features, practical advantages, and expected outputs;
- network/data conditions and limitations;
- whether the step is covered by the host Agent, an installed component, a previously successful component, or an unresolved capability gap.

The interaction is deliberately gated. AgentFit first resolves every workflow step against a host-supplied inventory and explains every exposed component it checked. When all steps are covered, it skips GitHub and asks whether to start the ordered workflow. When gaps remain, it automatically performs read-only discovery only for those capability IDs. Discovery never downloads, installs, or executes anything. AgentFit stops before every new installation and, when no candidate is suitable, asks before using the host fallback. Formal artifact production always needs an explicit user confirmation. After the host Agent produces the artifact, AgentFit runs the quality gate and returns concrete revision actions when checks fail.

For example, a request to research public AI-product trends and draft a decision report first receives **Public research with citations**: it explains that the value is traceable sources and cross-checking, that it needs web permission, and that it handles public information only. The optional next card, **Decision report formatting**, explains that it turns reviewed findings into an executive-ready report and does not invent evidence. Both are fixed workflow cards until a specific external Skill has passed source and installation review.

## Host source policy

| Host | Research sources |
| --- | --- |
| WorkBuddy | WorkBuddy native Skill-search handoff plus GitHub |
| Codex | GitHub only |
| Claude Code | GitHub only |

WorkBuddy search is deliberately a user-side handoff: AgentFit makes a precise search request and review checklist; it does not presume an undocumented market API.

## Capability reuse and work learning

The normal host flow is `task → capability inventory → workflow assignments → host execution → quality gate → accepted workflow reuse`. The automatic store contains capability IDs, allowlisted domain labels, task/deliverable/audience/language/data-scope/web-tendency profile fields, opaque project scopes, timestamps, quality outcomes, and accepted component references—never raw task text, task files, credentials, customer names, project codes, or restricted business context.

- One observation is `observed`.
- Every approved AgentFit use records one observation, including repeated uses on the same day; the store keeps the most recent 250 observations.
- Two observations on distinct days are `emerging`.
- Four observations across at least three days become `established`; only this level can lightly personalize an ambiguous future recommendation. Explicit preferences and the current task always take priority.
- When a later task contains a previously observed domain, AgentFit applies the controlled domain and aggregate audience/work-profile labels to the plan. For example, a returning robotics executive receives an explicit explanation that robotics-focused, decision-oriented candidates are prioritized; the stored profile never contains the original task wording or company names.
- A component receives strong reuse priority only after the artifact passes AgentFit's quality gate and the user accepts it.
- The user can view or erase the automatic profile with `learning-status` and `learning-forget --confirm-delete`.
- Daily external research is optional catalog maintenance and remains disabled until separately enabled.

## Local use

```sh
npm run recommend -- --host codex --task "整理公开 CSV 并输出周报" --learning-store .agentfit/learning.json --auto-learn
# Optional: enable periodic external catalog research separately.
node src/cli.mjs learning-enable --host codex --learning-store .agentfit/learning.json --confirm-enable --daily-research true
node src/cli.mjs recommend --host codex --project product-docs --task "处理产品文档" --inventory-file .agentfit/inventory.json --learning-store .agentfit/learning.json --auto-learn
node src/cli.mjs quality-check --plan .agentfit/plan.json --evidence .agentfit/quality-evidence.json
node src/cli.mjs workflow-outcome --host codex --plan .agentfit/plan.json --quality-result .agentfit/quality-result.json --learning-store .agentfit/learning.json
node src/cli.mjs daily-research --host codex --learning-store .agentfit/learning.json
node src/cli.mjs daily-schedule-handoff --host codex --frequency weekly --local-time 09:00 --learning-store .agentfit/learning.json
```

AgentFit is an online discovery layer by default. The host creates the plan, then runs `--discover --confirm-discovery true` automatically; the CLI still requires that explicit internal confirmation so discovery cannot happen accidentally outside the host flow. A task that explicitly prohibits networking must pass `--allow-web false`, in which case AgentFit returns the workflow only and clearly marks discovery as deferred. The approved daily job additionally permits a once-per-local-day, generic-capability query. It reads repository metadata, README, Skill/MCP/plugin manifests when available, license evidence, release evidence, and script/permission signals; it never downloads or runs candidate code. It suppresses candidates already seen in earlier daily runs. Installation is separate and explicit; after confirmed installation, the host's main Agent executes the original task.

AgentFit first identifies the final deliverable, required research depth, freshness, source types, and host runtime. It then separates workflow stages from component searches. For example, `制作一份关于机器人行业最新发展的 PPT` becomes `research → host-agent evidence synthesis → editable PPTX production`, but GitHub discovery runs only for unresolved research and PPT-production stages. Common host inventory aliases such as `kind`/`status: available` are normalized; conservative identity mappings let an exposed browser cover public research and an image generator cover visual design while leaving unsupported PPTX production as an explicit gap. The host Agent handles ordinary synthesis and analysis unless that step has a concrete requirement beyond the host's capability.

GitHub discovery uses English capability terms such as `research citations web-search` and `pptx presentation slides`, rather than requiring the business topic to appear in a repository name. Each candidate is grouped under its target stage and compared lexicographically in this order: deliverable fit, research-depth fit, freshness fit, source-type fit, runtime fit, then minimality. A focused lightweight component therefore outranks a broad all-in-one Agent when both satisfy the task. A root `SKILL.md` is optional: an installable MCP, host plugin, Agent extension, or open-source project can enter review when its README or official manifest provides sufficient installation evidence.

Each candidate also receives a 0–100 quality assessment. The verdict is `推荐审核` (75+), `谨慎审核` (55–74), or `不建议优先` (<55). Candidates below 55 cannot re-enter the install-review list when results from multiple searches are merged. This is a triage signal for efficient review, not a claim that the project is safe or effective; the user still approves installation and validates the result.

```sh
node src/cli.mjs github-scout --host codex --task "public CSV reporting" --allow-web
```

For sustained use, set `GITHUB_TOKEN` outside this repository. Never put credentials in a Skill package, a plugin manifest, or committed files.

GitHub Token 是可选项，不是使用前提。没有 GitHub 账号时，AgentFit 先使用匿名只读 API；若达到匿名额度，仍会保留已找到的仓库链接和步骤归类，并标记为“待打开确认”，不会把它误报为没有候选。需要更高额度时，再打开 [GitHub Fine-grained token 创建页](https://github.com/settings/personal-access-tokens/new)，只授予 Public repositories 的 read-only `Contents`/`Metadata` 权限，然后在当前终端设置 `GITHUB_TOKEN`（macOS/Linux：`export GITHUB_TOKEN="<your-token>"`，Windows PowerShell：`$env:GITHUB_TOKEN="<your-token>"`）。AgentFit 遇到 API 限流时会在 `discovery.githubAuthSetup` 返回此可选链接和权限说明；Token 不会写入项目文件。

## Memory, daily schedule, and installation contract

Automatic work-pattern learning is distinct from the explicit Memory Contract. Memory records can be scoped to a host and project, and may explicitly prefer or avoid Skill IDs. Only confirmed, non-expired records in the same scope affect a recommendation; the resulting plan lists every applied record.

`daily-schedule-handoff` produces the exact safe scheduler payload, cadence, verification criterion, and the daily job's idempotency guarantee. The default cadence is every weekday at 09:00 in the user's local timezone, with options for every day or weekly. The daily result is a personalized project brief, similar to a news digest but filtered by the user's learned domains, recurring workflows, and output preferences. Notifications go to the host Agent by default and are sent only when there is a new reviewable recommendation; a system notification-bar alert is optional and depends on host permissions. A host schedule is considered active only after the host returns a durable task identifier. WorkBuddy must not treat a session-only or expiring scheduled task as a durable daily service.

An installation is a three-part action: create a pending request, save a separate approval record, then execute a checksum-verified staged copy. The installer rejects changed manifests, symbolic links, duplicate paths, overwrites, and packages that execute scripts. WorkBuddy remains a native installation handoff.

## Validation

```sh
npm run check
```

This runs the deterministic core tests, refreshes host packages, and checks that each package is self-contained.

The deterministic recommendation benchmark is also runnable on its own. It reports routing/composition accuracy for the fixed golden cases; it deliberately does not claim to measure host-model hallucination or user satisfaction.

```sh
npm run eval:offline
```

产品级离线评估使用真实办公场景检查 AgentFit 是否覆盖前置知识获取、交付物制作、记忆个性化、步骤契约和执行闸门：

```sh
npm run eval:product
```

该评估仍是可重复的离线代理指标；GitHub 候选质量需要另行进行在线抽样评审，不能仅凭固定测试得分推断。

## Local host integration

This repository carries two project-local marketplaces so a developer can test the adapters without copying source into an account-wide directory:

- Codex: `.agents/plugins/marketplace.json` exposes `./plugins/agentfit`, which is regenerated from the Codex adapter by `npm run package:adapters`.
- Claude Code: `.claude-plugin/marketplace.json` exposes `./adapters/claude-code/agentfit`.
- WorkBuddy: `.workbuddy-plugin/marketplace.json` exposes `./adapters/workbuddy/agentfit`; the adapter now includes a native `.workbuddy-plugin/plugin.json` manifest.

Both marketplaces are intentionally local development artifacts. On a new machine, register the project root in the relevant host, install only `agentfit`, then start a **new** host conversation for representative prompts. The host package may be installed; no third-party Skill is installed by this workflow.

For Codex, the most reliable smoke test is to start a new conversation after installing or reloading the local plugin and begin the request with `$agentfit`, for example: `$agentfit 帮我调研公开 AI 产品趋势并整理成决策报告`. The response must show the outcome, the minimal workflow, and how each step is covered. It must skip GitHub when installed or host-native capabilities cover every step; otherwise it performs read-only discovery only for the gaps and stops before each new installation. After Codex creates the artifact, AgentFit must run the quality gate. If `$agentfit` is unknown, the plugin is not loaded in that session; reinstall the local marketplace entry or reload plugins, then start a new conversation.

For WorkBuddy AI / CodeBuddy Code, validate the WorkBuddy adapter and use its native plugin flow:

```sh
codebuddy plugin validate adapters/workbuddy/agentfit
codebuddy plugin validate .workbuddy-plugin/marketplace.json
codebuddy plugin marketplace add ./
codebuddy plugin install agentfit@agentfit-workbuddy-local --scope project
```

Start a new WorkBuddy task or run `/reload-plugins` afterward. Some WorkBuddy CLI versions do not include project-scope plugins in `plugin list --json`; the authoritative runtime signal is that the session log reports `Loaded 1 skill(s) from extension: agentfit@agentfit-workbuddy-local [agentfit]`.

## Deliberate boundaries

- The core returns `handoff_required` for WorkBuddy. Codex/Claude staged installs require an independently stored approval record and a script-free, checksum-verified artifact.
- With `--auto-learn`, abstract local work-pattern learning starts automatically and defaults to `.agentfit/learning.json`; it does not edit native WorkBuddy, Codex, or Claude Code memory stores and can be completely erased per host. Daily external research remains a separate explicit opt-in.
- A GitHub candidate is evidence for review, never an automatic recommendation to install. Fixed capability cards are not presented as real installable Skills until bound to source evidence.
