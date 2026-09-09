import { createSkillPlan, createQualityGate, evaluateQualityGate } from '../src/index.mjs';
import { AGENTFIT_BENCHMARK_CASES } from '../evals/agentfit-benchmark-cases.mjs';

function planFor(testCase) {
  return createSkillPlan({
    ...testCase.brief,
    installedComponents: testCase.inventory?.components,
    inventoryDocument: testCase.inventory,
    inventoryMode: testCase.inventory?.mode
  });
}

function checkPlan(testCase, result) {
  const expected = testCase.expected ?? {};
  const failures = [];
  if (expected.status && result.status !== expected.status) failures.push(`status expected ${expected.status}, got ${result.status}`);
  if (expected.blockCode && result.block?.code !== expected.blockCode) failures.push(`block expected ${expected.blockCode}, got ${result.block?.code}`);
  const plan = result.plan;
  if (expected.inventoryStatus && plan?.hostInventory?.status !== expected.inventoryStatus) failures.push(`inventory expected ${expected.inventoryStatus}, got ${plan?.hostInventory?.status}`);
  if (expected.assignmentStatus && plan?.capabilityResolution?.assignments?.[0]?.status !== expected.assignmentStatus) failures.push(`assignment expected ${expected.assignmentStatus}, got ${plan?.capabilityResolution?.assignments?.[0]?.status}`);
  if (expected.discoveryCapabilityIds && JSON.stringify(plan?.capabilityResolution?.discoveryCapabilityIds ?? []) !== JSON.stringify(expected.discoveryCapabilityIds)) failures.push(`discovery expected ${expected.discoveryCapabilityIds.join(',')}, got ${(plan?.capabilityResolution?.discoveryCapabilityIds ?? []).join(',')}`);
  if (expected.executionReady != null && plan?.capabilityResolution?.readyForHostExecution !== expected.executionReady) failures.push(`execution readiness expected ${expected.executionReady}, got ${plan?.capabilityResolution?.readyForHostExecution}`);
  if (expected.phases && JSON.stringify(plan?.userFacing?.taskBreakdown?.decomposition?.map((step) => step.capabilityId)) !== JSON.stringify(expected.phases)) failures.push('phase decomposition mismatch');
  if (expected.primary && plan?.primarySkill?.id !== expected.primary) failures.push(`primary expected ${expected.primary}, got ${plan?.primarySkill?.id}`);
  for (const term of expected.queryExcludes ?? []) {
    const queries = [
      plan?.githubResearch?.query,
      ...(plan?.githubResearch?.queriesByStep ?? []).map((query) => query.query),
      plan?.workbuddySearchHandoff?.query
    ].filter(Boolean).join(' ');
    if (queries.includes(term)) failures.push(`query leaked forbidden term ${term}`);
  }
  if (testCase.id === 'G3-claude-browser-mcp-reuse' && plan?.capabilityResolution?.assignments?.[0]?.status !== 'installed-component') failures.push('browser MCP was not reused');
  if (testCase.id === 'G4-codex-research-to-ppt' && !(plan?.capabilityResolution?.discoveryCapabilityIds ?? []).includes('presentation-production')) failures.push('PPT production gap was not isolated');
  return failures;
}

function evaluateQualityCase(testCase) {
  if (testCase.id === 'G5-quality-gate-revision-loop') {
    const contract = createQualityGate({ taskRequirements: { deliverable: 'research-report', sourceTypes: ['official-web'] }, decomposition: [{ capabilityId: 'research-with-citations' }] });
    const result = evaluateQualityGate(contract, { artifactExists: true, fileType: 'report', structurePassed: true, citationsPresent: false, sourceAppendixPresent: false }, { attempt: 1 });
    return result.status === 'needs-revision' && result.revisionActions.length > 0 ? [] : ['quality gate did not return a concrete revision loop'];
  }
  return [];
}

function evaluateReuseCase(testCase) {
  if (testCase.id !== 'G6-accepted-workflow-reuse') return [];
  const result = createSkillPlan({
    ...testCase.brief,
    installedComponents: [{ id: 'trusted-research', name: 'Trusted Research', type: 'mcp', enabled: true, capabilityIds: ['research-with-citations'], hostPlatforms: ['codex'] }],
    inventoryDocument: { hostPlatform: 'codex', source: 'host-runtime', mode: 'verified', components: [{ id: 'trusted-research', name: 'Trusted Research', type: 'mcp', enabled: true, capabilityIds: ['research-with-citations'], hostPlatforms: ['codex'] }] },
    inventoryMode: 'verified',
    learningContext: { status: 'enabled', successfulWorkflows: [{ status: 'accepted', passed: true, components: [{ id: 'trusted-research' }] }] }
  });
  const assignment = result.plan?.capabilityResolution?.assignments?.find((item) => item.capabilityId === 'research-with-citations');
  return assignment?.status === 'reused-successful-component' ? [] : ['accepted workflow component was not reused'];
}

const cases = AGENTFIT_BENCHMARK_CASES.map((testCase) => {
  let failures = [];
  const manualOnly = new Set(['A5-no-reviewable-candidate-fallback', 'A6-installed-high-risk-action-reconfirms', 'A7-source-conflict-is-human-review', 'A8-duplicate-installation-is-rejected', 'A9-quality-claim-without-artifact-evidence', 'A10-specialist-skill-quality-fit']);
  if (manualOnly.has(testCase.id)) return { id: testCase.id, set: testCase.set, verification: 'manual-review-required', passed: null, failures: [], rubric: testCase.rubric };
  if (testCase.id === 'G5-quality-gate-revision-loop') failures = evaluateQualityCase(testCase);
  else if (testCase.id === 'G6-accepted-workflow-reuse') failures = evaluateReuseCase(testCase);
  else failures = checkPlan(testCase, planFor(testCase));
  return { id: testCase.id, set: testCase.set, verification: 'automated', passed: failures.length === 0, failures };
});
const automatedCases = cases.filter((item) => item.verification === 'automated');
const passed = automatedCases.filter((item) => item.passed).length;
const manualReviewCases = cases.filter((item) => item.verification === 'manual-review-required');
const report = { kind: 'agentfit-product-benchmark-cases', total: cases.length, automatedTotal: automatedCases.length, automatedPassed: passed, manualReviewTotal: manualReviewCases.length, score: Number((passed / automatedCases.length).toFixed(4)), cases };
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
// Manual cases are intentionally excluded from the automated exit condition.
// A manual review placeholder is not an automated failure.
if (passed !== automatedCases.length) process.exitCode = 1;
