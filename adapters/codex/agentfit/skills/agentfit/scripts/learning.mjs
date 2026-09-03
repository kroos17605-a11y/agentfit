import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { HOST_PLATFORMS, normalizeTaskBrief } from './policy.mjs';

const STORE_VERSION = 1;
const MAX_OBSERVATIONS = 250;
const MAX_DAILY_RUNS = 60;
const MAX_WORKFLOW_OUTCOMES = 120;
const INFERENCE_WINDOW_DAYS = 90;
const BUSINESS_DOMAIN_RULES = [
  ['robotics', /(机器人|robotics?|具身智能)/iu],
  ['ai-products', /(人工智能|AI 产品|ai product|大模型|生成式 AI)/iu],
  ['sales-operations', /(销售|营收|客户|sales|revenue)/iu],
  ['product-management', /(产品|PRD|roadmap|需求|product)/iu],
  ['marketing', /(市场|营销|marketing|竞品)/iu],
  ['recruiting', /(招聘|候选人|recruit|candidate)/iu],
  ['finance', /(财务|预算|finance|forecast)/iu]
];

function businessDomains(task) {
  return BUSINESS_DOMAIN_RULES.filter(([, pattern]) => pattern.test(String(task ?? ''))).map(([domain]) => domain);
}

function workProfile(task, deliverable, dataSensitivity) {
  const text = `${task ?? ''} ${deliverable ?? ''}`;
  const pick = (rules) => rules.filter(([, pattern]) => pattern.test(text)).map(([value]) => value);
  return {
    taskTypes: pick([
      ['research', /(调研|研究|research|分析)/iu], ['presentation', /(PPT|简报|汇报|演示|presentation)/iu],
      ['reporting', /(报告|周报|月报|report)/iu], ['planning', /(规划|计划|roadmap|项目管理)/iu],
      ['product-design', /(产品设计|PRD|需求分析)/iu], ['meeting', /(会议|纪要|跟进)/iu],
      ['translation', /(翻译|本地化|translation)/iu], ['data-work', /(数据|表格|CSV|Excel)/iu]
    ]),
    deliverableTypes: pick([
      ['ppt', /(PPT|简报|幻灯片|presentation)/iu], ['decision-report', /(决策报告|报告|report)/iu],
      ['weekly-report', /(周报|月报)/iu], ['roadmap', /(roadmap|路线图)/iu], ['prd', /\bPRD\b/iu],
      ['meeting-minutes', /(会议纪要|会议记录)/iu]
    ]),
    audience: pick([['executive', /(管理层|高管|领导|决策者)/iu], ['team', /(团队|同事|部门)/iu], ['external', /(客户|公开发布|对外)/iu]]),
    languages: pick([['chinese', /(中文|汉语)/iu], ['english', /(英文|英语|English)/iu]]),
    dataScope: dataSensitivity,
    webRequired: /(最新|近期|趋势|公开资料|市场|research|调研)/iu.test(text)
  };
}

function mergeWorkProfiles(observations) {
  const counts = {};
  for (const observation of observations) {
    const profile = observation.workProfile ?? {};
    for (const [key, values] of Object.entries(profile)) {
      if (Array.isArray(values)) for (const value of values) counts[`${key}:${value}`] = (counts[`${key}:${value}`] ?? 0) + 1;
      else if (values != null) counts[`${key}:${values}`] = (counts[`${key}:${values}`] ?? 0) + 1;
    }
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([key, count]) => {
    const [category, value] = key.split(':'); return { category, value, observations: count };
  });
}

export class LearningStoreError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LearningStoreError';
  }
}

function assertText(value, field, { required = true, maxLength = 160 } = {}) {
  if (value == null && !required) return null;
  const normalized = String(value ?? '').trim();
  if (!normalized && required) throw new LearningStoreError(`${field} is required.`);
  if (!normalized) return null;
  if (normalized.length > maxLength) throw new LearningStoreError(`${field} must be ${maxLength} characters or fewer.`);
  return normalized;
}

function assertHost(hostPlatform) {
  const host = assertText(hostPlatform, 'hostPlatform');
  if (!HOST_PLATFORMS.includes(host)) {
    throw new LearningStoreError(`hostPlatform must be one of: ${HOST_PLATFORMS.join(', ')}.`);
  }
  return host;
}

