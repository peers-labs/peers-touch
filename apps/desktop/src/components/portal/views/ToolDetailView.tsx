import { useSyncExternalStore } from 'react';
import { Flexbox } from 'react-layout-kit';
import { theme, Typography, Tag } from 'antd';
import { useTranslation } from 'react-i18next';

import {
  resolveToolCallProjection,
  toolRuntime,
} from '../../../runtimes/toolRuntime';
import type { ToolCallInfo } from '../../../store/chat';

interface ToolDetailViewProps {
  toolCall: ToolCallInfo;
}

export function ToolDetailView({ toolCall }: ToolDetailViewProps) {
  const { token } = theme.useToken();
  const { t } = useTranslation(['chat', 'agent']);
  const projection = useSyncExternalStore(
    toolRuntime.subscribe,
    () => toolRuntime.getProjection(toolCall.id),
    () => undefined,
  );
  const projected = resolveToolCallProjection(toolCall, projection);
  const error = projected.error?.startsWith('agent.')
    ? t(projected.error, { ns: 'agent' })
    : projected.error;

  const statusColor = {
    success: 'green',
    error: 'red',
    pending: 'blue',
    cancelled: 'default',
    queued: 'default',
    approved: 'green',
    denied: 'red',
    approval_required: 'orange',
    expired: 'orange',
    unknown_side_effect: 'orange',
  } as const;

  return (
    <Flexbox gap={16}>
      <Flexbox horizontal align="center" gap={8}>
        <Typography.Text strong style={{ fontSize: 15 }}>
          {projected.name}
        </Typography.Text>
        {projected.status && (
          <Tag color={statusColor[projected.status] || 'default'}>
            {t(`chat.message.toolCall.status.${projected.status}`)}
          </Tag>
        )}
      </Flexbox>

      {projected.serverName && (
        <Section
          label={t('chat.message.toolCall.server')}
          content={projected.serverName}
          token={token}
        />
      )}

      {projected.args && (
        <Section
          label={t('chat.message.toolCall.arguments')}
          content={projected.args}
          token={token}
          mono
        />
      )}

      {projected.result && (
        <Section
          label={t('chat.message.toolCall.result')}
          content={projected.result}
          token={token}
          mono
        />
      )}

      {error && (
        <Section
          label={t('chat.message.diagnostics.error')}
          content={error}
          token={token}
        />
      )}

      {projected.approvalActor && (
        <Flexbox gap={4}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t('chat.message.toolCall.approval')}
          </Typography.Text>
          <Typography.Text style={{ fontSize: 13 }}>
            {projected.status === 'denied'
              ? t('chat.message.toolCall.deniedBy', {
                  actor: projected.approvalActor,
                })
              : t('chat.message.toolCall.approvedBy', {
                  actor: projected.approvalActor,
                })}
            {projected.approvedAt && ` · ${projected.approvedAt}`}
          </Typography.Text>
        </Flexbox>
      )}

      {projected.progress && (
        <Section
          label={t('chat.message.toolCall.progress')}
          content={projected.progress}
          token={token}
        />
      )}
    </Flexbox>
  );
}

function Section({ label, content, token, mono }: {
  label: string;
  content: string;
  token: ReturnType<typeof theme.useToken>['token'];
  mono?: boolean;
}) {
  return (
    <Flexbox gap={4}>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {label}
      </Typography.Text>
      <pre
        style={{
          margin: 0,
          padding: 10,
          borderRadius: token.borderRadius,
          background: token.colorFillQuaternary,
          fontSize: 12,
          lineHeight: 1.5,
          fontFamily: mono ? 'var(--font-mono, monospace)' : 'inherit',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          maxHeight: 300,
          overflow: 'auto',
        }}
      >
        {content}
      </pre>
    </Flexbox>
  );
}
