import { useEffect, useState, type HTMLAttributes, type ReactNode } from 'react';
import { Button } from './actions';
import './moments.css';

export interface MomentCommentRowProps extends Omit<HTMLAttributes<HTMLLIElement>, 'content'> {
  commentId: string;
  avatar: ReactNode;
  author: ReactNode;
  content: ReactNode;
  time?: ReactNode;
  actions?: ReactNode;
  replies?: ReactNode;
  composer?: ReactNode;
  own?: boolean;
  depth?: number;
  highlighted?: boolean;
  /** Set only when this row first arrives in an already acquired visible thread. */
  arrival?: boolean;
  reaction?: {
    count: bigint | number;
    liked: boolean;
    /** Accessible action label; the visible control is an emoji and count. */
    label: string;
    pending?: boolean;
    error?: ReactNode;
    onActivate: () => void;
    retry?: { label: string; onActivate: () => void };
  };
}

/** The owner supplies canonical identity, time, nesting and commands. */
export function MomentCommentRow({ commentId, avatar, author, content, time, actions, replies,
  composer, own, depth = 0, highlighted, arrival = false, reaction, className = '', onAnimationEnd,
  ...props }: MomentCommentRowProps) {
  const [arriving, setArriving] = useState(arrival);
  useEffect(() => {
    if (!arriving) return;
    // Retire even when hidden or motion is disabled, so alive-page restoration
    // cannot replay an old arrival animation.
    const timer = setTimeout(() => setArriving(false), 400);
    return () => clearTimeout(timer);
  }, [arriving]);
  return <li {...props} className={`sk-comment-item ${className}`} data-comment-id={commentId}
    data-arriving={arrival && arriving || undefined}
    onAnimationEnd={event => {
      if (event.target === event.currentTarget) setArriving(false);
      onAnimationEnd?.(event);
    }}
    data-moments-comment={commentId} data-own-comment={own ? 'true' : 'false'} data-depth={depth}
    data-highlighted={highlighted || undefined} tabIndex={highlighted ? 0 : -1}>
    {avatar}
    <div className="sk-comment-body">
      <div className="sk-comment-line">{author}<span className="sk-comment-text">{content}</span></div>
      {(time || actions || reaction) && <div className="sk-comment-meta">{time}
        {reaction && <Button actionId={`comment.like.${commentId}`} emphasis="quiet" density="compact"
          className={`sk-comment-action${reaction.liked ? ' is-liked' : ''}`}
          data-comment-like={reaction.liked ? 'on' : 'off'} data-comment-like-count={String(reaction.count)}
          aria-pressed={reaction.liked} aria-label={reaction.label}
          execution={reaction.pending ? 'pending' : 'idle'} onActivate={reaction.onActivate}>
          <span className="sk-comment-reaction-emoji" aria-hidden="true">👍</span>
          {BigInt(reaction.count) > 0n && <span className="sk-comment-reaction-count" aria-hidden="true">
            {String(reaction.count)}
          </span>}
        </Button>}
        {actions}
        {reaction?.retry && <Button actionId={`comment.like.retry.${commentId}`} emphasis="quiet"
          density="compact" className="sk-comment-action" label={reaction.retry.label}
          onActivate={reaction.retry.onActivate} />}
        {reaction?.error && <span className="sk-comment-status" role="alert">{reaction.error}</span>}
      </div>}
      {replies && <ul className="sk-reply-list">{replies}</ul>}
      {composer}
    </div>
  </li>;
}

export function MomentCommentComposer({ children, status, invalid, className = '', ...props }:
  HTMLAttributes<HTMLDivElement> & { status?: ReactNode; invalid?: boolean }) {
  return <div {...props} className={`sk-comment-composer ${className}`} data-invalid={invalid || undefined}>
    <div className="sk-inline-composer">{children}</div>
    {status && <div className="sk-comment-status" role={invalid ? 'alert' : 'status'}>{status}</div>}
  </div>;
}
