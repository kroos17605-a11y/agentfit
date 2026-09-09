import { createHash } from 'node:crypto';
import { CAPABILITY_CARDS, CATALOG_VERSION, GITHUB_DISCOVERY_TERMS } from './catalog.mjs';
import { resolveCapabilityPlan } from './capability.mjs';
import { hostInventoryStatus } from './host-inventory.mjs';
import { createQualityGate } from './quality.mjs';
import {
  normalizeTaskBrief,
  safetyAssessment,
  sourcePolicyFor,
  workBuddySearchHandoff,
  safeSearchTerms
} from './policy.mjs';

const STOP_WORDS = new Set(['the', 'and', 'for', 'with', 'from', 'this', 'that', '需要', '一个', '进行', '输出', '使用']);

const INTENT_BOOSTS = [
  { cardId: 'translation-localization', pattern: /(translate|translation|locali[sz]e|翻译|本地化)/iu, score: 12 },
  { cardId: 'meeting-follow-up', pattern: /(meeting|minutes|action items|会议|纪要|行动项)/iu, score: 10 },
  { cardId: 'email-drafting', pattern: /(email|reply|邮件|回复)/iu, score: 9 },
  { cardId: 'research-with-citations', pattern: /(research|market research|citations?|调研|市场研究|引用)/iu, score: 11 },
  { cardId: 'presentation-production', pattern: /(slides?|presentation|deck|pptx?|powerpoint|汇报|演示|幻灯片)/iu, score: 11 },
  { cardId: 'presentation-outline', pattern: /(outline|storyline|storyboard|大纲|故事线|逐页结构)/iu, score: 11 },
  { cardId: 'presentation-design', pattern: /(slides?|presentation|deck|ppt|汇报|演示|幻灯片|排版|视觉|设计)/iu, score: 7 },
  { cardId: 'writing-polish', pattern: /(polish|edit|editing|writing|润色|文字|文案|编辑)/iu, score: 7 },
  { cardId: 'structured-decision-scorecard', pattern: /(recruitment|candidate|scorecard|scoring|招聘|候选人|评分|评估)/iu, score: 12 },
  { cardId: 'spreadsheet-cleanup', pattern: /(clean(?:up)?|duplicate|normalize|清洗|去重|规范化)/iu, score: 10 },
  { cardId: 'knowledge-base-organizer', pattern: /(knowledge base|taxonomy|知识库|知识分类|知识整理)/iu, score: 10 },
  { cardId: 'workflow-automation-planner', pattern: /(automation|workflow|integration|自动化|工作流|集成)/iu, score: 9 }
];

const BUSINESS_DOMAIN_TERMS = Object.freeze({
  robotics: /(机器人|robotics?|具身智能)/iu,
  'ai-products': /(人工智能|AI 产品|ai product|大模型|生成式 AI)/iu,
  'product-management': /(产品|PRD|roadmap|需求|product)/iu,
  marketing: /(市场|营销|marketing|竞品)/iu,
  finance: /(财务|预算|finance|forecast)/iu,
  recruiting: /(招聘|候选人|recruit|candidate)/iu,
  'sales-operations': /(销售|营收|客户|sales|revenue)/iu
});

const CARD_SUBSTEPS = Object.freeze({
  'presentation-outline': ['确认受众、场景、页数和验收标准', '整理并核对输入资料或前置研究摘要', '建立结论先行的故事线与逐页结构', '为关键数据设计图表并标注来源', '补充讲者提示、检查可读性并输出可编辑简报'],
  'presentation-production': ['确认受众、页数、格式和验收标准', '接收已整理与核验的结论结构', '生成逐页内容、图表、引用和讲者提示', '应用一致版式并检查页面可读性', '输出并渲染检查可编辑 PPTX'],
  'report-formatter': ['确认读者、决策问题和报告格式', '把已核实事实与观点分层整理', '形成摘要、关键判断、风险和行动项', '为关键结论附回查来源或证据', '检查范围、措辞和交付格式'],
  'public-data-analysis': ['确认数据来源、字段含义和分析问题', '检查缺失值、重复值、时间范围和口径', '计算趋势、分组差异和异常点', '用图表呈现发现并标注数据限制', '输出可复核的分析结果和下一步建议'],
  'private-data-analysis': ['确认内部数据权限、字段口径和分析问题', '在本地工作区检查质量与敏感字段', '计算趋势、分组差异和异常点', '保留数据不外送并记录分析假设', '输出可复核的内部分析与人工复核项'],
  'project-planning': ['明确目标、范围、成功指标和不做事项', '拆分里程碑、任务、负责人和依赖', '识别资源约束、风险与决策节点', '安排检查点和变更处理方式', '输出可交接的计划或路线图'],
  'meeting-follow-up': ['整理会议背景、参与者和议题', '区分已决策事项、未决问题与事实记录', '提取负责人、截止时间和行动项', '标记需要补充确认的内容', '输出纪要、跟进清单或邮件草稿'],
  'translation-localization': ['确认目标语言、受众、语气和术语要求', '识别专有名词、数字和不可翻译内容', '完成翻译并保持结构与格式', '检查术语一致性和文化适配', '输出译文及需要人工确认的疑点']
});

