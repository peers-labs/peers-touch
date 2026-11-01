import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Tooltip } from '@lobehub/ui';
import { theme, Typography } from 'antd';
import { RotateCcw } from 'lucide-react';

import {
  evaluateDeliveryVerdict,
  type DeliveryVerdict,
} from '../../../messaging/deliveryVerdict';
import type { ChatMessage } from './chatMessageModel';

const { Text } = Typography;

/**
 * Horizon judgments are time-derived from immutable facts, so rows need a
 * light re-render tick even when no store update arrives. A single shared
 * 30s interval drives every mounted verdict meta instead of one timer each.
 */
const TICK_INTERVAL_MS = 30_000;
let tickNowMs = Date.now();
let intervalId: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function ensureTicker() {
  if (intervalId !== null) return;
  intervalId = setInterval(() => {
    tickNowMs = Date.now();
    listeners.forEach(listener => listener());
  }, TICK_INTERVAL_MS);
}

function stopTickerWhenIdle() {
  if (listeners.size > 0 || intervalId === null) return;
  clearInterval(intervalId);
  intervalId = null;
}

function useHorizonTick(): number {
  const [nowMs, setNowMs] = useState(tickNowMs);
  useEffect(() => {
    const listener = () => setNowMs(tickNowMs);
    listeners.add(listener);
    ensureTicker();
    return () => {
      listeners.delete(listener);
      stopTickerWhenIdle();
    };
  }, []);
  return nowMs;
}

function describeReasonCode(
  t: (key: string, options?: Record<string, unknown>) => string,
  reasonCode?: string,
): string | null {
  if (!reasonCode) return null;
  if (reasonCode === 'http_429') {
    return t('chat.social.messageArea.stateReasonRateLimited');
  }
  if (
    reasonCode === 'station_unavailable'
    || reasonCode === 'session_revoked'
    || reasonCode === 'no_route'
    || reasonCode === 'stale_route'
    || reasonCode === 'cancelled'
    || reasonCode === 'overloaded'
  ) {
    return t('chat.social.messageArea.stateReasonStationUnavailable');
  }
  if (
    reasonCode === 'network'
    || reasonCode === 'http_408'
    || reasonCode === 'invalid_response'
    || reasonCode.startsWith('http_5')
  ) {
    return t('chat.social.messageArea.stateReasonNetwork');
  }
  if (reasonCode === 'prepare_failed') {
    return t('chat.social.messageArea.stateReasonPrepareFailed');
  }
  if (reasonCode.startsWith('stale_')) {
    return t('chat.social.messageArea.stateReasonStalePlan');
  }
  return t('chat.social.messageArea.stateReasonUnknown', { code: reasonCode });
}

function formatNextAttempt(unixMs: number): string {
  return new Date(unixMs).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

interface DeliveryVerdictMetaProps {
  message: ChatMessage;
  isGroup: boolean;
  compact: boolean;
  onRetryMessage: (message: ChatMessage) => void;
}

/**
 * MP-D34 sender verdict meta. Renders durable facts and horizon-derived local
 * judgments for the actor's own messages. Positive Direct facts stay with the
 * existing receipt ticks; group rows show the x/N text verdict. Retry always
 * reuses the existing message/command identity (never mints a new message).
 */
export function DeliveryVerdictMeta({
  message,
  isGroup,
  compact,
  onRetryMessage,
}: DeliveryVerdictMetaProps) {
  const { t } = useTranslation('chat');
  const { token } = theme.useToken();
  const nowMs = useHorizonTick();

  const verdict = useMemo<DeliveryVerdict | null>(
    () =>
      evaluateDeliveryVerdict(
        {
          state: message.deliveryState ?? '',
          timestampUnixMs: message.sentAtMs,
          attemptCount: message.attemptCount,
          nextAttemptAtUnixMs: message.nextAttemptAtUnixMs,
          lastErrorCode: message.lastErrorCode,
          requiredDeviceCount: message.requiredDeviceCount,
          deliveredDeviceCount: message.deliveredDeviceCount,
        },
        nowMs,
      ),
    [
      message.deliveryState,
      message.sentAtMs,
      message.attemptCount,
      message.nextAttemptAtUnixMs,
      message.lastErrorCode,
      message.requiredDeviceCount,
      message.deliveredDeviceCount,
      nowMs,
    ],
  );

  if (!verdict) return null;

  // Direct messages render positive facts through the existing
  // single/double receipt ticks, so the text meta covers convergence states,
  // failure and the unconfirmed judgment only. Group rows have no tick rail
  // and show the full fact progression as text.
  if (
    !isGroup
    && (
      verdict.kind === 'submitted'
      || verdict.kind === 'delivered'
      || verdict.kind === 'fully_delivered'
      || verdict.kind === 'read'
    )
  ) {
    return null;
  }
  if (isGroup && verdict.kind === 'read') {
    return null;
  }

  const reason = describeReasonCode(t, verdict.reasonCode);
  const nextAttempt = verdict.nextAttemptAtUnixMs
    ? t('chat.social.messageArea.stateRetryNext', {
      time: formatNextAttempt(verdict.nextAttemptAtUnixMs),
    })
    : null;

  const fontSize = compact ? 10 : 11;
  const baseStyle = { fontSize, lineHeight: 1.2 } as const;

  let label: string;
  let color = token.colorTextTertiary;
  switch (verdict.kind) {
    case 'queued':
      label = t('chat.social.messageArea.stateQueued');
      break;
    case 'retry_wait':
      label = t('chat.social.messageArea.stateRetrying');
      break;
    case 'submit_overdue':
      label = t('chat.social.messageArea.stateSubmitOverdue');
      color = token.colorWarning;
      break;
    case 'submitted':
      label = t('chat.social.messageArea.stateSubmitted');
      break;
    case 'delivered':
      label = verdict.requiredDeviceCount > 0
        ? t('chat.social.messageArea.stateDeliveredPartial', {
          delivered: verdict.deliveredDeviceCount,
          required: verdict.requiredDeviceCount,
        })
        : t('chat.social.messageArea.stateSubmitted');
      break;
    case 'fully_delivered':
      label = t('chat.social.messageArea.stateDeliveredAll');
      color = token.colorPrimary;
      break;
    case 'failed_terminal':
      label = t('chat.social.messageArea.stateFailed');
      color = token.colorError;
      break;
    case 'undeliverable_suspected':
      label = t('chat.social.messageArea.stateUndeliverable');
      color = token.colorWarning;
      break;
    default:
      return null;
  }

  const details = [reason, nextAttempt].filter(Boolean).join(' · ');
  const canRetry = verdict.kind === 'failed_terminal'
    || verdict.kind === 'undeliverable_suspected';

  return (
    <>
      <Tooltip title={details || label}>
        <Text
          data-message-delivery-state={verdict.kind}
          data-message-delivery-fact={message.deliveryState ?? ''}
          data-message-delivery-reason={verdict.reasonCode ?? ''}
          style={{ ...baseStyle, color }}
        >
          {label}
          {details ? ` · ${details}` : ''}
        </Text>
      </Tooltip>
      {canRetry && (
        <Button
          data-message-retry={message.ulid}
          aria-label={t('chat.message.action.retry')}
          type="text"
          size="small"
          icon={<RotateCcw size={12} />}
          onClick={() => onRetryMessage(message)}
          style={{ height: 24, paddingInline: 5 }}
        >
          {t('chat.message.action.retry')}
        </Button>
      )}
    </>
  );
}
