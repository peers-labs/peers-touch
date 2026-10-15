import { useEffect, useRef } from 'react';
import { Typography } from 'antd';
import { CornerUpLeft, Send } from 'lucide-react';
import type { AvatarRenderState, Moment } from '../types';
import { demoAvatarUrls } from '../data';
import copy from '../../../../../locales/en/common.json';
import { IdentityAvatar } from './IdentityAvatar';

const { Text } = Typography;

export function MomentComments({
  moment,
  avatarState,
  expanded,
  composerOpen,
  focusComposer,
  draft,
  onDraftChange,
  onExpand,
  onClose,
  onReply,
  onSubmit,
  onOpenAuthor,
}: {
  moment: Moment;
  avatarState: AvatarRenderState;
  expanded: boolean;
  composerOpen: boolean;
  focusComposer: boolean;
  draft: string;
  onDraftChange: (value: string) => void;
  onExpand: () => void;
  onClose: () => void;
  onReply: (name: string) => void;
  onSubmit: () => void;
  onOpenAuthor: (name: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const comments = expanded ? moment.comments : moment.comments.slice(0, 2);

  useEffect(() => {
    if (!composerOpen || !focusComposer) return;
    const input = inputRef.current;
    if (!input) return;
    input.focus({ preventScroll: true });
    const bounds = input.getBoundingClientRect();
    const page = input.closest('.mp-page')?.getBoundingClientRect();
    if (page && (bounds.top < page.top || bounds.bottom > page.bottom)) {
      input.scrollIntoView({ block: 'nearest', behavior: 'auto' });
    }
  }, [composerOpen, focusComposer]);

  if (!moment.comments.length && !composerOpen) return null;

  return (
    <section id={`moment-comments-${moment.id}`} className="mp-moment-comments"
      data-moment-comments={moment.id} aria-label={copy['mobile.moments.comment.title']}>
      <div className="mp-moment-comment-list" aria-live="polite" aria-relevant="additions">
        {comments.map((comment) => (
          <article key={comment.id} className="mp-moment-comment">
            <IdentityAvatar
              name={comment.name}
              initials={comment.avatar}
              src={comment.avatarUrl}
              size={28}
              renderState={avatarState}
              onClick={() => onOpenAuthor(comment.name)}
            />
            <div className="mp-moment-comment-body">
              <div className="mp-moment-comment-heading">
                <button type="button" className="mp-actor-link"
                  onClick={() => onOpenAuthor(comment.name)}>{comment.name}</button>
                <Text type="secondary" className="mp-moment-comment-time">{comment.time}</Text>
                <button type="button" className="mp-moment-comment-reply"
                  aria-label={`Reply to ${comment.name}`} title={`Reply to ${comment.name}`} onClick={() => {
                  onReply(comment.name);
                  inputRef.current?.focus({ preventScroll: true });
                  requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
                }}>
                  <CornerUpLeft size={12} aria-hidden="true" />
                </button>
              </div>
              <div className="mp-moment-comment-copy">
                <span className="mp-moment-comment-text">{comment.text}</span>
              </div>
            </div>
          </article>
        ))}
      </div>
      {!expanded && moment.comments.length > comments.length && (
        <button type="button" className="mp-moment-comment-more" onClick={onExpand}>
          {copy['mobile.moments.comment.showMore'].replace('{{count}}', String(moment.comments.length - comments.length))}
        </button>
      )}
      {composerOpen && (
        <form className="mp-moment-comment-input-row" onSubmit={(event) => {
          event.preventDefault();
          if (draft.trim()) onSubmit();
        }}>
          <IdentityAvatar
            name="Alice Chen"
            initials="AC"
            src={demoAvatarUrls.alice}
            size={28}
            renderState={avatarState}
          />
          <input
            ref={inputRef}
            type="text"
            className="mp-moment-comment-input"
            name={`comment-${moment.id}`}
            aria-label={copy['mobile.moments.comment.title']}
            placeholder={copy['mobile.moments.comment.placeholder']}
            autoComplete="off"
            value={draft}
            onChange={(event) => onDraftChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                onClose();
              } else if (event.key === 'Enter' && (event.nativeEvent.isComposing || event.keyCode === 229)) {
                event.preventDefault();
              }
            }}
          />
          <button type="submit"
            className={`mp-moment-comment-send ${draft.trim() ? 'active' : ''}`}
            aria-label={copy['mobile.moments.comment.send']}
            disabled={!draft.trim()}>
            <Send size={16} aria-hidden="true" />
          </button>
        </form>
      )}
    </section>
  );
}
