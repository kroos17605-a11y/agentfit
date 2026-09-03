import { safeSearchTerms, sourcePolicyFor, normalizeTaskBrief } from './policy.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export class GitHubResearchError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.name = 'GitHubResearchError';
    this.status = status;
  }
}

export const GITHUB_TOKEN_SETUP = Object.freeze({
  url: 'https://github.com/settings/personal-access-tokens/new',
  permissions: 'Public repositories: read-only (Contents and Metadata)',
  environmentVariable: 'GITHUB_TOKEN',
  note: 'Token 只用于 GitHub API 只读检索，不会写入项目文件或发送给 AgentFit。'
});

function hostEvidenceTerms(hostPlatform) {
  return {
    workbuddy: ['workbuddy'],
    codex: ['codex', '.agents/skills', '.codex-plugin'],
    'claude-code': ['claude code', '.claude', '.claude-plugin']
  }[hostPlatform];
}

function sanitizedTopic(task, dataSensitivity) {
  if (dataSensitivity !== 'public') return 'office workflow';
  const result = safeSearchTerms(task, 8);
  const aliases = [
    ['机器人', 'robotics'], ['行业', 'industry'], ['发展', 'trends'], ['最新', 'latest'],
    ['调研', 'research'], ['研究', 'research'], ['报告', 'report'], ['周报', 'weekly report'],
    ['数据', 'data analysis'], ['分析', 'analysis'], ['PPT', 'presentation slides'],
    ['润色', 'writing editing'], ['设计', 'presentation design'], ['方案', 'proposal'],
    ['产品', 'product management'], ['项目', 'project planning']
  ];
  const expanded = aliases.flatMap(([term, alias]) => result.some((item) => item.includes(term)) ? [alias] : []);
  return [...new Set([...result, ...expanded])].join(' ') || 'office workflow';
}

function maxCandidateCount(value) {
  if (value == null) return 3;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 10) {
    throw new GitHubResearchError('maxCandidates must be an integer from 1 to 10.', 400);
  }
  return parsed;
}

function relevanceScore(candidate) {
  const referencePenalty = /(?:\/star$|\/blog$|gallery|awesome[- ]?(?:list|stars?)|my[-_ ]?stars?)/iu.test(candidate.repository) ? -20 : 0;
  return candidate.qualityAssessment.score + referencePenalty;
}

function compareCandidateQuality(left, right) {
  const priority = ['deliverableFit', 'researchDepthFit', 'freshnessFit', 'sourceTypeFit', 'runtimeFit', 'minimality', 'installEvidence'];
  for (const dimension of priority) {
    const difference = (right.qualityAssessment.dimensions[dimension] ?? 0) - (left.qualityAssessment.dimensions[dimension] ?? 0);
    if (difference !== 0) return difference;
  }
  return relevanceScore(right) - relevanceScore(left) || (right.stargazersCount ?? 0) - (left.stargazersCount ?? 0) || right.updatedAt?.localeCompare(left.updatedAt ?? '');
}

