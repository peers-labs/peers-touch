import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type SetStateAction,
  type UIEvent as ReactUIEvent,
} from 'react';
import { Input, Typography } from 'antd';
import {
  ArrowLeft,
  ArrowUp,
  Check,
  ChevronRight,
  Globe,
  ImagePlus,
  MessageCircle,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  SmilePlus,
  Trash2,
  UserCheck,
  UserPlus,
  Users,
} from 'lucide-react';
import type {
  AvatarRenderState,
  Contact,
  Moment,
  MomentAudience,
  MomentComment,
  ReactionKind,
} from '../types';
import { GRADIENTS, REACTION_EMOJI, REACTION_KINDS } from '../types';
import { demoAvatarUrls, demoContacts, demoGroups } from '../data';
import { ReactionChip } from '../../../../shared/ReactionChip';
import { ReactionPicker } from '../../../../shared/ReactionPicker';
import { IdentityAvatar } from '../components/IdentityAvatar';
import { NewMomentSheet, type NewMomentPayload } from '../components/NewMomentSheet';
import { MomentComments } from '../components/MomentComments';
import { AccessibleClearIcon } from '../components/AccessibleClearIcon';
import { ConfirmationDialog } from '../components/ConfirmationDialog';
import { PrototypeListMemory } from '../listPresentation';
import type {
  Circle,
  MomentsPageState,
  SocialTab,
  SocialView,
} from '../momentsState';
import copy from '../../../../../locales/en/common.json';

const { Text } = Typography;

const groupNames = new Set(demoGroups.map((group) => group.name));
const authorKind = (name: string): 'person' | 'group' => (groupNames.has(name) ? 'group' : 'person');
const reactionLabels: Record<ReactionKind, string> = {
  like: copy['mobile.moments.reaction.like'],
  love: copy['mobile.moments.reaction.love'],
  laugh: copy['mobile.moments.reaction.laugh'],
  wow: copy['mobile.moments.reaction.wow'],
  celebrate: copy['mobile.moments.reaction.celebrate'],
};
const socialTabs: Array<{ id: SocialTab; label: string }> = [
  { id: 'feed', label: 'Home' },
  { id: 'explore', label: 'Public' },
  { id: 'circles', label: 'Circles' },
];

const audienceMeta: Record<MomentAudience, { label: string; Icon: typeof Globe }> = {
  public: { label: 'Public', Icon: Globe },
  followers: { label: 'Followers', Icon: UserCheck },
  circles: { label: 'Circles', Icon: Users },
};

