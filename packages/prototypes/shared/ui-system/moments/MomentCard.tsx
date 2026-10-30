/**
 * MomentCard — one social post in the north-star frame.
 *
 * Migrated anatomy of the desktop components/moments/MomentCard.tsx:
 * identity header (48px rounded-square avatar), source · reason · audience
 * trust line, body with long-text expansion, image grid + lightbox, comment
 * preview tile, and an action bar (16-kind reaction picker with summaries,
 * comment count, more menu). Every affordance has a real destination; the
 * card body itself opens detail just like the desktop surface.
 */
import { useState } from 'react';
import {
  Globe, Lock, MessageCircle, MoreHorizontal, Smile, UserCheck, Users, UsersRound,
} from 'lucide-react';
import { Avatar, Button, Dialog, IconButton, Menu, Popover, Toggle } from '@peers-touch/ui';
import {
  REACTION_CATALOG, REACTION_BY_KIND,
  type AudienceKind, type Moment, type ReactionKind, type TrustReason,
} from './moments-data';

const EXPAND_THRESHOLD = 320;

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

function ReactionBar({ post, onReact, onUnreact, onOpenComments }: {
  post: Moment;
  onReact: (id: string, kind: ReactionKind) => void;
  onUnreact: (id: string) => void;
  onOpenComments: () => void;
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
        aria-label={`${post.comments.length} 条评论`}
        onActivate={event => { event.stopPropagation(); onOpenComments(); }} />
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

export interface MomentCardProps {
  post: Moment;
  onOpen: (id: string) => void;
  onAuthor: (name: string) => void;
  onReact: (id: string, kind: ReactionKind) => void;
  onUnreact: (id: string) => void;
}

export function MomentCard({ post, onOpen, onAuthor, onReact, onUnreact }: MomentCardProps) {
  const [expanded, setExpanded] = useState(false);
  const longBody = post.text.length > EXPAND_THRESHOLD;
  const visibleBody = expanded || !longBody
    ? post.text
    : `${post.text.slice(0, EXPAND_THRESHOLD)}…`;
  const previewComments = post.comments.slice(0, 2);

  return (
    <article className="sk-post" data-post-id={post.id} data-acceptance-id="social-moment-card"
      onClick={() => onOpen(post.id)}>
      <header className="sk-post-head">
        <button type="button" className="sk-post-author"
          aria-label={`查看 ${post.author} 的主页`}
          onClick={event => { event.stopPropagation(); onAuthor(post.author); }}>
          <Avatar name={post.author} background={post.tone} size={48}
            style={{ borderRadius: 13 }} aria-hidden="true" />
          <span className="sk-post-idcol">
            <strong className="sk-post-name">{post.author}</strong>
            <span className="sk-post-time">{post.at}</span>
          </span>
        </button>
        <span className="sk-post-menu" onClick={event => event.stopPropagation()}>
          <Menu placement="bottom" label="动态操作"
            actions={[{ id: `moment.open.${post.id}`, label: '打开动态', onActivate: () => onOpen(post.id) }]}>
            <IconButton actionId={`moment.menu.${post.id}`} iconId="more-horizontal" iconSize={16}
              label="更多" emphasis="quiet" density="compact" />
          </Menu>
        </span>
      </header>

      <div className="sk-post-meta"><TrustMeta post={post} /></div>

      <div className="sk-post-body" onClick={event => event.stopPropagation()}>
        <p>{visibleBody}</p>
        {longBody && (
          <button type="button" className="sk-post-expand"
            onClick={() => setExpanded(value => !value)}>
            {expanded ? '收起' : '展开全文'}
          </button>
        )}
        {post.images && post.images.length > 0 && <ImageGrid images={post.images} />}
      </div>

      {(previewComments.length > 0 || post.comments.length > 0) && (
        <div className="sk-comments" onClick={event => event.stopPropagation()}>
          {previewComments.map(comment => (
            <p key={comment.id} className="sk-comment-row">
              <button type="button" className="sk-comment-author"
                onClick={() => onAuthor(comment.author)}>{comment.author}</button>
              <span> {comment.text}</span>
            </p>
          ))}
          <button type="button" className="sk-comment-all"
            onClick={() => onOpen(post.id)}>
            {post.comments.length > previewComments.length
              ? `查看全部 ${post.comments.length} 条`
              : '查看评论'}
          </button>
        </div>
      )}

      <div onClick={event => event.stopPropagation()}>
        <ReactionBar post={post} onReact={onReact} onUnreact={onUnreact}
          onOpenComments={() => onOpen(post.id)} />
      </div>
    </article>
  );
}