const MATCH_PRIORITY = Object.freeze([
  'deliverable-fit',
  'research-depth-fit',
  'freshness-fit',
  'source-type-fit',
  'runtime-fit',
  'minimality'
]);

function inferTaskRequirements(brief) {
  const text = `${brief.task} ${brief.deliverable ?? ''}`;
  const deliverable = /(PPT|幻灯片|简报|presentation|slides?)/iu.test(text)
    ? 'editable-presentation'
    : /(报告|report)/iu.test(text)
      ? 'research-report'
      : /(表格|Excel|CSV|spreadsheet)/iu.test(text)
        ? 'spreadsheet'
        : 'host-agent-output';
  const researchDepth = /(深入|全面|战略|决策|deep|comprehensive|strategy)/iu.test(text)
    ? 'deep'
    : /(快速|简要|概览|brief|quick|overview)/iu.test(text)
      ? 'light'
      : /(行业|市场|趋势|调研|研究|research|market|trend)/iu.test(text)
        ? 'standard'
        : 'none';
  const freshness = /(最新|近期|当前|实时|latest|recent|current|real[- ]?time)/iu.test(text) ? 'current' : 'not-required';
  const sourceTypes = brief.dataSensitivity === 'public'
    ? (researchDepth === 'none' ? ['user-provided-context'] : ['official-web', 'industry-reports', 'public-data'])
    : ['user-selected-local-files'];
  return {
    deliverable,
    researchDepth,
    freshness,
    sourceTypes,
    runtimeEnvironment: brief.hostPlatform,
    matchPriority: [...MATCH_PRIORITY]
  };
}

function discoveryTermsFor(capabilityId) {
  return {
    'research-with-citations': ['research', 'citations', 'web-search', 'source-verification'],
    'presentation-outline': ['presentation-outline', 'slide-storyline'],
    'presentation-production': ['pptx', 'presentation', 'slides', 'powerpoint'],
    'report-formatter': ['report', 'writing', 'document-generation'],
    'public-data-analysis': ['data-analysis', 'csv', 'spreadsheet'],
    'private-data-analysis': ['local-data-analysis', 'csv', 'spreadsheet']
  }[capabilityId] ?? (GITHUB_DISCOVERY_TERMS[capabilityId] ?? []);
}

function terms(value) {
  return String(value)
    .toLocaleLowerCase()
    .match(/[\p{L}\p{N}]+/gu)
    ?.filter((term) => term.length > 1 && !STOP_WORDS.has(term)) ?? [];
}

function applicableMemoryEntries(brief, entries) {
  if (!brief.personalisationEnabled || !Array.isArray(entries)) return [];
  const now = Date.now();
  return entries.filter((entry) => {
    if (entry?.status !== 'confirmed') return false;
    if (entry.expiresAt && Date.parse(entry.expiresAt) <= now) return false;
    if (entry.context?.hostPlatform && entry.context.hostPlatform !== brief.hostPlatform) return false;
    if (entry.context?.projectId && entry.context.projectId !== brief.projectId) return false;
    return true;
  });
}

