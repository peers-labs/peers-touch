import type { AgentRecord, TopicRecord } from './types';

/**
 * Seed catalog for the Agent prototype. Deterministic local data — no
 * backend, no network. Later batches extend these records with messages,
 * tool calls, files, terminals and memory candidates.
 */

const DAY = 86_400_000;
const at = (offsetDays: number, hour = 9): string => {
  const date = new Date();
  date.setDate(date.getDate() - offsetDays);
  date.setHours(hour, 12, 0, 0);
  return date.toISOString();
};

export const SEED_AGENTS: readonly AgentRecord[] = [
  {
    id: 'agent-assistant',
    name: 'assistant',
    description: '通用研究与写作执行单元，复用已确认的记忆与技能。',
    avatarMode: 'initial',
    avatarValue: 'A',
    status: 'active',
    defaultModel: 'Seed2.1-Pro',
    topicCount: 100,
    pinned: true,
    systemOwned: true,
  },
  {
    id: 'agent-dogfood',
    name: 'workspace-runner',
    description: 'Full Access 代码环境执行单元，绑定本机 worktree 与沙箱。',
    avatarMode: 'emoji',
    avatarValue: '🛠️',
    status: 'active',
    defaultModel: 'Seed2.1-Pro',
    topicCount: 24,
    pinned: true,
  },
  {
    id: 'agent-archivist',
    name: 'archivist',
    description: '资料整理与长文档版本管理，只在授权目录内读写。',
    avatarMode: 'initial',
    avatarValue: 'R',
    status: 'disabled',
    defaultModel: 'Seed2.1-Lite',
    topicCount: 7,
  },
  {
    id: 'agent-reviewer',
    name: 'review-bot',
    description: '合并请求审查与回归清单核对，输出可追溯检查结论。',
    avatarMode: 'initial',
    avatarValue: 'V',
    status: 'active',
    defaultModel: 'Seed2.1-Pro',
    topicCount: 12,
  },
];

export const SEED_TOPICS: readonly TopicRecord[] = [
  // workspace-runner — today / yesterday / this week / older bands
  {
    id: 'topic-dogfood',
    agentId: 'agent-dogfood',
    title: 'dogfood real worktree',
    pinned: true,
    updatedAt: at(0, 10),
    messageCount: 38,
    draft: '',
  },
  {
    id: 'topic-shell-s3',
    agentId: 'agent-dogfood',
    title: 'TW shell S3 闭环验证',
    updatedAt: at(0, 8),
    messageCount: 12,
    draft: '',
  },
  {
    id: 'topic-sandbox-net',
    agentId: 'agent-dogfood',
    title: '沙箱隔离网络与 provisioner 鉴权',
    updatedAt: at(1, 16),
    messageCount: 9,
    draft: '',
  },
  {
    id: 'topic-proto-merge',
    agentId: 'agent-dogfood',
    title: 'PR #182 北极星合并冲突处理',
    updatedAt: at(3, 14),
    messageCount: 21,
    draft: '',
  },
  {
    id: 'topic-cargo-cache',
    agentId: 'agent-dogfood',
    title: 'cargo 构建缓存与 digest 固定',
    updatedAt: at(12, 11),
    messageCount: 6,
    draft: '',
  },
  // assistant
  {
    id: 'topic-browser-o12',
    agentId: 'agent-assistant',
    title: 'O12 browser held 租约接管',
    pinned: true,
    updatedAt: at(0, 9),
    messageCount: 21,
    draft: '继续整理接管后的账号隔离证据',
  },
  {
    id: 'topic-writing',
    agentId: 'agent-assistant',
    title: '架构周报草稿',
    updatedAt: at(2, 15),
    messageCount: 5,
    draft: '',
  },
  {
    id: 'topic-memory-cleanup',
    agentId: 'agent-assistant',
    title: '记忆候选复核与失效处理',
    updatedAt: at(6, 10),
    messageCount: 14,
    draft: '',
  },
  {
    id: 'topic-lark-bridge',
    agentId: 'agent-assistant',
    title: 'Lark Bot 消息桥接字段映射',
    updatedAt: at(20, 17),
    messageCount: 8,
    draft: '',
  },
  // archivist (disabled agent — history stays readable)
  {
    id: 'topic-archive-q3',
    agentId: 'agent-archivist',
    title: 'Q3 调研资料归档',
    updatedAt: at(15, 13),
    messageCount: 17,
    draft: '',
  },
  // reviewer
  {
    id: 'topic-review-checklist',
    agentId: 'agent-reviewer',
    title: '回归清单与 e2e 门对齐',
    updatedAt: at(1, 11),
    messageCount: 11,
    draft: '',
  },
];
