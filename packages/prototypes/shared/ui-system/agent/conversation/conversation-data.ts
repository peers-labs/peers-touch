import type { ConversationMessage } from './types';

/**
 * Deterministic seed conversations, keyed by topic id. The flagship topic
 * exercises every production message/tool state in one scroll so the
 * peers-ui completeness claim is reviewable in a single surface.
 */

const FLAGSHIP: readonly ConversationMessage[] = [
  {
    id: 'm-user-1',
    turnId: 'turn-1',
    role: 'user',
    status: 'completed',
    timestamp: '09:41',
    content: '在 dogfood worktree 里跑一遍 shell 闭环，并把变更摘要写进任务结果。',
    attachments: [
      { id: 'att-1', name: 'acceptance-matrix.md', kind: 'file', sizeLabel: '8.2 KB' },
      { id: 'att-2', name: 'workspace-diagram.png', kind: 'image', sizeLabel: '146 KB' },
    ],
  },
  {
    id: 'm-assistant-1',
    turnId: 'turn-1',
    role: 'assistant',
    status: 'completed',
    timestamp: '09:42',
    model: 'Seed2.1-Pro',
    thinking: '先确认工作目录授权，再执行只读检查；写操作必须落在已授权 worktree 内，输出按退出码判定成败。',
    thinkingDone: true,
    attribution: [
      { id: 'at-1', kind: 'profile', label: 'workspace-runner · SOUL', state: 'included' },
      { id: 'at-2', kind: 'skill', label: 'shell-safety', state: 'included' },
      { id: 'at-3', kind: 'attachment', label: 'acceptance-matrix.md', state: 'included' },
      { id: 'at-4', kind: 'memory', label: 'worktree 授权边界', state: 'truncated' },
    ],
    tools: [
      {
        id: 'tool-shell-ok',
        kind: 'shell',
        title: 'local_shell_exec',
        status: 'completed',
        command: 'pnpm --filter @peers-touch/app-desktop exec vitest run src/store',
        cwd: '~/peers/agent-task-workbench-20261102',
        exitCode: 0,
        durationMs: 18420,
        lines: [
          { id: 'l1', stream: 'stdin', text: 'pnpm --filter @peers-touch/app-desktop exec vitest run src/store' },
          { id: 'l2', stream: 'stdout', text: 'RUN  v4.1.10' },
          { id: 'l3', stream: 'stdout', text: 'Test Files  248 passed | 1 skipped (249)' },
          { id: 'l4', stream: 'stdout', text: 'Tests  1869 passed | 1 skipped (1870)' },
        ],
      },
      {
        id: 'tool-file-write',
        kind: 'file-write',
        title: 'local_file_edit',
        status: 'completed',
        changeType: 'modified',
        path: 'packages/prototypes/shared/ui-system/agent/agent.css',
        beforeDigest: 'sha256:9f2c…44ea',
        afterDigest: 'sha256:1b7e…8c2f',
        diffBefore: '.pa-row { gap: 6px; padding: 4px; }',
        diffAfter: '.pa-row { gap: var(--pt-space-sm); padding: var(--pt-space-xs) var(--pt-space-sm); }',
      },
    ],
    content: '只读检查与一次样式令牌替换已完成：单测 1869 通过，文件改动保留前后 digest 与 unified diff，可在工作面文件工具中回读。',
    followUps: ['生成变更摘要', '打开 diff 视图'],
  },
  {
    id: 'm-user-2',
    turnId: 'turn-2',
    role: 'user',
    status: 'completed',
    timestamp: '09:58',
    content: '再验证失败路径，故意让 shell 返回非零退出。',
    amended: true,
  },
  {
    id: 'm-assistant-2',
    turnId: 'turn-2',
    role: 'assistant',
    status: 'completed',
    timestamp: '09:59',
    model: 'Seed2.1-Pro',
    tools: [
      {
        id: 'tool-shell-fail',
        kind: 'shell',
        title: 'local_shell_exec',
        status: 'failed',
        command: 'cargo check -p peers-touch-desktop --features e2e-testing',
        cwd: '~/peers/agent-task-workbench-20261102',
        exitCode: 101,
        durationMs: 6310,
        lines: [
          { id: 'l1', stream: 'stdin', text: 'cargo check -p peers-touch-desktop --features e2e-testing' },
          { id: 'l2', stream: 'stderr', text: 'error[E0308]: mismatched types: expected Tone, found string' },
          { id: 'l3', stream: 'stderr', text: 'error: aborting due to 1 previous error' },
        ],
        stderrTruncated: true,
      },
    ],
    typedError: {
      errorType: 'TOOL_EXECUTION_FAILED',
      text: '命令以退出码 101 结束，stderr 已截断保留首段诊断。',
      resolutionLabel: '重试检查',
    },
    content: '失败被如实投影为 danger 状态，没有伪装成成功；修复类型后可重新执行同一检查。',
  },
  {
    id: 'm-assistant-3',
    turnId: 'turn-3',
    role: 'assistant',
    status: 'completed',
    timestamp: '10:12',
    model: 'Seed2.1-Pro',
    tools: [
      {
        id: 'tool-clarify',
        kind: 'clarification',
        title: 'ask_clarifying_question',
        status: 'approval_required',
        clarification: {
          prompt: '删除归档话题前需要确认影响范围，请选择处理方式：',
          choices: ['仅删除当前 Agent 可见记录', '同步清除关联消息与附件', '先导出备份再删除'],
        },
      },
    ],
    content: '该操作需要你的显式决定，选项与自由输入都在卡片内完成。',
  },
  {
    id: 'm-user-3',
    turnId: 'turn-4',
    role: 'user',
    status: 'completed',
    timestamp: '10:15',
    content: '先导出备份再删除。',
  },
  {
    id: 'm-assistant-4',
    turnId: 'turn-4',
    role: 'assistant',
    status: 'completed',
    timestamp: '10:16',
    model: 'Seed2.1-Pro',
    tools: [
      {
        id: 'tool-clarify-done',
        kind: 'clarification',
        title: 'ask_clarifying_question',
        status: 'completed',
        clarification: {
          prompt: '删除归档话题前需要确认影响范围，请选择处理方式：',
          choices: ['仅删除当前 Agent 可见记录', '同步清除关联消息与附件', '先导出备份再删除'],
          answer: '先导出备份再删除',
        },
      },
      {
        id: 'tool-fetch',
        kind: 'web-fetch',
        title: 'web_fetch',
        status: 'completed',
        path: 'https://example.org/backup-policy',
      },
      {
        id: 'tool-todo',
        kind: 'todo',
        title: 'todo_write',
        status: 'completed',
        path: '导出 → 校验 → 删除（3/3 完成）',
      },
    ],
    attribution: [
      { id: 'at-5', kind: 'knowledge', label: '数据保留策略 v3', state: 'included' },
      { id: 'at-6', kind: 'tool', label: 'web_fetch', state: 'included' },
    ],
    content: '决定产生了终态卡片与执行回执，备份校验通过后才进入删除步骤。',
  },
  {
    id: 'm-assistant-cancel',
    turnId: 'turn-5',
    role: 'assistant',
    status: 'cancelled',
    timestamp: '10:31',
    model: 'Seed2.1-Pro',
    tools: [
      {
        id: 'tool-cancelled',
        kind: 'shell',
        title: 'local_shell_exec',
        status: 'cancelled',
        command: 'pnpm run long-migration',
        cwd: '~/peers/agent-task-workbench-20261102',
        lines: [
          { id: 'l1', stream: 'system', text: '用户停止了本次执行，进程已收到终止信号。' },
        ],
      },
    ],
    typedError: {
      errorType: 'LIFECYCLE_CANCELLED',
      text: '本轮已取消，部分输出保留为只读记录。',
      resolutionLabel: '重新开始',
    },
  },
  {
    id: 'm-user-queued',
    turnId: 'turn-6',
    role: 'user',
    status: 'queued',
    timestamp: '10:33',
    queuePosition: 2,
    content: '等前一轮结束后再整理本次验收清单。',
  },
];

