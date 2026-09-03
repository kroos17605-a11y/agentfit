import { createSkillPlan } from '../src/index.mjs';
import { RECOMMENDATION_GOLDEN_CASES } from '../evals/recommendation-golden.mjs';

function compareCase(testCase) {
  const result = createSkillPlan(testCase.brief);
  const failures = [];
  const expected = testCase.expect;
  if (result.status !== expected.status) failures.push(`status expected ${expected.status}, got ${result.status}`);
  if (expected.blockCode && result.block?.code !== expected.blockCode) failures.push(`block expected ${expected.blockCode}, got ${result.block?.code}`);
  if (expected.primary && result.plan?.primarySkill?.id !== expected.primary) failures.push(`primary expected ${expected.primary}, got ${result.plan?.primarySkill?.id}`);
  if (expected.supporting) {
    const actual = result.plan?.supportingSkills?.map((skill) => skill.id) ?? [];
    if (JSON.stringify(actual) !== JSON.stringify(expected.supporting)) failures.push(`supporting expected ${expected.supporting.join(',') || '(none)'}, got ${actual.join(',') || '(none)'}`);
  }
  if (expected.sources && JSON.stringify(result.plan?.sourcePolicy) !== JSON.stringify(expected.sources)) {
    failures.push(`sources expected ${expected.sources.join(',')}, got ${(result.plan?.sourcePolicy ?? []).join(',')}`);
  }
  for (const forbidden of expected.queryExcludes ?? []) {
    const query = `${result.plan?.githubResearch?.query ?? ''} ${result.plan?.workbuddySearchHandoff?.query ?? ''}`;
    if (query.includes(forbidden)) failures.push(`query leaked forbidden term: ${forbidden}`);
  }
  return { id: testCase.id, passed: failures.length === 0, failures };
}

const cases = RECOMMENDATION_GOLDEN_CASES.map(compareCase);
const passed = cases.filter((entry) => entry.passed).length;
const report = {
  kind: 'agentfit-offline-recommendation-eval',
  scope: 'deterministic routing, composition, source-policy, and query-safety only',
  doesNotMeasure: ['host-model hallucination', 'user satisfaction', 'real third-party Skill quality'],
  total: cases.length,
  passed,
  accuracy: Number((passed / cases.length).toFixed(4)),
  cases
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (passed !== cases.length) process.exitCode = 1;
