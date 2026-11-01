/**
 * MomentsFeature — the full social moments surface inside the north-star
 * frame. It migrates the visible anatomy of the desktop moments module
 * (MomentsApp: feed / explore / people search / circles, composer, detail,
 * profile) with peers-ui components and local state only.
 */
import { useState, type KeyboardEvent } from 'react';
import { Check, ChevronLeft, Plus, Search, UserPlus } from 'lucide-react';
import {
  Avatar, AvatarGroup, Button, Dialog, Empty, Segmented, Select,
  TextArea, TextField, Toggle,
} from '@peers-touch/ui';
import { MomentCard } from './MomentCard';
import {
  CIRCLE_SEEDS, MOMENT_SEEDS, PEOPLE_SEEDS, VIEWER,
  type AudienceKind, type Circle, type Moment, type Person, type ReactionKind, type TrustReason,
} from './moments-data';
import './moments.css';

type MomentsTab = 'feed' | 'explore' | 'people' | 'circles';

// Feed/profile stay in one surface; cards carry their own comments inline.
type MomentsNav =
  | { kind: 'tab' }
  | { kind: 'profile'; name: string; from: MomentsTab };

const TAB_OPTIONS: { value: MomentsTab; label: string }[] = [
  { value: 'feed', label: '首页' },
  { value: 'explore', label: '探索' },
  { value: 'people', label: '找人' },
  { value: 'circles', label: '圈友' },
];

const TAB_HINT: Record<MomentsTab, string> = {
  feed: '关注与同圈邻居的最新动态',
  explore: '联邦内其他站点的公开动态',
  people: '按名字找到本站与联邦内的人',
  circles: '你加入的圈子与成员',
};

const AUDIENCE_OPTIONS: { value: AudienceKind; label: string }[] = [
  { value: 'public', label: '公开 · 联邦可见' },
  { value: 'followers', label: '关注者' },
  { value: 'friends', label: '朋友' },
  { value: 'circle', label: '圈子' },
  { value: 'self', label: '仅自己' },
];

const PAGE_SIZE = 3;

function ComposeDialog({ open, circles, onDismiss, onPublish }: {
  open: boolean;
  circles: Circle[];
  onDismiss: () => void;
  onPublish: (draft: { text: string; audience: AudienceKind; circle?: string }) => void;
}) {
  const [text, setText] = useState('');
  const [audience, setAudience] = useState<AudienceKind>('public');
  const [circleId, setCircleId] = useState(circles[0]?.id ?? '');
  const trimmed = text.trim();
  const circle = circles.find(entry => entry.id === circleId);

  const publish = () => {
    if (!trimmed) return;
    onPublish({ text: trimmed, audience, circle: audience === 'circle' ? circle?.name : undefined });
    setText('');
    setAudience('public');
  };

  return (
    <Dialog open={open} onDismiss={onDismiss} title="发动态" width={480}
      description="新动态会插入首页最前面（本地示例）" closeLabel="关闭"
      footer={
        <>
          <Button actionId="compose.cancel" emphasis="quiet" label="取消" onActivate={onDismiss} />
          <Button actionId="compose.publish" emphasis="primary" label="发布"
            availability={trimmed ? { kind: 'enabled' } : { kind: 'disabled', reason: '请输入动态内容' }}
            onActivate={publish} />
        </>
      }>
      <div className="sk-compose">
        <TextArea framing="embedded" minimumRows={4} maximumRows={8}
          className="sk-compose-input" value={text} aria-label="动态内容"
          data-compose-value={text} placeholder="分享你身边正在发生的连接……"
          onValueChange={setText} onEnter={event => event.preventDefault()} />
        <div className="sk-compose-audience">
          <Select<AudienceKind> label="可见范围" aria-label="可见范围"
            options={AUDIENCE_OPTIONS} value={audience}
            onValueChange={value => setAudience((Array.isArray(value) ? value[0] : value) ?? 'public')} />
          {audience === 'circle' && (
            <Select<string> label="圈子" aria-label="选择圈子"
              options={circles.map(entry => ({ value: entry.id, label: entry.name }))}
              value={circleId} onValueChange={value => setCircleId(String(value))} />
          )}
        </div>
      </div>
    </Dialog>
  );
}

