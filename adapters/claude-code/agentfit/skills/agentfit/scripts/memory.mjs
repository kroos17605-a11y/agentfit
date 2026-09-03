import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

const ALLOWED_KINDS = new Set(['profile', 'routine', 'business-context', 'skill-decision', 'feedback', 'safety-guardrail']);

export class MemoryContractError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MemoryContractError';
  }
}

function assertText(value, field) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new MemoryContractError(`${field} is required.`);
  if (normalized.length > 500) throw new MemoryContractError(`${field} must be 500 characters or fewer.`);
  return normalized;
}

function normalizedStrings(values, field) {
  if (!Array.isArray(values)) throw new MemoryContractError(`${field} must be an array.`);
  const normalized = [...new Set(values.map((value) => assertText(value, field)))];
  return normalized;
}

function normalizeContext(context = {}) {
  if (context == null || typeof context !== 'object') throw new MemoryContractError('context must be an object.');
  const hostPlatform = context.hostPlatform == null ? null : assertText(context.hostPlatform, 'context.hostPlatform');
  if (hostPlatform && !['workbuddy', 'codex', 'claude-code'].includes(hostPlatform)) {
    throw new MemoryContractError('context.hostPlatform is not supported.');
  }
  return {
    hostPlatform,
    projectId: context.projectId == null ? null : assertText(context.projectId, 'context.projectId')
  };
}

function normalizeRecommendationEffect(effect = {}) {
  if (effect == null || typeof effect !== 'object') throw new MemoryContractError('recommendationEffect must be an object.');
  const preferSkillIds = normalizedStrings(effect.preferSkillIds ?? [], 'recommendationEffect.preferSkillIds');
  const avoidSkillIds = normalizedStrings(effect.avoidSkillIds ?? [], 'recommendationEffect.avoidSkillIds');
  if (preferSkillIds.some((id) => avoidSkillIds.includes(id))) {
    throw new MemoryContractError('A Skill cannot be both preferred and avoided.');
  }
  return { preferSkillIds, avoidSkillIds };
}

function normalizeMetadata(metadata = {}) {
  if (metadata == null || typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw new MemoryContractError('metadata must be an object.');
  }
  const list = (value, field) => value == null ? [] : normalizedStrings(value, `metadata.${field}`);
  return {
    businessDomain: metadata.businessDomain == null ? null : assertText(metadata.businessDomain, 'metadata.businessDomain'),
    entities: list(metadata.entities, 'entities').slice(0, 20),
    preferredOutputs: list(metadata.preferredOutputs, 'preferredOutputs').slice(0, 10),
    workflowSteps: list(metadata.workflowSteps, 'workflowSteps').slice(0, 12),
    audience: metadata.audience == null ? null : assertText(metadata.audience, 'metadata.audience')
  };
}

function validateExpiresAt(expiresAt) {
  if (expiresAt == null) return null;
  const timestamp = Date.parse(expiresAt);
  if (!Number.isFinite(timestamp)) throw new MemoryContractError('expiresAt must be an ISO date.');
  if (timestamp <= Date.now()) throw new MemoryContractError('expiresAt must be in the future.');
  return new Date(timestamp).toISOString();
}

export function createMemoryCandidate({
  kind,
  summary,
  value,
  sensitivity = 'normal',
  expiresAt = null,
  source = 'user-confirmed',
  context = {},
  recommendationEffect = {},
  metadata = {}
}) {
  if (!ALLOWED_KINDS.has(kind)) throw new MemoryContractError(`Unsupported memory kind: ${kind}.`);
  if (!['normal', 'sensitive'].includes(sensitivity)) throw new MemoryContractError('sensitivity must be normal or sensitive.');
  return {
    id: `mem_${randomUUID()}`,
    kind,
    summary: assertText(summary, 'summary'),
    value: assertText(value, 'value'),
    sensitivity,
    source,
    context: normalizeContext(context),
    metadata: normalizeMetadata(metadata),
    recommendationEffect: normalizeRecommendationEffect(recommendationEffect),
    status: 'pending_user_confirmation',
    createdAt: new Date().toISOString(),
    expiresAt: validateExpiresAt(expiresAt)
  };
}

async function load(filePath) {
  try {
    const content = await readFile(filePath, 'utf8');
    const state = JSON.parse(content);
    if (!Array.isArray(state.entries)) throw new MemoryContractError('Memory store has an invalid entries field.');
    return state;
  } catch (error) {
    if (error.code === 'ENOENT') return { version: 1, entries: [] };
    throw error;
  }
}

async function saveAtomic(filePath, state) {
  await mkdir(dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, filePath);
}

export class MemoryStore {
  constructor(filePath) {
    if (!filePath) throw new MemoryContractError('A memory file path is required.');
    this.filePath = filePath;
  }

  async list({ includeExpired = false, hostPlatform = null, projectId = null } = {}) {
    const state = await load(this.filePath);
    const now = Date.now();
    return state.entries.filter((entry) => {
      const isExpired = entry.expiresAt && Date.parse(entry.expiresAt) <= now;
      if (!includeExpired && isExpired) return false;
      if (hostPlatform && entry.context?.hostPlatform && entry.context.hostPlatform !== hostPlatform) return false;
      if (projectId && entry.context?.projectId && entry.context.projectId !== projectId) return false;
      return true;
    });
  }

  async saveConfirmed(candidate, { confirmSave = false } = {}) {
    if (confirmSave !== true) {
      throw new MemoryContractError('Saving memory requires confirmSave: true.');
    }
    const state = await load(this.filePath);
    const duplicate = state.entries.find((entry) =>
      entry.status === 'confirmed' &&
      entry.kind === candidate.kind &&
      entry.summary === candidate.summary &&
      entry.context?.hostPlatform === candidate.context.hostPlatform &&
      entry.context?.projectId === candidate.context.projectId
    );
    if (duplicate) throw new MemoryContractError('An active memory with the same kind, summary, and context already exists.');
    const entry = { ...candidate, status: 'confirmed', confirmedAt: new Date().toISOString() };
    state.entries.push(entry);
    await saveAtomic(this.filePath, state);
    return entry;
  }

  async forget(id, { confirmDelete = false } = {}) {
    if (confirmDelete !== true) {
      throw new MemoryContractError('Deleting memory requires confirmDelete: true.');
    }
    const state = await load(this.filePath);
    const index = state.entries.findIndex((entry) => entry.id === id);
    if (index === -1) return false;
    state.entries.splice(index, 1);
    await saveAtomic(this.filePath, state);
    return true;
  }
}
