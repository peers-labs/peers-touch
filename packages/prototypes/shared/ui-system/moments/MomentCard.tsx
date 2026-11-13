/**
 * MomentCard — one social post in the north-star frame.
 *
 * The card is the whole surface: no separate detail page. Comments live
 * inline (shown by default, newest-first by time with cursor pagination —
 * communicative equality: likes are expression, never a ranking signal),
 * and every comment is itself interactive — like and reply, with one level of nested
 * replies rendered in a tinted reply block (a reply to a reply attaches
 * to the root). Delete exists solely on the viewer's own content.
 */
import { useState } from 'react';
import {
  Globe, Lock, MessagesSquare, Pencil, Trash2, UserCheck,
  UserRoundX, Users, UsersRound,
} from 'lucide-react';
import {
  Avatar, Button, Dialog, IconButton, ImageGrid, MomentAuthor, MomentCard as PeerMomentCard,
  MomentCommentRow, MomentCommentComposer, MomentReactionBar, MomentTrustMeta, MomentPoll, TextArea, TextField,
} from '@peers-touch/ui';
import { AuthorTrigger } from './AuthorCard';
import {
  REACTION_CATALOG, VIEWER_NAME, reactionLabel,
  type AudienceKind, type Moment, type MomentComment, type Person, type ReactionKind, type TrustReason,
} from './moments-data';

/** Identity-card wiring shared by post heads and every comment row. */
interface AuthorTriggerProps {
  resolvePerson: (name: string) => Person | undefined;
  onToggleFollow: (id: string) => void;
  onToggleBlock: (id: string) => void;
}

/** Top-level comments per page (proto GetComments cursor pagination). */
const COMMENT_PAGE = 5;

const AUDIENCE_LABEL: Record<AudienceKind, string> = {
  public: '公开',
  followers: '关注者',
  friends: '朋友',
  circle: '圈子',
  group: '群聊',
  allow: '部分可见',
  deny: '不给谁看',
  self: '仅自己',
};

const REASON_LABEL: Record<TrustReason, string> = {
  self: '自己',
  following: '关注的人',
  mutual: '互相关注',
  circle: '同圈',
  public: '联邦公开',
};

function audienceLabel(post: Moment): string {
  const { audience, circle, group } = post;
  if (audience === 'circle' && circle) return `圈子 · ${circle}`;
  if (audience === 'group' && group) return `群聊 · ${group}`;
  return AUDIENCE_LABEL[audience];
}

function TrustIcon({ audience }: { audience: AudienceKind }) {
  const size = 11;
  if (audience === 'followers') return <UserCheck size={size} />;
  if (audience === 'friends') return <Users size={size} />;
  if (audience === 'circle') return <UsersRound size={size} />;
  if (audience === 'group') return <MessagesSquare size={size} />;
  if (audience === 'deny') return <UserRoundX size={size} />;
  if (audience === 'allow') return <Users size={size} />;
  if (audience === 'self') return <Lock size={size} />;
  return <Globe size={size} />;
}

function TrustMeta({ post }: { post: Moment }) {
  const segments = [
    post.source === 'remote' && post.station ? `来自 ${post.station}` : '本站',
    post.reason === 'public' ? null : REASON_LABEL[post.reason],
    audienceLabel(post),
  ].filter((segment): segment is string => Boolean(segment));
  return (
    <MomentTrustMeta segments={segments.map((label, index) => ({
      id: String(index), label,
      icon: index === segments.length - 1 ? <TrustIcon audience={post.audience} /> : undefined,
    }))} />
  );
}

function ReactionBar({ post, commentsOpen, onToggleComments, onToggleReaction }: {
  post: Moment;
  commentsOpen: boolean;
  onToggleComments: () => void;
  onToggleReaction: (id: string, kind: ReactionKind) => void;
}) {
  const countComments = (comments: Moment['comments']): number =>
    comments.reduce((sum, c) => sum + 1 + countComments(c.replies ?? []), 0);
  const commentCount = countComments(post.comments);
  return <MomentReactionBar postId={post.id} commentCount={commentCount} commentsOpen={commentsOpen}
    reactions={REACTION_CATALOG.map(meta => ({
      kind: meta.kind, emoji: meta.emoji, label: reactionLabel(meta.kind),
      selected: (post.viewerReactions ?? []).includes(meta.kind), count: post.reactions[meta.kind] ?? 0,
    }))} copy={{
      picker: '选择反应', add: '添加反应', comments: count => `${count} 条评论`, selected: '，点击取消',
    }} onToggleComments={onToggleComments}
    onToggleReaction={kind => onToggleReaction(post.id, kind as ReactionKind)} />;
}

