import { basename } from 'node:path';
import { HOST_PLATFORMS } from './policy.mjs';

export class ScheduleHandoffError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ScheduleHandoffError';
  }
}

function assertHost(hostPlatform) {
  if (!HOST_PLATFORMS.includes(hostPlatform)) {
    throw new ScheduleHandoffError(`hostPlatform must be one of: ${HOST_PLATFORMS.join(', ')}.`);
  }
  return hostPlatform;
}

function assertLocalTime(localTime) {
  const value = String(localTime ?? '09:00').trim();
  if (!/^([01]\d|2[0-3]):[0-5]\d$/u.test(value)) {
    throw new ScheduleHandoffError('localTime must use 24-hour HH:MM format.');
  }
  return value;
}

function hostScheduleInstruction(hostPlatform, localTime, frequency) {
  const shared = `Run ${frequency} at ${localTime} local time using the installed AgentFit Skill to prepare a personalized daily project brief for ${hostPlatform}. Run approved GitHub Skill research using only saved capability patterns, business-domain labels, and structured work profile; never include task text, files, credentials, or private context in a query. Return new relevant Skills, MCP servers, plugins, or installable projects with a short explanation of why each matches the user's recurring work. Notify the user only when there is at least one new reviewable recommendation; otherwise remain silent. For WorkBuddy, include native Skill-search handoffs. Never install, update, enable, download, or execute a candidate.`;
  if (hostPlatform === 'workbuddy') {
    return {
      scheduler: 'WorkBuddy native scheduled task',
      prompt: shared,
      durabilityRequirement: 'Create a durable task and return its task ID. A session-only or expiring schedule is not sufficient for this feature.',
      verification: 'After creation, show the native task ID, its next run, and whether it survives a restart.'
    };
  }
  if (hostPlatform === 'codex') {
    return {
      scheduler: 'Codex recurring task',
      prompt: shared,
      durabilityRequirement: 'Create a recurring task attached to the selected project/account and return its task ID.',
      verification: 'Show the task ID, cadence, next run, and notification policy.'
    };
  }
  return {
    scheduler: 'Claude Code host scheduler or an external durable scheduler',
    prompt: shared,
    durabilityRequirement: 'Use a scheduler that survives an interactive Claude Code session ending.',
    verification: 'Show the scheduler identifier, cadence, and next run.'
  };
}

export function createDailyScheduleHandoff({ hostPlatform, localTime = '09:00', frequency = 'every weekday', learningStorePath = '.agentfit/learning.json' } = {}) {
  const host = assertHost(hostPlatform);
  const time = assertLocalTime(localTime);
  if (!['every day', 'every weekday', 'weekly'].includes(frequency)) {
    throw new ScheduleHandoffError('frequency must be every day, every weekday, or weekly.');
  }
  const store = String(learningStorePath ?? '').trim();
  if (!store || store.length > 2000) throw new ScheduleHandoffError('learningStorePath is required.');
  return {
    status: 'user_confirmation_required',
    feature: 'agentfit-daily-skill-research',
    hostPlatform: host,
    localTime: time,
    frequency,
    notification: {
      defaultChannel: 'host-agent-notification',
      systemNotificationBar: 'optional-host-capability',
      rule: 'Only send a notification when digest.recommendations contains at least one new reviewable candidate; otherwise do not notify.',
      payload: 'Show candidate title, type, why it matches the learned profile, key features, advantages, links, evidence status, and install boundary.'
    },
    learningStore: {
      pathHint: basename(store),
      privacy: 'The scheduled job reads only AgentFit capability-pattern storage. It does not read a task transcript or native host memory.'
    },
    execution: {
      command: ['node', '<agentfit-skill>/scripts/cli.mjs', 'daily-research', '--host', host, '--learning-store', '<configured AgentFit state file>'],
      idempotency: 'The daily job records its local-day completion and returns not_due if invoked again that day.'
    },
    hostSchedule: hostScheduleInstruction(host, time, frequency),
    safety: [
      'Daily external research requires a separate explicit opt-in before schedule creation; local automatic learning does not enable it.',
      'The scheduler must not be treated as installed until its host task ID and durability are verified.',
      'Research is read-only GitHub evidence collection; third-party Skill installation remains a separate exact confirmation.'
    ]
  };
}