function preferenceProfile(entries, learningContext) {
  const prefer = new Set();
  const avoid = new Set();
  const applied = [];
  const businessContextApplied = [];
  for (const entry of entries) {
    const effect = entry.recommendationEffect ?? {};
    const preferred = Array.isArray(effect.preferSkillIds) ? effect.preferSkillIds : [];
    const avoided = Array.isArray(effect.avoidSkillIds) ? effect.avoidSkillIds : [];
    if (preferred.length === 0 && avoided.length === 0) continue;
    preferred.forEach((id) => prefer.add(id));
    avoided.forEach((id) => avoid.add(id));
    applied.push({ id: entry.id, kind: entry.kind, summary: entry.summary, effect: { preferSkillIds: preferred, avoidSkillIds: avoided } });
    if (entry.kind === 'business-context' || entry.metadata?.businessDomain || entry.metadata?.workflowSteps?.length) {
      businessContextApplied.push({ id: entry.id, kind: entry.kind, summary: entry.summary, metadata: entry.metadata ?? {} });
    }
  }
  const learnedPrefer = new Set();
  const learnedPatterns = [];
  if (learningContext?.status === 'enabled' && Array.isArray(learningContext.recommendationInferences)) {
    for (const inference of learningContext.recommendationInferences) {
      if (inference?.confidence?.level !== 'established' || !Array.isArray(inference.capabilityIds)) continue;
      const skillIds = inference.capabilityIds.filter((id) => CAPABILITY_CARDS.some((card) => card.id === id));
      if (skillIds.length === 0) continue;
      skillIds.forEach((id) => learnedPrefer.add(id));
      learnedPatterns.push({
        id: inference.id,
        kind: inference.kind,
        capabilityIds: skillIds,
        confidence: inference.confidence,
        evidence: inference.evidence
      });
    }
  }
  // Automatic learning exposes only controlled labels and aggregate profile
  // values. Use them to explain why a recommendation is more vertical, while
  // keeping the original task and any raw business text out of the plan.
  const learnedBusinessDomains = Array.isArray(learningContext?.businessContexts)
    ? learningContext.businessContexts.filter((value) => typeof value === 'string')
    : [];
  const learnedProfile = Array.isArray(learningContext?.workProfile) ? learningContext.workProfile : [];
  const learnedAudience = learnedProfile
    .filter((item) => item?.category === 'audience')
    .sort((a, b) => (b.observations ?? 0) - (a.observations ?? 0))[0]?.value ?? null;
  return { prefer, avoid, applied, businessContextApplied, learnedPrefer, learnedPatterns, learnedBusinessDomains, learnedAudience };
}

function intentScore(card, task) {
  return INTENT_BOOSTS
    .filter((rule) => rule.cardId === card.id && rule.pattern.test(task))
    .reduce((total, rule) => total + rule.score, 0);
}

function cardIsEligible(card, brief, preferences) {
  if (preferences.avoid.has(card.id)) return false;
  if (brief.dataSensitivity !== 'public' && card.id === 'public-data-analysis') return false;
  if (brief.dataSensitivity === 'public' && card.id === 'private-data-analysis') return false;
  return true;
}

function scoreCard(card, brief, preferences) {
  const taskTerms = terms(`${brief.task} ${brief.deliverable ?? ''}`);
  const tags = card.taskTags.map((tag) => tag.toLocaleLowerCase());
  const hits = taskTerms.reduce((total, term) => total + tags.filter((tag) => tag.includes(term) || term.includes(tag)).length, 0);
  const directPhrase = card.taskTags.some((tag) => brief.task.toLocaleLowerCase().includes(tag.toLocaleLowerCase())) ? 3 : 0;
  const setupPenalty = brief.setupComfort === 'low' && card.requirements.setup === 'advanced' ? -5 : 0;
  const explicitPreferenceBoost = preferences.prefer.has(card.id) ? 8 : 0;
  // Automatic learning is intentionally weaker than a direct user preference.
  // A recurring pattern should personalize an ambiguous task, never override a
  // clear task intent or an explicit avoid/prefer decision.
  const learnedPreferenceBoost = preferences.learnedPrefer.has(card.id) ? 5 : 0;
  return hits + directPhrase + intentScore(card, brief.task) + explicitPreferenceBoost + learnedPreferenceBoost + setupPenalty;
}

function canSupport(primary, candidate) {
  const follows = candidate.composition.follows ?? [];
  if (follows.includes(primary.id)) return true;
  const primaryOutputs = new Set(primary.composition.produces ?? []);
  return (candidate.composition.consumes ?? []).some((input) => primaryOutputs.has(input));
}

function selectCards(brief, preferences) {
  const scored = CAPABILITY_CARDS
    .filter((card) => cardIsEligible(card, brief, preferences))
    .map((card) => ({ card, score: scoreCard(card, brief, preferences) }))
    .sort((left, right) => right.score - left.score || left.card.id.localeCompare(right.card.id));
  const primary = scored[0]?.score > 0
    ? scored[0].card
    : CAPABILITY_CARDS.find((card) => card.id === 'project-planning');
  let support = scored
    .filter(({ card, score }) => card.id !== primary.id && score > 0 && canSupport(primary, card))
    .slice(0, 2)
    .map(({ card }) => card);
  const requestsPresentationDesign = /(视觉设计|视觉排版|排版|版式|配色|presentation design|layout|visual design)/iu.test(brief.task);
  if (!requestsPresentationDesign) support = support.filter((card) => card.id !== 'presentation-design');
  // A topic/industry PPT implicitly needs knowledge acquisition before slide
  // production, even when the user only says "make a PPT".
  const needsResearchBeforeSlides = ['presentation-outline', 'presentation-production'].includes(primary.id) &&
    /(行业|市场|趋势|最新|发展|竞品|industry|market|trend|latest)/iu.test(brief.task);
  if (needsResearchBeforeSlides) {
    const research = CAPABILITY_CARDS.find((card) => card.id === 'research-with-citations');
    support = support.filter((card) => card.id !== research.id);
    support.unshift(research);
    support = support.slice(0, 3);
  }
  if (requestsPresentationDesign && (['presentation-outline', 'presentation-production'].includes(primary.id) || needsResearchBeforeSlides || support.some((card) => ['presentation-outline', 'presentation-production'].includes(card.id)))) {
    const design = CAPABILITY_CARDS.find((card) => card.id === 'presentation-design');
    if (design && !support.some((card) => card.id === design.id)) support.push(design);
  }
  if (/(润色|文字|文案|polish|editing)/iu.test(brief.task)) {
    const polish = CAPABILITY_CARDS.find((card) => card.id === 'writing-polish');
    if (polish && !support.some((card) => card.id === polish.id)) support.push(polish);
  }
  if (['presentation-outline', 'presentation-production'].includes(primary.id) && support.some((card) => card.id === 'research-with-citations')) {
    // Research is the prerequisite; keep the slide capability as the only
    // downstream card instead of listing the same research card twice.
    return {
      primary: CAPABILITY_CARDS.find((card) => card.id === 'research-with-citations'),
      support: [primary, ...support.filter((card) => card.id !== primary.id && card.id !== 'research-with-citations')].slice(0, 3)
    };
  }
  return { primary, support };
}

