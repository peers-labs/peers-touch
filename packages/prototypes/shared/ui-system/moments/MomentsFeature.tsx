/**
 * MomentsFeature — the full social moments surface inside the north-star
 * frame. It migrates the visible anatomy of the desktop moments module
 * (MomentsApp: merged timeline / circles scope, scope-local search, in-stream
 * recent/hot sort, composer, profile) with peers-ui components and local
 * state only.
 */
import { useEffect, useRef, useState } from 'react';
import {
  Check, ChevronLeft, ChevronRight, Search, UserPlus,
} from 'lucide-react';
import {
  Avatar, AvatarGroup, Button, Dialog, Empty, FilePicker, Icon, IconButton, Segmented, Select,
  TextArea, TextField, Toggle,
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
type FeedSort = 'recent' | 'hot';

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

/** Scroll distance (px) within which the stream counts as "at the top". */
const FEED_TOP_THRESHOLD = 4;

/**
 * Floating feed chip with two roles, decided by live scroll position:
 *  - at the very top: the 最新/热门 order Segmented (sorting can be chosen
 *    only while reading from the top — the platform never hides the order
 *    control mid-stream, it repurposes it);
 *  - scrolled down: the same capsule morphs into a "回顶" action; choosing it
 *    smooth-scrolls back to the top, where it morphs back into the sorter.
 * Both layers stay mounted in one fixed-footprint capsule and cross-fade
 * (never unmounted), so the role change reads as one continuous surface.
 */
function FeedSortFloat({ value, onChange }: {
  value: FeedSort;
  onChange: (value: FeedSort) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [atTop, setAtTop] = useState(true);

  useEffect(() => {
    const scroller = rootRef.current?.closest('.sk-moments-scroll');
    if (!scroller) return;
    let frame = 0;
    // Real-time scrollTop, rAF-coalesced: arriving at top by any means
    // (inertia, drag, the 回顶 action) restores the sorter without timers.
    const sync = () => {
      frame = 0;
      setAtTop(scroller.scrollTop <= FEED_TOP_THRESHOLD);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(sync);
    };
    sync();
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      scroller.removeEventListener('scroll', onScroll);
    };
  }, []);

  const scrollToTop = () => {
    rootRef.current
      ?.closest('.sk-moments-scroll')
      ?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="sk-feed-sort-float" data-feed-sort data-feed-mode={atTop ? 'sort' : 'top'}
      ref={rootRef}>
      <div className="sk-feed-sort-pill" data-mode={atTop ? 'sort' : 'top'}>
        <Segmented<FeedSort> className="sk-feed-sort-options" label="动态排序" density="compact"
          value={value}
          options={[
            { value: 'recent', label: '最新' },
            { value: 'hot', label: '热门' },
          ]}
          onValueChange={next => onChange(next ?? 'recent')} />
        <Button actionId="feed.back-to-top" emphasis="quiet" density="compact"
          className="sk-feed-sort-top" fullWidth
          leading={<Icon iconId="arrow-up" size={14} />}
          label="回顶" aria-label="回到最顶"
          onActivate={scrollToTop} />
      </div>
    </div>
  );
}

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
      <div className="sk-compose">
        <TextArea framing="embedded" minimumRows={4} maximumRows={8}
          className="sk-compose-input" value={text} aria-label="动态内容"
          data-compose-value={text} placeholder="分享你身边正在发生的连接……"
          onValueChange={setText} onEnter={event => event.preventDefault()} />

        {images.length > 0 && (
          <div className="sk-compose-thumbs" data-compose-image-count={images.length}>
            {images.map((src, index) => (
              <span className="sk-compose-thumb" key={`${src.slice(0, 24)}-${index}`}>
                <img src={src} alt={`待发布图片 ${index + 1}`} />
                <IconButton actionId={`compose.image.remove.${index}`} iconId="close" iconSize={12}
                  density="compact" emphasis="quiet" label="移除图片"
                  className="sk-compose-thumb-remove"
                  onActivate={() => setImages(list => list.filter((_, i) => i !== index))} />
              </span>
            ))}
          </div>
        )}

        <div className="sk-compose-toolbar" data-compose-file-input>
          <FilePicker
            iconId="image-plus"
            label={images.length > 0 ? `图片 ${images.length}/${MAX_IMAGES}` : '添加图片'}
            accept="image/*" multiple disabled={images.length >= MAX_IMAGES}
            onFiles={pickFilesFileList} />
        </div>

        <div className="sk-compose-audience">
          <Select<AudienceKind> label="可见范围" aria-label="可见范围"
            options={AUDIENCE_OPTIONS} value={audience}
            onValueChange={value => setAudience((Array.isArray(value) ? value[0] : value) ?? 'public')} />
          {audience === 'circle' && (
            circles.length > 0 ? (
              <Select<string> label="圈子" aria-label="选择圈子" className="sk-circle-select"
                options={circles.map(entry => ({ value: entry.id, label: entry.name }))}
                value={circle?.id ?? ''} onValueChange={value => setCircleId(String(value))} />
            ) : (
              <span className="sk-circle-missing">还没有圈子，先去「圈友」新建分组</span>
            )
          )}
          {audience === 'group' && (
            groups.length > 0 ? (
              <Select<string> label="群聊" aria-label="选择群聊"
                options={groups.map(entry => ({ value: entry.id, label: entry.name }))}
                value={group?.id ?? ''} onValueChange={value => setGroupId(String(value))} />
            ) : (
              <span className="sk-circle-missing">还没有可发布的群聊</span>
            )
          )}
          {(audience === 'allow' || audience === 'deny') && (
            <fieldset className="sk-audience-actors" data-audience-actors={audience}>
              <legend>{audience === 'allow' ? '仅这些人可见' : '关注者中排除这些人'}</legend>
              {people.map(person => {
                const chosen = actorIds.includes(person.id);
                return (
                  <Button key={person.id} actionId={`compose.actor.${person.id}`}
                    emphasis={chosen ? 'secondary' : 'quiet'} density="compact"
                    className={`sk-audience-actor${chosen ? ' is-chosen' : ''}`}
                    aria-pressed={chosen} data-actor-id={person.id}
                    leading={<Avatar name={person.name} background={person.tone} size={24}
                      style={{ borderRadius: 7 }} aria-hidden="true" />}
                    trailing={chosen ? <Check size={13} aria-hidden="true" /> : undefined}
                    onActivate={() => toggleActor(person.id)}>
                    {person.name}
                  </Button>
                );
              })}
            </fieldset>
          )}
        </div>
      </div>
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

function StatGrid({ stats }: { stats: MyMomentsStats }) {
  const cells: { label: string; value: number; key: string }[] = [
    { key: 'posts', label: '动态', value: stats.posts },
    { key: 'comments', label: '发出评论', value: stats.comments },
    { key: 'reactionsGiven', label: '送出反应', value: stats.reactionsGiven },
    { key: 'commentsReceived', label: '收到评论', value: stats.commentsReceived },
    { key: 'reactionsReceived', label: '收到反应', value: stats.reactionsReceived },
    { key: 'following', label: '关注', value: stats.following },
    { key: 'followers', label: '粉丝', value: stats.followers },
    { key: 'circles', label: '圈子', value: stats.circles },
  ];
  return (
    <div className="sk-stats-grid" data-moments-stats>
      {cells.map(cell => (
        <span className="sk-stat-cell" key={cell.key} data-stat={cell.key}>
          <strong>{cell.value}</strong>
          <em>{cell.label}</em>
        </span>
      ))}
    </div>
  );
}

function ProfileView({ name, people, postCount, onBack, onAuthor, onToggleReaction,
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
  onAuthor: (name: string) => void;
  onToggleReaction: (id: string, kind: ReactionKind) => void;
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
      <section className="sk-post sk-profile" data-profile-self={isSelf ? 'true' : 'false'}>
        <Avatar name={name} background={tone} size={72} style={{ borderRadius: 20 }} />
        <div className="sk-profile-id">
          <h2>{name}</h2>
          <span className="sk-post-time">{station}</span>
          {bio && <p>{bio}</p>}
          <div className="sk-profile-stats">
            <span><strong>{postCount}</strong> 动态</span>
            <span><strong>{followers}</strong> 粉丝</span>
            {!isSelf && <span><strong>{following}</strong> 关注</span>}
          </div>
        </div>
        {person && !isSelf && (
          <span className="sk-profile-actions">
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
          </span>
        )}
      </section>
      {isSelf && stats && <StatGrid stats={stats} />}
    </div>
  );
}

function CircleCreateDialog({ open, onDismiss, onCreate }: {
  open: boolean;
  onDismiss: () => void;
  onCreate: (name: string) => void;
}) {
  const [name, setName] = useState('');
  const trimmed = name.trim();
  return (
    <Dialog open={open} onDismiss={onDismiss} title="新建圈子" width={400}
      description="圈子创建后会出现在列表里（本地示例）" closeLabel="关闭"
      footer={
        <>
          <Button actionId="circle.cancel" emphasis="quiet" label="取消" onActivate={onDismiss} />
          <Button actionId="circle.create" emphasis="primary" label="创建"
            availability={trimmed ? { kind: 'enabled' } : { kind: 'disabled', reason: '请输入圈子名称' }}
            onActivate={() => { onCreate(trimmed); setName(''); }} />
        </>
      }>
      <TextField className="sk-circle-name-input" aria-label="圈子名称" placeholder="例如：夜跑小队"
        value={name} onValueChange={setName} onEnter={event => { event.preventDefault(); if (trimmed) { onCreate(trimmed); setName(''); } }} />
    </Dialog>
  );
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
            <Button actionId={`circle.manage.${circle.id}`} emphasis="quiet" density="normal"
              fullWidth className="sk-post sk-circle-card" aria-label={`管理 ${circle.name}`}
              onActivate={() => onOpenManage(circle.id)}>
              <span className="sk-circle-id">
                <strong className="sk-circle-name">{circle.name}</strong>
                {circle.desc && <span className="sk-circle-desc">{circle.desc}</span>}
                <span className="sk-post-time">{circle.members.length} 位成员</span>
              </span>
              <span className="sk-circle-tail">
                <AvatarGroup className="sk-circle-avatars" aria-label={`${circle.name} 成员`}>
                  {circle.members.slice(0, 5).map(member => (
                    <Avatar key={member.id} name={member.name} background={member.tone}
                      size={28} style={{ borderRadius: 8 }} />
                  ))}
                </AvatarGroup>
                <ChevronRight size={15} className="sk-circle-chevron" aria-hidden="true" />
              </span>
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

interface CircleDraft {
  name: string;
  desc: string;
  memberIds: string[];
}

function CircleManageDialog({ circle, people, onDismiss, onSave, onRequestDelete }: {
  circle: Circle;
  people: Person[];
  onDismiss: () => void;
  onSave: (id: string, draft: CircleDraft) => void;
  onRequestDelete: (circle: Circle) => void;
}) {
  const [draft, setDraft] = useState<CircleDraft>({
    name: circle.name,
    desc: circle.desc === '新建圈子' ? '' : circle.desc,
    memberIds: circle.members.map(member => member.id),
  });
  const trimmedName = draft.name.trim();
  const memberOf = (id: string) => circle.members.find(member => member.id === id);
  const memberName = (id: string) => memberOf(id)?.name ?? people.find(person => person.id === id)?.name ?? id;
  const memberTone = (id: string) => memberOf(id)?.tone ?? people.find(person => person.id === id)?.tone ?? IDENTITY_INK;
  const candidates = people.filter(person => !draft.memberIds.includes(person.id));

  return (
    <Dialog open onDismiss={onDismiss} title="管理圈子" width={460}
      description="圈子是你的发布受众分组，成员不会收到通知（本地示例）" closeLabel="关闭"
      footer={
        <div className="sk-circle-manage-footer">
          <Button actionId={`circle.delete.${circle.id}`} emphasis="quiet" tone="danger"
            label="删除分组" onActivate={() => onRequestDelete(circle)} />
          <span className="sk-circle-footer-spacer" />
          <Button actionId="circle.save-cancel" emphasis="quiet" label="取消" onActivate={onDismiss} />
          <Button actionId="circle.save" emphasis="primary" label="保存"
            availability={trimmedName ? { kind: 'enabled' } : { kind: 'disabled', reason: '请输入圈子名称' }}
            onActivate={() => onSave(circle.id, { ...draft, name: trimmedName })} />
        </div>
      }>
      <div className="sk-circle-manage">
        <TextField className="sk-circle-name-edit" aria-label="圈子名称"
          data-circle-name={trimmedName} placeholder="圈子名称"
          value={draft.name} onValueChange={name => setDraft(d => ({ ...d, name }))} autoFocus />
        <TextField className="sk-circle-desc-edit" aria-label="圈子描述"
          data-circle-desc={draft.desc} placeholder="描述（可选）"
          value={draft.desc} onValueChange={desc => setDraft(d => ({ ...d, desc }))} />

        <div className="sk-circle-manage-members" data-circle-member-count={draft.memberIds.filter(id => id !== 'viewer').length}>
          <span className="sk-circle-manage-label">成员 · {draft.memberIds.length}</span>
          <ul className="sk-circle-member-list">
            {draft.memberIds.map(id => (
              <li key={id} className="sk-circle-member-row" data-circle-member={id}>
                <Avatar name={memberName(id)} background={memberTone(id)} size={30}
                  style={{ borderRadius: 8 }} aria-hidden="true" />
                <strong className="sk-circle-member-name">{memberName(id)}</strong>
                {id === 'viewer'
                  ? <span className="sk-circle-member-self">我</span>
                  : (
                    <IconButton actionId={`circle.member.remove.${circle.id}.${id}`}
                      iconId="user-minus" iconSize={14} density="compact" emphasis="quiet"
                      label={`移除 ${memberName(id)}`} className="is-danger"
                      onActivate={() => setDraft(d => ({ ...d, memberIds: d.memberIds.filter(m => m !== id) }))} />
                  )}
              </li>
            ))}
          </ul>
        </div>

        <div className="sk-circle-candidates">
          <span className="sk-circle-manage-label">添加已知人</span>
          {candidates.length === 0
            ? <span className="sk-circle-candidates-empty">已知人都已在分组里</span>
            : (
              <ul className="sk-circle-member-list">
                {candidates.map(person => (
                  <li key={person.id} className="sk-circle-member-row" data-circle-candidate={person.id}>
                    <Avatar name={person.name} background={person.tone} size={30}
                      style={{ borderRadius: 8 }} aria-hidden="true" />
                    <span className="sk-circle-member-meta">
                      <strong className="sk-circle-member-name">{person.name}</strong>
                      <span className="sk-post-time">{person.station} · {person.bio}</span>
                    </span>
                    <IconButton actionId={`circle.member.add.${circle.id}.${person.id}`}
                      iconId="user-plus" iconSize={14} density="compact" emphasis="quiet"
                      label={`添加 ${person.name}`}
                      onActivate={() => setDraft(d => ({ ...d, memberIds: [...d.memberIds, person.id] }))} />
                  </li>
                ))}
              </ul>
            )}
        </div>
      </div>
    </Dialog>
  );
}

export function MomentsFeature({ openSelfSignal = 0 }: { openSelfSignal?: number } = {}) {
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
  const backToTab = () => {
    if (nav.kind === 'tab') return;
    setTab(nav.from);
    setNav({ kind: 'tab' });
  };

  // Rail identity tile: the shell bumps this nonce to open the viewer's own
  // moments profile from any pane. Applied during render (not in a passive
  // effect) so the navigation commits in the same frame as the click — a
  // post-effect setNav would race consumers that observe the profile on the
  // next tick. tabRef keeps the back-target fresh without retriggering on
  // ordinary tab switches.
  const tabRef = useRef(tab);
  tabRef.current = tab;
  const handledSelfSignal = useRef(0);
  if (openSelfSignal !== handledSelfSignal.current) {
    handledSelfSignal.current = openSelfSignal;
    if (openSelfSignal > 0) {
      setNav({ kind: 'profile', name: VIEWER.name, from: tabRef.current });
    }
  }

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
  const saveCircle = (id: string, draft: CircleDraft) => {
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
        desc: draft.desc.trim(),
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
          <div className="sk-moments-subbar">
            {/* Spatial-rotation contract: the scope group is a single-line
                scrollable island; under squeeze the search and compose
                controls collapse in place to icons, peers never rewrap. */}
            <Segmented<MomentsTab> label="动态范围" options={TAB_OPTIONS} scrollable className="sk-scope-island"
              value={tab} onValueChange={value => switchTab(value ?? 'feed')} />
            <div className="sk-scope-wrap"
              onClick={event => {
                // When collapsed to an icon tile, the whole tile is the focus
                // affordance: a click anywhere on it opens the field in place.
                if (event.target === event.currentTarget
                  || !(event.target as HTMLElement).closest('input,button,a')) {
                  event.currentTarget.querySelector('input')?.focus();
                }
              }}>
              <TextField className="sk-scope-search" aria-label={TAB_SEARCH_PLACEHOLDER}
                data-scope-search={tab} placeholder={TAB_SEARCH_PLACEHOLDER}
                value={query} onValueChange={setQuery} clearable onClear={() => setQuery('')}
                leading={<Search size={15} />} density="compact" />
            </div>
            {/* One icon-only add tile in a fixed slot for every tab: identical
                geometry, only the action (and accessible name) changes, so the
                right chrome never shifts when the scope switches. */}
            {tab === 'feed' && (
              <IconButton actionId="moments.compose" iconId="plus" iconSize={18} label="发动态"
                emphasis="primary" className="sk-subbar-add sk-compose-open"
                onActivate={() => setComposerOpen(true)} />
            )}
            {tab === 'circles' && (
              <IconButton actionId="circle.open-create" iconId="plus" iconSize={18} label="新建圈子"
                emphasis="primary" className="sk-subbar-add sk-circle-open"
                onActivate={() => setCircleComposerOpen(true)} />
            )}
          </div>

          {tab === 'feed' && (
            <div className="sk-moments-scroll">
              {/* Global order view — a floating chip pinned to the scroll
                  viewport's top right. It owns no row (cards start at the top)
                  and its halo/shadow keeps it visually detached from the
                  first card it overlaps. It dissolves while scrolling and
                  softly returns at rest; hidden while searching. */}
              {!q && (
                <FeedSortFloat value={feedSort} onChange={setFeedSort} />
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
            onToggleFollow={toggleFollow} onToggleBlock={toggleBlock} onBack={backToTab}
            onAuthor={openProfile}
            onToggleReaction={sharedCardProps.onToggleReaction} />
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
