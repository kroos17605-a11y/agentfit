import { createSkillPlan } from '../src/index.mjs';

// Product-level offline smoke evaluation. This measures whether AgentFit
// creates a useful, explainable, safe plan; it does not claim live GitHub or
// host-model quality.
const cases = [
  {
    id: 'robotics-latest-ppt',
    brief: { hostPlatform: 'codex', task: '制作一份关于机器人行业最新发展的 PPT', allowWeb: true },
    expectCapabilities: ['research-with-citations', 'presentation-production'],
    expectPhases: ['research-with-citations', 'evidence-synthesis', 'presentation-production'],
    expectSearches: ['research-with-citations', 'presentation-production'],
    expectRequirements: { deliverable: 'editable-presentation', researchDepth: 'standard', freshness: 'current', runtimeEnvironment: 'codex' }
  },
  {
    id: 'internal-presentation',
    brief: { hostPlatform: 'codex', task: '制作公司季度汇报 PPT 并进行视觉设计', dataSensitivity: 'internal', allowWeb: false },
    expectCapabilities: ['presentation-production', 'presentation-design']
  },
  {
    id: 'private-analysis',
    brief: { hostPlatform: 'claude-code', task: '分析客户销售预测数据并输出管理层报告', dataSensitivity: 'restricted', allowWeb: false },
    expectCapabilities: ['private-data-analysis']
  },
  {
    id: 'learned-verticality',
    brief: {
      hostPlatform: 'codex', task: '制作机器人行业发展 PPT', allowWeb: true,
      learningContext: { status: 'enabled', businessContexts: ['robotics'], workProfile: [{ category: 'audience', value: 'executive', observations: 5 }] }
    },
    expectCapabilities: ['research-with-citations', 'presentation-production']
  }
];

const results = cases.map(({ id, brief, expectCapabilities, expectPhases, expectSearches, expectRequirements }) => {
  const result = createSkillPlan(brief);
  const actual = result.status === 'recommended' ? [result.plan.primarySkill.id, ...result.plan.supportingSkills.map((skill) => skill.id)] : [];
  const failures = [];
  for (const skill of expectCapabilities) if (!actual.includes(skill)) failures.push(`missing capability ${skill}`);
  const phases = result.plan?.userFacing?.taskBreakdown?.decomposition?.map((step) => step.capabilityId) ?? [];
  const searches = result.plan?.githubResearch?.queriesByStep?.map((query) => query.capabilityId) ?? [];
  if (expectPhases && JSON.stringify(phases) !== JSON.stringify(expectPhases)) failures.push(`phases expected ${expectPhases.join(' -> ')}, got ${phases.join(' -> ')}`);
  if (expectSearches && JSON.stringify(searches) !== JSON.stringify(expectSearches)) failures.push(`component searches expected ${expectSearches.join(',')}, got ${searches.join(',')}`);
  for (const [key, value] of Object.entries(expectRequirements ?? {})) {
    if (result.plan?.userFacing?.taskBreakdown?.taskRequirements?.[key] !== value) failures.push(`requirement ${key} expected ${value}`);
  }
  if (!result.plan?.userFacing?.taskDecompositionPrompt) failures.push('missing decomposition prompt');
  if (!result.plan?.userFacing?.taskBreakdown?.decomposition?.every((step) => step.substeps?.length >= 3 && step.input && step.output)) failures.push('incomplete step contract');
  const capabilityGaps = result.plan?.capabilityResolution?.discoveryCapabilityIds ?? [];
  if (capabilityGaps.length > 0 && result.plan?.hostExecutionHandoff?.status !== 'needs-component-discovery') failures.push('capability gaps did not block host execution');
  if (capabilityGaps.some((capabilityId) => !searches.includes(capabilityId))) failures.push('a capability gap has no targeted discovery query');
  if (!result.plan?.qualityGate?.criteria?.length || result.plan.qualityGate.maxRevisionAttempts !== 2) failures.push('missing post-execution quality gate');
  if (id === 'learned-verticality' && result.plan.businessContextApplied?.length === 0) failures.push('learned business context not applied');
  return { id, passed: failures.length === 0, failures, actual, phases, componentSearches: searches };
});

const passed = results.filter((result) => result.passed).length;
const report = {
  kind: 'agentfit-product-usefulness-eval',
  scope: 'offline plan usefulness: decomposition completeness, capability coverage, personalization, and execution safety',
  doesNotMeasure: ['live GitHub recall/precision', 'third-party project quality', 'host-model adherence', 'user satisfaction'],
  total: results.length,
  passed,
  score: Number((passed / results.length).toFixed(4)),
  cases: results
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (passed !== results.length) process.exitCode = 1;
