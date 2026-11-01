/**
 * MomentCard — one social post in the north-star frame.
 *
 * The card is the whole surface: no separate detail page. Comments live
 * inline (shown by default, folded after COMMENT_FOLD), and every comment
 * is itself interactive — like and reply, with one level of nested
 * replies rendered in a tinted reply block (a reply to a reply attaches
 * to the root). Delete exists solely on the viewer's own content.
 */
import { useState } from 'react';
import {
  Globe, Lock, MessageCircle, Smile, Trash2, UserCheck, Users, UsersRound,
} from 'lucide-react';
import {
  Avatar, Button, Dialog, IconButton, Menu, Popover, TextField,
} from '@peers-touch/ui';
import {
  REACTION_CATALOG, REACTION_BY_KIND, VIEWER_NAME,
  type AudienceKind, type Moment, type MomentComment, type ReactionKind, type TrustReason,
} from './moments-data';

const EXPAND_THRESHOLD = 320;
/** Comments visible without an explicit expand action. */
const COMMENT_FOLD = 10;

const AUDIENCE_LABEL: Record<AudienceKind, string> = {
  public: '公开',
  followers: '关注者',
  friends: '朋友',
  circle: '圈子',
  self: '仅自己',
};

const REASON_LABEL: Record<TrustReason, string> = {
  self: '自己',
  following: '关注的人',
  mutual: '互相关注',
  circle: '同圈',
  public: '联邦公开',
};

function audienceLabel(audience: AudienceKind, circle?: string): string {
  if (audience === 'circle' && circle) return `圈子 · ${circle}`;
  return AUDIENCE_LABEL[audience];
}

function TrustIcon({ audience }: { audience: AudienceKind }) {
  const size = 11;
  if (audience === 'followers') return <UserCheck size={size} />;
  if (audience === 'friends') return <Users size={size} />;
  if (audience === 'circle') return <UsersRound size={size} />;
  if (audience === 'self') return <Lock size={size} />;
  return <Globe size={size} />;
}

function TrustMeta({ post }: { post: Moment }) {
  const segments = [
    post.source === 'remote' && post.station ? `来自 ${post.station}` : '本站',
    post.reason === 'public' ? null : REASON_LABEL[post.reason],
    audienceLabel(post.audience, post.circle),
  ].filter((segment): segment is string => Boolean(segment));
  return (
    <div className="sk-trust" data-acceptance-id="social-trust-meta">
      {segments.map((segment, index) => (
        <span className="sk-trust-seg" key={segment}>
          {index === segments.length - 1 && <TrustIcon audience={post.audience} />}
          {segment}
          {index < segments.length - 1 && <span className="sk-trust-dot" aria-hidden="true">·</span>}
        </span>
      ))}
    </div>
  );
}