function normalizeTimezone(timezone) {
  const candidate = assertText(timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC', 'timezone');
  try {
    Intl.DateTimeFormat('en-CA', { timeZone: candidate }).format();
  } catch {
    throw new LearningStoreError('timezone must be a supported IANA timezone.');
  }
  return candidate;
}

function isoTimestamp(value = new Date()) {
  const timestamp = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new LearningStoreError('timestamp must be a valid date.');
  return new Date(timestamp).toISOString();
}

function dayKey(timestamp, timezone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date(timestamp));
}

function emptyState() {
  return {
    version: STORE_VERSION,
    profiles: {},
    observations: [],
    dailyResearchRuns: [],
    workflowOutcomes: []
  };
}

function validateState(state) {
  if (!state || typeof state !== 'object' || state.version !== STORE_VERSION) {
    throw new LearningStoreError('Learning store has an unsupported format.');
  }
  if (!state.profiles || typeof state.profiles !== 'object' || Array.isArray(state.profiles)) {
    throw new LearningStoreError('Learning store has an invalid profiles field.');
  }
  if (!Array.isArray(state.observations) || !Array.isArray(state.dailyResearchRuns)) {
    throw new LearningStoreError('Learning store has invalid history fields.');
  }
  if (state.workflowOutcomes == null) state.workflowOutcomes = [];
  if (!Array.isArray(state.workflowOutcomes)) throw new LearningStoreError('Learning store has an invalid workflowOutcomes field.');
  return state;
}

async function load(filePath) {
  try {
    return validateState(JSON.parse(await readFile(filePath, 'utf8')));
  } catch (error) {
    if (error.code === 'ENOENT') return emptyState();
    throw error;
  }
}

async function saveAtomic(filePath, state) {
  await mkdir(dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, filePath);
}

function profileFor(state, hostPlatform) {
  return state.profiles[hostPlatform] ?? null;
}

function normalizeCapabilityIds(plan) {
  const ids = [plan?.primarySkill?.id, ...(plan?.supportingSkills ?? []).map((skill) => skill?.id)]
    .filter((id) => typeof id === 'string' && /^[a-z0-9-]{2,80}$/u.test(id));
  const unique = [...new Set(ids)];
  if (unique.length === 0 || unique.length > 3) {
    throw new LearningStoreError('A task observation needs one to three valid capability IDs.');
  }
  return unique;
}

function observationSignature(capabilityIds) {
  return capabilityIds.join('+');
}

function inferenceId(hostPlatform, signature) {
  return `inf_${createHash('sha256').update(`${hostPlatform}:${signature}`).digest('hex').slice(0, 16)}`;
}

function projectScope(projectId, salt) {
  if (!projectId) return null;
  return `project_${createHash('sha256').update(`${salt}:${projectId}`).digest('hex').slice(0, 16)}`;
}

function confidenceFor({ observations, distinctDays }) {
  if (observations >= 4 && distinctDays >= 3) return { level: 'established', score: 0.8 };
  if (observations >= 2 && distinctDays >= 2) return { level: 'emerging', score: 0.55 };
  return { level: 'observed', score: 0.3 };
}

function deriveInferences(state, hostPlatform, { now = new Date() } = {}) {
  const profile = profileFor(state, hostPlatform);
  if (!profile) return [];
  const cutoff = new Date(new Date(now).getTime() - INFERENCE_WINDOW_DAYS * 24 * 60 * 60 * 1000).getTime();
  const groups = new Map();
  for (const observation of state.observations) {
    if (observation.hostPlatform !== hostPlatform || Date.parse(observation.observedAt) < cutoff) continue;
    const signature = observationSignature(observation.capabilityIds);
    const group = groups.get(signature) ?? {
      capabilityIds: observation.capabilityIds,
      observations: [],
      projects: new Set(),
      days: new Set()
    };
    group.observations.push(observation);
    if (observation.projectScope) group.projects.add(observation.projectScope);
    group.days.add(dayKey(observation.observedAt, profile.timezone));
    groups.set(signature, group);
  }
  return [...groups.entries()]
    .map(([signature, group]) => {
      const ordered = group.observations.slice().sort((left, right) => left.observedAt.localeCompare(right.observedAt));
      const confidence = confidenceFor({ observations: ordered.length, distinctDays: group.days.size });
      return {
        id: inferenceId(hostPlatform, signature),
        kind: 'recurring-work-pattern',
        hostPlatform,
        capabilityIds: group.capabilityIds,
        projectScopes: [...group.projects].sort(),
        evidence: {
          observations: ordered.length,
          distinctDays: group.days.size,
          firstObservedAt: ordered[0].observedAt,
          lastObservedAt: ordered.at(-1).observedAt,
          windowDays: INFERENCE_WINDOW_DAYS
        },
        confidence
      };
    })
    .sort((left, right) => right.confidence.score - left.confidence.score || right.evidence.lastObservedAt.localeCompare(left.evidence.lastObservedAt));
}

