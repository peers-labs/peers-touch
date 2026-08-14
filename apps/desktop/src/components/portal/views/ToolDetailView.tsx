import { Flexbox } from 'react-layout-kit';
import { theme, Typography, Tag } from 'antd';

import type { ToolCallInfo } from '../../../store/chat';

interface ToolDetailViewProps {
  toolCall: ToolCallInfo;
}

export function ToolDetailView({ toolCall }: ToolDetailViewProps) {
  const { token } = theme.useToken();

  const statusColor = {
    success: 'green',
    error: 'red',
    pending: 'blue',
    cancelled: 'default',
    queued: 'default',
    approved: 'green',
    denied: 'red',
    approval_required: 'orange',
  } as const;

  return (
    <Flexbox gap={16}>
      <Flexbox horizontal align="center" gap={8}>
        <Typography.Text strong style={{ fontSize: 15 }}>
          {toolCall.name}
        </Typography.Text>
        {toolCall.status && (
          <Tag color={statusColor[toolCall.status] || 'default'}>
            {toolCall.status}
          </Tag>
        )}
      </Flexbox>

      {toolCall.serverName && (
        <Section label="Server" content={toolCall.serverName} token={token} />
      )}

      {toolCall.args && (
        <Section label="Arguments" content={toolCall.args} token={token} mono />
      )}

      {toolCall.result && (
        <Section label="Result" content={toolCall.result} token={token} mono />
      )}

      {toolCall.approvalActor && (
        <Flexbox gap={4}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Approved by
          </Typography.Text>
          <Typography.Text style={{ fontSize: 13 }}>
            {toolCall.approvalActor}
            {toolCall.approvedAt && ` · ${toolCall.approvedAt}`}
          </Typography.Text>
        </Flexbox>
      )}

      {toolCall.progress && (
        <Section label="Progress" content={toolCall.progress} token={token} />
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