function stepsFor(primary, supporting) {
  const steps = [
    `确认输入范围、敏感度和目标交付物，再使用 ${primary.name}。`,
    `审阅 ${primary.name} 的中间结果与风险提示。`
  ];
  for (const card of supporting) steps.push(`仅在需要时，将已审阅输出交给 ${card.name}。`);
  steps.push('在宿主 Agent 中完成任务，并对该 Skill Plan 给出“完成 / 不适用 / 卡住”反馈。');
  return steps;
}

function taskBreakdown(brief, primary, supporting) {
  const cards = [primary, ...supporting];
  const taskText = `${brief.task} ${brief.deliverable ?? ''}`.toLocaleLowerCase();
  const requirements = inferTaskRequirements(brief);
  const domainContext = Object.entries(BUSINESS_DOMAIN_TERMS)
    .filter(([, pattern]) => pattern.test(taskText))
    .map(([domain]) => domain);
  const steps = cards.map((card, index) => {
    const searchTerms = discoveryTermsFor(card.id);
    const substeps = card.id === 'research-with-citations'
      ? ['明确研究问题、时间范围和判断标准', '按关键词检索公开来源并记录原始链接', '筛选来源质量，区分事实、观点与宣传', '对关键结论进行至少两处来源交叉核对', '输出带引用的发现、分歧和待确认问题']
      : CARD_SUBSTEPS[card.id] ?? ['确认输入范围、目标和验收标准', '执行该能力的核心处理并记录关键假设', '检查中间结果、风险和需要人工确认的内容', '整理为可交接的结构化输出'];
    return {
      order: index + 1,
      capabilityId: card.id,
      role: index === 0 ? '核心步骤' : '后续步骤（可选）',
      objective: index === 0
        ? `先完成「${card.userGuide.displayName}」，解决任务的主要目标。`
        : `将前一步已核对的结果交给「${card.userGuide.displayName}」，形成下一项交付物。`,
      input: index === 0 ? '用户任务与已选择的资料' : `第 ${index} 步的已审阅输出`,
      output: card.outputs,
      substeps,
      phase: index === 0 ? '前置知识／数据或核心处理阶段' : '后置交付物制作阶段',
      dependsOn: index === 0 ? [] : [cards[index - 1].id],
      componentSearchRequired: true,
      componentReason: '该阶段需要宿主之外的专项能力，搜索一个最小够用的 Skill、MCP 或插件。',
      searchKeywords: searchTerms,
      keywordReason: '使用英文能力词搜索通用可安装组件；业务主题只用于判断适配度，不作为必须出现在项目名称中的条件。'
    };
  });
  const researchIndex = steps.findIndex((step) => step.capabilityId === 'research-with-citations');
  const productionIndex = steps.findIndex((step) => ['presentation-outline', 'presentation-production', 'report-formatter'].includes(step.capabilityId));
  if (researchIndex !== -1 && productionIndex !== -1 && researchIndex < productionIndex) {
    steps.splice(productionIndex, 0, {
      order: productionIndex + 1,
      capabilityId: 'evidence-synthesis',
      role: '主 Agent 内部步骤',
      objective: '整合并分析研究资料，形成可直接用于最终交付物的结论结构。',
      input: `第 ${researchIndex + 1} 步的带引用研究结果`,
      output: ['verified findings', 'analysis structure', 'source map'],
      substeps: ['合并重复资料并统一口径', '按主题、时间和证据强度归类', '比较不同来源并解释冲突', '提炼趋势、判断和不确定性', '形成供下一步使用的结构化内容'],
      phase: '整合与分析阶段',
      dependsOn: ['research-with-citations'],
      componentSearchRequired: false,
      componentReason: '默认由当前主 Agent 完成，不为这个中间步骤额外安装组件；只有数据规模或分析要求超出宿主能力时才升级。',
      searchKeywords: [],
      keywordReason: '无需单独搜索，避免为中间处理增加不必要组件。'
    });
  }
  steps.forEach((step, index) => {
    step.order = index + 1;
    if (index > 0) step.dependsOn = [steps[index - 1].capabilityId];
    if (index > 0 && step.input.startsWith('第 ')) step.input = `第 ${index} 步的已审阅输出`;
  });
  return {
    userGoal: brief.task,
    deliverable: requirements.deliverable,
    dataSensitivity: brief.dataSensitivity,
    taskRequirements: requirements,
    domainContext,
    decompositionRationale: '先识别交付物、研究深度、时效要求、来源类型和运行环境，再拆成必要阶段；工作阶段不等于必须安装组件。',
    decomposition: steps,
    searchStrategy: {
      beforeConsent: '只展示关键词与检索计划，不联网。',
      afterConsent: '仅使用下列关键词组合检索允许的平台，并先审阅 README、SKILL.md、MCP 或插件清单及许可证。',
      candidateTypes: ['Skill', 'MCP server', '宿主插件/扩展', '可安装的开源项目'],
      matchingPriority: [...MATCH_PRIORITY],
      minimalityRule: '先选择满足交付物、研究深度、时效、来源和运行环境的最小组件；功能更全面不是加分项，额外设置、权限和重复能力会降低排序。',
      installabilityRule: '只要 README 或官方清单明确说明宿主兼容性、安装方式、版本、权限、文件与卸载方式，候选即可进入安装审核；SKILL.md 不是硬性要求，普通参考项目仍不会被当成可安装组件。',
      terms: [...new Set(steps.filter((step) => step.componentSearchRequired).flatMap((step) => step.searchKeywords))],
      excluded: brief.dataSensitivity === 'public'
        ? ['凭证、文件内容、未要求的个人信息']
        : ['任务原文、文件内容、客户名、项目代号、凭证']
    }
  };
}

