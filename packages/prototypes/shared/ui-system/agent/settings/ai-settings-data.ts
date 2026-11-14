/**
 * Deterministic seed data for the eight AI-settings sections.
 *
 * Values mirror the production provider/capability/STT/cron catalogs at the
 * shape level; reachability and install transitions are local state, never
 * claimed as real backend results.
 */
import type { IconId } from '@peers-touch/ui-assets';
import type { StringKey } from '../../prefs';
import type {
  CatalogPackage, CronJobRecord, McpServerRecord, ProviderRecord,
  SkillRecord, AiSectionId,
} from './types';

export const AI_SECTIONS: ReadonlyArray<{ id: AiSectionId; iconId: IconId; labelKey: StringKey; descKey: StringKey }> = [
  { id: 'providers', iconId: 'server', labelKey: 'agent.ai.section.providers', descKey: 'agent.ai.section.providers.desc' },
  { id: 'models', iconId: 'brain', labelKey: 'agent.ai.section.models', descKey: 'agent.ai.section.models.desc' },
  { id: 'discover', iconId: 'search', labelKey: 'agent.ai.section.discover', descKey: 'agent.ai.section.discover.desc' },
  { id: 'memory', iconId: 'hard-drive', labelKey: 'agent.ai.section.memory', descKey: 'agent.ai.section.memory.desc' },
  { id: 'skills', iconId: 'scroll-text', labelKey: 'agent.ai.section.skills', descKey: 'agent.ai.section.skills.desc' },
  { id: 'mcp', iconId: 'plug', labelKey: 'agent.ai.section.mcp', descKey: 'agent.ai.section.mcp.desc' },
  { id: 'voice', iconId: 'mic', labelKey: 'agent.ai.section.voice', descKey: 'agent.ai.section.voice.desc' },
  { id: 'cron', iconId: 'clock', labelKey: 'agent.ai.section.cron', descKey: 'agent.ai.section.cron.desc' },
];

export const SEED_PROVIDERS: readonly ProviderRecord[] = [
  {
    id: 'openai', name: 'OpenAI-compatible', kind: 'direct', enabled: true,
    apiKey: 'sk-proj-xxxxxxxxxxxxxxxx', baseUrl: 'https://api.openai.com/v1',
    models: [
      { id: 'seed-pro', name: 'Seed2.1-Pro', kind: 'chat', enabled: true },
      { id: 'text-embedding-3', name: 'text-embedding-3', kind: 'embedding', enabled: true },
      { id: 'dall-e-4', name: 'dall-e-4', kind: 'image', enabled: false },
    ],
  },
  {
    id: 'anthropic', name: 'Anthropic', kind: 'direct', enabled: false,
    apiKey: 'sk-ant-xxxxxxxxxxxxxxxx', baseUrl: 'https://api.anthropic.com',
    models: [{ id: 'claude-sonnet-4', name: 'claude-sonnet-4', kind: 'chat', enabled: true }],
  },
  {
    id: 'ollama', name: 'Ollama (local)', kind: 'direct', enabled: false,
    apiKey: '', baseUrl: 'http://127.0.0.1:11434',
    models: [
      { id: 'deepseek-v3', name: 'deepseek-v3', kind: 'chat', enabled: false },
      { id: 'nomic-embed', name: 'nomic-embed-text', kind: 'embedding', enabled: true },
    ],
  },
  {
    id: 'codex-cli', name: 'Codex CLI', kind: 'cli', enabled: false,
    apiKey: '', baseUrl: 'codex --json exec',
    models: [{ id: 'default', name: 'default', kind: 'chat', enabled: true }],
  },
];

export const SEED_CATALOG: readonly CatalogPackage[] = [
  { id: 'pkg-research-partner', name: 'Research Partner', publisher: 'Peers', type: 'Agent', installed: false },
  { id: 'pkg-source-reader', name: 'Source Reader', publisher: 'Peers', type: 'Skill', installed: true },
  { id: 'pkg-browser-tools', name: 'Browser Tools', publisher: 'Peers', type: 'MCP', installed: false },
  { id: 'pkg-coverage-audit', name: 'Coverage Audit', publisher: 'Peers', type: 'Skill', installed: false },
];