function MomentArticle({
  moment,
  avatarState,
  reactionPickerOpen,
  detail = false,
  onOpen,
  commentsOpen,
  onComment,
  onOpenAuthor,
  onTogglePicker,
  onReact,
  children,
}: {
  moment: Moment;
  avatarState: AvatarRenderState;
  reactionPickerOpen: boolean;
  detail?: boolean;
  onOpen?: () => void;
  commentsOpen: boolean;
  onComment: () => void;
  onOpenAuthor: (name: string) => void;
  onTogglePicker: () => void;
  onReact: (kind: ReactionKind) => void;
  children: ReactNode;
}) {
  const Audience = audienceMeta[moment.audience ?? 'public'];
  const audienceLabel = moment.audience === 'circles' && moment.circleName
    ? moment.circleName
    : Audience.label;
  const totalReactions = Object.values(moment.reactionCounts ?? {}).reduce((total, count) => total + (count ?? 0), 0);
  const myReactions = new Set(moment.myReactions ?? []);
  const body = (
    <>
      <span className="mp-moment-text">{moment.text}</span>
      {moment.images && (
        <span className={`mp-moment-grid mp-moment-grid--${Math.min(moment.images.length, 3)}`}>
          {moment.images.map((image, index) => (
            <span key={`${moment.id}-${index}`} className="mp-moment-image" style={{ background: image }} />
          ))}
        </span>
      )}
    </>
  );

  return (
    <article className={`mp-moment-card ${detail ? 'mp-moment-card--detail' : ''}`} data-social-post={moment.id}>
      <div className="mp-moment-header">
        <IdentityAvatar
          name={moment.name}
          initials={moment.avatar}
          src={moment.avatarUrl}
          kind={authorKind(moment.name)}
          size={42}
          renderState={avatarState}
          onClick={() => onOpenAuthor(moment.name)}
        />
        <div className="mp-moment-author">
          <button type="button" className="mp-actor-link" onClick={() => onOpenAuthor(moment.name)}>
            {moment.name}
          </button>
          <div className="mp-moment-meta-row">
            <Text type="secondary" className="mp-moment-time">{moment.time}</Text>
            <span className="mp-moment-audience">
              <Audience.Icon size={11} />
              {audienceLabel}
            </span>
          </div>
        </div>
      </div>
      {detail ? (
        <div className="mp-moment-open">{body}</div>
      ) : (
        <button type="button" className="mp-moment-open" onClick={onOpen} aria-label={`Open post by ${moment.name}`}>
          {body}
        </button>
      )}

      {totalReactions > 0 && (
        <div className="mp-moment-reaction-summary">
          {REACTION_KINDS.map((kind) => {
            const count = moment.reactionCounts?.[kind] ?? 0;
            if (!count) return null;
            return (
              <ReactionChip
                key={kind}
                touch
                scope="moment"
                reactionId={kind}
                emoji={REACTION_EMOJI[kind]}
                count={count}
                selected={myReactions.has(kind)}
                label={(myReactions.has(kind)
                  ? copy['mobile.reaction.removeNamed']
                  : copy['mobile.reaction.addNamed'])
                  .replace('{{reaction}}', reactionLabels[kind])}
                onClick={() => onReact(kind)}
              />
            );
          })}
        </div>
      )}

      {reactionPickerOpen && (
        <ReactionPicker
          className="mp-moment-reaction-picker"
          label={copy['mobile.reaction.choose']}
          items={REACTION_KINDS.map((kind) => {
            const selected = myReactions.has(kind);
            return {
              id: kind,
              emoji: REACTION_EMOJI[kind],
              selected,
              label: (selected
                ? copy['mobile.reaction.removeNamed']
                : copy['mobile.reaction.addNamed'])
                .replace('{{reaction}}', reactionLabels[kind]),
            };
          })}
          onToggle={onReact}
        />
      )}

      <div className="mp-moment-actions">
        <div className="mp-moment-action-group">
          <button
            type="button"
            className={`mp-moment-action ${myReactions.size > 0 ? 'reacted' : ''}`}
            aria-label="React to post"
            aria-expanded={reactionPickerOpen}
            onClick={onTogglePicker}
          >
            <SmilePlus size={18} />
            <span>{copy['mobile.reaction.action']}</span>
          </button>
          <button type="button" className="mp-moment-action" aria-label={copy['mobile.moments.comment.title']}
            data-comment-action={moment.id}
            aria-expanded={commentsOpen} aria-controls={`moment-comments-${moment.id}`} onClick={onComment}>
            <MessageCircle size={18} />
            <span>{moment.comments.length}</span>
          </button>
        </div>
      </div>
      {children}
    </article>
  );
}

