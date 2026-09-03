const COMPONENT_TYPES = new Set(['skill', 'mcp', 'tool', 'plugin', 'extension', 'project', 'host-native']);
const RISK_ORDER = Object.freeze({ low: 0, medium: 1, high: 2 });

const INFERRED_CAPABILITIES = Object.freeze([
  { pattern: /(?:^|[.:/_-])browser(?:$|[.:/_-])|web[-_ ]?(?:search|browse)|playwright/iu, capabilityIds: ['research-with-citations'] },
  { pattern: /pptx|powerpoint|presentation[-_ ]?(?:creator|production|generator)|slides?[-_ ]?(?:creator|production|generator)/iu, capabilityIds: ['presentation-production'] },
  { pattern: /imagegen|image[-_ ]?generation|visual[-_ ]?design/iu, capabilityIds: ['presentation-design'] }
]);

export class CapabilityInventoryError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CapabilityInventoryError';
  }
}

function requiredText(value, field) {
  const text = String(value ?? '').trim();
  if (!text) throw new CapabilityInventoryError(`${field} is required.`);
  if (text.length > 500) throw new CapabilityInventoryError(`${field} is too long.`);
  return text;
}

function strings(value, field, limit = 30) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new CapabilityInventoryError(`${field} must be an array.`);
  return [...new Set(value.map((item) => requiredText(item, field)))].slice(0, limit);
}

export function normalizeInstalledComponent(component, index = 0) {
  if (!component || typeof component !== 'object' || Array.isArray(component)) {
    throw new CapabilityInventoryError(`components[${index}] must be an object.`);
  }
  const type = requiredText(component.type ?? component.kind ?? 'tool', `components[${index}].type`).toLocaleLowerCase();
  if (!COMPONENT_TYPES.has(type)) throw new CapabilityInventoryError(`Unsupported component type: ${type}.`);
  const riskLevel = requiredText(component.riskLevel ?? 'low', `components[${index}].riskLevel`).toLocaleLowerCase();
  if (!(riskLevel in RISK_ORDER)) throw new CapabilityInventoryError(`Unsupported risk level: ${riskLevel}.`);
  const declaredCapabilityIds = strings(component.capabilityIds, `components[${index}].capabilityIds`);
  const searchableIdentity = `${component.id ?? ''} ${component.name ?? ''} ${component.description ?? ''}`;
  const inferredCapabilityIds = declaredCapabilityIds.length === 0
    ? [...new Set(INFERRED_CAPABILITIES.filter(({ pattern }) => pattern.test(searchableIdentity)).flatMap(({ capabilityIds }) => capabilityIds))]
    : [];
  const normalizedStatus = String(component.status ?? '').trim().toLocaleLowerCase();
  const enabled = component.enabled == null
    ? !['disabled', 'unavailable', 'not-installed', 'not installed'].includes(normalizedStatus)
    : component.enabled !== false;
  return {
    id: requiredText(component.id, `components[${index}].id`),
    name: requiredText(component.name ?? component.id, `components[${index}].name`),
    type,
    version: component.version == null ? null : requiredText(component.version, `components[${index}].version`),
    source: component.source == null ? 'host-runtime' : requiredText(component.source, `components[${index}].source`),
    capabilityIds: declaredCapabilityIds.length > 0 ? declaredCapabilityIds : inferredCapabilityIds,
    capabilityEvidence: declaredCapabilityIds.length > 0 ? 'host-declared' : inferredCapabilityIds.length > 0 ? 'inferred-from-component-identity' : 'unmapped',
    outputs: strings(component.outputs, `components[${index}].outputs`),
    hostPlatforms: strings(component.hostPlatforms, `components[${index}].hostPlatforms`),
    permissions: strings(component.permissions, `components[${index}].permissions`),
    riskLevel,
    enabled,
    setupCost: Number.isFinite(component.setupCost) ? Math.max(0, Number(component.setupCost)) : 0
  };
}

export function normalizeCapabilityInventory(input = {}) {
  const components = Array.isArray(input) ? input : input.components ?? [];
  if (!Array.isArray(components)) throw new CapabilityInventoryError('inventory.components must be an array.');
  const normalized = components.map(normalizeInstalledComponent);
  const ids = new Set();
  for (const component of normalized) {
    if (ids.has(component.id)) throw new CapabilityInventoryError(`Duplicate component id: ${component.id}.`);
    ids.add(component.id);
  }
  return normalized;
}

