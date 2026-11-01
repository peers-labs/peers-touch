/**
 * MomentCard — one social post in the north-star frame.
 *
 * The card is the whole surface: there is no separate detail page. Comments
 * live inline inside the card, shown by default; only beyond COMMENT_FOLD
 * are they collapsed behind an explicit toggle. Commenting and deleting
 * happen here too — and delete exists solely on the viewer's own content
 * (comments and the viewer's own post menu).
 */
import { useState, type KeyboardEvent } from 'react';
import {
  Globe, Lock, MessageCircle, Smile, Trash2, UserCheck, Users, UsersRound,
} from 'lucide-react';
import { Avatar, Button, Dialog, IconButton, Menu, Popover, TextArea, Toggle } from '@peers-touch/ui';
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
  const totals = (Object.entries(post.reactions) as [ReactionKind, number][])
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1]);
  const total = totals.reduce((sum, [, count]) => sum + count, 0);
  const viewerMeta = post.viewerReaction ? REACTION_BY_KIND.get(post.viewerReaction) : undefined;
  const topMeta = totals.length ? REACTION_BY_KIND.get(totals[0][0]) : undefined;

  const picker = (
    <div className="sk-react-picker" role="group" aria-label="选择反应">
      {REACTION_CATALOG.map(meta => (
        <Button key={meta.kind} actionId={`moment.react.${meta.kind}`} emphasis="quiet"
          density="compact" aria-label={meta.label}
          onActivate={() => { setPickerOpen(false); onReact(post.id, meta.kind); }}>
          <span aria-hidden="true">{meta.emoji}</span>
        </Button>
      ))}
    </div>
  );

  return (
    <div className="sk-post-actions">
      {viewerMeta ? (
        <Toggle actionId={`moment.reaction.${post.id}`} emphasis="quiet" density="compact"
          selected leading={<span aria-hidden="true">{viewerMeta.emoji}</span>}
          label={String(total)} aria-label={`取消${viewerMeta.label}`}
          className="is-liked"
          onSelectedChange={() => onUnreact(post.id)} />
      ) : topMeta ? (
        <>
          <Toggle actionId={`moment.reaction.${post.id}`} emphasis="quiet" density="compact"
            selected={false} leading={<span aria-hidden="true">{topMeta.emoji}</span>}
            label={String(total)} aria-label={`反应：${topMeta.label}`}
            onSelectedChange={() => onReact(post.id, topMeta.kind)} />
          <Popover open={pickerOpen} onOpenChange={setPickerOpen} content={picker}
            placement="top" label="选择反应" className="sk-react-popover">
            <IconButton actionId={`moment.react-more.${post.id}`} iconId="smile" iconSize={15}
              label="更多反应" emphasis="quiet" density="compact" className="sk-react-more" />
          </Popover>
        </>
      ) : (
        <Popover open={pickerOpen} onOpenChange={setPickerOpen} content={picker}
          placement="top" label="选择反应" className="sk-react-popover">
          <Button actionId={`moment.react-add.${post.id}`} emphasis="quiet" density="compact"
            leading={<Smile size={14} />} label="添加反应"
            aria-label="添加反应" className="sk-react-add" />
        </Popover>
      )}
      <Button actionId={`moment.comments.${post.id}`} emphasis="quiet" density="compact"
        leading={<MessageCircle size={14} />} label={String(post.comments.length)}
        aria-label={`${post.comments.length} 条评论`} aria-expanded={commentsOpen}
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

function CommentItem({ comment, onAuthor, onRequestDelete }: {
  comment: MomentComment;
  onAuthor: (name: string) => void;
  onRequestDelete: (comment: MomentComment) => void;
}) {
  const mine = comment.author === VIEWER_NAME;
  return (
    <li className="sk-comment-item" data-comment-id={comment.id} data-own-comment={mine ? 'true' : 'false'}>
      <Avatar name={comment.author} background={comment.tone} size={30}
        style={{ borderRadius: 9 }} aria-hidden="true" />
      <span className="sk-comment-body">
        <span className="sk-comment-line">
          <button type="button" className="sk-comment-author"
            onClick={() => onAuthor(comment.author)}>{comment.author}</button>
          <span className="sk-comment-text">{comment.text}</span>
          {mine && (
            <IconButton actionId={`comment.delete.${comment.id}`} iconId="delete" iconSize={12}
              label="删除评论" density="compact" emphasis="quiet"
              className="sk-comment-delete" onActivate={() => onRequestDelete(comment)} />
          )}
        </span>
        <time>{comment.at}</time>
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
  onDeleteComment: (postId: string, commentId: string) => void;
  onDeletePost: (postId: string) => void;
}

export function MomentCard({ post, onAuthor, onReact, onUnreact, onComment, onDeleteComment, onDeletePost }: MomentCardProps) {
  const [expanded, setExpanded] = useState(false);
  // Comments are visible by default; the bubble hides/shows the inline tile.
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
  const onEnter = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    event.preventDefault();
    submitComment();
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

      {commentsOpen && (
        <div className="sk-comments" data-comments-open="true">
          {post.comments.length > 0 && (
            <ul className="sk-comment-list">
              {visibleComments.map(comment => (
                <CommentItem key={comment.id} comment={comment} onAuthor={onAuthor}
                  onRequestDelete={setConfirmTarget} />
              ))}
            </ul>
          )}
          {needsFold && (
            <button type="button" className="sk-comment-fold" data-comments-folded={allComments ? 'false' : 'true'}
              onClick={() => setAllComments(value => !value)}>
              {allComments ? '收起评论' : `展开全部 ${post.comments.length} 条评论`}
            </button>
          )}
          <div className="sk-inline-composer">
            <TextArea framing="embedded" minimumRows={1} maximumRows={4}
              className="sk-composer-input" value={draft} aria-label="写评论"
              data-comment-value={draft} placeholder="写评论……"
              onValueChange={setDraft} onEnter={onEnter} />
            <IconButton iconId="send" iconSize={16} label="发送评论"
              actionId={`comment.send.${post.id}`} emphasis="primary"
              availability={draft.trim() ? { kind: 'enabled' } : { kind: 'disabled', reason: '请输入评论' }}
              onActivate={submitComment} />
          </div>
        </div>
      )}

      <ReactionBar post={post} commentsOpen={commentsOpen}
        onToggleComments={() => setCommentsOpen(value => !value)}
        onReact={onReact} onUnreact={onUnreact} />

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