function qualityAssessment(candidate, matchProfile = {}) {
  const capabilities = candidate.readme?.capabilitySignals ?? [];
  const capabilityId = matchProfile.capabilityId;
  const expectedCapability = capabilityId === 'research-with-citations' ? 'research'
    : ['presentation-outline', 'presentation-production'].includes(capabilityId) ? 'presentation'
      : capabilityId === 'report-formatter' ? 'report'
        : capabilityId?.includes('data-analysis') ? 'data-analysis' : null;
  const deliverableFit = expectedCapability === 'research'
    ? candidate.readme?.researchWorkflowEvidence && candidate.readme?.citationEvidence ? 30
      : candidate.readme?.researchWorkflowEvidence ? 20 : 0
    : expectedCapability === 'presentation'
      ? candidate.readme?.editablePresentationEvidence ? 30
        : candidate.readme?.presentationGenerationEvidence ? 20 : 0
      : expectedCapability && capabilities.includes(expectedCapability) ? 30 : 0;
  const researchDepthFit = matchProfile.researchDepth === 'none' || expectedCapability !== 'research'
    ? 15
    : candidate.readme?.researchWorkflowEvidence && (candidate.readme?.citationEvidence || matchProfile.researchDepth === 'light') ? 15 : 5;
  const freshnessFit = matchProfile.freshness !== 'current'
    ? 15
    : candidate.readme?.freshSourceEvidence ? 15 : 5;
  const requestedSources = matchProfile.sourceTypes ?? [];
  const sourceTypeFit = requestedSources.length === 0 || requestedSources.some((source) => (candidate.readme?.sourceTypeSignals ?? []).includes(source)) ? 15 : 5;
  const runtimeFit = candidate.readme?.compatibilityEvidence?.length ? 15 : candidate.readme?.portableMcp ? 12 : 4;
  const breadth = capabilities.filter((value) => ['research', 'presentation', 'report', 'data-analysis', 'coding', 'automation'].includes(value)).length;
  const repositorySummary = `${candidate.repository} ${candidate.description ?? ''}`.toLocaleLowerCase();
  const broadProject = /awesome|collection|catalog|marketplace|all[- ]in[- ]one|everything|chatgpt clone|agent platform|skill library|skills store|control plane/iu.test(repositorySummary);
  const focusedProject = expectedCapability === 'research'
    ? /research|citation|web[- ]?search|search mcp/iu.test(repositorySummary)
    : expectedCapability === 'presentation'
      ? /pptx|powerpoint|presentation|slides?/iu.test(repositorySummary)
      : false;
  const minimality = broadProject ? 0 : focusedProject ? 10 : breadth <= 2 ? 8 : breadth <= 4 ? 4 : 0;
  const installEvidence = candidate.readme?.installationMentioned ? 10 : 0;
  const viewerPenalty = expectedCapability === 'presentation' && candidate.readme?.viewerOnlyEvidence ? 20 : 0;
  const score = Math.max(0, Math.min(100, deliverableFit + researchDepthFit + freshnessFit + sourceTypeFit + runtimeFit + minimality - viewerPenalty));
  return {
    score,
    verdict: score >= 75 ? '推荐审核' : score >= 55 ? '谨慎审核' : '不建议优先',
    dimensions: { deliverableFit, researchDepthFit, freshnessFit, sourceTypeFit, runtimeFit, minimality, installEvidence },
    matchPriority: ['deliverable-fit', 'research-depth-fit', 'freshness-fit', 'source-type-fit', 'runtime-fit', 'minimality'],
    rationale: score >= 75 ? '先满足当前阶段与运行环境，再以较少的额外能力和设置完成任务。' : score >= 55 ? '能覆盖部分核心要求，但仍需确认来源、兼容性或安装成本。' : '与当前阶段的直接匹配不足，不能因为功能更多而优先推荐。'
  };
}

export function buildGitHubRepositoryQuery({ task, hostPlatform, dataSensitivity = 'public', portable = false }) {
  const platform = {
    workbuddy: 'WorkBuddy',
    codex: 'Codex',
    'claude-code': 'Claude Code'
  }[hostPlatform];
  const topic = sanitizedTopic(task, dataSensitivity);
  const componentTerm = portable || /\bmcp\b/iu.test(topic)
    ? ''
    : /\b(?:skill|plugin)\b/iu.test(topic) ? '' : ' skill';
  const runtimeTerm = portable ? '' : ` ${platform}`;
  return `${topic}${componentTerm}${runtimeTerm} in:name,description,readme archived:false`;
}

function readmeEvidence(readmeText, hostPlatform) {
  const lower = readmeText.toLocaleLowerCase();
  const compatibilityEvidence = hostEvidenceTerms(hostPlatform).filter((term) => lower.includes(term));
  const skillDocumentMentioned = /skill\.md/iu.test(readmeText);
  const agentSkillMentioned = /agent\s+skill|智能体技能|agent skills/iu.test(readmeText);
  const installationMentioned = /install|installation|安装|使用方法|usage/iu.test(readmeText);
  const signalRules = [
    ['research', /(research|web search|search the web|调研|研究)/iu],
    ['citations', /(citation|citations|sources?|引用|来源)/iu],
    ['presentation', /(pptx|powerpoint|presentation|slides?|简报|幻灯片)/iu],
    ['report', /(report|document generation|报告)/iu],
    ['data-analysis', /(data analysis|spreadsheet|csv|数据分析)/iu],
    ['automation', /(automation|workflow|自动化|工作流)/iu],
    ['coding', /(coding|code generation|软件开发|代码生成)/iu]
  ];
  const capabilitySignals = signalRules.filter(([, pattern]) => pattern.test(readmeText)).map(([name]) => name);
  const researchWorkflowEvidence = /(?:deep|web|online|automated|agentic)[- ]?research|research agent|web search/iu.test(readmeText);
  const citationEvidence = /citations?|cited|source[- ](?:level|backed)|references?|引用|来源/iu.test(readmeText);
  const presentationAssetEvidence = /pptx|powerpoint/iu.test(readmeText);
  const presentationGenerationEvidence = presentationAssetEvidence && /(?:create|generate|build|make|author|produce|edit|write|turn .{0,40} into|创建|生成|制作|编辑)/iu.test(readmeText);
  const editablePresentationEvidence = presentationGenerationEvidence && /editable|native (?:shapes?|slides?|powerpoint)|real[ -]?(?:powerpoint|pptx)|pptxgenjs|python-pptx|可编辑|原生/iu.test(readmeText);
  const viewerOnlyEvidence = /viewer|preview|inspect|read-only|visuali[sz]e|查看器|预览/iu.test(readmeText) && !presentationGenerationEvidence;
  const sourceTypeSignals = [
    /(?:official|web|browser|search|公开网页)/iu.test(readmeText) ? 'official-web' : null,
    /(?:industry report|market report|行业报告)/iu.test(readmeText) ? 'industry-reports' : null,
    /(?:public data|dataset|公开数据)/iu.test(readmeText) ? 'public-data' : null,
    /(?:local files?|filesystem|本地文件)/iu.test(readmeText) ? 'user-selected-local-files' : null
  ].filter(Boolean);
  return {
    compatibilityEvidence,
    skillDocumentMentioned,
    agentSkillMentioned,
    installationMentioned,
    isSkillLike: skillDocumentMentioned || agentSkillMentioned,
    capabilitySignals,
    researchWorkflowEvidence,
    citationEvidence,
    presentationGenerationEvidence,
    editablePresentationEvidence,
    viewerOnlyEvidence,
    sourceTypeSignals,
    freshSourceEvidence: /(real[- ]?time|latest|current|web search|browser|实时|最新)/iu.test(readmeText),
    portableMcp: /model context protocol|\bmcp\b/iu.test(lower)
  };
}