function ReactionBar({ post, commentsOpen, onToggleComments, onReact, onUnreact }: {
  post: Moment;
  commentsOpen: boolean;
  onToggleComments: () => void;
  onReact: (id: string, kind: ReactionKind) => void;
  onUnreact: (id: string) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const countComments = (comments: Moment['comments']): number =>
    comments.reduce((sum, c) => sum + 1 + countComments(c.replies ?? []), 0);
  const commentCount = countComments(post.comments);
  const totals = (Object.entries(post.reactions) as [ReactionKind, number][])
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1]);
  const total = totals.reduce((sum, [, count]) => sum + count, 0);
  const viewerMeta = post.viewerReaction ? REACTION_BY_KIND.get(post.viewerReaction) : undefined;
  // One single reaction control. It shows the viewer's own choice when set,
  // otherwise the most-used reaction; a post with no reactions shows the
  // smile entry. There is no separate "like" button — like is just the first
  // emoji in the picker.
  const shownMeta = viewerMeta ?? (totals.length ? REACTION_BY_KIND.get(totals[0][0]) : undefined);

  // Re-picking the viewer's current reaction clears it; any other emoji
  // switches the single-choice reaction.
  const choose = (kind: ReactionKind) => {
    setPickerOpen(false);
    if (post.viewerReaction === kind) onUnreact(post.id);
    else onReact(post.id, kind);
  };

  const picker = (
    <div className="sk-react-picker" role="group" aria-label="选择反应">
      {REACTION_CATALOG.map(meta => (
        <Button key={meta.kind} actionId={`moment.react.${meta.kind}`} emphasis="quiet"
          density="compact" aria-label={meta.label}
          aria-pressed={post.viewerReaction === meta.kind}
          data-reaction-kind={meta.kind}
          onActivate={() => choose(meta.kind)}>
          <span aria-hidden="true">{meta.emoji}</span>
        </Button>
      ))}
    </div>
  );

  return (
    <div className="sk-post-actions">
      <Popover open={pickerOpen} onOpenChange={setPickerOpen} content={picker}
        placement="bottom" label="选择反应" className="sk-react-popover">
        <Button actionId={`moment.reaction.${post.id}`} emphasis="quiet" density="compact"
          leading={shownMeta
            ? <span className="sk-react-emoji" aria-hidden="true">{shownMeta.emoji}</span>
            : <Smile size={14} />}
          label={shownMeta ? String(total) : undefined}
          className={viewerMeta ? 'is-liked' : undefined}
          aria-pressed={Boolean(viewerMeta)}
          data-reaction-total={total}
          aria-label={shownMeta ? `反应：${shownMeta.label}，共 ${total}` : '添加反应'} />
      </Popover>
      <Button actionId={`moment.comments.${post.id}`} emphasis="quiet" density="compact"
        leading={<MessageCircle size={14} />} label={String(commentCount)}
        aria-label={`${commentCount} 条评论`} aria-expanded={commentsOpen}
        onActivate={onToggleComments} />
    </div>
  );
}

function ImageGrid({ images }: { images: string[] }) {
  const [lightbox, setLightbox] = useState<number | null>(null);
  const count = images.length;
  const close = () => setLightbox(null);
  const shift = (delta: number) => setLightbox(index => {
    if (index === null) return index;
    return (index + delta + count) % count;
  });
  return (
    <>
      <div className={`sk-post-images sk-grid-${Math.min(count, 9)}`} data-count={count}>
        {images.map((src, index) => (
          <button type="button" key={src} className="sk-img-tile"
            aria-label={`查看图片 ${index + 1}/${count}`}
            onClick={event => { event.stopPropagation(); setLightbox(index); }}>
            <img src={src} alt="" loading="lazy" />
          </button>
        ))}
      </div>
      <Dialog open={lightbox !== null} onDismiss={close} title="图片" width={620}
        closeLabel="关闭"
        footer={
          <>
            <Button actionId="lightbox.prev" emphasis="secondary" label="上一张"
              availability={count <= 1 ? { kind: 'disabled', reason: 'Only one image' } : undefined}
              onActivate={() => shift(-1)} />
            <Button actionId="lightbox.next" emphasis="secondary" label="下一张"
              availability={count <= 1 ? { kind: 'disabled', reason: 'Only one image' } : undefined}
              onActivate={() => shift(1)} />
          </>
        }>
        {lightbox !== null && (
          <div className="sk-lightbox">
            <img src={images[lightbox]} alt={`图片 ${lightbox + 1}`} />
            <span className="sk-lightbox-count">{lightbox + 1} / {count}</span>
          </div>
        )}
      </Dialog>
    </>
  );
}

interface CommentItemProps {
  comment: MomentComment;
  depth?: number;
  rootId: string;
  postId: string;
  onAuthor: (name: string) => void;
  onLikeComment: (postId: string, commentId: string) => void;
  onReplyComment: (postId: string, rootId: string, text: string) => void;
  onRequestDelete: (comment: MomentComment) => void;
}

