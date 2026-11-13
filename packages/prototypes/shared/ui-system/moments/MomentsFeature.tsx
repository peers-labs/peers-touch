/**
 * MomentsFeature — the full social moments surface inside the north-star
 * frame. It migrates the visible anatomy of the desktop moments module
 * (MomentsApp: merged timeline / circles scope, scope-local search, in-stream
 * recent/hot sort, composer, profile) with peers-ui components and local
 * state only.
 */
import { useEffect, useRef, useState } from 'react';
import {
  Check, ChevronLeft, UserPlus,
} from 'lucide-react';
import {
  Avatar, Button, Dialog, Empty, FeedSortFloat, FilePicker, MomentAudiencePicker,
  MomentCircleCard, MomentCircleEditor, MomentComposerSurface, MomentScopeBar, StatGrid,
  TextArea, Toggle, UserProfileHeader, type FeedSort, type MomentCircleDraft,
  type MomentCircleEditorCopy, type MomentCirclePerson,
} from '@peers-touch/ui';
import { MomentCard } from './MomentCard';
import {
  CIRCLE_SEEDS, GROUP_SEEDS, IDENTITY_INK, MOMENT_SEEDS, PEOPLE_SEEDS, VIEWER,
  type AudienceKind, type AudienceGroup, type Circle, type Moment,
  type Person, type ReactionKind, type TrustReason,
} from './moments-data';
import './moments.css';

type MomentsTab = 'feed' | 'circles';
// Feed order is an explicit user view (default: time). `hot` only applies when
// the reader chooses it — the platform never defaults to engagement ranking.
// Comment ordering is separate and time-only (communicative equality).

// Feed/profile stay in one surface; cards carry their own comments inline.
type MomentsNav =
  | { kind: 'tab' }
  | { kind: 'profile'; name: string; from: MomentsTab };

const TAB_OPTIONS: { value: MomentsTab; label: string }[] = [
  { value: 'feed', label: '动态' },
  { value: 'circles', label: '圈友' },
];

// Information-locality rule: the single sub-bar search filters whichever
// scope is active — the merged timeline (home + federated public) or my
// audience circles. One short shared placeholder keeps the search chrome
// geometrically identical across tabs (same glyph, same content width).
const TAB_SEARCH_PLACEHOLDER = '搜索动态与圈友';

// Proto-parity audience list (post.proto Audience.Kind), broad → explicit →
// self, same order as desktop AudiencePicker.
const AUDIENCE_OPTIONS: { value: AudienceKind; label: string }[] = [
  { value: 'public', label: '公开 · 联邦可见' },
  { value: 'followers', label: '关注者' },
  { value: 'friends', label: '朋友（互相关注）' },
  { value: 'circle', label: '圈子（我的受众分组）' },
  { value: 'group', label: '群聊成员' },
  { value: 'allow', label: '部分可见（白名单）' },
  { value: 'deny', label: '不给谁看（黑名单）' },
  { value: 'self', label: '仅自己' },
];

const MAX_IMAGES = 9;
const PAGE_SIZE = 3;

export interface ComposerDraft {
  text: string;
  images: string[];
  audience: AudienceKind;
  circle?: string;
  group?: string;
  actorIds: string[];
}