function skillDocumentEvidence(skillText) {
  const text = skillText.toLocaleLowerCase();
  const scriptsMentioned = /scripts\/|\.(?:sh|ps1|py|js|mjs)\b|\bnpm\b|\bcurl\b/iu.test(text);
  const permissionsMentioned = /permission|network|filesystem|file access|权限|联网|文件/u.test(text);
  return {
    present: Boolean(skillText),
    scriptsMentioned,
    permissionsMentioned,
    status: skillText ? 'inspected' : 'missing'
  };
}

async function parseResponse(response) {
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new GitHubResearchError('GitHub returned a non-JSON response.', response.status);
  }
  if (!response.ok) {
    const detail = body.message ? `: ${body.message}` : '';
    throw new GitHubResearchError(`GitHub request failed (${response.status})${detail}`, response.status);
  }
  return body;
}

function decodeContent(content) {
  if (!content) return '';
  return Buffer.from(content.replace(/\n/gu, ''), 'base64').toString('utf8');
}

function errorEvidence(error) {
  return { status: 'unavailable', reason: error.message, httpStatus: error.status ?? 500 };
}

function candidateLinks(candidate) {
  return [
    { label: 'GitHub 倉庫', url: candidate.url },
    candidate.readme?.url ? { label: 'README', url: candidate.readme.url } : null,
    candidate.skillDocument?.url ? { label: 'SKILL.md', url: candidate.skillDocument.url } : null,
    candidate.licenseEvidence?.url ? { label: 'LICENSE', url: candidate.licenseEvidence.url } : null
  ].filter(Boolean);
}