function useConditions(card, brief) {
  const conditions = [];
  if (card.risk.externalDataSharing) {
    conditions.push(brief.allowWeb
      ? '可使用公開網路資料；仍不得把內部或敏感內容送到外部來源。'
      : '這一步需要聯網授權；授權前只能先規劃研究，不會開始搜尋。');
  } else if (brief.dataSensitivity !== 'public') {
    conditions.push('只使用你已選擇的工作區內容；不把非公開資料帶到外部調研。');
  } else {
    conditions.push('使用你選擇的輸入；此能力卡本身不需要聯網。');
  }
  if (card.risk.notes.length > 0) conditions.push(...card.risk.notes);
  return conditions;
}

function userFacingCard(card, { role, step, primary, brief }) {
  const guide = card.userGuide;
  const isPrimary = role === 'primary';
  return {
    id: card.id,
    role: isPrimary ? '核心 Skill' : '輔助 Skill（可選）',
    step,
    name: guide.displayName,
    whatItDoes: guide.whatItDoes,
    whyRecommended: isPrimary
      ? '它最直接對應本次任務的主要目標與交付物。'
      : `它接在「${primary.userGuide.displayName}」之後，將已確認的中間結果轉成下一個交付物。`,
    bestFor: guide.bestFor,
    keyFeatures: guide.keyFeatures,
    advantages: guide.advantages,
    expectedOutputs: card.outputs,
    conditions: useConditions(card, brief),
    limitations: guide.limitations,
    availability: 'AgentFit 固定能力卡：目前不是已安裝的第三方 Skill。基礎工作流可由宿主 Agent 直接執行；若要替換成外部 Skill，必須先取得來源證據並由你確認安裝。'
  };
}