function historyComponentIds(successfulWorkflows) {
  return new Set((successfulWorkflows ?? [])
    .filter((workflow) => workflow?.status === 'accepted' || workflow?.passed === true)
    .flatMap((workflow) => workflow.components ?? [])
    .map((component) => typeof component === 'string' ? component : component?.id)
    .filter(Boolean));
}

function componentMatches(component, step, hostPlatform) {
  if (!component.enabled) return false;
  if (component.hostPlatforms.length > 0 && !component.hostPlatforms.includes(hostPlatform)) return false;
  if (component.capabilityIds.includes(step.capabilityId)) return true;
  return component.outputs.some((output) => (step.output ?? []).includes(output));
}

function compareComponents(left, right, reusedIds) {
  const reuseDifference = Number(reusedIds.has(right.id)) - Number(reusedIds.has(left.id));
  if (reuseDifference !== 0) return reuseDifference;
  const riskDifference = RISK_ORDER[left.riskLevel] - RISK_ORDER[right.riskLevel];
  if (riskDifference !== 0) return riskDifference;
  const setupDifference = left.setupCost - right.setupCost;
  if (setupDifference !== 0) return setupDifference;
  const breadthDifference = left.capabilityIds.length - right.capabilityIds.length;
  if (breadthDifference !== 0) return breadthDifference;
  return left.name.localeCompare(right.name);
}

export function resolveCapabilityPlan({ steps = [], inventory = [], successfulWorkflows = [], hostPlatform } = {}) {
  const components = normalizeCapabilityInventory(inventory);
  const reusedIds = historyComponentIds(successfulWorkflows);
  const assignments = steps.map((step) => {
    if (step.componentSearchRequired === false) {
      return {
        stepOrder: step.order,
        capabilityId: step.capabilityId,
        status: 'host-native',
        component: { id: `${hostPlatform}:host-agent`, name: '当前主 Agent', type: 'host-native' },
        reason: '该步骤属于主 Agent 的一般整合、分析或协调能力，不需要额外组件。'
      };
    }
    const matches = components
      .filter((component) => componentMatches(component, step, hostPlatform))
      .sort((left, right) => compareComponents(left, right, reusedIds));
    const selected = matches[0] ?? null;
    if (!selected) {
      return {
        stepOrder: step.order,
        capabilityId: step.capabilityId,
        status: 'capability-gap',
        component: null,
        alternatives: [],
        reason: '当前宿主没有暴露可验证的匹配组件，需要只针对这个能力缺口进行外部发现。'
      };
    }
    return {
      stepOrder: step.order,
      capabilityId: step.capabilityId,
      status: reusedIds.has(selected.id) ? 'reused-successful-component' : 'installed-component',
      component: selected,
      alternatives: matches.slice(1, 3),
      reason: reusedIds.has(selected.id)
        ? '该组件已安装，并且曾在通过验收的相似工作流中成功使用，优先复用。'
        : '该组件已安装、启用且覆盖当前步骤，优先于搜索或安装新工具。'
    };
  });
  const gaps = assignments.filter((assignment) => assignment.status === 'capability-gap');
  const matchedComponentIds = new Set(assignments.flatMap((assignment) => [assignment.component?.id, ...(assignment.alternatives ?? []).map((item) => item.id)]).filter(Boolean));
  const inventoryReview = components.map((component) => ({
    id: component.id,
    name: component.name,
    type: component.type,
    enabled: component.enabled,
    capabilityIds: component.capabilityIds,
    capabilityEvidence: component.capabilityEvidence,
    status: !component.enabled ? 'disabled'
      : matchedComponentIds.has(component.id) ? 'matched-to-workflow'
        : component.capabilityIds.length === 0 ? 'checked-unmapped'
          : 'checked-not-needed',
    reason: !component.enabled ? '宿主标记为不可用。'
      : matchedComponentIds.has(component.id) ? '已匹配到本次工作流步骤。'
        : component.capabilityIds.length === 0 ? '已检查，但现有元数据不足以证明它能承担本次步骤。'
          : '已检查，能力与本次必要步骤不匹配。'
  }));
  return {
    inventoryCount: components.length,
    inventoryReview,
    assignments,
    gaps,
    discoveryCapabilityIds: gaps.map((gap) => gap.capabilityId),
    readyForHostExecution: gaps.length === 0,
    policy: 'reuse-successful → installed-and-compatible → discover-only-the-gap'
  };
}