function CommentItem({ comment, depth = 0, rootId, postId, onAuthor, onLikeComment, onReplyComment, onRequestDelete }: CommentItemProps) {
  const [replying, setReplying] = useState(false);
  const [draft, setDraft] = useState('');
  const mine = comment.author === VIEWER_NAME;
  const liked = (comment.likes ?? []).includes(VIEWER_NAME);
  const likeCount = comment.likes?.length ?? 0;
  const replies = comment.replies ?? [];

  const submit = () => {
    const text = draft.trim();
    if (!text) return;
    onReplyComment(postId, rootId, text);
    setDraft('');
    setReplying(false);
  };

  return (
    <li className="sk-comment-item" data-comment-id={comment.id} data-own-comment={mine ? 'true' : 'false'}
      data-depth={depth}>
      <Avatar name={comment.author} background={comment.tone} size={30}
        style={{ borderRadius: 9 }} aria-hidden="true" />
      <span className="sk-comment-body">
        <span className="sk-comment-line">
          <button type="button" className="sk-comment-author"
            onClick={() => onAuthor(comment.author)}>{comment.author}</button>
          <span className="sk-comment-text">{comment.text}</span>
        </span>
        <div className="sk-comment-meta">
          <time>{comment.at}</time>
          <Button actionId={`comment.like.${comment.id}`} emphasis="quiet" density="compact"
            className={`sk-comment-action${liked ? ' is-liked' : ''}`}
            data-comment-like={liked ? 'on' : 'off'}
            label={likeCount > 0 ? `赞 ${likeCount}` : '赞'}
            onActivate={() => onLikeComment(postId, comment.id)} />
          <Button actionId={`comment.reply.${comment.id}`} emphasis="quiet" density="compact"
            className="sk-comment-action" data-comment-reply label="回复"
            onActivate={() => setReplying(value => !value)} />
          {mine && (
            <Button actionId={`comment.delete.${comment.id}`} emphasis="quiet" density="compact"
              className="sk-comment-action is-danger" data-comment-delete label="删除"
              tone="danger" onActivate={() => onRequestDelete(comment)} />
          )}
        </div>

        {replies.length > 0 && (
          <ul className="sk-reply-list">
            {replies.map(reply => (
              <CommentItem key={reply.id} comment={reply} depth={1} rootId={rootId} postId={postId}
                onAuthor={onAuthor} onLikeComment={onLikeComment}
                onReplyComment={onReplyComment} onRequestDelete={onRequestDelete} />
            ))}
          </ul>
        )}

        {replying && (
          <span className="sk-inline-composer sk-reply-composer" data-reply-to={comment.author}>
            <TextField aria-label={`回复 ${comment.author}`}
              placeholder={`回复 ${comment.author}……`} value={draft}
              data-reply-value={draft}
              onValueChange={setDraft}
              onEnter={event => { event.preventDefault(); submit(); }} autoFocus />
            <IconButton iconId="send" iconSize={14} label="发送回复"
              actionId={`reply.send.${comment.id}`} emphasis="primary" density="compact"
              availability={draft.trim() ? { kind: 'enabled' } : { kind: 'disabled', reason: '请输入回复' }}
              onActivate={submit} />
          </span>
        )}
      </span>
    </li>
  );
}

export interface MomentCardProps {
  post: Moment;
  onAuthor: (name: string) => void;
  onReact: (id: string, kind: ReactionKind) => void;
  onUnreact: (id: string) => void;
  onComment: (id: string, text: string) => void;
  onLikeComment: (postId: string, commentId: string) => void;
  onReplyComment: (postId: string, rootCommentId: string, text: string) => void;
  onDeleteComment: (postId: string, commentId: string) => void;
  onDeletePost: (postId: string) => void;
}

