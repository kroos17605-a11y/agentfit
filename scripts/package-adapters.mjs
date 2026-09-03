import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(root, 'src');
const destinations = [
  'adapters/codex/agentfit/skills/agentfit/scripts',
  'adapters/claude-code/agentfit/skills/agentfit/scripts',
  'adapters/workbuddy/agentfit/skills/agentfit/scripts'
].map((path) => resolve(root, path));
const localMarketplacePlugin = resolve(root, 'plugins/agentfit');

for (const destination of destinations) {
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  await cp(source, destination, { recursive: true });
}

// The project-local marketplace is a distributable Codex artifact.  Keep it
// derived from the Codex adapter so the manifest, SKILL.md, and core scripts
// cannot silently drift from the package users actually install.
await rm(localMarketplacePlugin, { recursive: true, force: true });
await mkdir(resolve(root, 'plugins'), { recursive: true });
await cp(resolve(root, 'adapters/codex/agentfit'), localMarketplacePlugin, { recursive: true });

process.stdout.write(`Packaged AgentFit core into ${destinations.length} host adapters and the local Codex marketplace plugin.\n`);
