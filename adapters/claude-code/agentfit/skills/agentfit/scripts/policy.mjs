export const HOST_PLATFORMS = ['workbuddy', 'codex', 'claude-code'];

export const RESEARCH_SOURCE_POLICY = Object.freeze({
  workbuddy: ['workbuddy-native-search-handoff', 'github'],
  codex: ['github'],
  'claude-code': ['github']
});

export class AgentFitInputError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AgentFitInputError';
  }
}

export function normalizeTaskBrief(input) {
  if (!input || typeof input !== 'object') {
    throw new AgentFitInputError('TaskBrief must be an object.');
  }
  const task = String(input.task ?? '').trim();
  const hostPlatform = String(input.hostPlatform ?? input.host ?? '').trim();
  if (!task) throw new AgentFitInputError('TaskBrief.task is required.');
  if (!HOST_PLATFORMS.includes(hostPlatform)) {
    throw new AgentFitInputError(`hostPlatform must be one of: ${HOST_PLATFORMS.join(', ')}.`);
  }
  const dataSensitivity = input.dataSensitivity ?? 'public';
  if (!['public', 'internal', 'restricted'].includes(dataSensitivity)) {
    throw new AgentFitInputError('dataSensitivity must be public, internal, or restricted.');
  }
  return {
    task,
    hostPlatform,
    deliverable: input.deliverable ? String(input.deliverable) : null,
    projectId: input.projectId ? String(input.projectId).trim() : null,
    dataSensitivity,
    // AgentFit is an online discovery layer by default. A task can still
    // explicitly prohibit networking, in which case the host returns an
    // offline plan and explains which discovery steps are deferred.
    allowWeb: input.allowWeb !== false,
    setupComfort: input.setupComfort ?? 'guided',
    personalisationEnabled: input.personalisationEnabled === true,
    memoryHints: Array.isArray(input.memoryHints) ? input.memoryHints.map(String) : []
  };
}

export function sourcePolicyFor(hostPlatform) {
  return [...RESEARCH_SOURCE_POLICY[hostPlatform]];
}

export function needsFreshResearch(task) {
  const asksForFreshness = /(latest|recent|current|new(?:ly)?|最新|近期|新上传|新上架)/iu.test(task);
  const isResearchRequest = /(research|market|source|skill|repository|调研|市场|资料|技能|仓库)/iu.test(task);
  return asksForFreshness && isResearchRequest;
}

const UNSAFE_QUERY_TERMS = new Set([
  'ignore', 'instruction', 'instructions', 'system', 'prompt', 'safety', 'install', 'all', 'every',
  '忽略', '指令', '系统', '提示', '安全', '安装', '所有', '全部', '执行'
]);

export function safeSearchTerms(value, limit = 6) {
  return String(value ?? '')
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .split(/\s+/u)
    .map((term) => term.trim())
    .filter((term) => {
      const lower = term.toLocaleLowerCase();
      return term.length > 1 && ![...UNSAFE_QUERY_TERMS].some((unsafe) => lower.includes(unsafe));
    })
    .slice(0, limit);
}

export function safetyAssessment(brief) {
  const alerts = [];
  if (needsFreshResearch(brief.task) && !brief.allowWeb) {
    return {
      status: 'blocked',
      block: {
        code: 'web-not-allowed',
        reason: '当前任务要求最新/近期资料，但任务约束禁止联网。',
        safeNextSteps: ['允许联网后重新生成计划', '提供已下载的公开资料后离线处理']
      },
      alerts
    };
  }
  if (brief.dataSensitivity !== 'public' && brief.allowWeb) {
    alerts.push('任务含非公开数据：GitHub 调研只能使用脱敏关键词，不能发送任务内容、文件或业务上下文。');
  }
  return { status: 'ok', alerts };
}

export function workBuddySearchHandoff(brief, primarySkillName) {
  if (brief.hostPlatform !== 'workbuddy') return null;
  const coreTerms = brief.dataSensitivity === 'public'
    ? safeSearchTerms(brief.task)
    : ['office', 'workflow'];
  return {
    source: 'workbuddy-native-search-handoff',
    query: [primarySkillName, ...coreTerms, 'Skill'].join(' '),
    userAction: '在 WorkBuddy 中打开“查找 Skill”，粘贴搜索词后逐项查看来源、权限与脚本。',
    checklist: [
      '确认该 Skill 的任务范围与当前任务相符。',
      '查看来源、条款/许可证和维护状态。',
      '确认是否联网、读写文件、要求账户或执行脚本。',
      '确认安装范围与卸载方式。'
    ]
  };
}
