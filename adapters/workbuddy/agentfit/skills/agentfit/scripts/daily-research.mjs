import { getCard, GITHUB_DISCOVERY_TERMS } from './catalog.mjs';
import { GitHubScout } from './github.mjs';
import { workBuddySearchHandoff } from './policy.mjs';

function topicFromInference(inference) {
  const cards = inference.capabilityIds.map(getCard).filter(Boolean);
  const terms = [...new Set(inference.capabilityIds.flatMap((id) => GITHUB_DISCOVERY_TERMS[id] ?? []))].slice(0, 5);
  if (cards.length === 0 || terms.length === 0) return null;
  return {
    ...inference,
    label: cards.map((card) => card.name).join(' + '),
    searchTask: terms.join(' ')
  };
}

function uniqueCandidateReferences(reports, knownRepositories) {
  const seen = new Set();
  const references = [];
  for (const report of reports) {
    for (const candidate of report.result?.candidates ?? []) {
      if (seen.has(candidate.repository) || knownRepositories.has(candidate.repository)) continue;
      seen.add(candidate.repository);
      references.push(candidate);
    }
  }
  return references;
}

export async function runDailySkillResearch({ learningStore, hostPlatform, scout = new GitHubScout(), maxCandidates = 3, now = new Date(), force = false } = {}) {
  if (!learningStore || typeof learningStore.prepareDailyResearch !== 'function') {
    throw new TypeError('A LearningStore is required.');
  }
  const prepared = await learningStore.prepareDailyResearch({ hostPlatform, now, force });
  if (prepared.status !== 'due') return prepared;
  const topics = prepared.topics.map(topicFromInference).filter(Boolean);
  const knownRepositories = await learningStore.knownCandidateRepositories({ hostPlatform });
  const reports = await Promise.all(topics.map(async (topic) => {
    try {
      const result = await scout.scout({
        hostPlatform,
        task: topic.searchTask,
        dataSensitivity: 'public',
        allowWeb: true,
        maxCandidates
      });
      return { topic, status: 'completed', result };
    } catch (error) {
      return { topic, status: 'failed', error: { name: error.name, message: error.message } };
    }
  }));
  const candidateReferences = uniqueCandidateReferences(reports, knownRepositories);
  const digest = candidateReferences.map((candidate) => {
    const matchingTopics = reports.filter((report) => (report.result?.candidates ?? []).some((item) => item.repository === candidate.repository)).map((report) => report.topic);
    return {
      repository: candidate.repository,
      url: candidate.url,
      title: candidate.description || candidate.repository,
      whatItDoes: candidate.description || '仓库未提供足够说明，暂时无法确认具体能力。',
      bestFor: matchingTopics.length > 0
        ? `适合「${matchingTopics.map((topic) => topic.label).join('、')}」相关工作。`
        : '暂未确认适用场景。',
      keyFeatures: [
        candidate.readme?.skillDocumentMentioned ? 'README 提及 Skill 文档' : '未确认 Skill 文档',
        candidate.readme?.installationMentioned ? 'README 提供安装或使用说明' : '未确认安装说明',
        candidate.readme?.compatibilityEvidence?.length ? `宿主兼容性：${candidate.readme.compatibilityEvidence.join('、')}` : '未确认宿主兼容性'
      ],
      advantages: matchingTopics.length > 0
        ? [`与已记录的${matchingTopics.map((topic) => topic.label).join('、')}工作模式相关`, '可先查看公开证据，再决定是否进入安装审核']
        : ['仅作为公开项目线索，不宣称适合当前用户'],
      expectedOutputs: ['候选项目说明', 'README/许可证/权限审阅结果', '是否进入安装审核的建议'],
      limitations: [
        candidate.reviewStatus === 'reviewable' ? '仍需用户确认版本、权限和安装范围。' : '证据不足，不能作为已验证可安装组件。',
        '每日简报不会下载、安装或执行候选。'
      ],
      relevance: matchingTopics.map((topic) => ({
        label: topic.label,
        capabilityIds: topic.capabilityIds,
        reason: `匹配用户已建立的「${topic.label}」工作模式。`
      })),
      reviewStatus: candidate.reviewStatus,
      action: candidate.reviewStatus === 'reviewable' ? 'user_review_required' : 'read_only_reference',
      neverExecuted: true
    };
  });
  const runStatus = reports.every((report) => report.status === 'completed')
    ? 'completed'
    : reports.some((report) => report.status === 'completed')
      ? 'partial'
      : 'failed';
  const recorded = await learningStore.recordDailyResearch({
    hostPlatform,
    day: prepared.day,
    topics,
    candidateReferences,
    status: runStatus,
    now
  });
  return {
    status: 'researched',
    digest: {
      format: 'personalized-daily-project-brief',
      title: '今日个性化能力简报',
      summary: `${digest.filter((item) => item.action === 'user_review_required').length} 个可进入审核的推荐，${digest.filter((item) => item.action === 'read_only_reference').length} 个仅供参考。`,
      recommendations: digest.filter((item) => item.action === 'user_review_required'),
      references: digest.filter((item) => item.action === 'read_only_reference')
    },
    hostPlatform,
    day: prepared.day,
    newCandidateCount: candidateReferences.length,
    topics: reports.map(({ topic, status, result, error }) => ({
      inferenceId: topic.inferenceId,
      capabilityIds: topic.capabilityIds,
      label: topic.label,
      status,
      github: result ?? null,
      newCandidates: (result?.candidates ?? []).filter((candidate) => candidateReferences.some((reference) => reference.repository === candidate.repository)),
      error: error ?? null,
      workbuddySearchHandoff: hostPlatform === 'workbuddy'
        ? workBuddySearchHandoff({ hostPlatform, task: topic.searchTask, dataSensitivity: 'public' }, topic.label)
        : null
    })),
    recorded,
    installPolicy: 'Daily research only collects GitHub review evidence and WorkBuddy search handoffs. It never installs, updates, enables, or executes a candidate Skill.'
  };
}
