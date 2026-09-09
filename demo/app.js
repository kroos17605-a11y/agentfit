const button = document.querySelector('#approvalButton');
const drawer = document.querySelector('#detailDrawer');
const title = document.querySelector('#detailTitle');
const text = document.querySelector('#detailText');
const meta = document.querySelector('#detailMeta');

const details = {
  identify: ['识别任务', 'AgentFit 将一句自然语言转换为交付物、时效、来源和运行环境等结构化要求。', ['交付物', '研究深度', '时效', '运行环境']],
  decompose: ['拆解工作流', '系统把机器人行业 PPT 分成研究、整合分析和制作三个连续步骤，为每一步定义输入、输出和验收标准。', ['Research', 'Synthesis', 'PPTX']],
  match: ['匹配能力', '先读取当前宿主暴露的能力，再为真正缺失的步骤生成英文搜索词，优先复用已有组件。', ['Inventory', 'Gap-only search', 'Minimality']],
  handoff: ['交给主 Agent', '用户确认后，Codex、Claude Code 或 WorkBuddy 按顺序执行；完成后回到 AgentFit 做质量检查。', ['User approval', 'Host execution', 'Quality gate']],
  codex: ['Codex', 'AgentFit 作为 Codex 插件运行，负责任务路由、GitHub 能力发现和交付质量检查。', ['Codex plugin', 'GitHub']],
  claude: ['Claude Code', 'AgentFit 以 Claude Code 插件形式接入，保留相同的工作流与安装边界。', ['Claude Code', 'GitHub']],
  workbuddy: ['WorkBuddy', 'WorkBuddy 使用原生 Skill 搜索，加上 GitHub 发现，AgentFit 输出审核清单和执行顺序。', ['Native Skill search', 'GitHub']],
  p0: ['P0 · 可控的任务闭环', '当前版本先把任务拆解、能力匹配、安装确认、主 Agent 交接和质量检查做成稳定闭环。', ['已完成', '39/39 tests']],
  p1: ['P1 · 个性化能力目录', '下一阶段让工作画像、成功流程和每日调研共同影响候选排序，只推送对用户有帮助的新能力。', ['进行中', 'Daily research']],
  p2: ['P2 · 组合式 Agent 工作流', '未来把研究、分析、写作和制作能力组合成可复用的新工作流，支持跨宿主协作。', ['未来', 'Skill composition']]
};

function openDetail(key) {
  const item = details[key];
  if (!item || !drawer) return;
  title.textContent = item[0];
  text.textContent = item[1];
  meta.innerHTML = item[2].map((value) => `<span>${value}</span>`).join('');
  drawer.classList.add('open');
}
document.querySelectorAll('[data-detail]').forEach((element) => element.addEventListener('click', () => openDetail(element.dataset.detail)));
document.querySelector('.drawer-close')?.addEventListener('click', () => drawer.classList.remove('open'));

button?.addEventListener('click', () => {
  button.innerHTML = '候选已展开 · 等待确认 <span>✓</span>';
  button.closest('.approval').style.color = '#0f766e';
  openDetail('match');
});

const stageButtons = [...document.querySelectorAll('[data-stage]')];
const stagePanels = [...document.querySelectorAll('[data-panel]')];
const auditList = document.querySelector('#auditList');
const initialAudit = auditList?.innerHTML;
const inventoryRows = [...document.querySelectorAll('.inventory-row')];