function userFacingPlan({ primary, support, brief, webPermissionNeeded, breakdown, capabilityResolution, qualityGate, inventoryStatus }) {
  const selected = [primary, ...support];
  return {
    title: '推薦的 Skill 工作流',
    summary: webPermissionNeeded
      ? '我已先完成離線規劃；其中的公開調研步驟會在你允許聯網後才開始。'
      : '這是一個可直接在宿主 Agent 中執行的最小工作流；不會因此自動安裝任何第三方 Skill。',
    cards: selected.map((card, index) => userFacingCard(card, {
      role: index === 0 ? 'primary' : 'supporting',
      step: index + 1,
      primary,
      brief
    })),
    taskDecompositionPrompt: '先识别交付物、研究深度、时效要求、来源类型和运行环境，再拆出完成任务必需的阶段。行业最新发展 PPT 通常只拆为：研究、整合与分析资料、制作 PPT。工作阶段不等于安装组件：整合分析默认由主 Agent 完成，只为研究和 PPT 制作寻找 Skill、MCP 或插件。候选按交付物匹配、研究深度、时效、来源、运行环境、最小性依次排序；不要因为工具功能更多而把它排在更贴合任务的轻量工具之前。发现候选后停下，等待用户确认安装或使用固定流程。',
    taskBreakdown: breakdown,
    capabilityResolution: {
      inventoryCount: capabilityResolution.inventoryCount,
      inventoryMode: capabilityResolution.inventoryMode,
      inventoryStatus: inventoryStatus.status,
      inventoryReason: inventoryStatus.reason,
      policy: capabilityResolution.policy,
      inventoryReview: capabilityResolution.inventoryReview,
      assignments: capabilityResolution.assignments.map((assignment) => ({
        stepOrder: assignment.stepOrder,
        capabilityId: assignment.capabilityId,
        status: assignment.status,
        component: assignment.component ? { id: assignment.component.id, name: assignment.component.name, type: assignment.component.type } : null,
        reason: assignment.reason
      })),
      discoveryNeededFor: capabilityResolution.discoveryCapabilityIds
    },
    workflowValue: '先完成並審閱前一步，再把已確認的輸出交給下一步；這能避免把未核實的內容包裝成報告、簡報或對外溝通。',
    installationBoundary: '推薦的是能力與工作流，不等於已找到或已安裝外部 Skill。任何候選都需先展示來源、版本、權限、腳本與卸載方式，再由你確認。',
      executionGate: {
      status: capabilityResolution.readyForHostExecution ? 'user-confirmation-required' : 'capability-decision-required',
      prompt: inventoryStatus.verified && capabilityResolution.readyForHostExecution
        ? '现有能力已经覆盖工作流。是否按以上步骤开始正式执行任务？'
        : !inventoryStatus.verified
          ? inventoryStatus.nextAction
        : '仍有能力缺口。请先选择安装推荐候选，或明确同意使用主 Agent 的备用流程；确认前不会开始制作正式交付物。',
      rule: '任务拆解、能力盘点和只读候选发现可以自动进行；生成报告、PPT、表格或其他正式交付物前必须等待用户明确确认。'
    },
    qualityGate: {
      owner: 'AgentFit',
      timing: '主 Agent 完成交付物后立即执行。',
      criteria: qualityGate.criteria.map(({ id, description }) => ({ id, description })),
      maxRevisionAttempts: qualityGate.maxRevisionAttempts,
      passEffect: '通过且用户接受后，才把本次组件组合记录为可复用成功工作流。'
    },
    discoveryConsent: {
      prompt: '联网调研已默认开启。以上任务拆解完成后，我会按列出的关键词自动只读检索 GitHub（WorkBuddy 另加原生 Skill 搜索）；你只需要在看到候选后决定是否进入安装审核。',
      beforeConsent: '任务拆解后会自动按关键词进行只读检索；不会下载、安装或执行任何外部组件。',
      afterConsent: '搜索结果会展示仓库／README／SKILL.md／MCP 或插件清单／LICENSE 链接与审阅结果；搜索不等于安装。展示结果后会再次停住，不会直接执行原任务；若搜索失败，会先询问是否改用固定能力模板。',
      decline: '你可以拒绝安装或改用固定能力模板；联网检索本身不会安装或执行候选。'
    },
    hostHandoff: {
      afterInstall: 'handoff_to_host_agent',
      message: '外部组件完成用户确认的安装后，重新盘点能力并询问是否开始正式执行；主 Agent 完成交付物后，AgentFit 继续负责质量验收。',
      agentFitDoesNot: ['不代替宿主執行原始任務', '不把宿主的執行結果宣稱為 AgentFit 產出']
    },
    learningNotice: {
      automatic: true,
      stores: '本机自动保存能力 ID、受控业务领域、结构化工作画像、匿名项目范围、验收结果，以及通过验收且被用户接受的组件组合；不保存任务原文、文件、凭证、客户名或项目代号。',
      purpose: '下一次优先复用已经安装并在相似任务中成功通过验收的组件与执行顺序。',
      dailyResearch: '每日外部调研默认关闭，与本地学习分离；只有用户单独开启后才运行。',
      controls: '用户可随时查看 learning-status，或使用 learning-forget --confirm-delete 删除该宿主的全部 AgentFit 学习记录。'
    }
  };
}

