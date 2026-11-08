import { forwardRef, useState, type HTMLAttributes, type ReactNode } from 'react';
import { Avatar } from './data';
import { Button, IconButton } from './actions';
import { Menu, Popover, type MenuEntry } from './overlays';
import { Icon } from './icon';
import type { ActionExecution, Availability } from '@peers-touch/ui-contracts';
import './moments.css';

export interface MomentCardCopy { more: string; expand: string; collapse: string }
export interface MomentCardProps extends Omit<HTMLAttributes<HTMLElement>, 'content'> {
  postId: string;
  copy: MomentCardCopy;
  /** One semantic author trigger, supplied by the canonical Identity Owner. */
  author: ReactNode;
  text: string;
  trust?: ReactNode;
  notice?: ReactNode;
  attachments?: ReactNode;
  content?: ReactNode;
  actions?: ReactNode;
  comments?: ReactNode;
  dialogs?: ReactNode;
  menuActions?: readonly MenuEntry[];
  embedded?: boolean;
}

/** Presentation only. Signed writes, media, comments and private state stay with their owners. */
export function MomentCard({ postId, copy, author, text, trust, notice, attachments, content,
  actions, comments, dialogs, menuActions = [], embedded, className = '', ...props }: MomentCardProps) {
  const [expanded, setExpanded] = useState(false);
  const long = text.length > 320;
  return <article {...props} className={`sk-post ${className}`} data-post-id={postId}
    data-embedded={embedded || undefined} data-acceptance-id="social-moment-card">
    <header className="sk-post-head">
      {author}
      {menuActions.length > 0 && <span className="sk-post-menu">
        <Menu placement="bottom" label={copy.more} actions={menuActions}>
          <IconButton actionId={`moment.menu.${postId}`} iconId="more-horizontal" iconSize={16}
            label={copy.more} emphasis="quiet" density="compact" data-acceptance-id="social-moment-menu" />
        </Menu>
      </span>}
    </header>
    {trust && <div className="sk-post-meta">{trust}</div>}
    {notice}
    <div className="sk-post-body">
      {text && <p>{expanded || !long ? text : `${text.slice(0, 320)}…`}</p>}
      {long && <button type="button" className="sk-post-expand" aria-expanded={expanded}
        onClick={() => setExpanded(value => !value)}>{expanded ? copy.collapse : copy.expand}</button>}
      {attachments}{content}
    </div>
    {actions}
    {comments && <div className="sk-comments" data-comments-open="true">{comments}</div>}
    {dialogs}
  </article>;
}

export const MomentAuthor = forwardRef<HTMLButtonElement,
  Omit<HTMLAttributes<HTMLButtonElement>, 'children'> & {
    avatar: ReactNode; name: string; time?: string; label: string;
  }>(function MomentAuthor({ avatar, name, time, label, ...props }, ref) {
  return <button {...props} ref={ref} type="button" className="sk-post-author" aria-label={label}>
    {avatar}<span className="sk-post-idcol">
      <strong className="sk-post-name" data-acceptance-id="social-moment-author">{name}</strong>
      <span className="sk-post-time">{time}</span>
    </span>
  </button>;
});

export function MomentTrustMeta({ segments }: {
  segments: readonly { id: string; label: string; icon?: ReactNode }[];
}) {
  return <div className="sk-trust" data-acceptance-id="social-trust-meta">
    {segments.map((segment, index) => <span key={segment.id} className="sk-trust-seg">
      {segment.icon}{segment.label}
      {index < segments.length - 1 && <span className="sk-trust-dot" aria-hidden="true">·</span>}
    </span>)}
  </div>;
}

