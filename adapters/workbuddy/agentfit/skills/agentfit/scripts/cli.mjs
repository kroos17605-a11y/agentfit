#!/usr/bin/env node
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { GITHUB_DISCOVERY_TERMS } from './catalog.mjs';
import {
  createInstallRequest,
  createMemoryCandidate,
  createSkillPlan,
  evaluateQualityGate,
  executeVerifiedFilesystemInstall,
  GitHubScout,
  InstallApprovalStore,
  LearningStore,
  MemoryStore,
  createDailyScheduleHandoff
} from './index.mjs';
import { runDailySkillResearch } from './daily-research.mjs';
import { workBuddySearchHandoff, normalizeTaskBrief } from './policy.mjs';

function parseArgs(argv) {
  const [command, ...raw] = argv;
  const options = {};
  for (let index = 0; index < raw.length; index += 1) {
    const token = raw[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2).replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase());
    const next = raw[index + 1];
    if (!next || next.startsWith('--')) {
      options[key] = true;
    } else {
      options[key] = next;
      index += 1;
    }
  }
  return { command, options };
}

function asBoolean(value) {
  return value === true || value === 'true';
}

function output(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function taskBriefFrom(options) {
  return {
    hostPlatform: options.host,
    task: options.task,
    deliverable: options.deliverable,
    projectId: options.project,
    dataSensitivity: options.sensitivity ?? 'public',
    allowWeb: options.allowWeb == null ? true : asBoolean(options.allowWeb),
    personalisationEnabled: asBoolean(options.personalisation),
    memoryHints: options.memoryHint ? String(options.memoryHint).split('|') : []
  };
}

function learningStoreFrom(options) {
  const filePath = options.learningStore
    ? String(options.learningStore)
    : resolve(process.cwd(), '.agentfit', 'learning.json');
  return new LearningStore(filePath);
}

async function jsonFromFile(filePath, field) {
  if (!filePath) return null;
  try {
    return JSON.parse(await readFile(String(filePath), 'utf8'));
  } catch (error) {
    throw new Error(`${field} could not be read as JSON: ${error.message}`);
  }
}

async function saveJsonFile(filePath, value) {
  if (!filePath) return;
  const target = resolve(String(filePath));
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, target);
}

function discoveryTaskFor(brief) {
  return brief.task;
}

function discoveryVariantsFor(step) {
  if (step.capabilityId === 'research-with-citations') {
    return [
      'web research citations source verification skill',
      'deep research citations MCP server'
    ];
  }
  if (step.capabilityId === 'presentation-production') {
    return [
      'pptx generator editable powerpoint skill',
      'powerpoint generation MCP server'
    ];
  }
  const terms = step.matchProfile?.searchKeywords ?? step.searchKeywords ?? [];
  return [`${terms.join(' ')} skill`, `${terms.slice(0, 2).join(' ')} MCP server`];
}