function userFacingCandidate(candidate) {
  const reviewable = candidate.reviewStatus === 'reviewable' && candidate.qualityAssessment?.score >= 55;
  const signals = candidate.readme?.capabilitySignals ?? [];
  const keyFeatures = [
    candidate.readme?.researchWorkflowEvidence ? '支持联网或深度研究流程' : null,
    candidate.readme?.citationEvidence ? '提供来源或引用能力' : null,
    candidate.readme?.editablePresentationEvidence ? '可生成可编辑的原生 PPTX' : null,
    candidate.readme?.presentationGenerationEvidence && !candidate.readme?.editablePresentationEvidence ? '可生成 PowerPoint／PPTX，编辑能力需进一步确认' : null,
    candidate.readme?.portableMcp ? '提供可接入主 Agent 的 MCP 接口' : null,
    candidate.readme?.compatibilityEvidence?.length ? `README 提及 ${candidate.readme.compatibilityEvidence.join('、')} 兼容性` : null
  ].filter(Boolean);
  const advantages = [
    candidate.qualityAssessment?.dimensions?.deliverableFit >= 30 ? '直接覆盖该阶段要求的输出' : null,
    candidate.qualityAssessment?.dimensions?.minimality >= 8 ? '能力范围较聚焦，额外配置和重复功能较少' : null,
    candidate.stargazersCount > 0 ? `公开关注度：${candidate.stargazersCount} stars（仅作维护与采用度参考）` : null
  ].filter(Boolean);
  return {
    name: candidate.repository,
    description: candidate.description || '此倉庫未提供可用的簡短說明。',
    componentType: candidate.readme?.portableMcp ? 'MCP server' : candidate.readme?.isSkillLike ? 'Agent Skill' : '可安装开源项目',
    keyFeatures: keyFeatures.length > 0 ? keyFeatures : signals.map((signal) => `README 能力信号：${signal}`),
    advantages,
    limitations: [
      candidate.readme?.viewerOnlyEvidence ? '目前证据只支持查看或预览，不支持制作可编辑交付物。' : null,
      candidate.license === 'unknown' ? '许可证尚未确认。' : null,
      candidate.readme?.compatibilityEvidence?.length ? null : '尚未找到当前宿主的明确兼容说明。',
      '尚未下载或执行，实际效果仍需在安装审核后验证。'
    ].filter(Boolean),
    reviewStatus: candidate.reviewStatus,
    recommendationStatus: reviewable ? candidate.qualityAssessment.verdict : '不建议优先',
    reviewSummary: reviewable
      ? '已找到 README 安裝說明；授權、宿主相容性、SKILL.md、MCP 或插件清單會如實展示，缺失項目留給安裝審核時確認。'
      : '證據尚不足以進入安裝審核；可以閱讀連結，但不能把它當成已驗證或可安全安裝的 Skill。',
    links: candidateLinks(candidate),
    safetySignals: {
      license: candidate.license,
      updatedAt: candidate.updatedAt,
      scriptsMentioned: candidate.skillDocument?.scriptsMentioned === true,
      permissionsMentioned: candidate.skillDocument?.permissionsMentioned === true,
      neverExecuted: true
    },
    qualityAssessment: candidate.qualityAssessment,
    installQuestion: reviewable
      ? `你要為「${candidate.repository}」進入安裝審核嗎？我會先展示精確版本、權限、檔案、腳本與卸載方式；此步驟不會立刻安裝。`
      : null
  };
}

export class GitHubScout {
  constructor({ fetchImpl = globalThis.fetch, token = process.env.GITHUB_TOKEN } = {}) {
    if (typeof fetchImpl !== 'function') throw new TypeError('A fetch implementation is required.');
    this.fetchImpl = fetchImpl;
    this.token = token;
    this.allowKeychain = fetchImpl === globalThis.fetch;
  }

  async resolveToken() {
    if (this.token) return this.token;
    if (process.platform !== 'darwin' || !this.allowKeychain) return null;
    try {
      const { stdout } = await execFileAsync('security', ['find-internet-password', '-s', 'github.com', '-w'], { timeout: 3000, maxBuffer: 4096 });
      const token = String(stdout ?? '').trim();
      return token || null;
    } catch {
      return null;
    }
  }

  headers() {
    return {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'agentfit-layer',
      ...(this.token ? { Authorization: `Bearer ${this.token}` } : {})
    };
  }

  async request(path) {
    const response = await this.fetchImpl(`https://api.github.com${path}`, { headers: this.headers() });
    return parseResponse(response);
  }

  async evidenceRequest(path) {
    try {
      return { ok: true, value: await this.request(path) };
    } catch (error) {
      return { ok: false, error: errorEvidence(error) };
    }
  }

