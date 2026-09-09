import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeInstalledComponent, resolveCapabilityPlan } from '../src/capability.mjs';

test('unknown or auth-required components are visible but never treated as callable', () => {
  const item = normalizeInstalledComponent({ id: 'browser', name: 'Browser MCP', type: 'mcp', capabilityIds: ['research-with-citations'], status: 'unknown' });
  assert.equal(item.enabled, true);
  assert.equal(item.callable, false);
  const plan = resolveCapabilityPlan({
    hostPlatform: 'claude-code', inventoryMode: 'verified',
    inventory: [item], steps: [{ order: 1, capabilityId: 'research-with-citations', output: ['cited research'] }]
  });
  assert.equal(plan.assignments[0].status, 'capability-gap');
  assert.equal(plan.readyForHostExecution, false);
});

test('missing dependencies block an otherwise matching specialist skill', () => {
  const plan = resolveCapabilityPlan({
    hostPlatform: 'codex', inventoryMode: 'verified',
    inventory: [{ id: 'ppt-design', name: 'PPT design Skill', type: 'skill', capabilityIds: ['presentation-design'], dependencyIssues: ['rendering-runtime'] }],
    steps: [{ order: 1, capabilityId: 'presentation-design', output: ['editable-pptx'] }]
  });
  assert.equal(plan.assignments[0].status, 'capability-gap');
  assert.equal(plan.inventoryReview[0].status, 'blocked-dependencies');
  assert.deepEqual(plan.inventoryReview[0].dependencyIssues, ['rendering-runtime']);
});

test('component identity infers document editing and data analysis capabilities', () => {
  assert.ok(normalizeInstalledComponent({ id: 'docx-editor', name: 'DOCX editor', type: 'tool' }).capabilityIds.includes('document-editing'));
  assert.ok(normalizeInstalledComponent({ id: 'xlsx', name: 'Spreadsheet analysis', type: 'skill' }).capabilityIds.includes('public-data-analysis'));
});
