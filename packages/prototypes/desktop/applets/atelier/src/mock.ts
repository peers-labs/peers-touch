/**
 * Atelier prototype — mock conversation data (SOLO-style).
 *
 * Tasks are grouped by project folder (like SOLO's "Your Task List").
 * One task's chat stream shows the full Atelier loop in conversation form:
 * user goal -> agent restated plan -> a folded multi-agent negotiation ->
 * an inline decision the user must make -> execution + diff + artifact,
 * each finished reply carrying a Completed marker + feedback bar.
 */
import type { AtelierState } from './types';

export const MOCK: AtelierState = {
  budgetSpent: 2.1,
  budgetCap: 5,
  model: 'openrouter-3o',

  tasks: [
    { id: 't-data', project: 'peers-touch', title: '接入行情 DataProvider', status: 'active', running: true, branch: 'feat/data-provider' },
    { id: 't-stock', project: 'peers-touch', title: '选股研究报告', status: 'active' },
    { id: 't-arch', project: 'peers-touch', title: '架构重构 PoC', status: 'archived', branch: 'poc/3-layer' },
    { id: 't-social', project: 'peers-social', title: '酷炫网络实体介绍动画', status: 'active' },
    { id: 't-feed', project: 'peers-social', title: '优化按钮和新帖子交互', status: 'active' },
    { id: 't-brief', project: 'peers-ai-agent', title: '每日简报（每天 8:00）', status: 'active' },
    { id: 't-old', project: 'peers-social', title: '旧版登录页改版（废弃）', status: 'deleted' },
  ],

  selectedTaskId: 't-data',

  stream: {
    't-data': [
      {
        kind: 'user',
        id: 'u1',
        text: '帮我给平台接入一个稳定的行情 DataProvider，统一到我们的 `Provider` 接口，别动上层业务。',
        at: '09:02',
      },
      {
        kind: 'agent',
        id: 'a1',
        text: '收到。我把目标复述如下，确认无误就开干：',
        bullets: [
          '对比 3 家 DataProvider，按延迟 / 限频 / 文档质量打分',
          '选定后写适配层，统一到现有 `Provider` 接口',
          '跑冒烟 + 接口契约测试，不改动上层业务逻辑',
        ],
        at: '09:02',
        done: true,
      },
      {
        kind: 'nego',
        id: 'n1',
        summary: '3 个 Agent 协商了选型，已收敛到 vendor-A',
        agentCount: 3,
        converged: true,
        voices: [
          { role: 'Planner', stance: 'proposal', text: '建议 vendor-A：延迟最低、文档完整、改造成本小。', evidenceRef: 'bench/latency.csv' },
          { role: 'Risk', stance: 'objection', text: '反对裸接 vendor-A：限频 50 req/s 且无官方降级 SLA，高峰会被拖垮。', evidenceRef: 'vendor-A/ratelimit.md' },
          { role: 'Architect', stance: 'counter', text: '折中：选 vendor-A，但适配层加本地缓存 + 退避，规避限频。', evidenceRef: 'rfc/adapter-cache.md' },
        ],
        consensus: '共识：选 vendor-A + 适配层缓存退避。但「降级策略」涉及成本与可用性，超出 Agent 权限，升级给你拍板。',
      },
      {
        kind: 'decision',
        id: 'd1',
        question: 'vendor-A 限频 50 req/s 且无降级 SLA，降级策略怎么定？',
        spentSoFar: '$1.3 / 预算 $5',
        options: [
          { text: '缓存 + 指数退避（推荐，成本最低）', recommended: true },
          { text: '改选 vendor-B（贵但有 SLA）' },
          { text: '暂停，等商务谈下 SLA' },
        ],
        rollbackImpact: '适配层独立成分支，回退只丢弃 adapter 分支，不影响上层业务。',
      },
    ],

    't-stock': [
      {
        kind: 'user',
        id: 'su1',
        text: '出一份 A 股新能源板块的选股研究报告，要能复算。',
        at: '昨天',
      },
      {
        kind: 'agent',
        id: 'sa1',
        text: '已生成目标卡，验收口径如下（标注是否可自动判定）：',
        bullets: [
          '`result.json` 通过 schema 校验（自动）',
          '回测脚本在沙箱内一键复算（自动）',
          '报告结论与数据一致（需你签字）',
        ],
        at: '昨天',
        done: true,
      },
    ],

    't-social': [
      {
        kind: 'user',
        id: 'soc1',
        text: '首页加一个酷炫的网络实体介绍动画，参考下图风格。',
        at: '10:20',
        image: { name: 'ref-style.png', size: '576.5 KB' },
      },
      {
        kind: 'agent',
        id: 'soc2',
        text: '已实现 Canvas 粒子网络动画并接入首页 Hero 区，提交如下变更：',
        at: '10:41',
        done: true,
      },
      {
        kind: 'diff',
        id: 'soc-diff',
        files: 4,
        added: 346,
        removed: 44,
        paths: [
          'src/components/NetworkHero.tsx',
          'src/components/NetworkHero.css',
          'src/pages/Home.tsx',
          'src/assets/particles.ts',
        ],
      },
    ],

    't-feed': [
      {
        kind: 'user',
        id: 'f1',
        text: '帖子流的点赞按钮交互太生硬，优化一下手感。',
        at: '14:05',
      },
    ],

    't-brief': [
      {
        kind: 'agent',
        id: 'ba1',
        text: '每天 08:00 自动跑（复用框架定时能力）。今天已完成，产物如下：',
        at: '08:00',
        done: true,
      },
      {
        kind: 'artifact',
        id: 'bf1',
        name: 'daily-brief-0621.pdf',
        fileKind: 'pdf',
        producedBy: '排版并推送 · Executor',
      },
    ],

    't-arch': [
      {
        kind: 'user',
        id: 'ku1',
        text: '把核心模块重构成三层，做个 PoC。',
        at: '2 天前',
      },
      {
        kind: 'nego',
        id: 'kn1',
        summary: '2 个 Agent 复核了验收，已收敛',
        agentCount: 2,
        converged: true,
        voices: [
          { role: 'Verifier', stance: 'signoff', text: '基准回归通过，无退化（-0.3%）。', evidenceRef: 'bench #481' },
          { role: 'Risk', stance: 'objection', text: '担心新分层长期维护成本——但无量化证据，降级为疑虑。' },
        ],
        consensus: '共识：L0/L1 自动通过；「是否值得长期维护」是 L2 主观项，待你签字即收敛。',
      },
      {
        kind: 'agent',
        id: 'ka1',
        text: '编译通过、基准无退化。只剩一条 L2 主观项等你签字，签了就收尾。',
        at: '1 天前',
        done: true,
      },
      {
        kind: 'artifact',
        id: 'kf1',
        name: 'arch-3layer.rfc.md',
        fileKind: 'report',
        producedBy: '选型 · Architect',
      },
    ],
  },

  todos: {
    't-data': [
      { id: 'td1', text: '选型对比 3 家', status: 'done' },
      { id: 'td2', text: '定降级策略（等你拍板）', status: 'running' },
      { id: 'td3', text: '写适配层', status: 'todo' },
      { id: 'td4', text: '冒烟 + 契约测试', status: 'todo' },
    ],
  },

  context: {
    't-data': {
      usedPct: 45,
      files: [
        { name: 'src/providers/Provider.ts', group: 'files' },
        { name: 'src/providers/vendor-a.adapter.ts', group: 'files' },
        { name: 'bench/latency.csv', group: 'other' },
        { name: 'rfc/adapter-cache.md', group: 'other' },
      ],
    },
    't-social': {
      usedPct: 28,
      files: [
        { name: 'src/components/NetworkHero.tsx', group: 'files' },
        { name: 'ref-style.png', group: 'other' },
      ],
    },
  },

  artifacts: {
    't-data': [
      {
        id: 'art-rfc',
        name: 'adapter-cache.rfc.md',
        kind: 'markdown',
        meta: 'Markdown · 来自 Architect',
        markdown: [
          '# 适配层缓存退避 RFC',
          '',
          '## 背景',
          'vendor-A 限频 `50 req/s` 且无官方降级 SLA，高峰直连会被拖垮。',
          '',
          '## 方案',
          '- 适配层内置 **本地缓存**（TTL 可配），命中即不打外部。',
          '- 未命中走 **指数退避** 重试，封顶 3 次。',
          '- 统一暴露到现有 `Provider` 接口，上层业务零改动。',
          '',
          '## 验收口径',
          '1. `result.json` 通过 schema 校验（L0 自动）',
          '2. 契约测试全绿（L1 自动）',
          '3. 高峰压测不触发限频告警（需签字）',
        ].join('\n'),
      },
      {
        id: 'art-bench',
        name: 'latency.csv',
        kind: 'diff',
        meta: 'Data · 来自 Planner',
        paths: ['bench/latency.csv', 'bench/summary.md'],
      },
    ],
    't-social': [
      {
        // kind 'web' is shown as a real embedded browser (<iframe>) pointing
        // at the running URL, alongside the captured console logs.
        id: 'art-web',
        name: 'NetworkHero 预览',
        kind: 'web',
        meta: 'Web · 来自 Executor',
        url: 'http://localhost:3102/',
        logs: [
          { level: 'info', text: '[vite] connecting...' },
          { level: 'info', text: '[vite] connected.' },
          { level: 'log', text: 'NetworkHero: spawned 120 particles' },
          { level: 'log', text: 'NetworkHero: animation loop @60fps' },
          { level: 'warn', text: 'prefers-reduced-motion not handled yet' },
        ],
      },
      {
        id: 'art-img',
        name: 'image.png',
        kind: 'image',
        meta: 'PNG · 846.2 KB',
        src: 'https://copilot-cn.bytedance.net/api/ide/v1/text_to_image?prompt=abstract%20glowing%20particle%20network%20constellation%20on%20dark%20background%2C%20cyan%20and%20violet%20nodes%20connected%20by%20thin%20lines%2C%20hero%20banner%2C%20cinematic&image_size=landscape_16_9',
        size: '846.2 KB',
      },
    ],
    't-brief': [
      {
        id: 'art-pdf',
        name: 'daily-brief-0621.pdf',
        kind: 'markdown',
        meta: 'PDF · 来自 Executor',
        markdown: [
          '# 每日简报 · 06-21',
          '',
          '## 市场',
          '- A 股新能源板块小幅回暖（+1.2%）。',
          '',
          '## 项目',
          '- `t-data` 等你拍板降级策略。',
          '- `t-social` Hero 动画已提交，待预览验收。',
        ].join('\n'),
      },
    ],
    't-arch': [
      {
        id: 'art-arch',
        name: 'arch-3layer.rfc.md',
        kind: 'markdown',
        meta: 'Report · 来自 Architect',
        markdown: [
          '# 三层重构 PoC 报告',
          '',
          '编译通过、基准回归 **无退化（-0.3%）**。',
          '剩一条 L2 主观项「是否值得长期维护」待签字。',
        ].join('\n'),
      },
    ],
  },
};