function profileView(state, hostPlatform, now) {
  const profile = profileFor(state, hostPlatform);
  if (!profile) {
    return {
      status: 'consent_required',
      hostPlatform,
      collection: 'No task data has been saved. Use recommend --auto-learn to start abstract local learning automatically; daily research remains disabled.',
      enableCommand: 'recommend --auto-learn'
    };
  }
  const inferences = deriveInferences(state, hostPlatform, { now });
  return {
    status: 'enabled',
    hostPlatform,
    enabledAt: profile.enabledAt,
    timezone: profile.timezone,
    storage: 'capability patterns, opaque project scopes, timestamps, and public GitHub review references only; never raw task text or task files',
    dailyResearch: {
      enabled: profile.dailyResearch.enabled,
      localTime: profile.dailyResearch.localTime,
      lastCompletedOn: profile.dailyResearch.lastCompletedOn ?? null
    },
    inferences,
    recommendationInferences: inferences.filter((inference) => inference.confidence.level === 'established')
  };
}

function topicSummary(inference) {
  return {
    inferenceId: inference.id,
    capabilityIds: inference.capabilityIds,
    confidence: inference.confidence,
    evidence: inference.evidence
  };
}

function successfulWorkflowView(state, hostPlatform) {
  return state.workflowOutcomes
    .filter((outcome) => outcome.hostPlatform === hostPlatform && outcome.status === 'accepted')
    .slice(-20)
    .reverse()
    .map((outcome) => ({
      id: outcome.id,
      status: outcome.status,
      capabilityIds: outcome.capabilityIds,
      components: outcome.components,
      deliverable: outcome.deliverable,
      acceptedAt: outcome.recordedAt,
      qualityCriteria: outcome.qualityCriteria
    }));
}

const CORRECTION_CATEGORIES = new Set(['visual-style', 'audience-fit', 'source-quality', 'structure', 'format', 'data-accuracy', 'other']);

export class LearningStore {
  constructor(filePath) {
    this.filePath = assertText(filePath, 'filePath', { maxLength: 2000 });
  }

  async enable({ hostPlatform, confirmEnable = false, dailyResearch = false, timezone, localTime = '09:00', now = new Date() } = {}) {
    const host = assertHost(hostPlatform);
    if (confirmEnable !== true) {
      throw new LearningStoreError('Automatic learning needs one-time confirmEnable: true consent.');
    }
    if (typeof dailyResearch !== 'boolean') throw new LearningStoreError('dailyResearch must be a boolean.');
    if (!/^([01]\d|2[0-3]):[0-5]\d$/u.test(localTime)) {
      throw new LearningStoreError('localTime must use 24-hour HH:MM format.');
    }
    const state = await load(this.filePath);
    const existing = profileFor(state, host);
    const timestamp = isoTimestamp(now);
    state.profiles[host] = {
      hostPlatform: host,
      enabledAt: existing?.enabledAt ?? timestamp,
      updatedAt: timestamp,
      timezone: normalizeTimezone(timezone ?? existing?.timezone),
      scopeSalt: existing?.scopeSalt ?? randomUUID(),
      collectionPolicy: 'capability-patterns-only',
      dailyResearch: {
        enabled: dailyResearch,
        localTime,
        lastCompletedOn: existing?.dailyResearch?.lastCompletedOn ?? null
      }
    };
    await saveAtomic(this.filePath, state);
    return profileView(state, host, now);
  }

  async context({ hostPlatform, now = new Date() } = {}) {
    const host = assertHost(hostPlatform);
    const state = await load(this.filePath);
    const view = profileView(state, host, now);
    const domains = new Set(state.observations
      .filter((entry) => entry.hostPlatform === host)
      .flatMap((entry) => entry.businessDomains ?? []));
    const observations = state.observations.filter((entry) => entry.hostPlatform === host);
    return {
      ...view,
      businessContexts: [...domains].sort(),
      workProfile: mergeWorkProfiles(observations),
      successfulWorkflows: successfulWorkflowView(state, host)
    };
  }