function githubResearchBrief(brief, primary, breakdown, capabilityResolution, learnedDomains = [], learnedAudience = null) {
  const taskTerms = brief.dataSensitivity === 'public'
    ? [...new Set([
      ...safeSearchTerms(`${brief.task} ${brief.deliverable ?? ''}`, 8),
      ...(breakdown?.searchStrategy?.terms ?? []),
      ...learnedDomains,
      ...(learnedAudience ? [learnedAudience] : [])
    ])].slice(0, 14).join(' ')
    : (GITHUB_DISCOVERY_TERMS[primary.id]?.join(' ') ?? 'office workflow');
  const platformTerms = {
    workbuddy: 'WorkBuddy',
    codex: 'Codex .agents/skills',
    'claude-code': 'Claude Code .claude'
  };
  const platform = { workbuddy: 'WorkBuddy', codex: 'Codex .agents/skills', 'claude-code': 'Claude Code .claude' }[brief.hostPlatform];
  const missingCapabilities = new Set(capabilityResolution.discoveryCapabilityIds);
  const queriesByStep = (breakdown?.decomposition ?? []).filter((step) => missingCapabilities.has(step.capabilityId)).map((step) => {
    const terms = step.searchKeywords?.join(' ') || 'office workflow';
    return {
      order: step.order,
      capabilityId: step.capabilityId,
      query: `(SKILL.md OR MCP OR plugin OR agent) ${terms} ${platform} in:readme archived:false`,
      purpose: `为第 ${step.order} 步「${step.capabilityId}」寻找最小够用的可安装或可接入能力。`,
      matchProfile: {
        ...breakdown.taskRequirements,
        researchDepth: step.capabilityId === 'research-with-citations' ? breakdown.taskRequirements.researchDepth : 'none',
        freshness: step.capabilityId === 'research-with-citations' ? breakdown.taskRequirements.freshness : 'not-required',
        sourceTypes: step.capabilityId === 'research-with-citations' ? breakdown.taskRequirements.sourceTypes : [],
        capabilityId: step.capabilityId,
        requiredOutputs: step.output,
        searchKeywords: step.searchKeywords
      }
    };
  });
  return {
    automaticDiscoveryForEligibleTasks: true,
    source: 'github',
    query: `(SKILL.md OR MCP OR plugin OR agent) ${taskTerms} ${platformTerms[brief.hostPlatform]} in:readme archived:false`,
    queriesByStep,
    recommendationRule: '候选必须按 decomposition 中需要组件的 capabilityId 归类。先匹配交付物、研究深度、时效、来源类型和运行环境，再比较安装成本与能力范围；满足要求的轻量组件优先于大而全工具。',
    reviewOrder: ['README', 'referenced SKILL.md', 'LICENSE evidence', 'release/maintenance evidence', 'scripts and permission declarations'],
    restriction: brief.dataSensitivity === 'public'
      ? '只读证据采集；不下载、不执行、不安装候选代码。'
      : '当前任务含非公开资料：只使用通用脱敏关键词，不发送任务内容、文件或业务上下文。'
  };
}

