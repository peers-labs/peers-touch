import { useMemo } from 'react';
import { theme } from 'antd';
import { useTranslation } from 'react-i18next';

import { useChatStore, type ChatMessage, type Session } from '../../../../store/chat';
import { useWorkbenchTabsStore } from '../../../../store/workbenchTabs';

interface TaskSummaryProjection {
  title: string;
  agentName: string;
  model: string;
  turns: number;
  replies: number;
  toolCalls: number;
  toolErrors: number;
  pendingApprovals: number;
  queuedTurns: number;
  elapsedMs: number | null;
}

// Project the live conversation into a task overview. Every field comes from
// the chat store; there is no backend "task summary" capability, so no token
// or TODO metrics are invented here.
function projectTaskSummary(
  sessions: Session[],
  currentSessionKey: string,
  messages: readonly ChatMessage[],
): TaskSummaryProjection | null {
  if (messages.length === 0) return null;

  const session = sessions.find((item) => item.id === currentSessionKey);
  let toolCalls = 0;
  let toolErrors = 0;
  let pendingApprovals = 0;
  let queuedTurns = 0;
  let turns = 0;
  let replies = 0;
  const models = new Set<string>();
  let firstAt = 0;
  let lastAt = 0;

  for (const message of messages) {
    if (message.timestamp) {
      if (!firstAt || message.timestamp < firstAt) firstAt = message.timestamp;
      if (message.timestamp > lastAt) lastAt = message.timestamp;
    }
    if (message.role === 'user') turns += 1;
    if (message.role === 'assistant' && !message.loading) replies += 1;
    if (message.queued) queuedTurns += 1;
    if (message.model) models.add(message.model);
    for (const call of message.toolCalls ?? []) {
      toolCalls += 1;
      if (call.status === 'error' || call.status === 'expired') {
        toolErrors += 1;
      }
      if (call.status === 'approval_required' || call.pending === true) {
        pendingApprovals += 1;
      }
    }
  }

  return {
    title: session?.title?.trim() || '',
    agentName: session?.agent_name ?? '',
    model: session?.model_override?.trim() || (models.size === 1 ? [...models][0] : ''),
    turns,
    replies,
    toolCalls,
    toolErrors,
    pendingApprovals,
    queuedTurns,
    elapsedMs: firstAt && lastAt ? Math.max(0, lastAt - firstAt) : null,
  };
}

function formatElapsed(elapsedMs: number): string {
  const totalSeconds = Math.round(elapsedMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function TaskSummaryDock() {
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');
  const active = useWorkbenchTabsStore((s) => s.active === 'summary');
  const currentSessionKey = useChatStore((s) => s.currentSessionKey);
  const sessions = useChatStore((s) => s.sessions);
  const messages = useChatStore((s) => s.messages);

  const summary = useMemo(
    () => projectTaskSummary(sessions, currentSessionKey, messages),
    [sessions, currentSessionKey, messages],
  );

  if (!active) return null;

  if (!summary) {
    return (
      <div
        data-pt-workbench-summary-empty
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          fontSize: 12,
          color: token.colorTextTertiary,
          textAlign: 'center',
        }}
      >
        {t('chat.workbench.summary.empty')}
      </div>
    );
  }

  const facts: Array<[string, string]> = [
    [t('chat.workbench.summary.agent'), summary.agentName || '—'],
    [t('chat.workbench.summary.model'), summary.model || '—'],
    [t('chat.workbench.summary.elapsed'), summary.elapsedMs === null ? '—' : formatElapsed(summary.elapsedMs)],
  ];

  const metrics: Array<{ key: string; label: string; value: number; tone?: 'danger' | 'warn' }> = [
    { key: 'turns', label: t('chat.workbench.summary.turns'), value: summary.turns },
    { key: 'replies', label: t('chat.workbench.summary.replies'), value: summary.replies },
    { key: 'tools', label: t('chat.workbench.summary.toolCalls'), value: summary.toolCalls },
    { key: 'errors', label: t('chat.workbench.summary.toolErrors'), value: summary.toolErrors, tone: summary.toolErrors > 0 ? 'danger' : undefined },
    { key: 'pending', label: t('chat.workbench.summary.pending'), value: summary.pendingApprovals, tone: summary.pendingApprovals > 0 ? 'warn' : undefined },
    { key: 'queued', label: t('chat.workbench.summary.queued'), value: summary.queuedTurns },
  ];

  return (
    <div
      data-pt-workbench-summary
      data-pt-workbench-summary-turns={summary.turns}
      data-pt-workbench-summary-tools={summary.toolCalls}
      data-pt-workbench-summary-pending={summary.pendingApprovals}
      style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '16px 16px 24px' }}
    >
      {summary.title && (
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 14, lineHeight: 1.4 }}>
          {summary.title}
        </div>
      )}

      <div
        style={{
          borderRadius: 10,
          border: `1px solid ${token.colorBorderSecondary}`,
          overflow: 'hidden',
          marginBottom: 16,
        }}
      >
        {facts.map(([label, value], index) => (
          <div
            key={label}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              padding: '8px 12px',
              borderTop: index === 0 ? 'none' : `1px solid ${token.colorBorderSecondary}`,
              fontSize: 12,
            }}
          >
            <span style={{ color: token.colorTextTertiary }}>{label}</span>
            <span
              style={{
                color: token.colorText,
                fontWeight: 500,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {value}
            </span>
          </div>
        ))}
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 8,
        }}
      >
        {metrics.map((metric) => (
          <div
            key={metric.key}
            data-pt-workbench-summary-metric={metric.key}
            style={{
              borderRadius: 10,
              border: `1px solid ${token.colorBorderSecondary}`,
              padding: '10px 10px 8px',
              background: metric.tone === 'danger'
                ? token.colorErrorBg
                : metric.tone === 'warn'
                  ? token.colorWarningBg
                  : 'transparent',
            }}
          >
            <div
              style={{
                fontSize: 20,
                fontWeight: 600,
                lineHeight: 1.2,
                color: metric.tone === 'danger'
                  ? token.colorError
                  : metric.tone === 'warn'
                    ? token.colorWarning
                    : token.colorText,
              }}
            >
              {metric.value}
            </div>
            <div style={{ fontSize: 11, color: token.colorTextTertiary, marginTop: 2 }}>
              {metric.label}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
