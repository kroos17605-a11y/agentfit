#!/usr/bin/env node
import { createSkillPlan } from '../src/index.mjs';

const task = '制作一份关于机器人行业最新发展的中文 PPT';

function capabilityNames(plan) {
  return [plan.primarySkill, ...plan.supportingSkills].map((skill) => skill.userGuide?.displayName ?? skill.name);
}

function printPlan(label, result) {
  const plan = result.plan;
  const breakdown = plan.userFacing.taskBreakdown;
  console.log(`\n=== ${label} ===`);
  console.log(`任务：${task}`);
  console.log(`交付物：${breakdown.taskRequirements.deliverable}`);
  console.log(`时效：${breakdown.taskRequirements.freshness}；运行环境：${breakdown.taskRequirements.runtimeEnvironment}`);
  console.log(`工作流：${breakdown.decomposition.map((step) => step.objective).join(' → ')}`);
  console.log(`已匹配能力：${capabilityNames(plan).join('、')}`);
  console.log('逐步说明：');
  for (const step of breakdown.decomposition) {
    console.log(`  ${step.order}. ${step.objective}`);
    console.log(`     输入：${step.input}`);
    console.log(`     输出：${step.output.join('、')}`);
    console.log(`     搜索词：${(step.searchKeywords ?? []).join(' ') || '由宿主 Agent 完成'}`);
  }
  console.log(`需要搜索的能力：${(plan.githubResearch.queriesByStep ?? []).map((query) => query.capabilityId).join('、') || '无'}`);
  console.log(`执行闸门：${plan.hostExecutionHandoff.status}`);
  if (plan.businessContextApplied.length > 0) {
    console.log(`个性化理由：${plan.businessContextApplied.map((item) => item.reason).join(' ')}`);
  }
  console.log(`下一步：${plan.confirmationRequired.at(-1)}`);
}

const firstUse = createSkillPlan({
  hostPlatform: 'codex',
  task,
  allowWeb: true,
  installedComponents: [
    { id: 'browser', name: 'Browser', kind: 'tool', status: 'available', capabilityIds: ['public-research'] }
  ]
});

const returningUser = createSkillPlan({
  hostPlatform: 'codex',
  task,
  allowWeb: true,
  learningContext: {
    status: 'enabled',
    businessContexts: ['robotics'],
    workProfile: [{ category: 'audience', value: 'executive', observations: 5 }]
  },
  installedComponents: [
    { id: 'browser', name: 'Browser', kind: 'tool', status: 'available', capabilityIds: ['public-research'] }
  ]
});

console.log('AgentFit 产品 Demo：自然语言任务 → 能力路由 → 主 Agent 交接');
printPlan('首次使用：识别任务并发现能力缺口', firstUse);
printPlan('持续使用：读取工作模式并细化推荐', returningUser);
console.log('\n用户确认点：AgentFit 只展示候选和安装审核信息；用户确认后才允许安装，正式执行始终交给宿主主 Agent。');