export function MomentsPage({
  avatarState,
  state,
  onStateChange,
  listMemory,
  onRefresh,
  composerRequest = 0,
  defaultAudience = 'followers',
  onComposerRequestHandled,
  onOpenAuthor,
  onDetailChange,
}: {
  avatarState: AvatarRenderState;
  state: MomentsPageState;
  onStateChange: Dispatch<SetStateAction<MomentsPageState>>;
  listMemory: PrototypeListMemory;
  onRefresh: () => void;
  composerRequest?: number;
  defaultAudience?: Exclude<MomentAudience, 'circles'>;
  onComposerRequestHandled?: () => void;
  onOpenAuthor: (name: string) => void;
  onDetailChange?: (open: boolean) => void;
}) {
  const {
    moments,
    view,
    sort,
    searchQuery,
    followed,
    commentDrafts,
    expandedCommentIds,
    circles,
    refreshRevision,
    lastRefreshedAt,
  } = state;
  const activeTab = view.kind === 'tab' ? view.tab : view.from;
  const [reactionPickerId, setReactionPickerId] = useState<string | null>(null);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [scrollTopButtonTop, setScrollTopButtonTop] = useState(0);
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshState, setRefreshState] = useState<
    'idle' | 'pulling' | 'ready' | 'refreshing' | 'updated'
  >('idle');
  const [composerOpen, setComposerOpen] = useState(false);
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const pullStartY = useRef<number | null>(null);
  const pullPointerId = useRef<number | null>(null);
  const pullDistanceRef = useRef(0);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [newCircleName, setNewCircleName] = useState('');
  const [newCircleDescription, setNewCircleDescription] = useState('');
  const [circleCreateOpen, setCircleCreateOpen] = useState(false);
  const [circleEditName, setCircleEditName] = useState('');
  const [circleEditDescription, setCircleEditDescription] = useState('');
  const [circleMemberPickerOpen, setCircleMemberPickerOpen] = useState(false);
  const [deleteCircleId, setDeleteCircleId] = useState<string | null>(null);

  function setStateField<K extends keyof MomentsPageState>(
    key: K,
    update: SetStateAction<MomentsPageState[K]>,
  ) {
    onStateChange((current) => ({
      ...current,
      [key]: typeof update === 'function'
        ? (update as (value: MomentsPageState[K]) => MomentsPageState[K])(current[key])
        : update,
    }));
  }

  const setMoments = (update: SetStateAction<Moment[]>) => setStateField('moments', update);
  const setView = (update: SetStateAction<SocialView>) => setStateField('view', update);
  const setSort = (update: SetStateAction<'recent' | 'hot'>) => setStateField('sort', update);
  const setSearchQuery = (update: SetStateAction<string>) => setStateField('searchQuery', update);
  const setFollowed = (update: SetStateAction<Set<string>>) => setStateField('followed', update);
  const setCommentDrafts = (update: SetStateAction<Record<string, string>>) => (
    setStateField('commentDrafts', update)
  );
  const setExpandedCommentIds = (update: SetStateAction<Set<string>>) => (
    setStateField('expandedCommentIds', update)
  );
  const setCircles = (update: SetStateAction<Circle[]>) => setStateField('circles', update);

  useEffect(() => {
    if (composerRequest <= 0) return;
    setComposerOpen(true);
    onComposerRequestHandled?.();
  }, [composerRequest, onComposerRequestHandled]);
  useEffect(() => () => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    if (settleTimer.current) clearTimeout(settleTimer.current);
  }, []);
  const setPull = (distance: number) => {
    pullDistanceRef.current = distance;
    setPullDistance(distance);
  };
  const beginPullRefresh = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (refreshState !== 'idle') return;
    if (pageRef.current?.scrollTop !== 0) return;
    if ((event.target as HTMLElement).closest('button, input, textarea, select')) return;
    pullStartY.current = event.clientY;
    pullPointerId.current = event.pointerId;
  };
  const movePullRefresh = (event: ReactPointerEvent<HTMLDivElement>) => {
    const startY = pullStartY.current;
    if (startY === null || pullPointerId.current !== event.pointerId) return;
    if ((pageRef.current?.scrollTop ?? 1) > 0) {
      setPull(0);
      setRefreshState('idle');
      return;
    }
    const distance = Math.min(56, Math.max(0, (event.clientY - startY) * 0.6));
    setPull(distance);
    setRefreshState(distance <= 0 ? 'idle' : distance >= 44 ? 'ready' : 'pulling');
  };
  const finishPullRefresh = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (pullPointerId.current !== event.pointerId) return;
    pullStartY.current = null;
    pullPointerId.current = null;
    if (pullDistanceRef.current < 44 || refreshState !== 'ready') {
      setPull(0);
      setRefreshState('idle');
      return;
    }
    setPull(36);
    setRefreshState('refreshing');
    refreshTimer.current = setTimeout(() => {
      onRefresh();
      setRefreshState('updated');
      settleTimer.current = setTimeout(() => {
        setPull(0);
        setRefreshState('idle');
      }, 450);
    }, 350);
  };
  const cancelPullRefresh = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (pullPointerId.current !== event.pointerId) return;
    pullStartY.current = null;
    pullPointerId.current = null;
    setPull(0);
    setRefreshState('idle');
  };
  const handleSocialScroll = (event: ReactUIEvent<HTMLDivElement>) => {
    const { clientHeight, scrollTop } = event.currentTarget;
    setShowScrollTop(scrollTop > 72);
    setScrollTopButtonTop(Math.max(0, scrollTop + clientHeight - 110));
    listMemory.save(`moments:${activeTab}`, { scrollTop });
  };
  const scrollToTop = () => {
    setShowScrollTop(false);
    pageRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const refreshFeedback = (
    <span
      className={`mp-social-toolbar-refresh ${refreshState === 'refreshing' ? 'is-refreshing' : ''}`}
      aria-live="polite"
    >
      <RefreshCw size={15} />
      {refreshState !== 'pulling' && (
        <span>
          {refreshState === 'ready'
            ? 'Release to refresh'
            : refreshState === 'refreshing'
              ? 'Refreshing'
              : 'Updated'}
        </span>
      )}
    </span>
  );
  useLayoutEffect(() => {
    if (view.kind !== 'tab') return undefined;
    const page = pageRef.current;
    if (!page) return undefined;
    const key = `moments:${activeTab}`;
    const restoredScrollTop = listMemory.read(key)?.scrollTop ?? 0;
    page.scrollTop = restoredScrollTop;
    setShowScrollTop(restoredScrollTop > 72);
    setScrollTopButtonTop(Math.max(0, restoredScrollTop + page.clientHeight - 110));
    return () => {
      listMemory.save(key, { scrollTop: page.scrollTop });
    };
  }, [activeTab, listMemory, view.kind]);
  const selectedMoment = view.kind === 'detail'
    ? moments.find((moment) => moment.id === view.momentId) ?? null
    : null;
  const selectedCircle = view.kind === 'circle-detail'
    ? circles.find((circle) => circle.id === view.circleId) ?? null
    : null;

  const publicMoments = useMemo(() => {
    const rows = moments.filter((moment) => moment.audience === 'public');
    return sort === 'hot' ? [...rows].sort((left, right) => right.likes - left.likes) : rows;
  }, [moments, sort]);

  const circleMoments = useMemo(
    () => moments.filter((moment) => moment.audience === 'circles'),
    [moments],
  );

  const peopleSearchResults = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return [];
    return demoContacts.filter((contact) => (
      contact.name.toLowerCase().includes(query)
      || contact.note.toLowerCase().includes(query)
      || contact.key.toLowerCase().includes(query)
    ));
  }, [searchQuery]);

  const postSearchResults = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return [];
    return moments.filter((moment) => (
      moment.name.toLowerCase().includes(query)
      || moment.text.toLowerCase().includes(query)
      || moment.circleName?.toLowerCase().includes(query)
    ));
  }, [moments, searchQuery]);

  function toggleReaction(id: string, kind: ReactionKind) {
    setMoments((current) => current.map((moment) => {
      if (moment.id !== id) return moment;
      const counts = { ...(moment.reactionCounts ?? {}) };
      const selected = new Set(moment.myReactions ?? []);
      if (selected.has(kind)) {
        counts[kind] = Math.max(0, (counts[kind] ?? 1) - 1);
        selected.delete(kind);
        return {
          ...moment,
          myReactions: [...selected],
          reactionCounts: counts,
          likes: Math.max(0, moment.likes - 1),
        };
      }
      counts[kind] = (counts[kind] ?? 0) + 1;
      selected.add(kind);
      return {
        ...moment,
        myReactions: [...selected],
        reactionCounts: counts,
        likes: moment.likes + 1,
      };
    }));
  }

  function handleNewPost(payload: NewMomentPayload) {
    setMoments((current) => [{
      id: `mo-${Date.now()}`,
      name: 'Alice Chen',
      avatar: 'AC',
      avatarUrl: demoAvatarUrls.alice,
      avatarGradient: GRADIENTS[0],
      time: 'Just now',
      text: payload.text,
      images: payload.images.length ? payload.images : undefined,
      audience: payload.audience,
      circleId: payload.circleId,
      circleName: payload.circleName,
      likes: 0,
      reactionCounts: {},
      comments: [],
    }, ...current]);
    setComposerOpen(false);
    setView({ kind: 'tab', tab: payload.audience === 'circles' ? 'circles' : 'feed' });
  }

  function addComment(momentId: string) {
    const text = (commentDrafts[momentId] ?? '').trim();
    if (!text) return;
    const comment: MomentComment = {
      id: `comment-${Date.now()}`,
      name: 'Alice Chen',
      avatar: 'AC',
      avatarUrl: demoAvatarUrls.alice,
      avatarGradient: GRADIENTS[0],
      text,
      time: copy['mobile.moments.time.justNow'],
    };
    setMoments((current) => current.map((moment) => (
      moment.id === momentId ? { ...moment, comments: [...moment.comments, comment] } : moment
    )));
    setCommentDrafts((current) => ({ ...current, [momentId]: '' }));
    setExpandedCommentIds((current) => new Set(current).add(momentId));
  }

  function closeComments(momentId: string) {
    setActiveCommentId(null);
    pageRef.current?.querySelector<HTMLButtonElement>(`[data-comment-action="${momentId}"]`)?.focus({ preventScroll: true });
  }

  function toggleComments(momentId: string) {
    setReactionPickerId(null);
    if (activeCommentId === momentId) closeComments(momentId);
    else {
      setActiveCommentId(momentId);
      setExpandedCommentIds((current) => new Set(current).add(momentId));
    }
  }

  function renderComments(moment: Moment, detail = false) {
    return <MomentComments
      moment={moment}
      avatarState={avatarState}
      expanded={detail || expandedCommentIds.has(moment.id)}
      composerOpen={detail || activeCommentId === moment.id}
      focusComposer={activeCommentId === moment.id}
      draft={commentDrafts[moment.id] ?? ''}
      onDraftChange={(value) => setCommentDrafts((current) => ({ ...current, [moment.id]: value }))}
      onExpand={() => setExpandedCommentIds((current) => new Set(current).add(moment.id))}
      onClose={() => closeComments(moment.id)}
      onReply={(name) => {
        setActiveCommentId(moment.id);
        setCommentDrafts((current) => ({
          ...current,
          [moment.id]: current[moment.id]?.trim() || `@${name} `,
        }));
      }}
      onSubmit={() => addComment(moment.id)}
      onOpenAuthor={onOpenAuthor}
    />;
  }

  function openMoment(moment: Moment) {
    setView({
      kind: 'detail',
      momentId: moment.id,
      from: activeTab,
      returnTo: view.kind === 'search' ? 'search' : 'tab',
    });
    setReactionPickerId(null);
    onDetailChange?.(true);
  }

  function closeAuxiliaryView(tab: SocialTab) {
    setView({ kind: 'tab', tab });
    setActiveCommentId(null);
    setReactionPickerId(null);
    onDetailChange?.(false);
  }

  function openCircle(circle: Circle) {
    setCircleEditName(circle.name);
    setCircleEditDescription(circle.description);
    setCircleMemberPickerOpen(false);
    setView({ kind: 'circle-detail', circleId: circle.id, from: 'circles' });
    onDetailChange?.(true);
  }

  function createCircle() {
    const name = newCircleName.trim();
    if (!name) return;
    const circle: Circle = {
      id: `circle-${Date.now()}`,
      name,
      description: newCircleDescription.trim(),
      memberKeys: [],
    };
    setCircles((current) => [...current, circle]);
    setNewCircleName('');
    setNewCircleDescription('');
    setCircleCreateOpen(false);
    openCircle(circle);
  }

  function renderFeed(rows: Moment[]) {
    return (
      <div className="mp-moments-feed">
        {rows.map((moment) => (
          <MomentArticle
            key={moment.id}
            moment={moment}
            avatarState={avatarState}
            reactionPickerOpen={reactionPickerId === moment.id}
            commentsOpen={activeCommentId === moment.id}
            onComment={() => toggleComments(moment.id)}
            onOpen={() => openMoment(moment)}
            onOpenAuthor={onOpenAuthor}
            onTogglePicker={() => setReactionPickerId((current) => current === moment.id ? null : moment.id)}
            onReact={(kind) => toggleReaction(moment.id, kind)}
          >
            {renderComments(moment)}
          </MomentArticle>
        ))}
        {rows.length === 0 && (
          <div className="mp-social-empty">
            <Globe size={22} />
            <Text strong>No posts in this scope</Text>
            <Text type="secondary">New posts will appear here when they are available.</Text>
          </div>
        )}
      </div>
    );
  }

  function renderSearch() {
    return (
      <div className="mp-social-panel" data-social-scope="search">
        <div className="mp-social-search">
          <Input
            autoFocus
            allowClear={{ clearIcon: <AccessibleClearIcon label="Clear Moments search" /> }}
            prefix={<Search size={16} />}
            placeholder="Search people and posts"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
          />
        </div>
        {!searchQuery.trim() && (
          <div className="mp-social-empty">
            <Search size={22} />
            <Text strong>Search Moments</Text>
            <Text type="secondary">Find people, handles, and posts without leaving your current scope.</Text>
          </div>
        )}
        {searchQuery.trim() && peopleSearchResults.length === 0 && postSearchResults.length === 0 && (
          <div className="mp-social-empty">
            <Text strong>No results</Text>
            <Text type="secondary">Try another name, handle, or phrase.</Text>
          </div>
        )}
        {peopleSearchResults.length > 0 && (
          <section className="mp-social-search-section" aria-labelledby="social-search-people">
            <h3 id="social-search-people">People</h3>
            <div className="mp-social-people-list">
              {peopleSearchResults.map((contact) => (
                <article key={contact.key} className="mp-social-person">
                  <button type="button" className="mp-social-person-main" onClick={() => onOpenAuthor(contact.name)}>
                    <IdentityAvatar
                      name={contact.name}
                      initials={contact.avatar}
                      src={contact.avatarUrl}
                      size={44}
                      online={contact.online}
                      showPresence
                      renderState={avatarState}
                    />
                    <span>
                      <Text strong>{contact.name}</Text>
                      <Text type="secondary">@{contact.key}@alpha.peers.social</Text>
                      <Text type="secondary">{contact.note}</Text>
                    </span>
                  </button>
                  <button
                    type="button"
                    className={`mp-social-follow ${followed.has(contact.key) ? 'active' : ''}`}
                    onClick={() => setFollowed((current) => {
                      const next = new Set(current);
                      if (next.has(contact.key)) next.delete(contact.key); else next.add(contact.key);
                      return next;
                    })}
                  >
                    {followed.has(contact.key) ? <UserCheck size={15} /> : <UserPlus size={15} />}
                    {followed.has(contact.key) ? 'Following' : 'Follow'}
                  </button>
                </article>
              ))}
            </div>
          </section>
        )}
        {postSearchResults.length > 0 && (
          <section className="mp-social-search-section" aria-labelledby="social-search-posts">
            <h3 id="social-search-posts">Posts</h3>
            {renderFeed(postSearchResults)}
          </section>
        )}
      </div>
    );
  }

  function renderCircleManager() {
    return (
      <div ref={pageRef} className="mp-page mp-page--detail" data-prototype-page="social-circle-manage">
        <header className="mp-detail-header">
          <button type="button" className="mp-thread-back" aria-label="Back"
            onClick={() => closeAuxiliaryView('circles')}>
            <ArrowLeft size={22} />
          </button>
          <h2 className="mp-detail-header-title">Circles</h2>
          <button type="button" className="mp-header-action" aria-label="Create circle"
            onClick={() => setCircleCreateOpen((current) => !current)}>
            <Plus size={20} />
          </button>
        </header>
        <div className="mp-circle-manager">
          {circleCreateOpen && (
            <form className="mp-circle-create-form" onSubmit={(event) => {
              event.preventDefault();
              createCircle();
            }}>
              <Input
                autoFocus
                value={newCircleName}
                placeholder="Circle name"
                aria-label="Circle name"
                onChange={(event) => setNewCircleName(event.target.value)}
              />
              <Input
                value={newCircleDescription}
                placeholder="Description"
                aria-label="Circle description"
                onChange={(event) => setNewCircleDescription(event.target.value)}
              />
              <button type="submit" disabled={!newCircleName.trim()}>Create</button>
            </form>
          )}
          <div className="mp-circle-list">
            {circles.map((circle) => (
              <button key={circle.id} type="button" className="mp-circle-row"
                data-circle-row={circle.id} onClick={() => openCircle(circle)}>
                <span className="mp-circle-icon"><Users size={18} /></span>
                <span className="mp-circle-row-copy">
                  <strong>{circle.name}</strong>
                  <small>{circle.description || 'No description'}</small>
                  <small>{circle.memberKeys.length} members</small>
                </span>
                <ChevronRight size={18} />
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  function renderCircleDetail(circle: Circle) {
    const memberContacts = circle.memberKeys
      .map((key) => demoContacts.find((contact) => contact.key === key))
      .filter((contact): contact is Contact => Boolean(contact));
    const candidates = demoContacts.filter(
      (contact) => contact.key !== 'alice' && !circle.memberKeys.includes(contact.key),
    );
    return (
      <div ref={pageRef} className="mp-page mp-page--detail" data-prototype-page="social-circle-detail"
        data-circle-id={circle.id}>
        <header className="mp-detail-header">
          <button type="button" className="mp-thread-back" aria-label="Back" onClick={() => {
            setView({ kind: 'circle-manage', from: 'circles' });
            setCircleMemberPickerOpen(false);
          }}>
            <ArrowLeft size={22} />
          </button>
          <h2 className="mp-detail-header-title">{circle.name}</h2>
        </header>
        <div className="mp-circle-detail-body">
          <section className="mp-circle-editor">
            <label>
              <span>Name</span>
              <Input aria-label="Circle name" value={circleEditName}
                onChange={(event) => setCircleEditName(event.target.value)} />
            </label>
            <label>
              <span>Description</span>
              <Input aria-label="Circle description" value={circleEditDescription}
                onChange={(event) => setCircleEditDescription(event.target.value)} />
            </label>
            <button type="button" className="mp-circle-primary-action"
              disabled={!circleEditName.trim()} onClick={() => {
                const nextName = circleEditName.trim();
                const nextDescription = circleEditDescription.trim();
                setCircles((current) => current.map((item) => (
                  item.id === circle.id
                    ? { ...item, name: nextName, description: nextDescription }
                    : item
                )));
                setMoments((current) => current.map((moment) => (
                  moment.circleId === circle.id ? { ...moment, circleName: nextName } : moment
                )));
              }}>
              <Check size={16} /> Save changes
            </button>
          </section>

          <section className="mp-circle-member-section">
            <div className="mp-circle-section-heading">
              <span>
                <strong>Members</strong>
                <small>{memberContacts.length} people</small>
              </span>
              <button type="button" onClick={() => setCircleMemberPickerOpen((current) => !current)}>
                <UserPlus size={16} /> Add people
              </button>
            </div>
            {circleMemberPickerOpen && (
              <div className="mp-circle-candidate-list" aria-label="People to add">
                {candidates.map((contact) => (
                  <button key={contact.key} type="button" aria-label={`Add ${contact.name}`}
                    onClick={() => {
                      setCircles((current) => current.map((item) => (
                        item.id === circle.id
                          ? { ...item, memberKeys: [...item.memberKeys, contact.key] }
                          : item
                      )));
                    }}>
                    <IdentityAvatar name={contact.name} initials={contact.avatar}
                      src={contact.avatarUrl} size={32} renderState={avatarState} />
                    <span>{contact.name}</span>
                    <Plus size={16} />
                  </button>
                ))}
                {candidates.length === 0 && <Text type="secondary">Everyone is already in this circle.</Text>}
              </div>
            )}
            <div className="mp-circle-member-list">
              {memberContacts.map((contact) => (
                <div key={contact.key} className="mp-circle-member-row">
                  <IdentityAvatar name={contact.name} initials={contact.avatar}
                    src={contact.avatarUrl} size={36} renderState={avatarState} />
                  <span>
                    <strong>{contact.name}</strong>
                    <small>@{contact.key}@alpha.peers.social</small>
                  </span>
                  <button type="button" aria-label={`Remove ${contact.name}`}
                    onClick={() => setCircles((current) => current.map((item) => (
                      item.id === circle.id
                        ? { ...item, memberKeys: item.memberKeys.filter((key) => key !== contact.key) }
                        : item
                    )))}>
                    Remove
                  </button>
                </div>
              ))}
              {memberContacts.length === 0 && (
                <div className="mp-circle-empty-members">
                  <Users size={20} />
                  <Text strong>No members yet</Text>
                  <Text type="secondary">Add people before sharing private posts with this circle.</Text>
                </div>
              )}
            </div>
          </section>

          <section className="mp-circle-danger">
            <strong>Delete circle</strong>
            <small>This removes the audience list. Existing posts remain in your history.</small>
            <button type="button" onClick={() => setDeleteCircleId(circle.id)}>
              <Trash2 size={16} /> Delete circle
            </button>
          </section>
        </div>
        {deleteCircleId === circle.id && (
          <ConfirmationDialog
            title={`Delete ${circle.name}?`}
            description="Members will no longer be available as a publishing audience."
            confirmLabel="Delete"
            onCancel={() => setDeleteCircleId(null)}
            onConfirm={() => {
              setCircles((current) => current.filter((item) => item.id !== circle.id));
              setDeleteCircleId(null);
              setView({ kind: 'circle-manage', from: 'circles' });
            }}
          />
        )}
      </div>
    );
  }

  if (selectedMoment) {
    return (
      <div ref={pageRef} className="mp-page mp-page--detail" data-prototype-page="social-detail">
        <header className="mp-detail-header">
          <button type="button" className="mp-thread-back" aria-label="Back" onClick={() => {
            if (view.kind === 'detail' && view.returnTo === 'search') {
              setView({ kind: 'search', from: view.from });
            } else {
              closeAuxiliaryView(view.kind === 'detail' ? view.from : activeTab);
            }
          }}>
            <ArrowLeft size={22} />
          </button>
          <h2 className="mp-detail-header-title">Post</h2>
        </header>
        <div className="mp-social-thread">
          <MomentArticle
            moment={selectedMoment}
            avatarState={avatarState}
            detail
            reactionPickerOpen={reactionPickerId === selectedMoment.id}
            commentsOpen
            onComment={() => toggleComments(selectedMoment.id)}
            onOpenAuthor={onOpenAuthor}
            onTogglePicker={() => setReactionPickerId((current) => current === selectedMoment.id ? null : selectedMoment.id)}
            onReact={(kind) => toggleReaction(selectedMoment.id, kind)}
          >
            {renderComments(selectedMoment, true)}
          </MomentArticle>
        </div>
      </div>
    );
  }

  if (view.kind === 'search') {
    return (
      <div ref={pageRef} className="mp-page mp-page--detail" data-prototype-page="social-search">
        <header className="mp-detail-header">
          <button type="button" className="mp-thread-back" aria-label="Back"
            onClick={() => closeAuxiliaryView(view.from)}>
            <ArrowLeft size={22} />
          </button>
          <h2 className="mp-detail-header-title">Search</h2>
        </header>
        {renderSearch()}
      </div>
    );
  }

  if (view.kind === 'circle-manage') return renderCircleManager();
  if (view.kind === 'circle-detail') {
    return selectedCircle ? renderCircleDetail(selectedCircle) : renderCircleManager();
  }

  return (
    <div
      ref={pageRef}
      className="mp-page"
      data-prototype-page="social"
      data-social-last-refreshed-at={lastRefreshedAt ?? undefined}
      data-social-refresh-revision={refreshRevision}
      onScroll={handleSocialScroll}
      onPointerDown={beginPullRefresh}
      onPointerMove={movePullRefresh}
      onPointerUp={finishPullRefresh}
      onPointerCancel={cancelPullRefresh}
    >
      <header className="mp-header mp-social-header">
        <span>
          <h1 className="mp-header-title">Moments</h1>
          <Text type="secondary">Your federated social space</Text>
        </span>
        <span className="mp-social-header-actions">
          <button type="button" className="mp-header-action" aria-label="Search"
            onClick={() => {
              setView({ kind: 'search', from: activeTab });
              setActiveCommentId(null);
              setReactionPickerId(null);
              onDetailChange?.(true);
            }}>
            <Search size={20} />
          </button>
          <button type="button" className="mp-header-action" aria-label="New post" onClick={() => setComposerOpen(true)}>
            <ImagePlus size={20} />
          </button>
        </span>
      </header>

      <nav className="mp-social-scope" aria-label="Social scopes">
        {socialTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            aria-current={activeTab === tab.id ? 'page' : undefined}
            className={activeTab === tab.id ? 'active' : ''}
            onClick={() => {
              setView({ kind: 'tab', tab: tab.id });
              setActiveCommentId(null);
              setReactionPickerId(null);
              setShowScrollTop(false);
            }}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {activeTab === 'feed' && (
        <>
          <div
            className="mp-social-context mp-social-context--home-refresh"
            data-social-refresh-state={refreshState}
            style={{ height: refreshState === 'idle' ? 0 : Math.min(44, pullDistance) }}
          >
            {refreshState !== 'idle' && refreshFeedback}
          </div>
          {renderFeed(moments)}
        </>
      )}
      {activeTab === 'explore' && (
        <>
          <div
            className={`mp-social-context mp-social-context--split mp-social-context--toolbar ${refreshState !== 'idle' ? 'is-refresh-active' : ''}`}
            data-social-refresh-state={refreshState}
          >
            {refreshState !== 'idle' ? refreshFeedback : (
              <>
                <span aria-hidden="true" />
                <span className="mp-social-context-actions">
                  <span className="mp-social-sort">
                    {(['recent', 'hot'] as const).map((option) => (
                      <button key={option} type="button" className={sort === option ? 'active' : ''} onClick={() => setSort(option)}>
                        {option === 'recent' ? 'Recent' : 'Hot'}
                      </button>
                    ))}
                  </span>
                </span>
              </>
            )}
          </div>
          {renderFeed(publicMoments)}
        </>
      )}
      {activeTab === 'circles' && (
        <>
          <div
            className={`mp-social-context mp-social-context--split ${refreshState !== 'idle' ? 'is-refresh-active' : ''}`}
            data-social-refresh-state={refreshState}
          >
            {refreshState !== 'idle' ? refreshFeedback : (
              <>
                <span className="mp-social-context-copy">
                  Private posts shared with a specific circle.
                </span>
                <span className="mp-social-context-actions">
                  <button type="button" className="mp-social-manage-circles" onClick={() => {
                    setView({ kind: 'circle-manage', from: 'circles' });
                    setActiveCommentId(null);
                    setReactionPickerId(null);
                    onDetailChange?.(true);
                  }}>
                    <Settings2 size={15} /> Manage
                  </button>
                </span>
              </>
            )}
          </div>
          {renderFeed(circleMoments)}
        </>
      )}

      {showScrollTop && (
        <button
          type="button"
          className="mp-social-scroll-top"
          aria-label="Back to top"
          onClick={scrollToTop}
          style={{ top: scrollTopButtonTop }}
        >
          <ArrowUp size={18} />
        </button>
      )}

      {composerOpen && (
        <NewMomentSheet
          defaultAudience={defaultAudience}
          circles={circles.map((circle) => ({
            id: circle.id,
            name: circle.name,
            memberCount: circle.memberKeys.length,
          }))}
          onClose={() => setComposerOpen(false)}
          onSubmit={handleNewPost}
        />
      )}
    </div>
  );
}
