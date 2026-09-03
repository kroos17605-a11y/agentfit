import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

export class InstallContractError extends Error {
  constructor(message) {
    super(message);
    this.name = 'InstallContractError';
  }
}

const SUPPORTED_HOSTS = new Set(['workbuddy', 'codex', 'claude-code']);
const INSTALL_SCOPES = new Set(['user', 'project']);

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function manifestDigest(manifest) {
  return createHash('sha256').update(stableJson(manifest)).digest('hex');
}

function safeRelativePath(value) {
  const path = String(value ?? '').replace(/^\/+/, '');
  const segments = path.split('/');
  if (!path || path.includes('\\') || path.startsWith('/') || segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new InstallContractError(`Invalid package path: ${value}`);
  }
  return path;
}

function validateManifest(manifest) {
  if (!manifest || typeof manifest !== 'object') throw new InstallContractError('Install manifest must be an object.');
  if (!SUPPORTED_HOSTS.has(manifest.targetPlatform)) throw new InstallContractError('A supported targetPlatform is required.');
  if (!INSTALL_SCOPES.has(manifest.installScope)) throw new InstallContractError('installScope must be user or project.');
  if (!manifest.skill?.name || !manifest.skill?.version || !manifest.skill?.sourceUrl) {
    throw new InstallContractError('skill.name, skill.version, and skill.sourceUrl are required.');
  }
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    throw new InstallContractError('files must contain the exact files approved for installation.');
  }
  const files = manifest.files.map((file) => ({
    path: safeRelativePath(file.path),
    sha256: String(file.sha256 ?? '').toLowerCase(),
    bytes: Number(file.bytes)
  }));
  if (new Set(files.map((file) => file.path)).size !== files.length) {
    throw new InstallContractError('Install manifest contains duplicate file paths.');
  }
  for (const file of files) {
    if (!/^[a-f0-9]{64}$/u.test(file.sha256) || !Number.isSafeInteger(file.bytes) || file.bytes < 0) {
      throw new InstallContractError(`Invalid integrity entry for ${file.path}.`);
    }
  }
  if (!Array.isArray(manifest.requestedPermissions)) throw new InstallContractError('requestedPermissions must be an array.');
  if (typeof manifest.scriptsWillRun !== 'boolean') throw new InstallContractError('scriptsWillRun must be boolean.');
  if (!manifest.uninstall?.instructions) throw new InstallContractError('uninstall.instructions is required.');
  return {
    targetPlatform: manifest.targetPlatform,
    installScope: manifest.installScope,
    skill: { name: String(manifest.skill.name), version: String(manifest.skill.version), sourceUrl: String(manifest.skill.sourceUrl) },
    files,
    requestedPermissions: manifest.requestedPermissions.map(String),
    scriptsWillRun: manifest.scriptsWillRun === true,
    uninstall: { instructions: String(manifest.uninstall.instructions) }
  };
}

async function loadState(filePath, initial) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return initial;
    throw error;
  }
}

async function saveState(filePath, state) {
  await mkdir(dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, filePath);
}

/** Creates an unapproved, user-visible request with no side effects. */
export function createInstallRequest(manifest) {
  const approvedManifest = validateManifest(manifest);
  return {
    id: `install_${randomUUID()}`,
    manifest: approvedManifest,
    manifestDigest: manifestDigest(approvedManifest),
    status: 'pending_user_confirmation',
    createdAt: new Date().toISOString(),
    approval: null
  };
}

/**
 * The approval record is intentionally stored separately from an exported request. Execution
 * checks this record again, so mutating a request JSON after approval cannot substitute files.
 */
export class InstallApprovalStore {
  constructor(filePath) {
    if (!filePath) throw new InstallContractError('An approval store file path is required.');
    this.filePath = filePath;
  }

  async approve(request, { confirmInstall = false } = {}) {
    if (confirmInstall !== true) throw new InstallContractError('Approval requires confirmInstall: true.');
    if (request?.status !== 'pending_user_confirmation') {
      throw new InstallContractError('Only a pending_user_confirmation request may be approved.');
    }
    const manifest = validateManifest(request.manifest);
    const digest = manifestDigest(manifest);
    if (digest !== request.manifestDigest) throw new InstallContractError('Request manifest changed before approval.');
    const state = await loadState(this.filePath, { version: 1, approvals: [] });
    if (!Array.isArray(state.approvals)) throw new InstallContractError('Approval store is invalid.');
    const approval = {
      requestId: request.id,
      manifest,
      manifestDigest: digest,
      approvedAt: new Date().toISOString()
    };
    state.approvals = state.approvals.filter((entry) => entry.requestId !== request.id);
    state.approvals.push(approval);
    await saveState(this.filePath, state);
    const status = manifest.targetPlatform === 'workbuddy' ? 'handoff_required' : 'ready_for_verified_adapter';
    return {
      ...request,
      status,
      approval: { confirmedAt: approval.approvedAt, manifestDigest: digest },
      ...(status === 'handoff_required' ? {
        handoff: {
          reason: 'No verified WorkBuddy marketplace installation adapter is bundled.',
          userAction: 'Use the separately approved source and checklist in WorkBuddy’s native Skill installation flow.'
        }
      } : {})
    };
  }