interface CommentItemProps extends AuthorTriggerProps {
  comment: MomentComment;
  depth?: number;
  rootId: string;
  postId: string;
  /** Opens the full profile; reached from the author card, not the chip. */
  onAuthor: (name: string) => void;
  onLikeComment: (postId: string, commentId: string) => void;
  onReplyComment: (postId: string, rootId: string, text: string) => void;
  onRequestDelete: (comment: MomentComment) => void;
}

function CommentItem({ comment, depth = 0, rootId, postId, onAuthor, resolvePerson,
  onToggleFollow, onToggleBlock, onLikeComment, onReplyComment, onRequestDelete }: CommentItemProps) {
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
    <MomentCommentRow commentId={comment.id} own={mine} depth={depth} content={comment.text}
      reaction={{ count: likeCount, liked, label: likeCount > 0 ? `赞 ${likeCount}` : '赞',
        onActivate: () => onLikeComment(postId, comment.id) }}
      time={<time>{comment.at}</time>} avatar={
      <AuthorTrigger name={comment.author} person={resolvePerson(comment.author)}
        onOpenProfile={onAuthor} onToggleFollow={onToggleFollow} onToggleBlock={onToggleBlock}>
        <Button actionId={`comment.author-card-avatar.${comment.id}`} emphasis="quiet"
          density="compact" className="sk-comment-avatar"
          aria-label={`查看 ${comment.author} 的名片`}>
          <Avatar name={comment.author} background={comment.tone} size={30}
            style={{ borderRadius: 9 }} aria-hidden="true" />
        </Button>
      </AuthorTrigger>} author={
          <AuthorTrigger name={comment.author} person={resolvePerson(comment.author)}
            onOpenProfile={onAuthor} onToggleFollow={onToggleFollow} onToggleBlock={onToggleBlock}>
            <button type="button" className="sk-comment-author"
              aria-label={`查看 ${comment.author} 的名片`}>{comment.author}</button>
          </AuthorTrigger>} actions={<>
          <Button actionId={`comment.reply.${comment.id}`} emphasis="quiet" density="compact"
            className="sk-comment-action" data-comment-reply label="回复"
            onActivate={() => setReplying(value => !value)} />
          {mine && (
            <Button actionId={`comment.delete.${comment.id}`} emphasis="quiet" density="compact"
              className="sk-comment-action is-danger" data-comment-delete label="删除"
              tone="danger" onActivate={() => onRequestDelete(comment)} />
          )}
        </>} replies={replies.length > 0 ? <>
            {replies.map(reply => (
              <CommentItem key={reply.id} comment={reply} depth={1} rootId={rootId} postId={postId}
                onAuthor={onAuthor} resolvePerson={resolvePerson}
                onToggleFollow={onToggleFollow} onToggleBlock={onToggleBlock}
                onLikeComment={onLikeComment}
                onReplyComment={onReplyComment} onRequestDelete={onRequestDelete} />
            ))}
          </> : undefined} composer={replying ? (
          <MomentCommentComposer className="sk-reply-composer" data-reply-to={comment.author}>
            <TextField aria-label={`回复 ${comment.author}`}
              placeholder={`回复 ${comment.author}……`} value={draft}
              data-reply-value={draft}
              onValueChange={setDraft}
              onEnter={event => { event.preventDefault(); submit(); }} autoFocus />
            <IconButton iconId="send" iconSize={14} label="发送回复"
              actionId={`reply.send.${comment.id}`} emphasis="primary" density="compact"
              availability={draft.trim() ? { kind: 'enabled' } : { kind: 'disabled', reason: '请输入回复' }}
              onActivate={submit} />
          </MomentCommentComposer>
        ) : undefined} />
  );
}