export const SEED_SKILLS: readonly SkillRecord[] = [
  { id: 'sk-meeting-digest', name: '会议纪要', desc: '自动生成会议纪要与行动项', source: 'peers', scan: 'passed', enabled: true, installed: true },
  { id: 'sk-commit-helper', name: '提交助手', desc: '生成规范提交信息', source: 'peers', scan: 'warning', enabled: true, installed: true },
  { id: 'sk-builtin-search', name: '内置检索', desc: '工作区语义检索', source: 'builtin', scan: 'passed', enabled: true, installed: true },
  { id: 'sk-code-reviewer', name: 'Code Reviewer', desc: '差异审查与风险提示', source: 'peers', scan: 'passed', enabled: false, installed: false },
];

export const SEED_MCP: readonly McpServerRecord[] = [
  {
    id: 'mcp-fs', name: 'filesystem', transport: 'stdio',
    endpoint: 'npx -y @modelcontextprotocol/server-filesystem /docs',
    enabled: true, toolCount: 6, reachable: 'ok',
    tools: ['read', 'write', 'list', 'move', 'search', 'delete'],
  },
  {
    id: 'mcp-browser', name: 'integrated_browser', transport: 'http',
    endpoint: 'http://127.0.0.1:9222/mcp',
    enabled: true, toolCount: 3, reachable: 'ok',
    tools: ['navigate', 'click', 'snapshot'],
  },
  {
    id: 'mcp-github', name: 'github', transport: 'sse',
    endpoint: 'https://mcp.example.com/github/sse',
    enabled: false, toolCount: 0, reachable: 'idle', tools: [],
  },
];

const DAY = 86_400_000;
const isoAt = (offsetHours: number): string => new Date(Date.now() + offsetHours * 3_600_000).toISOString();
const isoAgo = (offsetHours: number): string => new Date(Date.now() - offsetHours * 3_600_000).toISOString();

export const SEED_CRON_JOBS: readonly CronJobRecord[] = [
  {
    id: 'cron-daily-digest',
    name: '每日架构摘要',
    description: '每天汇总工作区变更与验收状态',
    enabled: true,
    scheduleKind: 'cron',
    cronExpr: '0 9 * * *',
    intervalSec: 0,
    timezone: 'Asia/Shanghai',
    prompt: '汇总昨日工作区变更、工具调用与未关闭验收项，输出日报。',
    nextRunAt: isoAt(18),
    lastRunAt: isoAgo(6),
    lastStatus: 'ok',
    lastError: '',
    consecErrors: 0,
  },
  {
    id: 'cron-hourly-health',
    name: '沙箱健康巡检',
    description: '每小时探测沙箱与 provisioner 鉴权',
    enabled: true,
    scheduleKind: 'interval',
    cronExpr: '',
    intervalSec: 3600,
    timezone: 'Asia/Shanghai',
    prompt: '检查沙箱网络连通性与租约有效期，异常时上报。',
    nextRunAt: isoAt(2),
    lastRunAt: isoAgo(1),
    lastStatus: 'error',
    lastError: 'provisioner 返回 401，租约已过期',
    consecErrors: 2,
  },
  {
    id: 'cron-once-cleanup',
    name: '一次性记忆清理',
    description: '下周一对失效候选记忆做归档',
    enabled: false,
    scheduleKind: 'once',
    cronExpr: '',
    intervalSec: 0,
    timezone: 'Asia/Shanghai',
    prompt: '清理超过 30 天未命中的候选记忆并保留审计记录。',
    nextRunAt: new Date(Date.now() + DAY).toISOString(),
    lastRunAt: null,
    lastStatus: 'never',
    lastError: '',
    consecErrors: 0,
  },
];