async function commandRunner() {
  const { command, options } = parseArgs(process.argv.slice(2));
  switch (command) {
    case 'recommend': {
      const brief = taskBriefFrom(options);
      const memoryEntries = options.memoryStore && asBoolean(options.personalisation)
        ? await new MemoryStore(options.memoryStore).list({ hostPlatform: brief.hostPlatform, projectId: brief.projectId })
        : [];
      const learningStore = asBoolean(options.autoLearn) || options.learningStore
        ? learningStoreFrom(options)
        : null;
      const learningContext = learningStore
        ? await learningStore.context({ hostPlatform: brief.hostPlatform })
        : null;
      const inventoryDocument = await jsonFromFile(options.inventoryFile, 'inventoryFile');
      const recommendation = createSkillPlan({
        ...brief,
        memoryEntries,
        learningContext,
        installedComponents: Array.isArray(inventoryDocument) ? inventoryDocument : inventoryDocument?.components ?? []
      });
      const learning = learningStore && asBoolean(options.autoLearn) && recommendation.status === 'recommended'
        ? await learningStore.observe({ brief, plan: recommendation.plan, autoStart: true })
        : learningContext;
      let discovery = null;
      if (asBoolean(options.discover)) {
        if (!asBoolean(options.confirmDiscovery)) {
          discovery = {
            status: 'consent-required',
            reason: 'Discovery is a second-stage action and requires explicit user consent (--confirm-discovery true).'
          };
        } else if (recommendation.status !== 'recommended') {
          discovery = { status: 'not-run', reason: 'A blocked task has no discovery run.' };
        } else if (!brief.allowWeb) {
          discovery = {
            status: 'not-run',
            reason: 'This task explicitly prohibits networking. AgentFit returned the offline workflow only.'
          };
        } else {
          try {
            const scout = new GitHubScout();
            const plannedQueries = recommendation.plan.githubResearch?.queriesByStep ?? [];
            if (plannedQueries.length === 0) {
              discovery = {
                status: 'not-needed',
                source: 'installed-capability-inventory',
                reason: 'Every workflow step is covered by the host Agent or an installed compatible component.',
                reviewableCandidates: [],
                userFacing: {
                  title: '无需安装新工具',
                  summary: '当前 Agent 已有能力覆盖全部步骤，将直接把有序执行计划交给主 Agent。',
                  candidates: []
                },
                nextDecision: {
                  type: 'confirm-host-execution',
                  prompt: '现有能力已覆盖全部步骤。是否按以上工作流开始正式执行？'
                }
              };
            } else {
            const stepDefinitions = plannedQueries;
            const queries = stepDefinitions.flatMap((step) => {
              const variants = discoveryVariantsFor(step);
              return [...new Set(variants.filter(Boolean))].map((searchTerms, index) => ({ ...step, variant: index + 1, searchTerms }));
            });
            const settledRuns = await Promise.allSettled(queries.map(async (step) => ({ step, run: await scout.scout({
              ...brief,
              task: step.searchTerms,
              matchProfile: step.matchProfile,
              portable: step.variant === 2,
              allowWeb: true,
              maxCandidates: options.maxCandidates
            }) })));
            const failedRuns = settledRuns.filter((result) => result.status === 'rejected').map((result) => ({ status: 'failed', error: { name: result.reason?.name, message: result.reason?.message, code: result.reason?.status } }));
            const completedRuns = settledRuns.filter((result) => result.status === 'fulfilled').map((result) => result.value);
            const seen = new Set();
            const candidates = completedRuns.flatMap(({ run, step }) => run.candidates.map((candidate) => ({
              ...candidate,
              targetStep: step.order,
              targetCapabilityId: step.capabilityId
            }))).filter((candidate) => {
              const key = `${candidate.targetCapabilityId}:${candidate.repository}`;
              if (seen.has(key)) return false;
              seen.add(key);
              return true;
            });
            const visibleSeen = new Set();
            const visibleCandidates = completedRuns.flatMap(({ run, step }) => run.userFacing.candidates.map((candidate) => ({
              ...candidate,
              targetStep: step.order,
              targetCapabilityId: step.capabilityId
            }))).filter((candidate) => {
              const key = `${candidate.targetCapabilityId}:${candidate.name}`;
              if (visibleSeen.has(key)) return false;
              visibleSeen.add(key);
              return true;
            });
            const reviewableCandidates = candidates.filter((candidate) => candidate.reviewStatus === 'reviewable' && candidate.qualityAssessment?.score >= 55);
            discovery = {
              source: 'github', hostPlatform: brief.hostPlatform,
              query: completedRuns.map(({ run }) => run.query), queriesByStep: completedRuns.map(({ step, run }) => ({ ...step, query: run.query })),
              dataHandling: 'task keywords used after query sanitization', candidates, errors: failedRuns,
              ...(failedRuns.some((failure) => failure.error?.code === 403) ? { githubAuthSetup: { url: 'https://github.com/settings/personal-access-tokens/new', permissions: 'Public repositories: read-only (Contents and Metadata)', command: 'export GITHUB_TOKEN="<your-token>"', optional: true, note: '无需 GitHub 账号也可使用匿名只读模式；Token 仅用于提高 API 额度，不写入项目文件。' } } : {}),
              reviewableCandidates,
              userFacing: {
                title: '按任务步骤分类的 GitHub 候选',
                summary: '每个候选都按目标步骤归类；AgentFit 没有下载、执行或安装任何候选。',
                candidates: visibleCandidates,
                installationBoundary: '安装仍需用户逐项确认。'
              },
              nextDecision: reviewableCandidates.length > 0
                ? {
                    type: 'install-or-use-existing',
                    prompt: `发现 ${reviewableCandidates.length} 个可进入安装审核的候选。请用户选择要审核安装的候选，或明确选择不安装并使用现有能力。`
                  }
                : {
                    type: 'confirm-host-fallback',
                    prompt: '本次没有证据充分、可直接推荐安装的候选。请说明已检查的候选及原因，并询问用户是否不安装、改用当前主 Agent 的备用流程；确认前不得生成正式交付物。'
                  }
            };
            }
          } catch (error) {
            discovery = { status: 'failed', error: { name: error.name, message: error.message, code: error.status }, ...(error.status === 403 ? {
              githubAuthSetup: {
                url: 'https://github.com/settings/personal-access-tokens/new',
                permissions: 'Public repositories: read-only (Contents and Metadata)',
                command: 'export GITHUB_TOKEN="<your-token>"',
                optional: true,
                note: '无需 GitHub 账号也可使用匿名只读模式；Token 仅用于提高 API 额度，不写入项目文件。'
              }
            } : {}) };
          }
        }
      }
      const response = { ...recommendation, learning, discovery };
      await saveJsonFile(options.stateFile, response);
      output(response);
      return;
    }
    case 'quality-check': {
      const planDocument = await jsonFromFile(options.plan, 'plan');
      const evidence = await jsonFromFile(options.evidence, 'evidence');
      const plan = planDocument?.plan ?? planDocument;
      const result = evaluateQualityGate(plan?.qualityGate, evidence ?? {}, { attempt: Number(options.attempt ?? 1) });
      await saveJsonFile(options.resultFile, result);
      output(result);
      return;
    }
    case 'workflow-outcome': {
      const planDocument = await jsonFromFile(options.plan, 'plan');
      const qualityResult = await jsonFromFile(options.qualityResult, 'qualityResult');
      const plan = planDocument?.plan ?? planDocument;
      const correctionCategories = options.corrections ? String(options.corrections).split('|').filter(Boolean) : [];
      output(await learningStoreFrom(options).recordWorkflowOutcome({
        hostPlatform: options.host,
        projectId: options.project ?? null,
        plan,
        capabilityResolution: plan?.capabilityResolution,
        qualityResult,
        correctionCategories
      }));
      return;
    }
    case 'workbuddy-handoff': {
      const brief = normalizeTaskBrief({ ...taskBriefFrom({ ...options, host: 'workbuddy' }), hostPlatform: 'workbuddy' });
      output(workBuddySearchHandoff(brief, options.skill ?? 'AgentFit recommended Skill'));
      return;
    }
    case 'github-scout': {
      const result = await new GitHubScout().scout({
        ...taskBriefFrom(options),
        allowWeb: asBoolean(options.allowWeb),
        maxCandidates: options.maxCandidates
      });
      output(result);
      return;
    }
    case 'memory-add': {
      const candidate = createMemoryCandidate({
        kind: options.kind,
        summary: options.summary,
        value: options.value,
        sensitivity: options.sensitivity ?? 'normal',
        expiresAt: options.expiresAt ?? null,
        context: { hostPlatform: options.host ?? null, projectId: options.project ?? null },
        recommendationEffect: {
          preferSkillIds: options.preferSkill ? String(options.preferSkill).split('|') : [],
          avoidSkillIds: options.avoidSkill ? String(options.avoidSkill).split('|') : []
        }
      });
      const saved = await new MemoryStore(options.store).saveConfirmed(candidate, { confirmSave: asBoolean(options.confirmSave) });
      output(saved);
      return;
    }
    case 'memory-list':
      output(await new MemoryStore(options.store).list({
        includeExpired: asBoolean(options.includeExpired),
        hostPlatform: options.host ?? null,
        projectId: options.project ?? null
      }));
      return;
    case 'memory-forget':
      output({ deleted: await new MemoryStore(options.store).forget(options.id, { confirmDelete: asBoolean(options.confirmDelete) }) });
      return;
    case 'learning-enable': {
      output(await learningStoreFrom(options).enable({
        hostPlatform: options.host,
        confirmEnable: asBoolean(options.confirmEnable),
        dailyResearch: options.dailyResearch == null ? false : asBoolean(options.dailyResearch),
        timezone: options.timezone,
        localTime: options.localTime ?? '09:00'
      }));
      return;
    }
    case 'learning-status':
      output(await learningStoreFrom(options).context({ hostPlatform: options.host }));
      return;
    case 'learning-forget':
      output(await learningStoreFrom(options).forget({
        hostPlatform: options.host,
        confirmDelete: asBoolean(options.confirmDelete)
      }));
      return;
    case 'daily-research': {
      output(await runDailySkillResearch({
        learningStore: learningStoreFrom(options),
        hostPlatform: options.host,
        maxCandidates: options.maxCandidates,
        force: asBoolean(options.force)
      }));
      return;
    }
    case 'daily-schedule-handoff':
      output(createDailyScheduleHandoff({
        hostPlatform: options.host,
        localTime: options.localTime ?? '09:00',
        frequency: options.frequency ?? 'every weekday',
        learningStorePath: options.learningStore
      }));
      return;
    case 'install-request': {
      const manifest = JSON.parse(await readFile(options.manifest, 'utf8'));
      const request = createInstallRequest(manifest);
      if (!asBoolean(options.confirmInstall)) {
        output(request);
        return;
      }
      output(await new InstallApprovalStore(options.approvalStore).approve(request, { confirmInstall: true }));
      return;
    }
    case 'install-staged': {
      const request = JSON.parse(await readFile(options.request, 'utf8'));
      output(await executeVerifiedFilesystemInstall(request, {
        sourceDirectory: options.source,
        targetDirectory: options.target,
        approvalStore: new InstallApprovalStore(options.approvalStore),
        confirmInstall: asBoolean(options.confirmInstall)
      }));
      return;
    }
    default:
      throw new Error('Commands: recommend [--discover --confirm-discovery true], workbuddy-handoff, github-scout, memory-add, memory-list, memory-forget, learning-enable, learning-status, learning-forget, daily-research, daily-schedule-handoff, install-request, install-staged');
  }
}

commandRunner().catch((error) => {
  process.stderr.write(`${error.name ?? 'Error'}: ${error.message}\n`);
  process.exitCode = 1;
});