export interface MomentCardProps extends AuthorTriggerProps {
  post: Moment;
  /** Opens the full profile; reached from the author card, not the chip. */
  onAuthor: (name: string) => void;
  onToggleReaction: (id: string, kind: ReactionKind) => void;
  onComment: (id: string, text: string) => void;
  onLikeComment: (postId: string, commentId: string) => void;
  onReplyComment: (postId: string, rootCommentId: string, text: string) => void;
  onDeleteComment: (postId: string, commentId: string) => void;
  onDeletePost: (postId: string) => void;
  onEditPost: (postId: string, text: string) => void;
  onVotePoll: (postId: string, choices: number[]) => void;
}

export function MomentCard({ post, onAuthor, resolvePerson, onToggleFollow, onToggleBlock,
  onToggleReaction, onComment, onLikeComment,
  onReplyComment, onDeleteComment, onDeletePost, onEditPost, onVotePoll }: MomentCardProps) {
  const [commentsOpen, setCommentsOpen] = useState(true);
  const [commentPage, setCommentPage] = useState(1);
  const [draft, setDraft] = useState('');
  const [confirmTarget, setConfirmTarget] = useState<'post' | MomentComment | null>(null);
  const [editDraft, setEditDraft] = useState<string | null>(null);

  // Communicative equality: comments have one order — newest first by time.
  // Like counts are expression only and never reorder anyone's voice.
  const sortedComments = [...post.comments].reverse();
  const pagedComments = sortedComments.slice(0, commentPage * COMMENT_PAGE);
  const remainingComments = sortedComments.length - pagedComments.length;
  const ownPost = post.author === VIEWER_NAME;

  const submitComment = () => {
    const text = draft.trim();
    if (!text) return;
    onComment(post.id, text);
    setDraft('');
    setCommentsOpen(true);
    // A fresh comment is the newest one — the time order surfaces it on top.
    setCommentPage(1);
  };

  const runConfirm = () => {
    if (confirmTarget === 'post') onDeletePost(post.id);
    else if (confirmTarget) onDeleteComment(post.id, confirmTarget.id);
    setConfirmTarget(null);
  };

  return (
    <PeerMomentCard postId={post.id} text={post.text}
      copy={{ more: '更多', expand: '展开全文', collapse: '收起' }}
      author={
        <AuthorTrigger name={post.author} person={resolvePerson(post.author)}
          station={post.station}
          onOpenProfile={onAuthor} onToggleFollow={onToggleFollow} onToggleBlock={onToggleBlock}>
          <MomentAuthor name={post.author} time={post.at} label={`查看 ${post.author} 的名片`}
            avatar={<Avatar name={post.author} background={post.tone} size={48}
              style={{ borderRadius: 13 }} aria-hidden="true" />} />
        </AuthorTrigger>
      }
      menuActions={ownPost ? [
                ...(post.audience === 'public' ? [{
                  id: `moment.edit.${post.id}`, label: '编辑正文',
                  leading: <Pencil size={14} />,
                  onActivate: () => setEditDraft(post.text),
                }] : []), {
                id: `moment.delete.${post.id}`, label: '删除动态',
                leading: <Trash2 size={14} />, tone: 'danger',
                onActivate: () => setConfirmTarget('post'),
      }] : []}
      trust={<TrustMeta post={post} />}
      content={post.poll && <MomentPoll postId={post.id} question={post.poll.question}
        options={post.poll.options.map((text, index) => ({ text,
          votes: post.poll!.baseCounts[index] + Number(post.poll!.choices.includes(index)) }))}
        minChoices={post.poll.minChoices} maxChoices={post.poll.maxChoices}
        closed={post.poll.closed} confirmedChoices={post.poll.choices}
        totalVotes={post.poll.baseVoters + Number(post.poll.choices.length > 0)}
        onSubmit={choices => onVotePoll(post.id, choices)}
        copy={{ submit: '投票', replace: '更新选票', cancel: '取消选择', retry: '确认结果', closed: '投票已截止',
          choices: (min, max) => `请选择 ${min}–${max} 个选项`, total: count => `${count} 人已投票` }} />}
      attachments={post.images && post.images.length > 0 && <ImageGrid
          images={post.images.map((source, index) => ({
            resourceId: source, source, state: 'available', name: `图片 ${index + 1}`,
          }))}
          copy={{
            title: '图片', close: '关闭', previous: '上一张', next: '下一张',
            singleImage: '只有一张图片', openImage: (index, total) => `查看图片 ${index}/${total}`,
          }} />}
      actions={<ReactionBar post={post} commentsOpen={commentsOpen}
        onToggleComments={() => setCommentsOpen(value => !value)}
        onToggleReaction={onToggleReaction} />}
      commentsOpen={commentsOpen}
      comments={<>
          {post.comments.length > 0 && (
            <>
              <ul className="sk-comment-list">
                {pagedComments.map(comment => (
                  <CommentItem key={comment.id} comment={comment} rootId={comment.id} postId={post.id}
                    onAuthor={onAuthor} resolvePerson={resolvePerson}
                    onToggleFollow={onToggleFollow} onToggleBlock={onToggleBlock}
                    onLikeComment={onLikeComment}
                    onReplyComment={onReplyComment} onRequestDelete={setConfirmTarget} />
                ))}
              </ul>
              {remainingComments > 0 && (
                <button type="button" className="sk-comment-pager"
                  data-comment-remaining={remainingComments}
                  onClick={() => setCommentPage(page => page + 1)}>
                  {`查看更早 ${remainingComments} 条评论`}
                </button>
              )}
            </>
          )}
          <MomentCommentComposer data-card-composer>
            <TextField aria-label="写评论" placeholder="写评论……"
              value={draft} data-comment-value={draft}
              onValueChange={setDraft}
              onEnter={event => { event.preventDefault(); submitComment(); }} />
            <IconButton iconId="send" iconSize={15} label="发送评论"
              actionId={`comment.send.${post.id}`} emphasis="primary"
              availability={draft.trim() ? { kind: 'enabled' } : { kind: 'disabled', reason: '请输入评论' }}
              onActivate={submitComment} />
          </MomentCommentComposer>
      </>}
      dialogs={<>{editDraft !== null && (
        <Dialog open title="编辑动态" onDismiss={() => setEditDraft(null)} closeLabel="取消"
          description="仅修改公开正文，保留原动态、附件和受众。编辑后追加签名更新，已取得的副本可能保留旧版本。"
          footer={<>
            <Button actionId={`moment.edit.cancel.${post.id}`} label="取消" emphasis="quiet"
              onActivate={() => setEditDraft(null)} />
            <Button actionId={`moment.edit.save.${post.id}`} label="保存" emphasis="primary"
              data-acceptance-id="social-edit-save"
              availability={editDraft.trim() && editDraft !== post.text ? undefined
                : { kind: 'disabled', reason: '请修改正文后再保存' }}
              onActivate={() => { onEditPost(post.id, editDraft); setEditDraft(null); }} />
          </>}>
          <TextArea value={editDraft} onValueChange={setEditDraft} minimumRows={5}
            maximumRows={12} autoFocus aria-label="编辑动态"
            data-acceptance-id="social-edit-input" />
        </Dialog>
      )}

      <Dialog open={confirmTarget !== null} onDismiss={() => setConfirmTarget(null)}
        title={confirmTarget === 'post' ? '删除这条动态？' : '删除这条评论？'} width={380}
        closeLabel="取消"
        description={post.audience === 'public'
          ? '删除追加不可撤销的删除标记。已取得公开内容的设备仍可能保留副本。原型只模拟当前视图。'
          : '删除仅作用于本地原型视图。'}
        footer={
          <>
            <Button actionId="comment.delete-cancel" emphasis="quiet" label="取消"
              onActivate={() => setConfirmTarget(null)} />
            <Button actionId="comment.delete-ok" emphasis="primary" tone="danger" label="删除"
              onActivate={runConfirm} />
          </>
        }>
        <span data-delete-confirm={confirmTarget === 'post' ? 'post' : 'comment'} />
      </Dialog></>}
    />
  );
}
