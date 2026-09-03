export class QualityGateError extends Error {
  constructor(message) {
    super(message);
    this.name = 'QualityGateError';
  }
}

const ACTIONS = Object.freeze({
  'artifact-created': '由主 Agent 重新生成目标文件，并返回可访问的文件路径。',
  'editable-pptx': '使用支持原生 PPTX 的组件重新生成，不要只输出图片、PDF 或大纲。',
  'source-traceability': '补充关键事实、数据和图表的来源，并建立来源附录。',
  'decision-structure': '按目标受众重组内容，确保结论、证据和行动建议清楚。',
  'visual-readability': '修复溢出、遮挡、字号、图表标注和版式一致性后重新渲染检查。',
  'report-structure': '补齐摘要、正文层级、结论和行动项，并检查事实与观点的区分。',
  'spreadsheet-integrity': '重新检查字段、公式、数据类型、缺失值和计算结果。',
  'requested-format': '按用户要求重新输出正确且可编辑的文件格式。'
});

function criterion(id, description, evidenceFields) {
  return { id, description, evidenceFields, required: true };
}

export function createQualityGate({ taskRequirements = {}, decomposition = [] } = {}) {
  const deliverable = taskRequirements.deliverable ?? 'host-agent-output';
  const hasResearch = decomposition.some((step) => step.capabilityId === 'research-with-citations');
  const criteria = [criterion('artifact-created', '目标交付物已实际生成且可以访问。', ['artifactExists'])];
  if (deliverable === 'editable-presentation') {
    criteria.push(
      criterion('editable-pptx', '交付物是可编辑的 PPTX，而不是只有大纲、PDF 或整页图片。', ['fileType:pptx', 'editable']),
      criterion('decision-structure', '故事线、结论和内容层级符合目标受众与使用场景。', ['structurePassed']),
      criterion('visual-readability', '渲染检查没有文字溢出、遮挡或不可读图表。', ['visualReviewPassed', 'noOverflow'])
    );
  } else if (deliverable === 'research-report') {
    criteria.push(criterion('report-structure', '报告具有清楚的摘要、证据、判断和行动建议。', ['structurePassed']));
  } else if (deliverable === 'spreadsheet') {
    criteria.push(
      criterion('requested-format', '交付物是用户要求的可编辑表格格式。', ['fileType:spreadsheet']),
      criterion('spreadsheet-integrity', '数据质量、字段口径和公式计算已经检查。', ['dataValidationPassed', 'formulaIntegrityPassed'])
    );
  } else {
    criteria.push(criterion('requested-format', '结果符合用户要求的交付形式。', ['formatPassed']));
  }
  if (hasResearch) criteria.push(criterion('source-traceability', '关键结论和数据具有可回查来源。', ['citationsPresent', 'sourceAppendixPresent']));
  return {
    version: 1,
    deliverable,
    criteria,
    maxRevisionAttempts: 2,
    owner: 'agentfit-quality-gate',
    executor: 'host-agent'
  };
}

function fieldPassed(field, evidence) {
  const [name, expected] = field.split(':');
  if (expected === 'pptx') return String(evidence[name] ?? '').toLocaleLowerCase() === 'pptx';
  if (expected === 'spreadsheet') return ['xlsx', 'xls', 'csv', 'spreadsheet'].includes(String(evidence[name] ?? '').toLocaleLowerCase());
  return evidence[name] === true;
}

export function evaluateQualityGate(contract, evidence = {}, { attempt = 1 } = {}) {
  if (!contract || !Array.isArray(contract.criteria)) throw new QualityGateError('A quality-gate contract is required.');
  if (!Number.isInteger(attempt) || attempt < 1) throw new QualityGateError('attempt must be a positive integer.');
  const checks = contract.criteria.map((item) => {
    const passed = item.evidenceFields.every((field) => fieldPassed(field, evidence));
    return { ...item, passed, missingEvidence: passed ? [] : item.evidenceFields.filter((field) => !fieldPassed(field, evidence)) };
  });
  const failed = checks.filter((check) => !check.passed);
  const canRetry = failed.length > 0 && attempt < contract.maxRevisionAttempts;
  return {
    status: failed.length === 0 ? 'passed' : canRetry ? 'needs-revision' : 'needs-user-decision',
    attempt,
    passed: failed.length === 0,
    checks,
    failedCriteria: failed.map((check) => check.id),
    revisionActions: failed.map((check) => ACTIONS[check.id] ?? `修正「${check.description}」后重新检查。`),
    nextOwner: failed.length === 0 ? 'agentfit-learning' : canRetry ? 'host-agent' : 'user',
    recordAsReusableWorkflow: failed.length === 0 && evidence.userAccepted === true
  };
}
