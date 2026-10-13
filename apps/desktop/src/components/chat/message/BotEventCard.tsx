import { Flexbox } from 'react-layout-kit';
import { Button, theme, Typography } from 'antd';
import {
  Bot,
  CheckCircle2,
  Clock3,
  ExternalLink,
  Hourglass,
  XCircle,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { DesktopBotServiceEvent } from '../../../store/socialProjection';

const { Text } = Typography;

// Mirrors model/domain/chat/command.proto ServiceBotEventKind.
const KIND_COMPLETED = 1;
const KIND_WAITING_INPUT = 2;
const KIND_TASK_FAILED = 3;
const KIND_IDLE = 4;
// CUSTOM = 5 falls back to the neutral bot glyph.

// Mirrors ServiceBotEventSeverity; drives the accent color bar.
const SEVERITY_ATTENTION = 2;
const SEVERITY_ERROR = 3;

interface BotEventCardProps {
  event: DesktopBotServiceEvent;
  // Number of consecutive same-group bot events this card represents
  // (>1 only; supplied by the timeline's presentation-only fold).
  foldCount?: number;
}

export function BotEventCard({ event, foldCount = 1 }: BotEventCardProps) {
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');

  const failed = event.eventType === KIND_TASK_FAILED || event.eventSeverity === SEVERITY_ERROR;
  const waiting = event.eventType === KIND_WAITING_INPUT;
  const attention = event.eventSeverity === SEVERITY_ATTENTION;
  const completed = event.eventType === KIND_COMPLETED;

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
        : event.eventType === KIND_IDLE
          ? Clock3
          : Bot;

  const kindLabel = (() => {
    switch (event.eventType) {
      case KIND_COMPLETED:
        return t('chat.bot.eventKind.taskCompleted', { defaultValue: 'Task completed' });
      case KIND_WAITING_INPUT:
        return t('chat.bot.eventKind.waitingInput', { defaultValue: 'Waiting for input' });
      case KIND_TASK_FAILED:
        return t('chat.bot.eventKind.taskFailed', { defaultValue: 'Task failed' });
      case KIND_IDLE:
        return t('chat.bot.eventKind.idle', { defaultValue: 'Idle' });
      default:
        return t('chat.bot.eventKind.custom', { defaultValue: 'Bot update' });
    }
  })();

  const meta = [event.sourceAgent, event.sourceWorkspace, event.sourceSessionId].filter(Boolean);
  const safeActionUrl = /^https?:\/\//i.test(event.actionUrl) ? event.actionUrl : '';

  return (
    <div
      data-bot-event-card="true"
      data-bot-event-type={event.eventType}
      data-bot-event-fold-count={foldCount}
      data-bot-ptid={event.botPtid}
      style={{
        width: 280,
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
          <Text strong style={{ fontSize: 13, lineHeight: '20px' }}>
            {kindLabel}
          </Text>
          {foldCount > 1 && (
            <Text
              data-bot-event-fold-badge="true"
              strong
              style={{
                marginLeft: 'auto',
                flex: '0 0 auto',
                fontSize: 11,
                lineHeight: '18px',
                padding: '0 8px',
                borderRadius: 999,
                color: token.colorPrimary,
                border: `1px solid ${token.colorPrimaryBorder}`,
              }}
            >
              {t('chat.bot.foldedEvents', {
                count: foldCount,
                defaultValue: `×${foldCount} merged`,
              })}
            </Text>
          )}
        </Flexbox>
        {event.fallbackText && (
          <Text style={{ fontSize: 13, color: token.colorTextSecondary, whiteSpace: 'pre-wrap' }}>
            {event.fallbackText}
          </Text>
        )}
        {meta.length > 0 && (
          <Flexbox gap={2}>
            {meta.map((value) => (
              <Text
                key={value}
                type="secondary"
                ellipsis
                style={{ fontSize: 11, lineHeight: '16px' }}
              >
                {value}
              </Text>
            ))}
          </Flexbox>
        )}
        {safeActionUrl && (
          <Flexbox horizontal style={{ marginTop: 2 }}>
            <Button
              size="small"
              type="default"
              href={safeActionUrl}
              target="_blank"
              rel="noreferrer"
              icon={<ExternalLink size={13} />}
            >
              {t('chat.bot.openAction', { defaultValue: 'Open' })}
            </Button>
          </Flexbox>
        )}
      </Flexbox>
    </div>
  );
}
