import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconButton, Tooltip } from '@peers-touch/ui';
import { Check, CheckCheck } from 'lucide-react';
import { MessageStatus } from '../../../gen/proto/domain/chat/chat_pb';

import {
  evaluateDeliveryVerdict,
  type DeliveryVerdict,
} from '../../../messaging/deliveryVerdict';
import type { ChatMessage } from './chatMessageModel';

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
  onRetryMessage: (message: ChatMessage) => Promise<void>;
}

/** Receipt and recovery are mutually exclusive projections of one verdict. */
function DirectReceipt({ status }: { status: MessageStatus }) {
  const receipt = status === MessageStatus.READ ? 'read'
    : status === MessageStatus.DELIVERED ? 'delivered'
      : status === MessageStatus.SENT ? 'sent' : null;
  if (!receipt) return null;
  return (
    <span className={`sc-msg-status is-${receipt}`} data-message-receipt={receipt}>
      {receipt === 'sent' ? <Check size={11} /> : <CheckCheck size={11} />}
    </span>
  );
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
  const nowMs = useHorizonTick();
  const [retryExecution, setRetryExecution] = useState<'idle' | 'pending' | 'succeeded' | 'failed'>('idle');
  const retryAttempt = useRef({ generation: 0, pending: false });

  useEffect(() => () => {
    retryAttempt.current.generation += 1;
    retryAttempt.current.pending = false;
  }, [message.ulid]);

  useEffect(() => {
    if (retryExecution !== 'succeeded') return;
    const timer = window.setTimeout(() => setRetryExecution('idle'), 2500);
    return () => window.clearTimeout(timer);
  }, [retryExecution]);

  const retry = async () => {
    if (retryAttempt.current.pending) return;
    retryAttempt.current.pending = true;
    const generation = ++retryAttempt.current.generation;
    setRetryExecution('pending');
    try {
      await onRetryMessage(message);
      if (generation === retryAttempt.current.generation) setRetryExecution('succeeded');
    } catch {
      // The command owner reports the error. This control projects the same
      // outcome without replacing the message's durable delivery fact.
      if (generation === retryAttempt.current.generation) setRetryExecution('failed');
    } finally {
      if (generation === retryAttempt.current.generation) retryAttempt.current.pending = false;
    }
  };

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

  if (!verdict) return isGroup ? null : <DirectReceipt status={message.status as MessageStatus} />;

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
    return <DirectReceipt status={message.status as MessageStatus} />;
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

  let label: string;
  switch (verdict.kind) {
    case 'queued':
      label = t('chat.social.messageArea.stateQueued');
      break;
    case 'retry_wait':
      label = t('chat.social.messageArea.stateRetrying');
      break;
    case 'submit_overdue':
      label = t('chat.social.messageArea.stateSubmitOverdue');
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
      break;
    case 'failed_terminal':
      label = t('chat.social.messageArea.stateFailed');
      break;
    case 'undeliverable_suspected':
      label = t('chat.social.messageArea.stateUndeliverable');
      break;
    default:
      return null;
  }

  const details = [reason, nextAttempt].filter(Boolean).join(' · ');
  const canRetry = verdict.kind === 'failed_terminal'
    || verdict.kind === 'undeliverable_suspected';
  const retryLabel = t('chat.message.action.retry');
  const retryActionLabel = retryExecution === 'pending'
    ? t('chat.social.messageArea.stateRetrying')
    : retryExecution === 'succeeded'
      ? t('chat.social.messageArea.retryRequested')
      : retryExecution === 'failed'
        ? t('chat.social.messageArea.retryFailed')
        : retryLabel;

  if (canRetry) {
    return (
      <IconButton
        actionId={`message-retry-${message.ulid}`}
        data-message-retry={message.ulid}
        data-message-delivery-state={verdict.kind}
        data-message-delivery-fact={message.deliveryState ?? ''}
        data-message-delivery-reason={verdict.reasonCode ?? ''}
        iconId="rotate-ccw"
        iconSize={12}
        label={retryActionLabel}
        title={[retryActionLabel, label, details].filter(Boolean).join(' · ')}
        emphasis="quiet"
        density="compact"
        execution={retryExecution}
        executionLabel={retryActionLabel}
        aria-live="polite"
        onActivate={() => { void retry(); }}
      />
    );
  }

  return (
    <Tooltip className="sc-msg-verdict-details" label={details || label}>
      <span
        className={compact ? 'sc-verdict sc-verdict--compact' : 'sc-verdict'}
        data-message-delivery-state={verdict.kind}
        data-message-delivery-fact={message.deliveryState ?? ''}
        data-message-delivery-reason={verdict.reasonCode ?? ''}
      >
        {label}
        {details ? ` · ${details}` : ''}
      </span>
    </Tooltip>
  );
}