// Local, network-free image attach: read picked files as data URLs so the new
// post renders a real preview without any station / OSS round-trip.
function readImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function ComposeDialog({ open, circles, people, groups, onDismiss, onPublish }: {
  open: boolean;
  circles: Circle[];
  people: Person[];
  groups: AudienceGroup[];
  onDismiss: () => void;
  onPublish: (draft: ComposerDraft) => void;
}) {
  const [text, setText] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [audience, setAudience] = useState<AudienceKind>('public');
  // Stay bound to a surviving target; reset when the audience kind changes.
  const [circleId, setCircleId] = useState(circles[0]?.id ?? '');
  const [groupId, setGroupId] = useState(groups[0]?.id ?? '');
  const [actorIds, setActorIds] = useState<string[]>([]);

  const trimmed = text.trim();
  const circle = circles.find(entry => entry.id === circleId) ?? circles[0];
  const group = groups.find(entry => entry.id === groupId) ?? groups[0];
  const circleMissing = audience === 'circle' && circles.length === 0;
  const groupMissing = audience === 'group' && groups.length === 0;
  const actorsMissing = (audience === 'allow' || audience === 'deny') && actorIds.length === 0;

  const reset = () => {
    setText(''); setImages([]); setAudience('public'); setActorIds([]);
  };

  const publish = () => {
    if (!trimmed || circleMissing || groupMissing || actorsMissing) return;
    onPublish({
      text: trimmed, images, audience, actorIds,
      circle: audience === 'circle' ? circle?.name : undefined,
      group: audience === 'group' ? group?.name : undefined,
    });
    reset();
  };

  const pickFilesFileList = async (files: readonly File[]) => {
    const room = MAX_IMAGES - images.length;
    const picked = (await Promise.all(files.slice(0, room).map(readImage)));
    setImages(current => [...current, ...picked].slice(0, MAX_IMAGES));
  };

  const toggleActor = (id: string) => setActorIds(list =>
    list.includes(id) ? list.filter(entry => entry !== id) : [...list, id]);

  const disabledReason = !trimmed
    ? '请输入动态内容'
    : circleMissing
      ? '还没有圈子，先去圈友新建分组'
      : groupMissing
        ? '还没有可发布的群聊'
        : actorsMissing
          ? audience === 'allow' ? '白名单至少选择一位' : '黑名单至少选择一位'
          : undefined;

  return (
    <Dialog open={open} onDismiss={onDismiss} title="发动态" width={480}
      description="新动态会插入首页最前面（本地示例）" closeLabel="关闭"
      footer={
        <>
          <Button actionId="compose.cancel" emphasis="quiet" label="取消" onActivate={onDismiss} />
          <Button actionId="compose.publish" emphasis="primary" label="发布"
            availability={disabledReason ? { kind: 'disabled', reason: disabledReason } : { kind: 'enabled' }}
            onActivate={publish} />
        </>
      }>
      <MomentComposerSurface
        editor={<TextArea framing="embedded" minimumRows={4} maximumRows={8}
          className="sk-compose-input" value={text} aria-label="动态内容"
          data-compose-value={text} placeholder="分享你身边正在发生的连接……"
          onValueChange={setText} onEnter={event => event.preventDefault()} />}
        images={images.map((src, index) => ({ id: String(index), src, alt: `待发布图片 ${index + 1}` }))}
        onRemoveImage={id => setImages(list => list.filter((_, index) => index !== Number(id)))}
        copy={{ removeImage: '移除图片', retryImage: '重试图片' }}
        toolbar={<FilePicker
            iconId="image-plus"
            label={images.length > 0 ? `图片 ${images.length}/${MAX_IMAGES}` : '添加图片'}
            accept="image/*" multiple disabled={images.length >= MAX_IMAGES}
            onFiles={pickFilesFileList} />}
        audience={<MomentAudiencePicker value={audience} options={AUDIENCE_OPTIONS}
          onChange={value => setAudience(value as AudienceKind)}
          target={audience === 'circle' ? {
            label: '圈子', value: circle?.id,
            options: circles.map(entry => ({ value: entry.id, label: entry.name })),
            missing: '还没有圈子，先去「圈友」新建分组', onChange: setCircleId,
          } : audience === 'group' ? {
            label: '群聊', value: group?.id,
            options: groups.map(entry => ({ value: entry.id, label: entry.name })),
            missing: '还没有可发布的群聊', onChange: setGroupId,
          } : undefined}
          people={people.map(person => ({ id: person.id, label: person.name,
            avatar: <Avatar name={person.name} background={person.tone} size={24}
              style={{ borderRadius: 7 }} aria-hidden="true" /> }))}
          actorIds={actorIds}
          onToggleActor={audience === 'allow' || audience === 'deny' ? toggleActor : undefined}
          copy={{ audience: '可见范围', people: audience === 'allow' ? '仅这些人可见' : '关注者中排除这些人',
            noPeople: '还没有可选择的人' }} />}
        footer={null} />
    </Dialog>
  );
}