function logEvent(titleText, detailText, pending = false) {
  if (!auditList) return;
  const item = document.createElement('div');
  item.className = `audit-item${pending ? ' pending' : ''}`;
  item.innerHTML = `<span class="audit-time">刚刚</span><p><b>${titleText}</b><small>${detailText}</small></p>`;
  auditList.prepend(item);
}
function setStage(stageName) {
  stageButtons.forEach((tab) => {
    const active = tab.dataset.stage === stageName;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', String(active));
  });
  stagePanels.forEach((panel) => panel.classList.toggle('hidden', panel.dataset.panel !== stageName));
}
function refreshInventory() {
  const pending = inventoryRows.filter((row) => row.querySelector('.inventory-status')?.classList.contains('unknown')).length;
  const badge = document.querySelector('#inventoryBadge');
  if (badge) {
    badge.textContent = pending ? `${pending} 项待验证` : 'inventory verified';
    badge.classList.toggle('warning', pending > 0);
    badge.classList.toggle('success', pending === 0);
  }
  const hint = document.querySelector('#inventoryHint');
  if (hint) hint.textContent = pending ? '建议先验证网页检索，避免盲目搜索和安装。' : '已拿到能力证据，可以进入候选发现。';
}
function verifyRow(row) {
  const status = row.querySelector('.inventory-status');
  const action = row.querySelector('.row-action');
  if (!status || !status.classList.contains('unknown')) return;
  status.className = 'inventory-status verified';
  status.textContent = 'verified';
  if (action) { action.textContent = '已验证'; action.disabled = true; }
  logEvent('能力已验证', row.querySelector('.cap-info strong')?.textContent || 'host inventory');
  refreshInventory();
}
stageButtons.forEach((tab) => tab.addEventListener('click', () => {
  setStage(tab.dataset.stage);
  logEvent('切换阶段', tab.querySelector('b')?.textContent || tab.dataset.stage);
}));
document.querySelectorAll('[data-action="verify"]').forEach((action) => action.addEventListener('click', () => {
  const row = action.closest('.inventory-row');
  if (row) verifyRow(row);
}));
document.querySelector('[data-action="verify-all"]')?.addEventListener('click', () => {
  inventoryRows.forEach(verifyRow);
  logEvent('inventory verified', '网页检索、引用与输出能力均已获得证据');
});
document.querySelector('[data-action="to-install"]')?.addEventListener('click', () => {
  setStage('install');
  logEvent('进入 HITL 安装确认', '候选：Browser MCP', true);
});
document.querySelectorAll('[data-action="select-candidate"]').forEach((action) => action.addEventListener('click', () => {
  action.textContent = '已选中'; action.disabled = true;
  logEvent('查看候选详情', action.closest('.candidate-row')?.querySelector('strong')?.textContent || 'candidate');
}));
document.querySelector('[data-action="consent-install"]')?.addEventListener('change', (event) => {
  const installButton = document.querySelector('[data-action="install"]');
  if (installButton) installButton.disabled = !event.target.checked;
});
document.querySelector('[data-action="install"]')?.addEventListener('click', () => {
  const status = document.querySelector('[data-panel="install"] .state-badge');
  if (status) { status.textContent = '已安装'; status.className = 'state-badge success'; }
  logEvent('安装已确认', 'Browser MCP · 网络权限 · 用户批准');
  setStage('execute');
  const executeButton = document.querySelector('[data-action="execute"]');
  if (executeButton) executeButton.disabled = false;
});
document.querySelector('[data-action="execute"]')?.addEventListener('click', () => {
  logEvent('执行已确认', '主 Agent 开始抓取公开网页并生成简报');
  const status = document.querySelector('[data-panel="execute"] .state-badge');
  if (status) { status.textContent = '执行中'; status.className = 'state-badge success'; }
  setStage('quality');
});
document.querySelector('[data-action="review"]')?.addEventListener('click', (event) => {
  event.currentTarget.textContent = '已打开复核清单';
  logEvent('打开人工复核', '定价冲突 · 等待业务负责人确认', true);
});
document.querySelector('[data-action="reset"]')?.addEventListener('click', () => {
  inventoryRows.forEach((row) => {
    const status = row.querySelector('.inventory-status');
    const action = row.querySelector('.row-action');
    if (!status || row.dataset.capability === 'pptx') return;
    status.className = 'inventory-status unknown'; status.textContent = 'unknown';
    if (action) { action.textContent = '验证'; action.disabled = false; }
  });
  const consent = document.querySelector('[data-action="consent-install"]');
  if (consent) consent.checked = false;
  const installButton = document.querySelector('[data-action="install"]');
  if (installButton) installButton.disabled = true;
  const executeButton = document.querySelector('[data-action="execute"]');
  if (executeButton) executeButton.disabled = true;
  const installStatus = document.querySelector('[data-panel="install"] .state-badge');
  if (installStatus) { installStatus.textContent = '等待确认'; installStatus.className = 'state-badge warning'; }
  const executeStatus = document.querySelector('[data-panel="execute"] .state-badge');
  if (executeStatus) { executeStatus.textContent = '等待确认'; executeStatus.className = 'state-badge warning'; }
  document.querySelectorAll('[data-action="select-candidate"]').forEach((candidate) => { candidate.textContent = '查看详情'; candidate.disabled = false; });
  const reviewButton = document.querySelector('[data-action="review"]');
  if (reviewButton) reviewButton.textContent = '打开复核清单';
  if (auditList && initialAudit) auditList.innerHTML = initialAudit;
  refreshInventory(); setStage('inventory');
});
const observer = new IntersectionObserver((entries) => entries.forEach((entry) => entry.isIntersecting && entry.target.classList.add('visible')), { threshold: .12 });
document.querySelectorAll('section, .story-card, .timeline-item, .recommend-row, .roadmap-card').forEach((element) => { element.classList.add('reveal'); observer.observe(element); });
