import type { HTMLAttributes, ReactNode } from 'react';
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
  reaction?: {
    count: bigint | number;
    liked: boolean;
    label: string;
    pending?: boolean;
    error?: ReactNode;
    onActivate: () => void;
    retry?: { label: string; onActivate: () => void };
  };
}

/** The owner supplies canonical identity, time, nesting and commands. */
export function MomentCommentRow({ commentId, avatar, author, content, time, actions, replies,
  composer, own, depth = 0, highlighted, reaction, className = '', ...props }: MomentCommentRowProps) {
  return <li {...props} className={`sk-comment-item ${className}`} data-comment-id={commentId}
    data-moments-comment={commentId} data-own-comment={own ? 'true' : 'false'} data-depth={depth}
    data-highlighted={highlighted || undefined} tabIndex={highlighted ? 0 : -1}>
    {avatar}
    <div className="sk-comment-body">
      <div className="sk-comment-line">{author}<span className="sk-comment-text">{content}</span></div>
      {(time || actions || reaction) && <div className="sk-comment-meta">{time}
        {reaction && <Button actionId={`comment.like.${commentId}`} emphasis="quiet" density="compact"
          className={`sk-comment-action${reaction.liked ? ' is-liked' : ''}`}
          data-comment-like={reaction.liked ? 'on' : 'off'} data-comment-like-count={String(reaction.count)}
          aria-pressed={reaction.liked} label={reaction.label}
          execution={reaction.pending ? 'pending' : 'idle'} onActivate={reaction.onActivate} />}
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