export interface MomentReaction {
  kind: string; emoji: string; label: string; count: number; selected: boolean;
  execution?: ActionExecution; availability?: Availability;
}
export interface MomentReactionBarProps {
  postId: string; reactions: readonly MomentReaction[]; commentCount: number; commentsOpen: boolean;
  copy: { picker: string; add: string; comments: (count: number) => string; selected: string };
  onToggleComments: () => void;
  onToggleReaction: (kind: string) => void;
  status?: ReactNode;
}
export function MomentReactionBar({ postId, reactions, commentCount, commentsOpen, copy,
  onToggleComments, onToggleReaction, status }: MomentReactionBarProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const totals = reactions.filter(reaction => reaction.count > 0).slice()
    .sort((a, b) => b.count - a.count);
  const picker = <div className="sk-react-picker" role="group" aria-label={copy.picker}>
    {reactions.map(reaction => <Button key={reaction.kind} actionId={`moment.react.${reaction.kind}`}
      emphasis="quiet" density="compact" aria-label={reaction.label} aria-pressed={reaction.selected}
      execution={reaction.execution} availability={reaction.availability}
      data-reaction-kind={reaction.kind} data-acceptance-id={`social-reaction-pick-${reaction.kind}`}
      className={reaction.selected ? 'is-liked' : undefined}
      onActivate={() => onToggleReaction(reaction.kind)}><span aria-hidden="true">{reaction.emoji}</span></Button>)}
  </div>;
  return <div className="sk-post-actions">
    <span className="sk-react-summary" data-reaction-summary>
      {totals.map(reaction => <Button key={reaction.kind}
        actionId={`moment.reaction-chip.${postId}.${reaction.kind}`} emphasis="quiet" density="compact"
        className={reaction.selected ? 'sk-react-chip is-liked' : 'sk-react-chip'}
        aria-label={`${reaction.label} ${reaction.count}${reaction.selected ? copy.selected : ''}`}
        aria-pressed={reaction.selected} execution={reaction.execution} availability={reaction.availability}
        data-reaction-kind={reaction.kind} data-reaction-count={reaction.count}
        data-acceptance-id={`social-reaction-chip-${reaction.kind}`}
        onActivate={() => onToggleReaction(reaction.kind)}>
        <span className="sk-react-emoji" aria-hidden="true">{reaction.emoji}</span>
        <span className="sk-react-count">{reaction.count}</span>
      </Button>)}
    </span>
    <span className="sk-post-action-buttons">
      <Popover open={pickerOpen} onOpenChange={setPickerOpen} content={picker}
        placement="bottom" label={copy.picker} className="sk-react-popover">
        <Button actionId={`moment.reaction.${postId}`} emphasis="quiet" density="compact"
          data-acceptance-id="social-reaction-trigger"
          leading={<Icon iconId="smile" size={14} />} aria-label={copy.add}
          aria-haspopup="dialog" aria-expanded={pickerOpen}
          data-reaction-total={totals.reduce((sum, reaction) => sum + reaction.count, 0)} />
      </Popover>
      <Button actionId={`moment.comments.${postId}`} emphasis="quiet" density="compact"
        leading={<Icon iconId="message-circle" size={14} />} label={String(commentCount)}
        data-acceptance-id="social-open-comments"
        aria-label={copy.comments(commentCount)} aria-expanded={commentsOpen} onActivate={onToggleComments} />
    </span>
    {status}
  </div>;
}

export interface MomentStatistic { id: string; label: string; value?: number }
export function StatGrid({ statistics }: { statistics: readonly MomentStatistic[] }) {
  return <div className="sk-stats-panel"><div className="sk-stats-grid" data-moments-stats>
    {statistics.map(statistic => <span key={statistic.id} className="sk-stat-cell" data-stat={statistic.id}>
      <strong>{statistic.value ?? '—'}</strong><em>{statistic.label}</em>
    </span>)}
  </div></div>;
}

export interface UserProfileHeaderProps {
  name: string; station?: ReactNode; bio?: string; avatar?: ReactNode; tone?: string;
  statistics?: readonly MomentStatistic[]; actions?: ReactNode;
  isSelf?: boolean; inline?: boolean; loading?: boolean; loadingLabel?: string; refreshing?: ReactNode;
}
export function UserProfileHeader({ name, station, bio, avatar, tone, statistics = [], actions,
  isSelf, inline, loading, loadingLabel, refreshing }: UserProfileHeaderProps) {
  return <section className="sk-post sk-profile" data-profile-self={isSelf ? 'true' : 'false'}
    data-inline={inline || undefined} aria-busy={loading || undefined} aria-label={loading ? loadingLabel : undefined}>
    {avatar ?? <Avatar name={name} background={tone} size={inline ? 36 : 72}
      style={{ borderRadius: inline ? 9 : 20 }} />}
    <div className="sk-profile-id">
      <h2>{name}{refreshing}</h2>
      <span className="sk-post-time">{station}</span>
      {bio && <p>{bio}</p>}
      {!inline && <div className="sk-profile-stats">
        {statistics.map(statistic => <span key={statistic.id}>
          <strong>{statistic.value ?? '—'}</strong> {statistic.label}
        </span>)}
      </div>}
    </div>
    {actions && <span className="sk-profile-actions">{actions}</span>}
  </section>;
}
