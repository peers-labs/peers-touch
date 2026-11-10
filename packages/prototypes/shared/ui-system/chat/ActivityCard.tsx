/**
 * ActivityCard — automation/service task event in the message stream
 * (desktop ServiceMessageCard). Unlike the centered `sk-msg-service` pill
 * (join/leave style system notices), an activity event owns a surface card:
 * semantic state rail, task glyph, title/body, source meta, optional external
 * action, and a collapsed known-history roll-up.
 *
 * The card is always its own chrome: it never nests inside a message bubble,
 * on either the viewer's own side or a peer side.
 */
import { useState } from 'react';
import {
  Bot, CheckCircle2, ChevronDown, ChevronUp, CircleAlert, Clock3,
  ExternalLink, Hourglass, Loader2, XCircle,
} from 'lucide-react';
import type { ActivityEvent, ActivityState } from './chat-data';
import { useT } from '../prefs';

const STATE_GLYPH: Record<ActivityState, typeof Bot> = {
  running: Loader2,
  waiting: Hourglass,
  completed: CheckCircle2,
  failed: XCircle,
  cancelled: CircleAlert,
  info: Bot,
};

export function ActivityCard({ event }: { event: ActivityEvent }) {
  const { t } = useT();
  const [expanded, setExpanded] = useState(event.expanded ?? false);
  const state: ActivityState = event.state;
  const attention = state === 'waiting' && event.attention;
  const Glyph = STATE_GLYPH[state];
  const meta = [event.source?.program, event.source?.workspace, event.source?.sessionId].filter(Boolean);

  return (
    <article className="sk-activity" data-state={attention ? 'attention' : state} data-activity-card>
      <span className="sk-activity-rail" aria-hidden />
      <div className="sk-activity-body">
        <header className="sk-activity-head">
          <Glyph size={16} className={state === 'running' ? 'sk-spin' : undefined} />
          <strong className="sk-activity-title">{event.title}</strong>
          {typeof event.knownCount === 'number' && event.knownCount > 1 && (
            <button type="button" className="sk-activity-history"
              aria-expanded={expanded}
              onClick={() => setExpanded(value => !value)}>
              {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              {t('activity.knownUpdates', { n: event.knownCount })}
            </button>
          )}
        </header>
        {event.body && <p className="sk-activity-text">{event.body}</p>}
        {expanded && event.conflicting && (
          <p className="sk-activity-note is-warning">{t('activity.conflicting')}</p>
        )}
        {expanded && event.historyOnly && (
          <p className="sk-activity-note">{t('activity.historyOnly')}</p>
        )}
        {meta.length > 0 && <p className="sk-activity-meta">{meta.join(' · ')}</p>}
        {event.action && (
          <a className="sk-activity-action" href={event.action.url} target="_blank" rel="noreferrer">
            <ExternalLink size={13} /> {event.action.label}
          </a>
        )}
      </div>
    </article>
  );
}