  async observe({ brief, plan, now = new Date(), autoStart = false } = {}) {
    const normalizedBrief = normalizeTaskBrief(brief);
    const timestamp = isoTimestamp(now);
    const state = await load(this.filePath);
    let profile = profileFor(state, normalizedBrief.hostPlatform);
    if (!profile && autoStart === true) {
      state.profiles[normalizedBrief.hostPlatform] = {
        hostPlatform: normalizedBrief.hostPlatform,
        enabledAt: timestamp,
        updatedAt: timestamp,
        timezone: normalizeTimezone(),
        scopeSalt: randomUUID(),
        collectionPolicy: 'capability-patterns-and-accepted-workflows-only',
        dailyResearch: { enabled: false, localTime: '09:00', lastCompletedOn: null }
      };
      profile = state.profiles[normalizedBrief.hostPlatform];
    }
    if (!profile) {
      return {
        status: 'consent_required',
        hostPlatform: normalizedBrief.hostPlatform,
        recorded: false,
        reason: 'Automatic learning is not enabled for this host.'
      };
    }
    const capabilityIds = normalizeCapabilityIds(plan);
    const observation = {
      id: `obs_${randomUUID()}`,
      observedAt: timestamp,
      hostPlatform: normalizedBrief.hostPlatform,
      projectScope: projectScope(normalizedBrief.projectId, profile.scopeSalt),
      capabilityIds,
      dataSensitivity: normalizedBrief.dataSensitivity,
      businessDomains: businessDomains(normalizedBrief.task),
      workProfile: workProfile(normalizedBrief.task, normalizedBrief.deliverable, normalizedBrief.dataSensitivity)
    };
    state.observations.push(observation);
    state.observations = state.observations
      .sort((left, right) => left.observedAt.localeCompare(right.observedAt))
      .slice(-MAX_OBSERVATIONS);
    state.profiles[normalizedBrief.hostPlatform].updatedAt = timestamp;
    await saveAtomic(this.filePath, state);
    return {
      status: 'observed',
      recorded: true,
      observation,
      learning: profileView(state, normalizedBrief.hostPlatform, now)
    };
  }

  async prepareDailyResearch({ hostPlatform, now = new Date(), force = false } = {}) {
    const host = assertHost(hostPlatform);
    const state = await load(this.filePath);
    const profile = profileFor(state, host);
    if (!profile) return { status: 'consent_required', hostPlatform: host };
    if (!profile.dailyResearch.enabled) return { status: 'daily_research_disabled', hostPlatform: host };
    const today = dayKey(isoTimestamp(now), profile.timezone);
    if (!force && profile.dailyResearch.lastCompletedOn === today) {
      return { status: 'not_due', hostPlatform: host, completedOn: today };
    }
    const inferences = deriveInferences(state, host, { now });
    const topics = inferences
      .filter((inference) => ['emerging', 'established'].includes(inference.confidence.level))
      .slice(0, 3)
      .map(topicSummary);
    if (topics.length === 0) {
      return {
        status: 'not_ready',
        hostPlatform: host,
        reason: 'Daily research waits for at least two observations on separate days before inferring a work pattern.'
      };
    }
    return {
      status: 'due',
      hostPlatform: host,
      day: today,
      timezone: profile.timezone,
      topics
    };
  }

  async knownCandidateRepositories({ hostPlatform } = {}) {
    const host = assertHost(hostPlatform);
    const state = await load(this.filePath);
    return new Set(
      state.dailyResearchRuns
        .filter((run) => run.hostPlatform === host)
        .flatMap((run) => run.candidateReferences ?? [])
        .map((candidate) => candidate.repository)
    );
  }

  async recordDailyResearch({ hostPlatform, day, topics, candidateReferences = [], status = 'completed', now = new Date() } = {}) {
    const host = assertHost(hostPlatform);
    const state = await load(this.filePath);
    const profile = profileFor(state, host);
    if (!profile) throw new LearningStoreError('Automatic learning is not enabled for this host.');
    const completedOn = assertText(day, 'day');
    const allowedStatuses = new Set(['completed', 'partial', 'failed']);
    if (!allowedStatuses.has(status)) throw new LearningStoreError('Daily research status is invalid.');
    const run = {
      id: `research_${randomUUID()}`,
      hostPlatform: host,
      completedAt: isoTimestamp(now),
      day: completedOn,
      status,
      topics: Array.isArray(topics) ? topics.map(topicSummary) : [],
      candidateReferences: Array.isArray(candidateReferences)
        ? candidateReferences.map((candidate) => ({
          repository: assertText(candidate.repository, 'candidate.repository'),
          url: assertText(candidate.url, 'candidate.url', { maxLength: 2000 }),
          reviewStatus: assertText(candidate.reviewStatus, 'candidate.reviewStatus')
        })).slice(0, 30)
        : []
    };
    state.dailyResearchRuns = [...state.dailyResearchRuns, run]
      .sort((left, right) => left.completedAt.localeCompare(right.completedAt))
      .slice(-MAX_DAILY_RUNS);
    state.profiles[host].dailyResearch.lastCompletedOn = completedOn;
    state.profiles[host].updatedAt = run.completedAt;
    await saveAtomic(this.filePath, state);
    return run;
  }