export interface MyMomentsStats {
  posts: number;
  comments: number;
  reactionsGiven: number;
  commentsReceived: number;
  reactionsReceived: number;
  following: number;
  followers: number;
  circles: number;
}

function statisticsFor(stats: MyMomentsStats) {
  return [
    { id: 'posts', label: '动态', value: stats.posts },
    { id: 'comments', label: '发出评论', value: stats.comments },
    { id: 'reactionsGiven', label: '送出反应', value: stats.reactionsGiven },
    { id: 'commentsReceived', label: '收到评论', value: stats.commentsReceived },
    { id: 'reactionsReceived', label: '收到反应', value: stats.reactionsReceived },
    { id: 'following', label: '关注', value: stats.following },
    { id: 'followers', label: '粉丝', value: stats.followers },
    { id: 'circles', label: '圈子', value: stats.circles },
  ];
}

function ProfileView({ name, people, postCount, onBack,
  followed, blocked, followers, following, stats, onToggleFollow, onToggleBlock }: {
  name: string;
  people: Person[];
  postCount: number;
  followed: boolean;
  blocked: boolean;
  followers: number;
  following: number;
  stats: MyMomentsStats | null;
  onToggleFollow: (id: string) => void;
  onToggleBlock: (id: string) => void;
  onBack: () => void;
}) {
  const person = people.find(entry => entry.name === name);
  const tone = person?.tone ?? '#5d6b62';
  const station = person?.station ?? '本站';
  const bio = person?.bio ?? '';
  const isSelf = name === VIEWER.name;
  return (
    <div className="sk-profile-view">
      <Button actionId="profile.back" emphasis="quiet" leading={<ChevronLeft size={15} />}
        label="返回" onActivate={onBack} className="sk-detail-back" />
      <UserProfileHeader name={name} tone={tone} station={station} bio={bio} isSelf={isSelf}
        statistics={[{ id: 'posts', label: '动态', value: postCount },
          { id: 'followers', label: '粉丝', value: followers },
          ...(!isSelf ? [{ id: 'following', label: '关注', value: following }] : [])]}
        actions={person && !isSelf ? <>
            <Toggle actionId={`profile.follow.${person.id}`} className="sk-profile-follow"
              emphasis={followed ? 'secondary' : 'primary'}
              selected={followed}
              leading={followed ? <Check size={14} /> : <UserPlus size={14} />}
              label={followed ? '已关注' : '关注'}
              onSelectedChange={() => onToggleFollow(person.id)} />
            <Button actionId={`profile.block.${person.id}`} emphasis="quiet" tone="danger"
              density="compact"
              data-profile-block={blocked ? 'on' : 'off'}
              label={blocked ? '取消拉黑' : '拉黑'}
              onActivate={() => onToggleBlock(person.id)} />
          </> : undefined} />
      {isSelf && stats && <StatGrid statistics={statisticsFor(stats)} />}
    </div>
  );
}

function CircleCreateDialog({ open, onDismiss, onCreate }: {
  open: boolean;
  onDismiss: () => void;
  onCreate: (name: string) => void;
}) {
  const [draft, setDraft] = useState<MomentCircleDraft>({ name: '', description: '', memberIds: [] });
  return open ? <MomentCircleEditor draft={draft} onChange={setDraft} people={[]}
    onDismiss={onDismiss} onSave={() => onCreate(draft.name.trim())}
    copy={{ ...CIRCLE_EDITOR_COPY, title: '新建圈子', save: '创建', namePlaceholder: '例如：夜跑小队',
      description: '圈子创建后会出现在列表里（本地示例）' }} /> : null;
}

