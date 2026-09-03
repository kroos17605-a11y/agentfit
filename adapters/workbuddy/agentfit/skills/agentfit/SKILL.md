---
name: agentfit
description: 用于 WorkBuddy 中的日常办公与知识工作，包括 PPT、调研、报告、数据分析、会议、项目管理、产品设计、PRD、Roadmap 和方案。AgentFit 把自然语言需求转成结果规格，优先复用 WorkBuddy 当前可用或历史成功的能力，只为缺口搜索 WorkBuddy Skill、GitHub Skill、MCP、工具、插件或可安装项目，再由 WorkBuddy 执行并由 AgentFit 验收。普通代码开发、调试和基础设施任务不触发。
---

# AgentFit for WorkBuddy

AgentFit 是 WorkBuddy 主 Agent 内嵌的能力路由与质量控制层，不是第二个 Agent。

## 核心流程

1. 推断交付物、受众、研究深度、时效、来源类型、运行环境、数据敏感度和合理默认值。只有缺失信息会实质改变结果时才提问。
2. 在外部搜索前，逐项盘点当前 WorkBuddy 会话中实际暴露且已启用的 Skill、MCP、工具、插件和扩展。先扫描全部元数据，再完整读取每个可能匹配组件的 `SKILL.md` 或官方说明后才能断言适配；不得为了检查而调用不相关 Skill。磁盘中存在文件不等于可用。`.agentfit/inventory.json` 优先写入 `id`、`name`、`type`、`enabled`、`capabilityIds` 和 `hostPlatforms`；也兼容 `kind`／`status: available`，但应尽量明确能力 ID。不得写入凭证或任务内容。
3. 运行 `node <this-skill-folder>/scripts/cli.mjs recommend --host workbuddy --task "..." --project "..." --inventory-file .agentfit/inventory.json --learning-store .agentfit/learning.json --auto-learn --allow-web true --state-file .agentfit/plan.json`。仅在用户或宿主明确禁止联网时使用 `--allow-web false`。
4. 用普通办公语言说明预期结果和最短工作流，并展示 `plan.userFacing.capabilityResolution.inventoryReview`：逐项说明检查了哪些现有能力、能做什么、是否匹配以及原因。
5. 如果 `plan.githubResearch.queriesByStep` 为空，不搜索 GitHub。展示有序分工后询问 `plan.userFacing.executionGate.prompt`；用户明确确认前，不得开始调研、写作、PPT、表格或其他正式交付物。
6. 如果存在缺口，运行同一命令并加入 `--discover --confirm-discovery true`，且只搜索缺口；同时生成 WorkBuddy 原生“查找 Skill”请求。每个缺口展示一个首选和至多一个备选，说明特点、优点、限制与链接。严格执行 `discovery.nextDecision`：安装前询问；无候选可审核时明确说明“不建议安装”，再询问是否改用 WorkBuddy 当前能力。详情证据失败但仓库有潜力时，先用已有只读浏览能力查看首选 README。绝不能把“没有合格候选”当成自动执行许可。
7. 安装后重新盘点能力并展示最终分工；除非用户最新回复同时确认安装和执行，否则再次询问是否开始正式工作。WorkBuddy 完成交付物后，AgentFit 继续验收。
8. 为 `plan.qualityGate` 的每项标准收集证据并写入 `.agentfit/quality-evidence.json`，再运行 `quality-check --plan .agentfit/plan.json --evidence .agentfit/quality-evidence.json --result-file .agentfit/quality-result.json`。未通过项交回 WorkBuddy 修订，最多达到计划声明的次数；通过或用户接受剩余限制前不得声称完成。
9. 质量门通过后，运行 `workflow-outcome --host workbuddy --project "..." --plan .agentfit/plan.json --quality-result .agentfit/quality-result.json --learning-store .agentfit/learning.json`。只有通过质量检查且被用户接受的组件组合获得强复用优先级。本地学习随 `--auto-learn` 自动进行，只保存抽象结构，可查看、可删除，不保存任务原文或文件。
10. 每日外部调研与本地学习分离并默认关闭。只有用户明确要求时才启用或建立持久日程；仅当新候选能实质改善常用工作流时通知。

## 来源与安全边界

- WorkBuddy 的外部能力来源仅限 WorkBuddy 原生“查找 Skill”和 GitHub；不得把其他市场冒充为来源。
- 不得静默安装、更新或启用第三方组件，也不得把固定能力卡描述为已安装组件。
- 自动学习不得保存任务原文、文件、提示词、凭证或受限业务内容，也不得把推断模式说成用户明确偏好。
- WorkBuddy 负责工具调用和交付物制作；AgentFit 负责任务路由、安装闸门、最终质量检查和成功工作流复用。
