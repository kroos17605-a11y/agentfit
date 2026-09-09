import { normalizeCapabilityInventory } from './capability.mjs';

export const HOST_INVENTORY_VERSION = 1;
const INVENTORY_SOURCES = new Set(['host-runtime', 'host-adapter', 'user-supplied']);
const INVENTORY_MODES = new Set(['verified', 'partial', 'unknown']);

export class HostInventoryError extends Error {
  constructor(message) {
    super(message);
    this.name = 'HostInventoryError';
  }
}

function text(value, field, max = 200) {
  const result = String(value ?? '').trim();
  if (!result || result.length > max) throw new HostInventoryError(`${field} must be a non-empty string under ${max} characters.`);
  return result;
}

/**
 * Normalize the small, host-neutral envelope that adapters write after
 * inspecting the tools actually exposed in the current session.
 */
export function normalizeHostInventory(input = {}, { hostPlatform } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new HostInventoryError('Host inventory must be an object.');
  }
  const host = text(input.hostPlatform ?? hostPlatform, 'hostPlatform');
  const mode = String(input.mode ?? (input.complete === false ? 'partial' : 'verified')).trim().toLocaleLowerCase();
  if (!INVENTORY_MODES.has(mode)) throw new HostInventoryError(`mode must be one of: ${[...INVENTORY_MODES].join(', ')}.`);
  const source = String(input.source ?? 'host-runtime').trim().toLocaleLowerCase();
  if (!INVENTORY_SOURCES.has(source)) throw new HostInventoryError(`source must be one of: ${[...INVENTORY_SOURCES].join(', ')}.`);
  const components = normalizeCapabilityInventory(input.components ?? []);
  const observedAt = input.observedAt == null ? null : text(input.observedAt, 'observedAt', 80);
  return {
    version: Number(input.version ?? HOST_INVENTORY_VERSION),
    hostPlatform: host,
    source,
    mode,
    observedAt,
    components,
    capabilityIds: [...new Set(components.flatMap((component) => component.capabilityIds))].sort()
  };
}

export function hostInventoryStatus(input, { hostPlatform } = {}) {
  if (input == null) {
    return {
      status: 'unknown',
      verified: false,
      reason: '宿主没有提供当前会话实际暴露的 Skill、MCP、工具或插件清单。不能据此判断主 Agent 是否具备网页研究能力。',
      nextAction: `请让 ${hostPlatform ?? '宿主 Agent'} 先列出当前会话可调用的工具元数据，再重新运行 AgentFit。`
    };
  }
  const inventory = normalizeHostInventory(input, { hostPlatform });
  if (inventory.mode === 'unknown') {
    return { status: 'unknown', verified: false, inventory, reason: '宿主明确表示无法验证当前会话能力。', nextAction: '补充当前会话的实际工具清单；不要把磁盘上的配置或插件文件当成已启用能力。' };
  }
  if (inventory.mode === 'partial') {
    return { status: 'partial', verified: false, inventory, reason: '宿主只提供了部分能力清单，未列出的组件仍然未知。', nextAction: '完成当前会话的 Skill、MCP、工具、插件和扩展盘点后再进行缺口搜索。' };
  }
  return {
    status: 'verified',
    verified: true,
    inventory,
    reason: `已由 ${inventory.source} 验证当前会话的 ${inventory.components.length} 个组件。`,
    nextAction: '可以根据已验证的能力覆盖情况决定复用或只搜索缺口。'
  };
}

export function inventoryCollectionPrompt(hostPlatform) {
  const host = text(hostPlatform, 'hostPlatform');
  return {
    hostPlatform: host,
    requiredFields: ['id', 'name', 'type', 'enabled', 'capabilityIds', 'hostPlatforms'],
    instruction: `请在 ${host} 当前会话中枚举实际暴露且已启用的 Skill、MCP server、tool、plugin 和 extension。只写元数据，不调用无关工具；磁盘存在的配置不等于当前会话可用。`,
    capabilityHints: {
      'research-with-citations': 'browser、web search、网页抓取、Playwright、search/fetch 类工具',
      'presentation-production': 'PPTX、PowerPoint、slides 生成或编辑工具'
    },
    privacy: '不要写入凭证、任务原文、文件内容、客户名或项目代号。',
    outputFile: '.agentfit/inventory.json'
  };
}