const CIRCLE_EDITOR_COPY: MomentCircleEditorCopy = {
  title: '管理圈子', description: '圈子是你的发布受众分组，成员不会收到通知（本地示例）',
  close: '关闭', cancel: '取消', save: '保存', name: '圈子名称', namePlaceholder: '圈子名称',
  descriptionLabel: '圈子描述', descriptionPlaceholder: '描述（可选）', nameRequired: '请输入圈子名称',
  members: count => `成员 · ${count}`, candidates: '添加已知人', noCandidates: '已知人都已在分组里',
  self: '我', add: name => `添加 ${name}`, remove: name => `移除 ${name}`, delete: '删除分组',
};

function circlePerson(person: Circle['members'][number]): MomentCirclePerson {
  return { id: person.id, name: person.name, self: person.id === 'viewer',
    avatar: <Avatar name={person.name} background={person.tone} size={30}
      style={{ borderRadius: 8 }} aria-hidden="true" /> };
}
// Circles are the publisher's own audience lists (protocol Circle: a named,
// owner-private PTID list — not a bidirectional group, so there is no "leave";
// group leave/dissolve belongs to chat.Group). Each card opens its management
// dialog: rename/describe, add/remove members, delete.
function CirclesView({ circles, onOpenManage, emptyLabel }: {
  circles: Circle[];
  onOpenManage: (id: string) => void;
  emptyLabel: string;
}) {
  if (circles.length === 0) {
    return (
      <div className="sk-circles">
        <Empty description={emptyLabel} />
      </div>
    );
  }
  return (
    <div className="sk-circles">
      <ul className="sk-circle-list">
        {circles.map(circle => (
          <li key={circle.id}>
            <MomentCircleCard id={circle.id} name={circle.name} description={circle.desc}
              members={circle.members.map(member => ({ ...circlePerson(member),
                avatar: <Avatar name={member.name} background={member.tone} size={28}
                  style={{ borderRadius: 8 }} /> }))}
              copy={{ manage: `管理 ${circle.name}`, members: `${circle.members.length} 位成员` }}
              onOpen={() => onOpenManage(circle.id)} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function CircleManageDialog({ circle, people, onDismiss, onSave, onRequestDelete }: {
  circle: Circle;
  people: Person[];
  onDismiss: () => void;
  onSave: (id: string, draft: MomentCircleDraft) => void;
  onRequestDelete: (circle: Circle) => void;
}) {
  const [draft, setDraft] = useState<MomentCircleDraft>({
    name: circle.name,
    description: circle.desc === '新建圈子' ? '' : circle.desc,
    memberIds: circle.members.map(member => member.id),
  });
  const members = circle.members.map(circlePerson);
  const candidates = people.filter(person => !members.some(member => member.id === person.id))
    .map(person => ({ ...circlePerson(person), detail: `${person.station} · ${person.bio}` }));
  return <MomentCircleEditor id={circle.id} draft={draft} onChange={setDraft}
    people={[...members, ...candidates]} copy={CIRCLE_EDITOR_COPY} onDismiss={onDismiss}
    onSave={() => onSave(circle.id, { ...draft, name: draft.name.trim() })}
    onDelete={() => onRequestDelete(circle)} />;
}

export type MomentsNavigationRequest =
  | { nonce: number; kind: 'profile'; name: string };

export function MomentsFeature({ navigation }: { navigation?: MomentsNavigationRequest | null }) {
  const feedScrollRef = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<MomentsTab>('feed');
  const [nav, setNav] = useState<MomentsNav>({ kind: 'tab' });
  const [posts, setPosts] = useState<Moment[]>(MOMENT_SEEDS);
  const [people, setPeople] = useState<Person[]>(PEOPLE_SEEDS);
  const [circles, setCircles] = useState<Circle[]>(CIRCLE_SEEDS);
  // GROUP audience targets are static local group conversations (read-only).
  const groups = GROUP_SEEDS;
  const [feedSort, setFeedSort] = useState<FeedSort>('recent');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [composerOpen, setComposerOpen] = useState(false);
  const [circleComposerOpen, setCircleComposerOpen] = useState(false);
  const [circleManageId, setCircleManageId] = useState<string | null>(null);
  const [circleDeleteTarget, setCircleDeleteTarget] = useState<Circle | null>(null);
  // Scope-local search: one query whose domain follows the active tab.
  // Switching scope clears it so a term can never silently filter the wrong
  // domain.
  const [query, setQuery] = useState('');

  // BLOCK policy: a blocked actor leaves every timeline (home + federated).
  const blockedNames = new Set(people.filter(person => person.blocked).map(person => person.name));
  const homePosts = posts.filter(post => !post.federated && !blockedNames.has(post.author));
  const federatedPosts = posts.filter(post => post.federated && !blockedNames.has(post.author));
  // One merged stream: home first, then federated public. RECENT (the
  // default) keeps the deterministic time order (created_at DESC); HOT is an
  // explicit reader view ranking by total reactions — never the default.
  const reactionTotal = (post: Moment) =>
    Object.values(post.reactions).reduce((sum, count) => sum + (count ?? 0), 0);
  const recentTimeline = [...homePosts, ...federatedPosts];
  const timeline = feedSort === 'hot'
    ? [...recentTimeline].sort((a, b) => reactionTotal(b) - reactionTotal(a))
    : recentTimeline;

  const switchTab = (next: MomentsTab) => {
    setTab(next);
    setNav({ kind: 'tab' });
    setVisibleCount(PAGE_SIZE);
    setQuery('');
  };

  const q = query.trim().toLowerCase();
  const postMatches = (post: Moment) => !q
    || post.author.toLowerCase().includes(q)
    || post.text.toLowerCase().includes(q)
    || (post.station ?? '').toLowerCase().includes(q);
  const circleMatches = (circle: Circle) => !q
    || circle.name.toLowerCase().includes(q)
    || circle.desc.toLowerCase().includes(q)
    || circle.members.some(member => member.name.toLowerCase().includes(q));
  const searchedTimeline = q ? timeline.filter(postMatches) : null;
  const searchedCircles = q ? circles.filter(circleMatches) : circles;

  const openProfile = (name: string) => setNav({ kind: 'profile', name, from: tab });
  // Cross-surface request (e.g. identity card opened from chat): switch to
  // the moments surface tab state and open the person's profile.
  const navNonce = navigation?.nonce;
  useEffect(() => {
    if (!navigation || navNonce === undefined) return;
    if (navigation.kind === 'profile') openProfile(navigation.name);
    // openProfile is stable enough for this cross-surface effect; only the
    // request nonce re-triggers it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navNonce]);
  const backToTab = () => {
    if (nav.kind === 'tab') return;
    setTab(nav.from);
    setNav({ kind: 'tab' });
  };

  // Reactions are multi-select. A kind the viewer already has is unchecked
  // (count decremented); a new kind is added (count incremented). Other
  // chosen kinds stay visible and counted.
  const toggleReaction = (id: string, kind: ReactionKind) => {
    setPosts(list => list.map(post => {
      if (post.id !== id) return post;
      const chosen = new Set(post.viewerReactions ?? []);
      const reactions = { ...post.reactions };
      if (chosen.has(kind)) {
        chosen.delete(kind);
        const current = reactions[kind] ?? 0;
        if (current <= 1) delete reactions[kind];
        else reactions[kind] = current - 1;
      } else {
        chosen.add(kind);
        reactions[kind] = (reactions[kind] ?? 0) + 1;
      }
      const viewerReactions = [...chosen];
      return { ...post, reactions, viewerReactions: viewerReactions.length ? viewerReactions : undefined };
    }));
  };

  const addComment = (id: string, text: string) => {
    setPosts(list => list.map(post => post.id === id
      ? {
          ...post,
          comments: [...post.comments, {
            id: `local-${Date.now()}`, author: VIEWER.name, tone: VIEWER.tone, text, at: '刚刚',
          }],
        }
      : post));
  };

  const deleteComment = (postId: string, commentId: string) => {
    const removeRecursive = (comments: Moment['comments']): Moment['comments'] =>
      comments
        .filter(comment => comment.id !== commentId)
        .map(comment => comment.replies?.length
          ? { ...comment, replies: removeRecursive(comment.replies) }
          : comment);
    setPosts(list => list.map(post => post.id === postId
      ? { ...post, comments: removeRecursive(post.comments) }
      : post));
  };

  const likeComment = (postId: string, commentId: string) => {
    const toggleIn = (comments: Moment['comments']): Moment['comments'] =>
      comments.map(comment => {
        const liked = (comment.likes ?? []).includes(VIEWER.name);
        const likes = comment.id === commentId
          ? (liked
              ? comment.likes!.filter(name => name !== VIEWER.name)
              : [...(comment.likes ?? []), VIEWER.name])
          : comment.likes;
        return comment.replies?.length ? { ...comment, likes, replies: toggleIn(comment.replies) } : { ...comment, likes };
      });
    setPosts(list => list.map(post => post.id === postId ? { ...post, comments: toggleIn(post.comments) } : post));
  };

  const replyComment = (postId: string, rootId: string, text: string) => {
    const reply: Moment['comments'][number] = {
      id: `local-${Date.now()}`, author: VIEWER.name, tone: VIEWER.tone, text, at: '刚刚',
    };
    const appendIn = (comments: Moment['comments']): Moment['comments'] =>
      comments.map(comment => comment.id === rootId
        ? { ...comment, replies: [...(comment.replies ?? []), reply] }
        : comment.replies?.length ? { ...comment, replies: appendIn(comment.replies) } : comment);
    setPosts(list => list.map(post => post.id === postId ? { ...post, comments: appendIn(post.comments) } : post));
  };

  const deletePost = (postId: string) => {
    setPosts(list => list.filter(post => post.id !== postId));
  };

  const editPost = (postId: string, text: string) => {
    setPosts(list => list.map(post => post.id === postId ? { ...post, text } : post));
  };

  const votePoll = (postId: string, choices: number[]) => {
    setPosts(list => list.map(post => post.id === postId && post.poll
      ? { ...post, poll: { ...post.poll, choices: [...choices] } }
      : post));
  };

  const publish = (draft: ComposerDraft) => {
    const reason: TrustReason = draft.audience === 'self'
      ? 'self'
      : draft.audience === 'circle'
        ? 'circle'
        : draft.audience === 'public'
          ? 'public'
          : 'following';
    const post: Moment = {
      id: `local-${Date.now()}`,
      author: VIEWER.name, tone: VIEWER.tone, source: 'local', reason,
      audience: draft.audience,
      circle: draft.circle,
      group: draft.group,
      audienceActors: draft.actorIds.length
        ? draft.actorIds.map(id => people.find(p => p.id === id)?.name ?? id)
        : undefined,
      at: '刚刚',
      text: draft.text,
      images: draft.images.length ? draft.images : undefined,
      reactions: {}, comments: [],
    };
    setPosts(list => [post, ...list]);
    setComposerOpen(false);
    // switchTab resets paging; raise the page after it so the new head post
    // is visible (same-batch setters, last write wins).
    switchTab('feed');
    setVisibleCount(PAGE_SIZE + 1);
  };

  const toggleFollow = (id: string) => {
    setPeople(list => list.map(person => person.id === id
      ? { ...person, followed: !person.followed }
      : person));
  };

  // Block/unblock an actor. The timeline projection above removes their
  // posts immediately; the relationship is local prototype state.
  const toggleBlock = (id: string) => {
    setPeople(list => list.map(person => person.id === id
      ? { ...person, blocked: !person.blocked, followed: person.blocked ? person.followed : false }
      : person));
  };

  // Viewer dashboard counters (proto GetMyMomentsStats), aggregated live
  // from local state.
  const countAllComments = (comments: Moment['comments']): number =>
    comments.reduce((sum, comment) => sum + 1 + countAllComments(comment.replies ?? []), 0);
  const myStats: MyMomentsStats = (() => {
    const mine = posts.filter(post => post.author === VIEWER.name);
    const myComments = posts.reduce((sum, post) =>
      sum + post.comments.reduce((n, c) =>
        n + (c.author === VIEWER.name ? 1 : 0)
        + (c.replies ?? []).filter(r => r.author === VIEWER.name).length
      , 0), 0);
    const reactionsGiven = posts.reduce((sum, post) => sum + (post.viewerReactions?.length ?? 0), 0);
    const reactionsReceived = mine.reduce((sum, post) => sum + reactionTotal(post), 0);
    return {
      posts: mine.length,
      comments: myComments,
      reactionsGiven,
      commentsReceived: mine.reduce((sum, post) => sum + countAllComments(post.comments), 0),
      reactionsReceived,
      following: people.filter(person => person.followed).length,
      followers: people.filter(person => person.mutual).length + 128,
      circles: circles.length,
    };
  })();

  const createCircle = (name: string) => {
    setCircles(list => [...list, {
      id: `local-${Date.now()}`, name, desc: '',
      members: [{ id: 'viewer', name: VIEWER.name, tone: VIEWER.tone }],
    }]);
  };

  // Circle lifecycle: circles are the publisher's own audience lists, so the
  // closure is rename/describe + member add/remove + delete (no "leave").
  const saveCircle = (id: string, draft: MomentCircleDraft) => {
    setCircles(list => list.map(circle => {
      if (circle.id !== id) return circle;
      const memberById = (memberId: string) => {
        const existing = circle.members.find(member => member.id === memberId);
        if (existing) return existing;
        const person = people.find(p => p.id === memberId);
        return person
          ? { id: person.id, name: person.name, tone: person.tone }
          : { id: memberId, name: memberId, tone: IDENTITY_INK };
      };
      return {
        ...circle,
        name: draft.name,
        desc: draft.description.trim(),
        members: draft.memberIds.map(memberById),
      };
    }));
    setCircleManageId(null);
  };

  const deleteCircle = (id: string) => {
    setCircles(list => list.filter(circle => circle.id !== id));
    setCircleDeleteTarget(null);
    setCircleManageId(null);
  };

  const sharedCardProps = {
    onAuthor: openProfile,
    resolvePerson: (name: string) => people.find(person => person.name === name),
    onToggleFollow: toggleFollow,
    onToggleBlock: toggleBlock,
    onToggleReaction: toggleReaction,
    onComment: addComment,
    onLikeComment: likeComment,
    onReplyComment: replyComment,
    onDeleteComment: deleteComment,
    onDeletePost: deletePost,
    onEditPost: editPost,
    onVotePoll: votePoll,
  };

  const profileName = nav.kind === 'profile' ? nav.name : '';
  const profileIsSelf = profileName === VIEWER.name;
  // A block affects future lists/timelines (see blockedNames above), NOT the
  // profile the viewer is already looking at: content currently on screen
  // stays put. The actor simply won't appear in lists on later visits.
  const profilePosts = nav.kind === 'profile'
    ? posts.filter(post => post.author === nav.name)
    : [];
  const profilePerson = people.find(person => person.name === profileName);
  const profileFollowers = profileIsSelf
    ? myStats.followers
    : profilePerson?.followers ?? 0;

  return (
    <div className="sk-moments">
      {nav.kind === 'tab' ? (
        <>
          <MomentScopeBar value={tab} options={TAB_OPTIONS} onChange={switchTab}
            query={query} onQueryChange={setQuery}
            copy={{ scope: '动态范围', search: TAB_SEARCH_PLACEHOLDER, action: tab === 'feed' ? '发动态' : '新建圈子' }}
            actionId={tab === 'feed' ? 'moments.compose' : 'circle.open-create'}
            actionClassName={tab === 'feed' ? 'sk-compose-open' : 'sk-circle-open'}
            onAction={() => tab === 'feed' ? setComposerOpen(true) : setCircleComposerOpen(true)} />

          {tab === 'feed' && (
            <div className="sk-moments-scroll" ref={feedScrollRef}>
              {/* Global order view — a floating chip pinned to the scroll
                  viewport's top right. It owns no row (cards start at the top)
                  and its halo/shadow keeps it visually detached from the
                  first card it overlaps. It dissolves while scrolling and
                  softly returns at rest; hidden while searching. */}
              {!q && (
                <FeedSortFloat value={feedSort} onChange={setFeedSort} scrollRef={feedScrollRef}
                  copy={{ label: '动态排序', recent: '最新', hot: '热门', top: '回到最顶' }} />
              )}
              {(searchedTimeline ?? timeline.slice(0, visibleCount)).map(post => (
                <MomentCard key={post.id} post={post} {...sharedCardProps} />
              ))}
              {q && searchedTimeline && searchedTimeline.length === 0 && (
                <Empty description={`没有匹配「${query.trim()}」的动态`} />
              )}
              {!q && (visibleCount < timeline.length
                ? (
                  <Button actionId="moments.load-more" emphasis="quiet" fullWidth
                    className="sk-loadmore" label="加载更多"
                    onActivate={() => setVisibleCount(count => count + PAGE_SIZE)} />
                )
                : <span className="sk-feed-end">没有更多了</span>)}
            </div>
          )}

          {tab === 'circles' && (
            <CirclesView circles={searchedCircles} onOpenManage={setCircleManageId}
              emptyLabel={q
                ? `没有匹配「${query.trim()}」的圈子`
                : '还没有受众分组，点右上角「新建圈子」创建'} />
          )}
        </>
      ) : nav.kind === 'profile' ? (
        <div className="sk-moments-scroll">
          <ProfileView name={profileName} people={people} postCount={profilePosts.length}
            followed={profilePerson?.followed ?? false}
            blocked={profilePerson?.blocked ?? false}
            followers={profileFollowers}
            following={people.filter(person => person.followed).length}
            stats={profileIsSelf ? myStats : null}
            onToggleFollow={toggleFollow} onToggleBlock={toggleBlock} onBack={backToTab} />
          {profilePerson?.blocked && (
            <p className="sk-profile-blocked-note" data-profile-blocked-note>
              已拉黑 {profileName}：其动态不会再出现在你的时间线与列表中；当前主页内容保留显示，离开后按黑名单生效。
            </p>
          )}
          <div className="sk-profile-posts">
            {profilePosts.map(post => (
              <MomentCard key={post.id} post={post} {...sharedCardProps} />
            ))}
            {profilePosts.length === 0 && (
              <Empty description={`${profileName} 还没有公开动态`} />
            )}
          </div>
        </div>
      ) : null}

      <ComposeDialog open={composerOpen} circles={circles} people={people} groups={groups}
        onDismiss={() => setComposerOpen(false)} onPublish={publish} />
      <CircleCreateDialog key={circleComposerOpen ? 'open' : 'closed'} open={circleComposerOpen}
        onDismiss={() => setCircleComposerOpen(false)}
        onCreate={name => { createCircle(name); setCircleComposerOpen(false); }} />
      {circleManageId && circles.find(c => c.id === circleManageId) && (
        <CircleManageDialog
          key={circleManageId}
          circle={circles.find(c => c.id === circleManageId)!}
          people={people}
          onDismiss={() => setCircleManageId(null)}
          onSave={saveCircle}
          onRequestDelete={circle => { setCircleManageId(null); setCircleDeleteTarget(circle); }} />
      )}
      <Dialog open={circleDeleteTarget !== null} onDismiss={() => setCircleDeleteTarget(null)}
        title={circleDeleteTarget ? `删除分组「${circleDeleteTarget.name}」？` : '删除分组？'} width={380}
        closeLabel="取消" description="仅删除本地原型中的受众分组，不影响已发布动态的可见范围。"
        footer={
          <>
            <Button actionId="circle.delete-cancel" emphasis="quiet" label="取消"
              onActivate={() => setCircleDeleteTarget(null)} />
            <Button actionId="circle.delete-ok" emphasis="primary" tone="danger" label="删除"
              onActivate={() => circleDeleteTarget && deleteCircle(circleDeleteTarget.id)} />
          </>
        }>
        <span data-circle-delete-target={circleDeleteTarget?.id} />
      </Dialog>
    </div>
  );
}
