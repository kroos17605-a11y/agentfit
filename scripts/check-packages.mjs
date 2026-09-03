import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const required = [
  '.agents/plugins/marketplace.json',
  '.claude-plugin/marketplace.json',
  '.workbuddy-plugin/marketplace.json',
  'adapters/codex/agentfit/.codex-plugin/plugin.json',
  'adapters/codex/agentfit/skills/agentfit/SKILL.md',
  'adapters/codex/agentfit/skills/agentfit/scripts/cli.mjs',
  'adapters/codex/agentfit/skills/agentfit/scripts/learning.mjs',
  'adapters/codex/agentfit/skills/agentfit/scripts/daily-research.mjs',
  'adapters/codex/agentfit/skills/agentfit/scripts/schedule.mjs',
  'adapters/claude-code/agentfit/.claude-plugin/plugin.json',
  'adapters/claude-code/agentfit/skills/agentfit/SKILL.md',
  'adapters/claude-code/agentfit/skills/agentfit/scripts/cli.mjs',
  'adapters/claude-code/agentfit/skills/agentfit/scripts/learning.mjs',
  'adapters/claude-code/agentfit/skills/agentfit/scripts/daily-research.mjs',
  'adapters/claude-code/agentfit/skills/agentfit/scripts/schedule.mjs',
  'adapters/workbuddy/agentfit/skills/agentfit/SKILL.md',
  'adapters/workbuddy/agentfit/skills/agentfit/scripts/cli.mjs',
  'adapters/workbuddy/agentfit/skills/agentfit/scripts/learning.mjs',
  'adapters/workbuddy/agentfit/skills/agentfit/scripts/daily-research.mjs',
  'adapters/workbuddy/agentfit/skills/agentfit/scripts/schedule.mjs',
  'adapters/workbuddy/agentfit/.workbuddy-plugin/plugin.json',
  'plugins/agentfit/.codex-plugin/plugin.json',
  'plugins/agentfit/skills/agentfit/SKILL.md',
  'plugins/agentfit/skills/agentfit/scripts/cli.mjs',
  'plugins/agentfit/skills/agentfit/scripts/learning.mjs',
  'plugins/agentfit/skills/agentfit/scripts/daily-research.mjs',
  'plugins/agentfit/skills/agentfit/scripts/schedule.mjs'
];

await Promise.all(required.map((path) => access(resolve(root, path))));
for (const path of [
  'adapters/codex/agentfit/.codex-plugin/plugin.json',
  'adapters/claude-code/agentfit/.claude-plugin/plugin.json'
]) {
  JSON.parse(await readFile(resolve(root, path), 'utf8'));
}
const codexManifest = JSON.parse(await readFile(resolve(root, 'adapters/codex/agentfit/.codex-plugin/plugin.json'), 'utf8'));
for (const field of ['name', 'version', 'description', 'author', 'interface']) {
  if (!codexManifest[field]) throw new Error(`Codex manifest is missing ${field}.`);
}
for (const field of ['displayName', 'shortDescription', 'longDescription', 'developerName', 'category', 'capabilities', 'defaultPrompt']) {
  if (!codexManifest.interface[field]) throw new Error(`Codex manifest interface is missing ${field}.`);
}
if (codexManifest.name !== 'agentfit') throw new Error('Codex plugin name must match its agentfit folder.');
const marketplace = JSON.parse(await readFile(resolve(root, '.agents/plugins/marketplace.json'), 'utf8'));
const marketplaceEntry = marketplace.plugins?.find((entry) => entry.name === 'agentfit');
if (!marketplaceEntry || marketplaceEntry.source?.source !== 'local' || marketplaceEntry.source?.path !== './plugins/agentfit') {
  throw new Error('Local marketplace must expose AgentFit from ./plugins/agentfit.');
}
if (marketplaceEntry.policy?.installation !== 'AVAILABLE' || marketplaceEntry.policy?.authentication !== 'ON_INSTALL') {
  throw new Error('Local marketplace AgentFit entry must retain explicit installation policies.');
}
const claudeMarketplace = JSON.parse(await readFile(resolve(root, '.claude-plugin/marketplace.json'), 'utf8'));
const claudeEntry = claudeMarketplace.plugins?.find((entry) => entry.name === 'agentfit');
if (!claudeEntry || claudeEntry.source !== './adapters/claude-code/agentfit') {
  throw new Error('Claude Code marketplace must expose its AgentFit adapter from a local source.');
}
const workBuddyMarketplace = JSON.parse(await readFile(resolve(root, '.workbuddy-plugin/marketplace.json'), 'utf8'));
const workBuddyEntry = workBuddyMarketplace.plugins?.find((entry) => entry.name === 'agentfit');
if (!workBuddyEntry || workBuddyEntry.source !== './adapters/workbuddy/agentfit') {
  throw new Error('WorkBuddy marketplace must expose its AgentFit adapter from a local source.');
}
const packagedManifest = JSON.parse(await readFile(resolve(root, 'plugins/agentfit/.codex-plugin/plugin.json'), 'utf8'));
if (JSON.stringify(packagedManifest) !== JSON.stringify(codexManifest)) {
  throw new Error('Local marketplace plugin manifest must match the Codex adapter manifest.');
}
const codexSkill = await readFile(resolve(root, 'adapters/codex/agentfit/skills/agentfit/SKILL.md'), 'utf8');
const frontmatter = codexSkill.startsWith('---\n') ? codexSkill.slice(4, codexSkill.indexOf('\n---', 4)) : '';
if (!/^name:\s*agentfit\s*$/mu.test(frontmatter) || !/^description:\s*.+$/mu.test(frontmatter)) {
  throw new Error('Codex Skill must contain name and description frontmatter.');
}
process.stdout.write(`Validated ${required.length} required adapter files.\n`);