  async verify(request) {
    if (!request?.id || !request.manifest) throw new InstallContractError('Install request is incomplete.');
    const manifest = validateManifest(request.manifest);
    const digest = manifestDigest(manifest);
    if (digest !== request.manifestDigest || digest !== request.approval?.manifestDigest) {
      throw new InstallContractError('Install request changed after confirmation.');
    }
    const state = await loadState(this.filePath, { version: 1, approvals: [] });
    const approval = state.approvals?.find((entry) => entry.requestId === request.id);
    if (!approval || approval.manifestDigest !== digest || stableJson(approval.manifest) !== stableJson(manifest)) {
      throw new InstallContractError('No matching independent approval record exists for this request.');
    }
    return approval;
  }
}

function assertInside(root, path) {
  const relativePath = relative(root, path);
  if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
    throw new InstallContractError('Resolved package path escapes its declared root.');
  }
}

async function assertRealDirectory(path, label) {
  let info;
  try {
    info = await lstat(path);
  } catch (error) {
    if (error.code === 'ENOENT') throw new InstallContractError(`${label} must already exist as a real directory.`);
    throw error;
  }
  if (info.isSymbolicLink() || !info.isDirectory()) throw new InstallContractError(`${label} must be a real directory, not a symbolic link.`);
}

async function ensureSafeTargetPath(targetRoot, relativePath) {
  await assertRealDirectory(targetRoot, 'targetDirectory');
  const segments = relativePath.split('/');
  let cursor = targetRoot;
  for (const segment of segments.slice(0, -1)) {
    cursor = resolve(cursor, segment);
    try {
      const info = await lstat(cursor);
      if (info.isSymbolicLink() || !info.isDirectory()) {
        throw new InstallContractError(`Target path contains a non-directory or symbolic link: ${relativePath}.`);
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await mkdir(cursor);
    }
  }
  const targetPath = resolve(targetRoot, relativePath);
  assertInside(targetRoot, targetPath);
  try {
    await lstat(targetPath);
    throw new InstallContractError(`Refusing to overwrite existing target: ${relativePath}.`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return targetPath;
}

async function contentWithIntegrity(sourceRoot, expected) {
  const sourcePath = resolve(sourceRoot, expected.path);
  assertInside(sourceRoot, sourcePath);
  const sourceInfo = await lstat(sourcePath);
  if (sourceInfo.isSymbolicLink() || !sourceInfo.isFile()) {
    throw new InstallContractError(`Approved source must be a real file: ${expected.path}.`);
  }
  const content = await readFile(sourcePath);
  const actualHash = createHash('sha256').update(content).digest('hex');
  if (content.byteLength !== expected.bytes || actualHash !== expected.sha256) {
    throw new InstallContractError(`Integrity check failed for ${expected.path}.`);
  }
  return content;
}

/** Installs only already-staged, independently-approved, checksum-verified files. */
export async function executeVerifiedFilesystemInstall(request, {
  sourceDirectory,
  targetDirectory,
  approvalStore,
  confirmInstall = false
} = {}) {
  if (request?.status !== 'ready_for_verified_adapter') {
    throw new InstallContractError('Only a ready_for_verified_adapter request can be executed.');
  }
  if (confirmInstall !== true) throw new InstallContractError('Execution requires confirmInstall: true.');
  if (!(approvalStore instanceof InstallApprovalStore)) throw new InstallContractError('Execution requires an independent InstallApprovalStore.');
  if (!sourceDirectory || !targetDirectory) throw new InstallContractError('sourceDirectory and targetDirectory are required.');
  await approvalStore.verify(request);
  if (request.manifest.scriptsWillRun) {
    throw new InstallContractError('This adapter refuses packages that execute scripts; use a separately verified platform adapter.');
  }
  const sourceRoot = resolve(sourceDirectory);
  const targetRoot = resolve(targetDirectory);
  await assertRealDirectory(sourceRoot, 'sourceDirectory');
  const copies = [];
  try {
    for (const file of request.manifest.files) {
      const content = await contentWithIntegrity(sourceRoot, file);
      const targetPath = await ensureSafeTargetPath(targetRoot, file.path);
      await writeFile(targetPath, content, { flag: 'wx' });
      copies.push({ file, targetPath });
    }
  } catch (error) {
    await Promise.all(copies.reverse().map(({ targetPath }) => rm(targetPath, { force: true })));
    throw error;
  }
  return {
    id: request.id,
    status: 'installed',
    targetPlatform: request.manifest.targetPlatform,
    targetDirectory: targetRoot,
    installedFiles: copies.map(({ file }) => file.path),
    completedAt: new Date().toISOString()
  };
}