export function MomentCard({ post, onAuthor, onReact, onUnreact, onComment, onLikeComment,
  onReplyComment, onDeleteComment, onDeletePost }: MomentCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(true);
  const [allComments, setAllComments] = useState(false);
  const [draft, setDraft] = useState('');
  const [confirmTarget, setConfirmTarget] = useState<'post' | MomentComment | null>(null);
  const longBody = post.text.length > EXPAND_THRESHOLD;
  const visibleBody = expanded || !longBody
    ? post.text
    : `${post.text.slice(0, EXPAND_THRESHOLD)}…`;

  const needsFold = post.comments.length > COMMENT_FOLD;
  const visibleComments = needsFold && !allComments
    ? post.comments.slice(0, COMMENT_FOLD)
    : post.comments;
  const ownPost = post.author === VIEWER_NAME;

  const submitComment = () => {
    const text = draft.trim();
    if (!text) return;
    onComment(post.id, text);
    setDraft('');
    setCommentsOpen(true);
    setAllComments(true);
  };

  const runConfirm = () => {
    if (confirmTarget === 'post') onDeletePost(post.id);
    else if (confirmTarget) onDeleteComment(post.id, confirmTarget.id);
    setConfirmTarget(null);
  };

  return (
    <article className="sk-post" data-post-id={post.id} data-acceptance-id="social-moment-card">
      <header className="sk-post-head">
        <button type="button" className="sk-post-author"
          aria-label={`查看 ${post.author} 的主页`}
          onClick={() => onAuthor(post.author)}>
          <Avatar name={post.author} background={post.tone} size={48}
            style={{ borderRadius: 13 }} aria-hidden="true" />
          <span className="sk-post-idcol">
            <strong className="sk-post-name">{post.author}</strong>
            <span className="sk-post-time">{post.at}</span>
          </span>
        </button>
        {ownPost && (
          <span className="sk-post-menu">
            <Menu placement="bottom" label="动态操作"
              actions={[{
                id: `moment.delete.${post.id}`, label: '删除动态',
                leading: <Trash2 size={14} />, tone: 'danger',
                onActivate: () => setConfirmTarget('post'),
              }]}>
              <IconButton actionId={`moment.menu.${post.id}`} iconId="more-horizontal" iconSize={16}
                label="更多" emphasis="quiet" density="compact" />
            </Menu>
          </span>
        )}
      </header>

      <div className="sk-post-meta"><TrustMeta post={post} /></div>

      <div className="sk-post-body">
        <p>{visibleBody}</p>
        {longBody && (
          <button type="button" className="sk-post-expand"
            onClick={() => setExpanded(value => !value)}>
            {expanded ? '收起' : '展开全文'}
          </button>
        )}
        {post.images && post.images.length > 0 && <ImageGrid images={post.images} />}
      </div>

      {/* Feedback bar sits directly under the body, above the comments tile,
          so reaction/comment counts are visible without scrolling past a
          long default-expanded comment list. */}
      <ReactionBar post={post} commentsOpen={commentsOpen}
        onToggleComments={() => setCommentsOpen(value => !value)}
        onReact={onReact} onUnreact={onUnreact} />

      {commentsOpen && (
        <div className="sk-comments" data-comments-open="true">
          {post.comments.length > 0 && (
            <ul className="sk-comment-list">
              {visibleComments.map(comment => (
                <CommentItem key={comment.id} comment={comment} rootId={comment.id} postId={post.id}
                  onAuthor={onAuthor} onLikeComment={onLikeComment}
                  onReplyComment={onReplyComment} onRequestDelete={setConfirmTarget} />
              ))}
            </ul>
          )}
          {needsFold && (
            <button type="button" className="sk-comment-fold" data-comments-folded={allComments ? 'false' : 'true'}
              onClick={() => setAllComments(value => !value)}>
              {allComments ? '收起评论' : `展开全部 ${post.comments.length} 条评论`}
            </button>
          )}
          <span className="sk-inline-composer" data-card-composer>
            <TextField aria-label="写评论" placeholder="写评论……"
              value={draft} data-comment-value={draft}
              onValueChange={setDraft}
              onEnter={event => { event.preventDefault(); submitComment(); }} />
            <IconButton iconId="send" iconSize={15} label="发送评论"
              actionId={`comment.send.${post.id}`} emphasis="primary"
              availability={draft.trim() ? { kind: 'enabled' } : { kind: 'disabled', reason: '请输入评论' }}
              onActivate={submitComment} />
          </span>
        </div>
      )}

      <Dialog open={confirmTarget !== null} onDismiss={() => setConfirmTarget(null)}
        title={confirmTarget === 'post' ? '删除这条动态？' : '删除这条评论？'} width={380}
        closeLabel="取消"
        description="删除仅作用于本地原型视图。"
        footer={
          <>
            <Button actionId="comment.delete-cancel" emphasis="quiet" label="取消"
              onActivate={() => setConfirmTarget(null)} />
            <Button actionId="comment.delete-ok" emphasis="primary" tone="danger" label="删除"
              onActivate={runConfirm} />
          </>
        }>
        <span data-delete-confirm={confirmTarget === 'post' ? 'post' : 'comment'} />
      </Dialog>
    </article>
  );
}
