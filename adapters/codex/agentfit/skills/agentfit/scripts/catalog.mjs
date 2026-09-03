export const CATALOG_VERSION = '0.3.0';

const universalPlatforms = ['workbuddy', 'codex', 'claude-code'];

// Public, generic search terms are deliberately separate from task text. They
// make GitHub discovery useful for non-English or sensitive tasks without
// leaking a user's work brief into an external query.
export const GITHUB_DISCOVERY_TERMS = Object.freeze({
  'public-data-analysis': ['data', 'analysis', 'csv'],
  'private-data-analysis': ['local', 'data', 'analysis'],
  'report-formatter': ['report', 'writing'],
  'research-with-citations': ['research', 'citations'],
  'document-summarizer': ['document', 'summarization'],
  'meeting-follow-up': ['meeting', 'follow-up'],
  'presentation-outline': ['presentation-outline', 'slide-storyline'],
  'presentation-production': ['pptx', 'powerpoint', 'presentation-generation'],
  'writing-polish': ['writing', 'editing', 'polish'],
  'presentation-design': ['presentation', 'design', 'layout'],
  'spreadsheet-cleanup': ['spreadsheet', 'cleanup'],
  'knowledge-base-organizer': ['knowledge', 'organization'],
  'translation-localization': ['translation', 'localization'],
  'email-drafting': ['email', 'writing'],
  'structured-decision-scorecard': ['decision', 'scorecard'],
  'project-planning': ['project', 'planning'],
  'workflow-automation-planner': ['workflow', 'automation']
});