function ProfileView({ name, people, postCount, onBack, onAuthor, onReact, onUnreact,
  followed, onToggleFollow }: {
  name: string;
  people: Person[];
  postCount: number;
  followed: boolean;
  onToggleFollow: (id: string) => void;
  onBack: () => void;
  onAuthor: (name: string) => void;
  onReact: (id: string, kind: ReactionKind) => void;
  onUnreact: (id: string) => void;
}) {
  const person = people.find(entry => entry.name === name);
  const tone = person?.tone ?? '#5d6b62';
  const station = person?.station ?? '本站';
  const bio = person?.bio ?? '';
  return (
    <div className="sk-profile-view">
      <Button actionId="profile.back" emphasis="quiet" leading={<ChevronLeft size={15} />}
        label="返回" onActivate={onBack} className="sk-detail-back" />
      <section className="sk-post sk-profile">
        <Avatar name={name} background={tone} size={72} style={{ borderRadius: 20 }} />
        <div className="sk-profile-id">
          <h2>{name}</h2>
          <span className="sk-post-time">{station}</span>
          {bio && <p>{bio}</p>}
          <div className="sk-profile-stats">
            <span><strong>{postCount}</strong> 动态</span>
          </div>
        </div>
        {person && (
          <Toggle actionId={`profile.follow.${person.id}`} className="sk-profile-follow"
            emphasis={followed ? 'secondary' : 'primary'}
            selected={followed}
            leading={followed ? <Check size={14} /> : <UserPlus size={14} />}
            label={followed ? '已关注' : '关注'}
            onSelectedChange={() => onToggleFollow(person.id)} />
        )}
      </section>
    </div>
  );
}