  async recordWorkflowOutcome({ hostPlatform, projectId = null, plan, capabilityResolution, qualityResult, correctionCategories = [], now = new Date() } = {}) {
    const host = assertHost(hostPlatform);
    const state = await load(this.filePath);
    const profile = profileFor(state, host);
    if (!profile) throw new LearningStoreError('Automatic learning is not enabled for this host.');
    if (!qualityResult || typeof qualityResult.passed !== 'boolean') throw new LearningStoreError('qualityResult.passed is required.');
    if (!Array.isArray(correctionCategories)) throw new LearningStoreError('correctionCategories must be an array.');
    const normalizedCorrections = [...new Set(correctionCategories)].map((category) => assertText(category, 'correctionCategories'));
    if (normalizedCorrections.some((category) => !CORRECTION_CATEGORIES.has(category))) {
      throw new LearningStoreError('correctionCategories contains an unsupported value.');
    }
    const assignments = capabilityResolution?.assignments ?? plan?.capabilityResolution?.assignments ?? [];
    const components = assignments
      .map((assignment) => assignment?.component)
      .filter((component) => component?.id && component.type !== 'host-native')
      .map((component) => ({
        id: assertText(component.id, 'component.id'),
        name: assertText(component.name ?? component.id, 'component.name'),
        type: assertText(component.type ?? 'tool', 'component.type'),
        version: component.version == null ? null : assertText(component.version, 'component.version'),
        source: component.source == null ? null : assertText(component.source, 'component.source', { maxLength: 2000 })
      }));
    const accepted = qualityResult.passed === true && qualityResult.recordAsReusableWorkflow === true;
    const outcome = {
      id: `workflow_${randomUUID()}`,
      recordedAt: isoTimestamp(now),
      hostPlatform: host,
      projectScope: projectScope(projectId, profile.scopeSalt),
      status: accepted ? 'accepted' : qualityResult.passed ? 'passed-not-accepted' : 'needs-revision',
      capabilityIds: normalizeCapabilityIds(plan),
      components,
      deliverable: assertText(plan?.userFacing?.taskBreakdown?.taskRequirements?.deliverable ?? 'host-agent-output', 'deliverable'),
      qualityCriteria: Array.isArray(qualityResult.checks)
        ? qualityResult.checks.map((check) => ({ id: assertText(check.id, 'qualityCheck.id'), passed: check.passed === true })).slice(0, 20)
        : [],
      correctionCategories: normalizedCorrections
    };
    state.workflowOutcomes = [...state.workflowOutcomes, outcome]
      .sort((left, right) => left.recordedAt.localeCompare(right.recordedAt))
      .slice(-MAX_WORKFLOW_OUTCOMES);
    state.profiles[host].updatedAt = outcome.recordedAt;
    await saveAtomic(this.filePath, state);
    return outcome;
  }

  async forget({ hostPlatform, confirmDelete = false } = {}) {
    const host = assertHost(hostPlatform);
    if (confirmDelete !== true) throw new LearningStoreError('Deleting automatic learning history requires confirmDelete: true.');
    const state = await load(this.filePath);
    const removedObservations = state.observations.filter((entry) => entry.hostPlatform === host).length;
    const removedRuns = state.dailyResearchRuns.filter((entry) => entry.hostPlatform === host).length;
    const removedWorkflowOutcomes = state.workflowOutcomes.filter((entry) => entry.hostPlatform === host).length;
    delete state.profiles[host];
    state.observations = state.observations.filter((entry) => entry.hostPlatform !== host);
    state.dailyResearchRuns = state.dailyResearchRuns.filter((entry) => entry.hostPlatform !== host);
    state.workflowOutcomes = state.workflowOutcomes.filter((entry) => entry.hostPlatform !== host);
    await saveAtomic(this.filePath, state);
    return { deleted: true, hostPlatform: host, removedObservations, removedRuns, removedWorkflowOutcomes };
  }
}