  async inspectRepository(repository, brief) {
    const owner = encodeURIComponent(repository.owner.login);
    const name = encodeURIComponent(repository.name);
    const base = `/repos/${owner}/${name}`;
    const readmeResponse = await this.evidenceRequest(`${base}/readme`);
    if (!readmeResponse.ok) {
      return this.candidateFrom(repository, {
        readme: { present: false, ...readmeResponse.error },
        skillDocument: { status: 'not-requested' },
        licenseEvidence: { status: repository.license?.spdx_id ? 'repository-metadata-only' : 'missing' },
        releaseEvidence: { status: 'not-requested' }
      }, 'insufficient-evidence');
    }
    const readmeText = decodeContent(readmeResponse.value.content);
    const readme = {
      url: readmeResponse.value.html_url ?? `${repository.html_url}#readme`,
      present: Boolean(readmeText),
      ...readmeEvidence(readmeText, brief.hostPlatform),
      status: readmeText ? 'inspected' : 'missing'
    };
    if (repository.archived) {
      return this.candidateFrom(repository, {
        readme,
        skillDocument: { status: 'not-requested' },
        licenseEvidence: { status: 'not-requested' },
        releaseEvidence: { status: 'not-requested' }
      }, 'excluded-archived');
    }
    // A project does not need to ship a SKILL.md to be useful. If its README
    // documents installation and host compatibility, it can still be an
    // installable plugin, MCP server, or open-source project.
    if (!readme.isSkillLike && !readme.installationMentioned) {
      return this.candidateFrom(repository, {
        readme,
        skillDocument: { status: 'not-requested' },
        licenseEvidence: { status: 'not-requested' },
        releaseEvidence: { status: 'not-requested' }
      }, 'excluded-not-a-skill');
    }

    const [skillResponse, licenseResponse, releasesResponse] = await Promise.all([
      readme.skillDocumentMentioned ? this.evidenceRequest(`${base}/contents/SKILL.md`) : Promise.resolve({ ok: false, error: { status: 'not-mentioned' } }),
      this.evidenceRequest(`${base}/license`),
      this.evidenceRequest(`${base}/releases?per_page=1`)
    ]);
    const skillText = skillResponse.ok ? decodeContent(skillResponse.value.content) : '';
    const skillDocument = skillResponse.ok
      ? { url: skillResponse.value.html_url ?? `${repository.html_url}/blob/${repository.default_branch ?? 'main'}/SKILL.md`, ...skillDocumentEvidence(skillText) }
      : { ...skillDocumentEvidence(''), ...(skillResponse.error ?? {}) };
    const licenseEvidence = licenseResponse.ok
      ? { status: 'inspected', spdxId: licenseResponse.value.license?.spdx_id ?? repository.license?.spdx_id ?? 'unknown', url: licenseResponse.value.html_url ?? null }
      : { status: repository.license?.spdx_id ? 'repository-metadata-only' : 'missing', ...(licenseResponse.error ?? {}) };
    const releases = releasesResponse.ok && Array.isArray(releasesResponse.value) ? releasesResponse.value : [];
    const releaseEvidence = releasesResponse.ok
      ? { status: 'inspected', latestReleaseAt: releases[0]?.published_at ?? null, countObserved: releases.length }
      : releasesResponse.error;

    const reviewStatus = !readme.installationMentioned
      ? 'insufficient-installation-evidence'
      : 'reviewable';
    return this.candidateFrom(repository, { readme, skillDocument, licenseEvidence, releaseEvidence }, reviewStatus);
  }

  candidateFrom(repository, evidence, reviewStatus) {
    return {
      source: 'github',
      repository: `${repository.owner.login}/${repository.name}`,
      url: repository.html_url,
      description: repository.description ?? '',
      stargazersCount: repository.stargazers_count ?? 0,
      archived: repository.archived === true,
      license: repository.license?.spdx_id ?? 'unknown',
      updatedAt: repository.updated_at ?? null,
      defaultBranch: repository.default_branch ?? null,
      ...evidence,
      reviewStatus,
      neverExecuted: true
    };
  }

  async scout(input) {
    const brief = normalizeTaskBrief(input);
    if (input.allowWeb !== true) throw new GitHubResearchError('GitHub research requires explicit allowWeb: true.', 403);
    if (!sourcePolicyFor(brief.hostPlatform).includes('github')) throw new GitHubResearchError(`GitHub is not enabled for ${brief.hostPlatform}.`, 403);
    const maxCandidates = maxCandidateCount(input.maxCandidates);
    this.token = await this.resolveToken();
    const query = buildGitHubRepositoryQuery({ ...brief, portable: input.portable === true });
    const search = await this.request(`/search/repositories?q=${encodeURIComponent(query)}&per_page=${Math.min(maxCandidates * 4, 30)}`);
    const repositories = Array.isArray(search.items) ? search.items : [];
    const inspected = await Promise.all(repositories.map((repository) => this.inspectRepository(repository, brief)));
    const candidates = inspected.map((candidate) => ({ ...candidate, qualityAssessment: qualityAssessment(candidate, input.matchProfile) }))
      .sort(compareCandidateQuality).slice(0, maxCandidates);
    return {
      source: 'github',
      hostPlatform: brief.hostPlatform,
      query,
      dataHandling: brief.dataSensitivity === 'public' ? 'task keywords used after query sanitization' : 'generic keywords only',
      candidates,
      reviewableCandidates: candidates.filter((candidate) => candidate.reviewStatus === 'reviewable' && candidate.qualityAssessment.score >= 55),
      userFacing: {
        title: '可查看的 GitHub Skill 候選',
        summary: '以下連結僅供閱讀與安裝審核；AgentFit 沒有下載、執行、啟用或安裝任何候選。',
        candidates: candidates.map(userFacingCandidate),
        installationBoundary: '只有 reviewable 候選可詢問是否進入安裝審核。即使你同意，也必須在看到精確版本、來源、權限、腳本、檔案與卸載方式後再次確認安裝。'
      }
    };
  }
}