function PeopleView({ people, onToggleFollow, onOpenProfile }: {
  people: Person[];
  onToggleFollow: (id: string) => void;
  onOpenProfile: (name: string) => void;
}) {
  const [query, setQuery] = useState('');
  const filtered = people.filter(person =>
    `${person.name} ${person.station} ${person.bio}`.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <div className="sk-people">
      <TextField aria-label="找人" placeholder="搜索名字、站点" clearable onClear={() => setQuery('')}
        value={query} onValueChange={setQuery} leading={<Search size={15} />} />
      {filtered.length === 0
        ? <Empty description="没有匹配的人" />
        : (
          <ul className="sk-people-list">
            {filtered.map(person => (
              <li key={person.id}>
                <div className="sk-person-row sk-post">
                  <button type="button" className="sk-post-author"
                    onClick={() => onOpenProfile(person.name)}>
                    <Avatar name={person.name} background={person.tone} size={44}
                      style={{ borderRadius: 12 }} />
                    <span className="sk-post-idcol">
                      <strong className="sk-post-name">
                        {person.name}
                        {person.mutual && <span className="sk-person-mutual">互相关注</span>}
                      </strong>
                      <span className="sk-post-time">{person.station} · {person.bio}</span>
                    </span>
                  </button>
                  <Toggle actionId={`people.follow.${person.id}`} className="sk-person-follow"
                    emphasis={person.followed ? 'secondary' : 'primary'}
                    selected={person.followed}
                    leading={person.followed ? <Check size={13} /> : <UserPlus size={13} />}
                    label={person.followed ? '已关注' : '关注'}
                    onSelectedChange={() => onToggleFollow(person.id)} />
                </div>
              </li>
            ))}
          </ul>
        )}
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

function CirclesView({ circles, onCreate }: {
  circles: Circle[];
  onCreate: (name: string) => void;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  return (
    <div className="sk-circles">
      <div className="sk-circles-head">
        <span>{circles.length} 个圈子</span>
        <Button actionId="circle.open-create" emphasis="secondary" density="compact"
          leading={<Plus size={14} />} label="新建圈子" onActivate={() => setDialogOpen(true)} />
      </div>
      <ul className="sk-circle-list">
        {circles.map(circle => (
          <li key={circle.id}>
            <section className="sk-post sk-circle-card">
              <div className="sk-circle-id">
                <h3>{circle.name}</h3>
                <p>{circle.desc}</p>
                <span className="sk-post-time">{circle.members.length} 位成员</span>
              </div>
              <AvatarGroup className="sk-circle-avatars" aria-label={`${circle.name} 成员`}>
                {circle.members.slice(0, 5).map(member => (
                  <Avatar key={member.id} name={member.name} background={member.tone}
                    size={28} style={{ borderRadius: 8 }} />
                ))}
              </AvatarGroup>
            </section>
          </li>
        ))}
      </ul>
      <CircleCreateDialog open={dialogOpen} onDismiss={() => setDialogOpen(false)}
        onCreate={name => { onCreate(name); setDialogOpen(false); }} />
    </div>
  );
}

export function MomentsFeature() {
  const [tab, setTab] = useState<MomentsTab>('feed');
  const [nav, setNav] = useState<MomentsNav>({ kind: 'tab' });
  const [posts, setPosts] = useState<Moment[]>(MOMENT_SEEDS);
  const [people, setPeople] = useState<Person[]>(PEOPLE_SEEDS);
  const [circles, setCircles] = useState<Circle[]>(CIRCLE_SEEDS);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [composerOpen, setComposerOpen] = useState(false);

  const homePosts = posts.filter(post => !post.federated);
  const federatedPosts = posts.filter(post => post.federated);

  const switchTab = (next: MomentsTab) => {
    setTab(next);
    setNav({ kind: 'tab' });
    setVisibleCount(PAGE_SIZE);
  };

  const openProfile = (name: string) => setNav({ kind: 'profile', name, from: tab });
  const backToTab = () => {
    if (nav.kind === 'tab') return;
    setTab(nav.from);
    setNav({ kind: 'tab' });
  };

  const applyReaction = (id: string, kind: ReactionKind | null) => {
    setPosts(list => list.map(post => {
      if (post.id !== id) return post;
      const reactions = { ...post.reactions };
      if (post.viewerReaction) {
        const current = reactions[post.viewerReaction] ?? 0;
        if (current <= 1) delete reactions[post.viewerReaction];
        else reactions[post.viewerReaction] = current - 1;
      }
      if (kind) reactions[kind] = (reactions[kind] ?? 0) + 1;
      return { ...post, reactions, viewerReaction: kind ?? undefined };
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

  const publish = (draft: { text: string; audience: AudienceKind; circle?: string }) => {
    const reason: TrustReason = draft.audience === 'self'
      ? 'self'
      : draft.audience === 'circle'
        ? 'circle'
        : 'public';
    const post: Moment = {
      id: `local-${Date.now()}`,
      author: VIEWER.name, tone: VIEWER.tone, source: 'local', reason,
      audience: draft.audience, circle: draft.circle, at: '刚刚',
      text: draft.text, reactions: {}, comments: [],
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

  const createCircle = (name: string) => {
    setCircles(list => [...list, {
      id: `local-${Date.now()}`, name, desc: '新建圈子',
      members: [{ id: 'viewer', name: VIEWER.name, tone: VIEWER.tone }],
    }]);
  };

  const sharedCardProps = {
    onAuthor: openProfile,
    onReact: (id: string, kind: ReactionKind) => applyReaction(id, kind),
    onUnreact: (id: string) => applyReaction(id, null),
    onComment: addComment,
    onLikeComment: likeComment,
    onReplyComment: replyComment,
    onDeleteComment: deleteComment,
    onDeletePost: deletePost,
  };

  const profileName = nav.kind === 'profile' ? nav.name : '';
  const profilePosts = nav.kind === 'profile'
    ? posts.filter(post => post.author === nav.name)
    : [];

  return (
    <div className="sk-moments">
      {nav.kind === 'tab' ? (
        <>
          <div className="sk-moments-subbar">
            <Segmented<MomentsTab> label="动态范围" options={TAB_OPTIONS}
              value={tab} onValueChange={value => switchTab(value ?? 'feed')} />
            <span className="sk-moments-hint">{TAB_HINT[tab]}</span>
            {tab === 'feed' && (
              <Button actionId="moments.compose" emphasis="primary" className="sk-compose-open"
                leading={<Plus size={15} />} label="发动态" onActivate={() => setComposerOpen(true)} />
            )}
          </div>

          {tab === 'feed' && (
            <div className="sk-moments-scroll">
              {homePosts.slice(0, visibleCount).map(post => (
                <MomentCard key={post.id} post={post} {...sharedCardProps} />
              ))}
              {visibleCount < homePosts.length
                ? (
                  <Button actionId="moments.load-more" emphasis="quiet" fullWidth
                    className="sk-loadmore" label="加载更多"
                    onActivate={() => setVisibleCount(count => count + PAGE_SIZE)} />
                )
                : <span className="sk-feed-end">没有更多了</span>}
            </div>
          )}

          {tab === 'explore' && (
            <div className="sk-moments-scroll">
              {federatedPosts.map(post => (
                <MomentCard key={post.id} post={post} {...sharedCardProps} />
              ))}
              <span className="sk-feed-end">联邦探索由本地示例呈现</span>
            </div>
          )}

          {tab === 'people' && (
            <PeopleView people={people} onToggleFollow={toggleFollow}
              onOpenProfile={openProfile} />
          )}

          {tab === 'circles' && (
            <CirclesView circles={circles} onCreate={createCircle} />
          )}
        </>
      ) : nav.kind === 'profile' ? (
        <div className="sk-moments-scroll">
          <ProfileView name={profileName} people={people} postCount={profilePosts.length}
            followed={people.find(person => person.name === profileName)?.followed ?? false}
            onToggleFollow={toggleFollow} onBack={backToTab}
            onAuthor={openProfile}
            onReact={sharedCardProps.onReact} onUnreact={sharedCardProps.onUnreact} />
          <div className="sk-profile-posts">
            {profilePosts.map(post => (
              <MomentCard key={post.id} post={post} {...sharedCardProps} />
            ))}
            {profilePosts.length === 0 && <Empty description={`${profileName} 还没有公开动态`} />}
          </div>
        </div>
      ) : null}

      <ComposeDialog open={composerOpen} circles={circles}
        onDismiss={() => setComposerOpen(false)} onPublish={publish} />
    </div>
  );
}