// These are product explanations for people, rather than instructions for the
// host model.  A fixed capability card must be intelligible before it can be
// useful: users need to know what it does, what they get, and its boundaries.
const USER_GUIDES = {
  'public-data-analysis': {
    displayName: '公開資料分析',
    whatItDoes: '讀取你選擇的公開 CSV 或試算表，整理趨勢、異常與需要核對的地方。',
    bestFor: '公開營運數據、銷售週報、趨勢盤點。',
    keyFeatures: ['趨勢與異常辨識', '可核對的分析表格'],
    advantages: ['把分散數字轉成可討論的重點', '先做檢查，降低只看平均值而忽略異常的風險'],
    limitations: ['只適用於可公開使用的資料；內部或敏感資料會改用私密資料分析。']
  },
  'private-data-analysis': {
    displayName: '私密資料分析',
    whatItDoes: '在宿主工作區內分析你選擇的內部表格資料，整理趨勢、異常與核對項目。',
    bestFor: '內部營運表、客戶資料、尚未公開的預測數據。',
    keyFeatures: ['內部資料趨勢分析', '資料不外送的工作流限制'],
    advantages: ['保留與公開資料分析相同的洞察結構', '避免把非公開內容送進外部調研或第三方工具'],
    limitations: ['不會代替資料權限管理；高影響決策仍需人工覆核。']
  },
  'report-formatter': {
    displayName: '決策報告整理',
    whatItDoes: '把已確認的研究或分析發現，整理成有摘要、重點與下一步的短報告。',
    bestFor: '週報、主管摘要、研究結論整理。',
    keyFeatures: ['高層摘要', '結論與證據分層'],
    advantages: ['將分析結果轉成容易閱讀與決策的格式', '避免把原始筆記直接丟給讀者'],
    limitations: ['依賴前一步已核對的事實；不會自行補造資料或引用。']
  },
  'research-with-citations': {
    displayName: '附引用的公開調研',
    whatItDoes: '規劃並彙整公開網路資料，將重要結論連回可檢查的來源。',
    bestFor: '市場趨勢、競品、公開產品資訊與需要來源佐證的研究。',
    keyFeatures: ['研究問題拆解', '來源層級引用與交叉核對'],
    advantages: ['讀者可以回查每個關鍵結論', '將「資料很多」轉成有決策價值的研究摘要'],
    limitations: ['必須先取得聯網授權；只應處理公開資訊，不能帶出內部資料。']
  },
  'document-summarizer': {
    displayName: '文件重點整理',
    whatItDoes: '從你提供的文件中抽取決策、主題、待確認問題與重點脈絡。',
    bestFor: 'PDF、長文件、背景資料、內部說明文件。',
    keyFeatures: ['主題歸納', '未解問題與決策萃取'],
    advantages: ['減少閱讀長文件的時間', '不只縮短文字，也保留需要追問的內容'],
    limitations: ['只根據你提供的文件，不會自動補充外部事實。']
  },
  'meeting-follow-up': {
    displayName: '會議跟進整理',
    whatItDoes: '把會議紀要轉為已做決定、負責人與可追蹤的後續行動。',
    bestFor: '例會紀錄、跨部門同步、專案會後跟進。',
    keyFeatures: ['決策與待辦分離', '行動項與責任歸屬'],
    advantages: ['讓會議從記錄變成可執行的下一步', '降低待辦遺漏與責任不清'],
    limitations: ['責任人與日期需要由你確認；不會自行代表你發送任務。']
  },
  'presentation-outline': {
    displayName: '簡報架構設計',
    whatItDoes: '把已確認的研究或分析轉成以決策為中心的簡報大綱與講稿提示。',
    bestFor: '管理層匯報、策略提案、研究成果簡報。',
    keyFeatures: ['決策敘事結構', '投影片大綱與講者提示'],
    advantages: ['先建立故事線，再投入排版製作', '幫助受眾快速理解問題、證據與建議'],
    limitations: ['需要前一步的可信輸入；不會把未驗證的研究直接包裝成結論。']
  },
  'presentation-production': {
    displayName: 'PPT 制作',
    whatItDoes: '把已整理和核验的内容制作成可编辑的 PPTX，包含页面结构、图表、引用和讲者提示。',
    bestFor: '需要直接交付 PowerPoint 文件的行业研究、管理汇报和产品方案。',
    keyFeatures: ['可编辑 PPTX 生成', '图表、引用与讲者提示'],
    advantages: ['直接对应用户要求的最终交付物', '避免只生成大纲却没有可用文件'],
    limitations: ['依赖已核验和结构化的输入；品牌模板与特殊字体可能需要额外提供。']
  },
  'writing-polish': {
    displayName: '文字润色与编辑',
    whatItDoes: '在不改变事实和原意的前提下，优化结构、措辞、语气和术语一致性。',
    bestFor: '报告、PPT 文案、方案、周报和对外材料的最终文字检查。',
    keyFeatures: ['事实与原意保护', '受众导向的表达优化'],
    advantages: ['让复杂内容更清楚、更容易被快速阅读', '减少歧义、重复和不一致的表达'],
    limitations: ['不会替你补造事实；专业术语和关键数字仍需人工确认。']
  },
  'presentation-design': {
    displayName: 'PPT 视觉设计与排版',
    whatItDoes: '把已确认的简报结构和文字转成统一的版式、图表、视觉层级和可编辑页面。',
    bestFor: '行业汇报、管理层演示、产品方案和需要正式交付的 PPT。',
    keyFeatures: ['版式与视觉层级', '图表、配色和页面一致性'],
    advantages: ['让受众更快抓住结论和数据重点', '在不改变事实的情况下提升专业呈现质量'],
    limitations: ['依赖已确认的内容和品牌规范；不会替代事实核验或最终审稿。']
  },
  'spreadsheet-cleanup': {
    displayName: '試算表清理',
    whatItDoes: '檢查你選擇的試算表，提出可逆的格式、重複值與欄位標準化方案。',
    bestFor: 'Excel 整理、匯入前檢查、重複資料處理。',
    keyFeatures: ['資料品質盤點', '可逆的清理建議'],
    advantages: ['先讓資料可用，再做分析', '保留人工確認點，避免不可逆刪改'],
    limitations: ['預設只提出方案與檢查項；資料修改需你確認。']
  },
  'knowledge-base-organizer': {
    displayName: '知識庫整理',
    whatItDoes: '把你提供的筆記與文件整理成分類架構、標籤邏輯與維護計畫。',
    bestFor: 'Notion、Wiki、團隊知識整理、文件歸檔。',
    keyFeatures: ['可搜尋的分類法', '後續維護規則'],
    advantages: ['減少資料「放了但找不到」的情況', '讓日後新增內容可維持一致結構'],
    limitations: ['需要你確認團隊的分類語言與權限範圍。']
  },
  'translation-localization': {
    displayName: '翻譯與在地化',
    whatItDoes: '翻譯你提供的內容，盡量保留原意、術語與目標讀者的語氣。',
    bestFor: '產品文件、多語內容、面向不同市場的文案。',
    keyFeatures: ['術語一致性', '受眾與語氣調整'],
    advantages: ['不只逐字翻譯，也考慮讀者是否聽得懂', '輸出可延續使用的術語表'],
    limitations: ['法律、醫療與正式品牌術語仍應由專業人員覆核。']
  },
  'email-drafting': {
    displayName: '郵件草擬',
    whatItDoes: '根據你提供的事實、受眾與目的，起草清楚、有行動重點的郵件。',
    bestFor: '會後跟進、利害關係人溝通、回覆草稿。',
    keyFeatures: ['受眾導向語氣', '重點與行動請求'],
    advantages: ['減少從空白頁開始寫的時間', '讓收件者清楚知道背景與下一步'],
    limitations: ['預設只產生草稿，不會自動寄出。']
  },
  'structured-decision-scorecard': {
    displayName: '結構化決策評分表',
    whatItDoes: '為你提供的候選人、方案或選項建立可說明的評分標準與比較矩陣。',
    bestFor: '招聘初篩、供應商比較、方案評估。',
    keyFeatures: ['透明評分準則', '選項比較矩陣'],
    advantages: ['把隱性標準攤開討論', '讓決策依據更容易回顧與溝通'],
    limitations: ['高影響決策必須保留人工判斷，不能自動做最終錄用或資格決定。']
  },
  'project-planning': {
    displayName: '專案規劃',
    whatItDoes: '把一個目標拆成里程碑、相依關係、風險與檢視點。',
    bestFor: '新專案啟動、Roadmap、跨團隊協作安排。',
    keyFeatures: ['里程碑與相依關係', '風險與回顧節點'],
    advantages: ['把抽象目標變成可討論的工作路線', '及早暴露阻塞與資源需求'],
    limitations: ['計畫需要隨實際進度調整，不應被當成自動承諾。']
  },
  'workflow-automation-planner': {
    displayName: '工作流自動化規劃',
    whatItDoes: '設計可審核的自動化方案，列出資料流、授權與人工確認點。',
    bestFor: '重複行政工作、跨工具流程、Agent 協作設計。',
    keyFeatures: ['流程與資料流設計', '授權與例外處理清單'],
    advantages: ['先確認值不值得自動化，再連接帳號或執行動作', '讓風險與人工關卡可見'],
    limitations: ['不會靜默連接帳號、寫入外部系統或啟動自動化。']
  }
};

