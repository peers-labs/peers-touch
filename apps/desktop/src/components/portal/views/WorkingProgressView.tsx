import { useMemo } from 'react';
import { Flexbox } from 'react-layout-kit';
import { Empty } from '@lobehub/ui';
import { Tag, Typography, theme } from 'antd';
import { Loader2, CheckCircle2, XCircle, Clock } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useChatStore, type ChatOperation } from '../../../store/chat';
import type { OperationStatus } from '../../../store/streaming/types';

function statusIcon(status: OperationStatus) {
  switch (status) {
    case 'running':
    case 'waiting_for_approval':
      return Loader2;
    case 'completed':
      return CheckCircle2;
    case 'failed':
      return XCircle;
    case 'cancelled':
      return Clock;
    default:
      return Clock;
  }
}

function statusColor(status: OperationStatus, token: Record<string, string>): string {
  switch (status) {
    case 'running':
    case 'waiting_for_approval':
      return token.colorPrimary;
    case 'completed':
      return token.colorSuccess;
    case 'failed':
      return token.colorError;
    case 'cancelled':
      return token.colorTextTertiary;
    default:
      return token.colorTextSecondary;
  }
}

function statusLabel(status: OperationStatus, t: (key: string) => string): string {
  switch (status) {
    case 'running':
    case 'waiting_for_approval':
      return t('agent.working.operationRunning');
    case 'completed':
      return t('agent.working.operationComplete');
    case 'failed':
      return t('agent.working.operationFailed');
    case 'cancelled':
      return t('agent.working.operationCancelled');
    default:
      return status;
  }
}

function formatDuration(startedAt: number, endedAt?: number): string {
  const end = endedAt || Date.now();
  const durationMs = end - startedAt;
  if (durationMs < 1000) return `${durationMs}ms`;
  if (durationMs < 60_000) return `${(durationMs / 1000).toFixed(1)}s`;
  return `${Math.floor(durationMs / 60_000)}m ${Math.floor((durationMs % 60_000) / 1000)}s`;
}

export function WorkingProgressView() {
  const { t } = useTranslation('agent');
  const { token } = theme.useToken();
  const operations = useChatStore((s) => s.operations);

  const sortedOperations = useMemo<ChatOperation[]>(() => {
    return Object.values(operations).sort((a, b) => b.startedAt - a.startedAt);
  }, [operations]);

  if (sortedOperations.length === 0) {
    return (
      <Flexbox align="center" justify="center" style={{ height: '100%', padding: 32 }}>
        <Empty description={t('agent.working.noOperations')} />
      </Flexbox>
    );
  }

  return (
    <Flexbox gap={8}>
      {sortedOperations.map((op) => {
        const IconComponent = statusIcon(op.status);
        const color = statusColor(op.status, token as unknown as Record<string, string>);

        return (
          <Flexbox
            key={op.id}
            gap={6}
            style={{
              padding: '10px 12px',
              borderRadius: token.borderRadius,
              background: token.colorBgElevated,
            }}
          >
            <Flexbox horizontal align="center" gap={8}>
              <IconComponent
                size={16}
                color={color}
                className={op.status === 'running' ? 'spin-animation' : undefined}
              />
              <Typography.Text style={{ fontSize: 13, fontWeight: 500, flex: 1 }}>
                {op.type}
              </Typography.Text>
              <Tag
                color={op.status === 'running' ? 'processing' : op.status === 'completed' ? 'success' : op.status === 'failed' ? 'error' : 'default'}
                style={{ fontSize: 11, margin: 0 }}
              >
                {statusLabel(op.status, t)}
              </Tag>
            </Flexbox>
            <Flexbox horizontal align="center" gap={12}>
              <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                {formatDuration(op.startedAt, op.endedAt)}
              </Typography.Text>
              {op.error && (
                <Typography.Text type="danger" ellipsis style={{ fontSize: 11, flex: 1 }}>
                  {op.error.message}
                </Typography.Text>
              )}
            </Flexbox>
          </Flexbox>
        );
      })}
    </Flexbox>
  );
}
