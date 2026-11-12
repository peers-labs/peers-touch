/**
 * Deterministic seed data for the Agent Profile surface.
 *
 * Documents and capability bindings mirror what the Station profile transport
 * returns, but stay local: edits mutate prototype state only and never claim a
 * real save. Agents without an explicit record fall back to shared defaults.
 */
import type { CatalogEntry, ExtensionRecord, ProfileDocuments } from './types';

const DEFAULT_DOCUMENTS: ProfileDocuments = {
  soulMd: [
    '# SOUL.md',
    '',
    '## 角色定位',
    '你是 Peers-Touch 的本地执行 Agent，在用户显式授权的工作区内完成目标。',
    '',
    '## 行为边界',
    '- 未经授权不读取工作区之外的文件',
    '- shell 与写操作遵循逐次审批或 Full Access 授权',
    '- 输出必须可追溯，拒绝臆造观测结果',
  ].join('\n'),
  agentsMd: [
    '# AGENTS.md',
    '',
    '## 协作规则',
    '1. Proto-first：模型先落 proto，再生成调用代码',
    '2. 禁止 console.log / fmt.Println 等调试残留',
    '3. UI 文案统一走 i18n 键，禁止硬编码自然语言',
    '4. 长任务先给计划，再按批次交付与验收',
  ].join('\n'),
};

const DOGFOOD_DOCUMENTS: ProfileDocuments = {
  soulMd: [
    '# SOUL.md · workspace-runner',
    '',
    'Full Access 代码环境执行单元，绑定本机 worktree 与远端沙箱。',
    '',
    '## 职责',
    '- 在隔离沙箱中执行 shell、构建与迁移',
    '- 把工具调用终态（退出码/差异/终止原因）完整回传',
    '- 进程被停止后保留只读输出，不伪造成功回执',
  ].join('\n'),
  agentsMd: [
    '# AGENTS.md · workspace-runner',
    '',
    '## 工程约束',
    '- 变更前先跑 peer-only-gate 与 tsc，再跑 portal build',
    '- peers-ui 缺口在库内就地补齐，不引入外部组件库',
    '- 原型只承载确定性 seed，不接真实 Station/PTY',
  ].join('\n'),
};

const DOCUMENTS_BY_AGENT: Record<string, ProfileDocuments> = {
  'agent-dogfood': DOGFOOD_DOCUMENTS,
};

export function documentsForAgent(agentId: string): ProfileDocuments {
  return DOCUMENTS_BY_AGENT[agentId] ?? DEFAULT_DOCUMENTS;
}

/** Bound extensions per agent; Profile renders only these rows. */
const EXTENSIONS_BY_AGENT: Record<string, ExtensionRecord[]> = {
  'agent-dogfood': [
    {
      capabilityId: 'skill.workbench-probe',
      kind: 'skill',
      name: 'workbench-probe',
      description: '无头探针：门禁、tsc、构建与元素级截图回归',
      enabled: true,
    },
    {
      capabilityId: 'skill.semantic-merge',
      kind: 'skill',
      name: 'semantic-merge',
      description: '按语义冲突点合并远端分支并保留审计选择器',
      enabled: true,
    },
    {
      capabilityId: 'mcp.desktop-fs',
      kind: 'mcp',
      name: 'desktop-fs',
      description: '本机工作区文件树、差异与只读内容读取',
      enabled: true,
    },
    {
      capabilityId: 'mcp.terminal-holder',
      kind: 'mcp',
      name: 'terminal-holder',
      description: '设备持有 shell 会话的输出订阅与终止信号',
      enabled: false,
    },
  ],
  'agent-assistant': [
    {
      capabilityId: 'skill.research-writer',
      kind: 'skill',
      name: 'research-writer',
      description: '资料检索、结构化提纲与长文档写作',
      enabled: true,
    },
    {
      capabilityId: 'mcp.lark-bridge',
      kind: 'mcp',
      name: 'lark-bridge',
      description: 'Lark Bot 消息桥接字段映射与回执',
      enabled: true,
    },
  ],
};

export function extensionsForAgent(agentId: string): ExtensionRecord[] {
  return EXTENSIONS_BY_AGENT[agentId] ?? [];
}

/** The lazy catalog: capabilities available to bind but not yet bound. */
export const EXTENSION_CATALOG: readonly CatalogEntry[] = [
  { capabilityId: 'skill.coverage-audit', kind: 'skill', name: 'coverage-audit', description: '逐需求核对验收证据与覆盖缺口' },
  { capabilityId: 'skill.proto-review', kind: 'skill', name: 'proto-review', description: 'proto-first 变更审查与字段兼容性检查' },
  { capabilityId: 'skill.i18n-lint', kind: 'skill', name: 'i18n-lint', description: '硬编码文案与缺失 locale 键扫描' },
  { capabilityId: 'skill.release-notes', kind: 'skill', name: 'release-notes', description: '从提交历史生成变更日志草案' },
  { capabilityId: 'mcp.browser-cdp', kind: 'mcp', name: 'browser-cdp', description: '设备侧 CDP 浏览器会话与地址导航' },
  { capabilityId: 'mcp.station-console', kind: 'mcp', name: 'station-console', description: 'Station 控制台日志与部署回执订阅' },
  { capabilityId: 'mcp.secret-vault', kind: 'mcp', name: 'secret-vault', description: '授权密钥的最小权限读取与审计' },
  { capabilityId: 'mcp.memory-store', kind: 'mcp', name: 'memory-store', description: '候选记忆抽取、确认注入与失效处理' },
];
