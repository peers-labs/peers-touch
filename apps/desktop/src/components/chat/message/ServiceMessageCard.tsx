import {
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  ExternalLink,
  Hourglass,
  Loader2,
  XCircle,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { DesktopServiceMessage } from '../../../store/socialProjection';
import type { ServiceEventAggregation } from './serviceEventAggregation';

const STATE_RUNNING = 2;
const STATE_WAITING_INPUT = 3;
const STATE_COMPLETED = 4;
const STATE_FAILED = 5;
const STATE_CANCELLED = 6;

type ActivityStateAttr = 'failed' | 'waiting' | 'attention' | 'completed' | 'cancelled' | 'running' | 'info';

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
  const { t } = useTranslation('chat');
  const displayed = aggregation?.effective ?? service;
  const primary = displayed.content?.primary;
  const taskState = primary?.taskState?.state;
  const failed = taskState === STATE_FAILED;
  const waiting = taskState === STATE_WAITING_INPUT;
  const completed = taskState === STATE_COMPLETED;
  const cancelled = taskState === STATE_CANCELLED;
  const running = taskState === STATE_RUNNING;
  const attention = primary?.severity === 2;

  const stateAttr: ActivityStateAttr = failed
    ? 'failed'
    : waiting
      ? attention ? 'attention' : 'waiting'
      : completed
        ? 'completed'
        : cancelled
          ? 'cancelled'
          : running
            ? 'running'
            : 'info';

  const Glyph = failed
    ? XCircle
    : waiting
      ? Hourglass
      : completed
        ? CheckCircle2
        : cancelled
          ? CircleAlert
          : running
            ? Loader2
            : Bot;
  const title = primary?.title || primary?.text || displayed.fallbackText;
  const body = primary?.body || (primary?.title ? displayed.fallbackText : '');
  const action = primary?.actions?.find(item => /^https?:\/\//i.test(item.url));
  const source = displayed.sourceContext;
  const meta = [source?.program, source?.workspace, source?.sessionId].filter(Boolean);
  const historyLabel = aggregation
    ? t('chat.service.knownUpdates', {
        count: aggregation.knownCount,
        defaultValue: `${aggregation.knownCount} known`,
      })
    : '';

  return (
    <article
      className="sc-activity"
      data-state={stateAttr}
      data-service-message-card="true"
      data-service-event-type={primary?.eventType ?? ''}
      data-service-aggregation-count={aggregation?.knownCount ?? 1}
      data-service-aggregation-conflict={aggregation?.conflicting ? 'true' : 'false'}
    >
      <span className="sc-activity__rail" aria-hidden />
      <div className="sc-activity__body">
        <header className="sc-activity__head">
          <Glyph size={16} className={running ? 'sc-activity__spinning' : undefined} />
          <strong className="sc-activity__title">{title}</strong>
          {aggregation && (
            <button
              type="button"
              className="sc-activity__history"
              aria-label={historyLabel}
              aria-expanded={aggregation.expanded}
              onClick={() => onToggleAggregation?.(aggregation.key)}
            >
              {aggregation.expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              {historyLabel}
            </button>
          )}
        </header>
        {body && <p className="sc-activity__text">{body}</p>}
        {/* History notes are revealed only when the known-history roll-up is
            expanded (prototype ActivityCard). */}
        {aggregation?.expanded && aggregation.conflicting && (
          <p className="sc-activity__note sc-activity__note--warning">
            {t('chat.service.conflictingState', { defaultValue: 'Conflicting reports in known history' })}
          </p>
        )}
        {aggregation?.expanded && aggregation.knownHistoryOnly && (
          <p className="sc-activity__note">
            {t('chat.service.knownHistoryOnly', { defaultValue: 'Latest state from known history' })}
          </p>
        )}
        {meta.length > 0 && <p className="sc-activity__meta">{meta.join(' · ')}</p>}
        {action && (
          <a
            className="sc-activity__action"
            href={action.url}
            rel="noreferrer"
            target="_blank"
          >
            <ExternalLink size={13} />
            {action.label}
          </a>
        )}
      </div>
    </article>
  );
}