const SHORT: readonly ConversationMessage[] = [
  {
    id: 'm-short-1',
    turnId: 'turn-s1',
    role: 'user',
    status: 'completed',
    timestamp: '昨天',
    content: '整理这个话题的结论。',
  },
  {
    id: 'm-short-2',
    turnId: 'turn-s1',
    role: 'assistant',
    status: 'completed',
    timestamp: '昨天',
    model: 'Seed2.1-Pro',
    content: '结论已按证据、决定、待办三段归档，可继续追问或要求导出。',
  },
];

export const SEED_CONVERSATIONS: Readonly<Record<string, readonly ConversationMessage[]>> = {
  default: FLAGSHIP,
  'topic-dogfood': FLAGSHIP,
};

export function seedForTopic(topicId: string): readonly ConversationMessage[] {
  return SEED_CONVERSATIONS[topicId] ?? SHORT;
}

export const SLASH_COMMANDS: readonly { id: string; label: string; hint: string }[] = [
  { id: 'slash-approve', label: '/approve', hint: '批准当前待处理请求' },
  { id: 'slash-memory', label: '/memory', hint: '引用已确认记忆' },
  { id: 'slash-skill', label: '/skill', hint: '选择本次启用的技能' },
  { id: 'slash-clear', label: '/clear', hint: '清空输入草稿' },
];

export const SAMPLE_ATTACHMENTS: readonly { name: string; kind: 'image' | 'file'; sizeLabel: string }[] = [
  { name: 'review-notes.md', kind: 'file', sizeLabel: '4.1 KB' },
  { name: 'terminal-capture.png', kind: 'image', sizeLabel: '88 KB' },
  { name: 'diff.patch', kind: 'file', sizeLabel: '12.6 KB' },
];