function card({ id, name, summary, tags, outputs, risk = {}, composition = {} }) {
  return {
    id,
    name,
    summary,
    taskTags: tags,
    inputs: ['user-selected files or task context'],
    outputs,
    platforms: universalPlatforms.map((name) => ({ name, availability: 'guide-only' })),
    source: {
      type: 'fixed-catalog',
      url: 'local://agentfit/fixed-catalog',
      licenseOrTerms: 'AgentFit fixture — review before replacing with a third-party Skill',
      lastReviewedAt: '2026-09-03'
    },
    requirements: {
      network: 'none',
      files: 'user-selected',
      account: 'none',
      setup: 'guided'
    },
    risk: {
      externalDataSharing: false,
      executesScripts: false,
      notes: [],
      ...risk
    },
    composition: {
      consumes: ['task brief'],
      produces: outputs,
      compatibilityEvidence: 'verified',
      ...composition
    },
    userGuide: USER_GUIDES[id] ?? {
      displayName: name,
      whatItDoes: summary,
      bestFor: '與目前任務相符的工作。',
      keyFeatures: [],
      advantages: [],
      limitations: []
    }
  };
}

export const CAPABILITY_CARDS = [
  card({
    id: 'public-data-analysis',
    name: 'Public data analysis',
    summary: 'Analyze a user-selected public CSV or spreadsheet and surface trends, anomalies, and checks.',
    tags: ['csv', 'spreadsheet', 'table', 'data', 'sales', 'trend', 'anomaly', '数据', '表格', '周报', '趋势', '异常', '销售'],
    outputs: ['analysis summary', 'trend table', 'anomaly list'],
    composition: { follows: [], produces: ['analysis summary', 'trend table', 'anomaly list'] }
  }),
  card({
    id: 'private-data-analysis',
    name: 'Private data analysis',
    summary: 'Analyze user-selected internal or restricted tabular data locally and surface trends, anomalies, and checks.',
    tags: ['csv', 'spreadsheet', 'table', 'data', 'sales', 'forecast', '数据', '表格', '预测', '销售', '内部'],
    outputs: ['analysis summary', 'trend table', 'anomaly list'],
    risk: { notes: ['不得把非公開輸入送到外部調研或第三方工具。'] },
    composition: { follows: [], produces: ['analysis summary', 'trend table', 'anomaly list'] }
  }),
  card({
    id: 'report-formatter',
    name: 'Report formatter',
    summary: 'Turn structured findings into a concise weekly report with an executive summary.',
    tags: ['report', 'weekly', 'summary', 'format', '周报', '报告', '摘要', '格式'],
    outputs: ['formatted report'],
    composition: { consumes: ['analysis summary', 'research notes'], follows: ['public-data-analysis', 'research-with-citations'] }
  }),
  card({
    id: 'research-with-citations',
    name: 'Research with citations',
    summary: 'Plan and synthesize public web research with source-level citations.',
    tags: ['research', 'latest', 'citation', 'source', 'market', '调研', '最新', '引用', '资料', '市场'],
    outputs: ['cited research brief'],
    risk: { externalDataSharing: true, notes: ['使用前必須取得明確的聯網授權。'] },
    composition: { produces: ['cited research brief', 'research notes'] }
  }),
  card({
    id: 'document-summarizer',
    name: 'Document summarizer',
    summary: 'Extract decisions, themes, and open questions from user-provided documents.',
    tags: ['document', 'pdf', 'meeting notes', 'summarize', '文档', '总结', '纪要', 'PDF'],
    outputs: ['structured summary', 'open questions']
  }),
  card({
    id: 'meeting-follow-up',
    name: 'Meeting follow-up',
    summary: 'Convert meeting notes into decisions, owners, and follow-up actions.',
    tags: ['meeting', 'action items', 'follow up', 'minutes', '会议', '待办', '行动项', '纪要'],
    outputs: ['decision log', 'action list']
  }),
  card({
    id: 'presentation-outline',
    name: 'Presentation outline',
    summary: 'Create a decision-oriented presentation outline from approved inputs.',
    tags: ['outline', 'storyline', 'storyboard', '大纲', '故事线', '逐页结构'],
    outputs: ['slide outline', 'speaker notes'],
    composition: { consumes: ['cited research brief', 'analysis summary'], follows: ['research-with-citations', 'public-data-analysis', 'private-data-analysis'] }
  }),
  card({
    id: 'presentation-production',
    name: 'Presentation production',
    summary: 'Create an editable PPTX presentation from approved structured content.',
    tags: ['pptx', 'powerpoint', 'presentation', 'slides', 'deck', 'ppt', '汇报', '演示', 'PPT', '幻灯片'],
    outputs: ['editable presentation', 'speaker notes', 'source appendix'],
    composition: { consumes: ['cited research brief', 'analysis summary', 'verified findings'], follows: ['research-with-citations', 'public-data-analysis', 'private-data-analysis'] }
  }),
  card({
    id: 'writing-polish',
    name: 'Writing polish',
    summary: 'Polish approved copy while preserving facts, meaning, and terminology.',
    tags: ['writing', 'editing', 'polish', 'copy', '文字', '润色', '编辑', '文案'],
    outputs: ['polished copy', 'edit notes'],
    composition: { consumes: ['slide outline', 'formatted report', 'research notes'], follows: ['presentation-outline', 'presentation-production', 'report-formatter', 'research-with-citations'] }
  }),
  card({
    id: 'presentation-design',
    name: 'Presentation design',
    summary: 'Turn an approved slide outline and copy into a consistent, editable presentation design.',
    tags: ['presentation', 'slides', 'ppt', 'design', 'layout', 'visual', 'PPT', '排版', '设计', '图表'],
    outputs: ['editable presentation', 'visual asset list'],
    composition: { consumes: ['slide outline', 'polished copy', 'editable presentation'], follows: ['presentation-outline', 'presentation-production', 'writing-polish'] }
  }),
  card({
    id: 'spreadsheet-cleanup',
    name: 'Spreadsheet cleanup',
    summary: 'Profile a user-selected spreadsheet and propose reversible normalization steps.',
    tags: ['clean', 'duplicate', 'normalize', 'excel', '清洗', '去重', '规范化', 'Excel'],
    outputs: ['cleanup plan', 'quality checks']
  }),
  card({
    id: 'knowledge-base-organizer',
    name: 'Knowledge-base organizer',
    summary: 'Organize supplied notes into a searchable taxonomy and maintenance plan.',
    tags: ['knowledge base', 'notion', 'wiki', 'taxonomy', '知识库', '知识分类', '知识整理'],
    outputs: ['taxonomy', 'maintenance plan']
  }),
  card({
    id: 'translation-localization',
    name: 'Translation and localization',
    summary: 'Translate user-provided content while preserving intent, terminology, and audience fit.',
    tags: ['translate', 'localize', 'bilingual', 'translation', '翻译', '本地化', '双语'],
    outputs: ['localized draft', 'term list']
  }),
  card({
    id: 'email-drafting',
    name: 'Email drafting',
    summary: 'Draft a clear, audience-aware email from user-provided facts and constraints.',
    tags: ['email', 'reply', 'stakeholder', '邮件', '回复', '沟通'],
    outputs: ['email draft'],
    composition: { consumes: ['decision log', 'action list'], follows: ['meeting-follow-up'] }
  }),
  card({
    id: 'structured-decision-scorecard',
    name: 'Structured decision scorecard',
    summary: 'Create an explainable scoring rubric for user-provided candidates, options, or hiring decisions.',
    tags: ['recruitment', 'candidate', 'scorecard', 'scoring', 'evaluation', '招聘', '候选人', '评分', '评估'],
    outputs: ['scoring rubric', 'decision matrix'],
    risk: { notes: ['高影響決策必須人工覆核；不得自動做出最終錄用或資格決定。'] }
  }),
  card({
    id: 'project-planning',
    name: 'Project planning',
    summary: 'Turn a goal into milestones, dependencies, risks, and review points.',
    tags: ['project', 'roadmap', 'milestone', 'plan', '项目', '路线图', '里程碑', '规划'],
    outputs: ['project plan', 'risk register']
  }),
  card({
    id: 'workflow-automation-planner',
    name: 'Workflow automation planner',
    summary: 'Design a reviewable automation proposal without silently connecting accounts or running actions.',
    tags: ['automation', 'workflow', 'integration', 'agent', '自动化', '工作流', '集成', '智能体'],
    outputs: ['automation proposal', 'approval checklist'],
    risk: { externalDataSharing: true, notes: ['連接帳號或執行動作前必須取得明確授權。'] }
  })
];

export function getCard(id) {
  return CAPABILITY_CARDS.find((entry) => entry.id === id) ?? null;
}
