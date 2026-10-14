import { Button, theme, Typography } from 'antd';
import {
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  Clock3,
  ExternalLink,
  Hourglass,
  XCircle,
} from 'lucide-react';
import { Flexbox } from 'react-layout-kit';
import { useTranslation } from 'react-i18next';

import type { DesktopServiceMessage } from '../../../store/socialProjection';
import type { ServiceEventAggregation } from './serviceEventAggregation';

const { Text } = Typography;

const STATE_RUNNING = 2;
const STATE_WAITING_INPUT = 3;
const STATE_COMPLETED = 4;
const STATE_FAILED = 5;
const STATE_CANCELLED = 6;

interface ServiceMessageCardProps {
  service: DesktopServiceMessage;
  aggregation?: ServiceEventAggregation;
  onToggleAggregation?: (key: string) => void;
}

export function ServiceMessageCard({
  service,
  aggregation,
  onToggleAggregation,
}: ServiceMessageCardProps) {
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');
  const displayed = aggregation?.effective ?? service;
  const primary = displayed.content?.primary;
  const taskState = primary?.taskState?.state;
  const failed = taskState === STATE_FAILED;
  const waiting = taskState === STATE_WAITING_INPUT;
  const completed = taskState === STATE_COMPLETED;
  const cancelled = taskState === STATE_CANCELLED;
  const attention = primary?.severity === 2;
  const accent = failed
    ? token.colorError
    : waiting || attention
      ? token.colorWarning
      : completed
        ? token.colorSuccess
        : token.colorInfo;
  const Glyph = failed
    ? XCircle
    : waiting
      ? Hourglass
      : completed
        ? CheckCircle2
        : cancelled
          ? CircleAlert
          : taskState === STATE_RUNNING
            ? Clock3
            : Bot;
  const title = primary?.title || primary?.text || displayed.fallbackText;
  const body = primary?.body || (primary?.title ? displayed.fallbackText : '');
  const action = primary?.actions?.find(item => /^https?:\/\//i.test(item.url));
  const source = displayed.sourceContext;
  const meta = [source?.program, source?.workspace, source?.sessionId].filter(Boolean);

  return (
    <div
      data-service-message-card="true"
      data-service-event-type={primary?.eventType ?? ''}
      data-service-aggregation-count={aggregation?.knownCount ?? 1}
      data-service-aggregation-conflict={aggregation?.conflicting ? 'true' : 'false'}
      style={{
        width: 300,
        maxWidth: '100%',
        borderRadius: token.borderRadiusLG,
        border: `1px solid ${token.colorBorderSecondary}`,
        background: token.colorBgContainer,
        overflow: 'hidden',
      }}
    >
      <div style={{ height: 3, background: accent }} />
      <Flexbox gap={8} style={{ padding: 12 }}>
        <Flexbox horizontal align="center" gap={8}>
          <Glyph size={16} style={{ color: accent, flex: '0 0 auto' }} />
          <Text strong style={{ minWidth: 0, fontSize: 13, lineHeight: '20px' }} ellipsis>
            {title}
          </Text>
          {aggregation && (
            <Button
              aria-label={aggregation.expanded ? 'Collapse activity history' : 'Expand activity history'}
              icon={aggregation.expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              onClick={() => onToggleAggregation?.(aggregation.key)}
              size="small"
              type="text"
            >
              {t('chat.service.knownUpdates', {
                count: aggregation.knownCount,
                defaultValue: `${aggregation.knownCount} known`,
              })}
            </Button>
          )}
        </Flexbox>
        {body && (
          <Text style={{ fontSize: 13, color: token.colorTextSecondary, whiteSpace: 'pre-wrap' }}>
            {body}
          </Text>
        )}
        {aggregation?.conflicting && (
          <Text type="warning" style={{ fontSize: 11 }}>
            {t('chat.service.conflictingState', { defaultValue: 'Conflicting reports in known history' })}
          </Text>
        )}
        {aggregation?.knownHistoryOnly && (
          <Text type="secondary" style={{ fontSize: 11 }}>
            {t('chat.service.knownHistoryOnly', { defaultValue: 'Latest state from known history' })}
          </Text>
        )}
        {meta.length > 0 && (
          <Text type="secondary" ellipsis style={{ fontSize: 11 }}>
            {meta.join(' · ')}
          </Text>
        )}
        {action && (
          <Flexbox horizontal>
            <Button
              href={action.url}
              icon={<ExternalLink size={13} />}
              rel="noreferrer"
              size="small"
              target="_blank"
            >
              {action.label}
            </Button>
          </Flexbox>
        )}
      </Flexbox>
    </div>
  );
}