export function createSkillPlan(input) {
  const brief = normalizeTaskBrief(input);
  const safety = safetyAssessment(brief);
  if (safety.status === 'blocked') {
    return { status: 'blocked', hostPlatform: brief.hostPlatform, block: safety.block, alerts: safety.alerts };
  }
  const applicableMemory = applicableMemoryEntries(brief, input.memoryEntries);
  const preferences = preferenceProfile(applicableMemory, input.learningContext);
  const { primary, support } = selectCards(brief, preferences);
  const breakdown = taskBreakdown(brief, primary, support);
  const legacyInventory = input.inventoryDocument === undefined && input.inventoryMode === undefined && input.installedComponents === undefined;
  const inventoryStatus = legacyInventory
    ? { status: 'verified', verified: true, reason: '使用 API 兼容模式：调用方未声明宿主 inventory 状态。', nextAction: '可根据传入的组件数组进行能力匹配。' }
    : hostInventoryStatus(input.inventoryDocument ?? { hostPlatform: brief.hostPlatform, mode: input.inventoryMode ?? 'verified', components: input.installedComponents ?? [] }, { hostPlatform: brief.hostPlatform });
  const inventoryComponents = input.installedComponents
    ?? input.inventoryDocument?.components
    ?? [];
  const capabilityResolution = resolveCapabilityPlan({
    steps: breakdown.decomposition,
    inventory: inventoryComponents,
    successfulWorkflows: input.learningContext?.successfulWorkflows ?? [],
    hostPlatform: brief.hostPlatform,
    inventoryMode: input.inventoryMode ?? (legacyInventory ? 'legacy' : inventoryStatus.verified ? 'verified' : inventoryStatus.status)
  });
  for (const step of breakdown.decomposition) {
    const assignment = capabilityResolution.assignments.find((item) => item.stepOrder === step.order);
    step.componentResolution = assignment?.status ?? 'unknown';
    step.componentSearchNeeded = assignment?.status === 'capability-gap';
  }
  const qualityGate = createQualityGate({ taskRequirements: breakdown.taskRequirements, decomposition: breakdown.decomposition });
  const taskDomains = Object.entries(BUSINESS_DOMAIN_TERMS)
    .filter(([, pattern]) => pattern.test(brief.task))
    .map(([domain]) => domain);
  const matchedLearnedDomains = preferences.learnedBusinessDomains.filter((domain) => taskDomains.includes(domain));
  const learnedContextApplied = matchedLearnedDomains.map((domain) => ({
    kind: 'learned-business-context',
    businessDomain: domain,
    audience: preferences.learnedAudience,
    reason: preferences.learnedAudience === 'executive'
      ? `你過去多次處理 ${domain} 領域的管理層工作，因此本次優先尋找更適合高管決策的能力。`
      : `你過去多次處理 ${domain} 領域工作，因此本次優先尋找更垂直的能力。`
  }));
  const selectedSkills = [primary, ...support];
  const webPermissionNeeded = !brief.allowWeb && selectedSkills.some((skill) => skill.risk.externalDataSharing === true);
  const planSeed = JSON.stringify({ task: brief.task, host: brief.hostPlatform, primary: primary.id, support: support.map(({ id }) => id), memory: preferences.applied.map(({ id }) => id) });
  const planId = `plan_${createHash('sha256').update(planSeed).digest('hex').slice(0, 12)}`;
  const sources = sourcePolicyFor(brief.hostPlatform);
  return {
    status: 'recommended',
    plan: {
      id: planId,
      hostPlatform: brief.hostPlatform,
      primarySkill: primary,
      supportingSkills: support,
      userFacing: userFacingPlan({ primary, support, brief, webPermissionNeeded, breakdown, capabilityResolution, qualityGate, inventoryStatus }),
      steps: stepsFor(primary, support),
      reasons: [
        `${primary.name} 与任务意图、交付物和安全约束匹配。`,
        `当前宿主 ${brief.hostPlatform} 只允许使用：${sources.join('、')}。`,
        '计划保持最小化：1 个核心 Skill，按任务需要提供最多 3 个串联的支持 Skill。',
        ...learnedContextApplied.map((context) => context.reason),
        ...(preferences.learnedPatterns.length > 0
          ? ['已谨慎参考已建立的本机工作模式；显式偏好与当前任务意图仍优先。']
          : [])
      ],
      capabilityStatus: 'fixed-capability-template — 需通过平台目录或 GitHub 证据绑定为真实可安装 Skill。',
      hostInventory: inventoryStatus,
      sourcePolicy: sources,
      workbuddySearchHandoff: workBuddySearchHandoff(brief, primary.name),
      githubResearch: githubResearchBrief(brief, primary, breakdown, capabilityResolution, matchedLearnedDomains, preferences.learnedAudience),
      capabilityResolution,
      qualityGate,
      hostExecutionHandoff: {
        status: capabilityResolution.readyForHostExecution ? 'awaiting-user-execution-confirmation' : 'needs-component-discovery',
        orderedAssignments: capabilityResolution.assignments,
        afterExecution: 'Return artifact evidence to AgentFit quality-check before presenting the task as complete.',
        finalOwner: 'The host Agent executes each step; AgentFit owns capability routing, the final quality gate, and reusable-workflow learning.'
      },
      confirmationRequired: [
        '确认输入资料的敏感度与是否允许联网。',
        '查看任务拆解、现有能力匹配和候选选择后，确认是否开始生成正式交付物。',
        ...(webPermissionNeeded ? ['此工作流包含外部调研能力：执行前必须取得联网授权；在授权前只能完成离线规划。'] : []),
        ...(capabilityResolution.gaps.length > 0 ? ['任何第三方 Skill 安装前，确认精确版本、来源、权限、脚本、范围与卸载方式。'] : [])
      ],
      executionReadiness: webPermissionNeeded
        ? 'needs-web-permission'
        : capabilityResolution.gaps.length > 0
          ? 'needs-component-discovery'
        : 'needs-user-execution-confirmation',
      personalisationApplied: preferences.applied,
      businessContextApplied: [...preferences.businessContextApplied, ...learnedContextApplied],
      learnedBusinessContexts: input.learningContext?.businessContexts ?? [],
      learnedWorkProfile: input.learningContext?.workProfile ?? [],
      personalization: learnedContextApplied.length > 0
        ? { applied: true, businessDomains: matchedLearnedDomains, audience: preferences.learnedAudience, explanation: learnedContextApplied.map((context) => context.reason) }
        : { applied: false, businessDomains: [], audience: null, explanation: [] },
      learnedPatternsApplied: preferences.learnedPatterns
    },
    alerts: safety.alerts,
    evidence: { catalogVersion: CATALOG_VERSION, ruleVersion: '0.3.0' }
  };
}
