import { useMemo, useState } from 'react';
import { Input, Typography } from 'antd';
import {
  ArrowLeft,
  Globe,
  Heart,
  ImagePlus,
  MessageCircle,
  Plus,
  Search,
  Send,
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
import { GRADIENTS, REACTION_EMOJI } from '../types';
import { demoAvatarUrls, demoContacts, demoGroups, demoMoments } from '../data';
import { IdentityAvatar } from '../components/IdentityAvatar';
import { NewMomentSheet, type NewMomentPayload } from '../components/NewMomentSheet';

const { Text } = Typography;
type SocialTab = 'feed' | 'explore' | 'search' | 'circles';
type SocialView =
  | { kind: 'tab'; tab: SocialTab }
  | { kind: 'detail'; momentId: string; from: SocialTab };

type Circle = {
  id: string;
  name: string;
  description: string;
  memberKeys: string[];
};

const groupNames = new Set(demoGroups.map((group) => group.name));
const authorKind = (name: string): 'person' | 'group' => (groupNames.has(name) ? 'group' : 'person');
const reactionKinds: ReactionKind[] = ['like', 'love', 'laugh', 'wow', 'celebrate'];
const socialTabs: Array<{ id: SocialTab; label: string }> = [
  { id: 'feed', label: 'Home' },
  { id: 'explore', label: 'Public' },
  { id: 'search', label: 'Search' },
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
  onOpenAuthor,
  onTogglePicker,
  onReact,
}: {
  moment: Moment;
  avatarState: AvatarRenderState;
  reactionPickerOpen: boolean;
  detail?: boolean;
  onOpen: () => void;
  onOpenAuthor: (name: string) => void;
  onTogglePicker: () => void;
  onReact: (kind: ReactionKind) => void;
}) {
  const Audience = audienceMeta[moment.audience ?? 'public'];
  const totalReactions = Object.values(moment.reactionCounts ?? {}).reduce((total, count) => total + (count ?? 0), 0);
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
              {Audience.label}
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
          {reactionKinds.map((kind) => {
            const count = moment.reactionCounts?.[kind] ?? 0;
            if (!count) return null;
            return (
              <span key={kind} className={`mp-moment-reaction-tag ${moment.myReaction === kind ? 'mine' : ''}`}>
                {REACTION_EMOJI[kind]} {count}
              </span>
            );
          })}
        </div>
      )}

      <div className="mp-moment-actions">
        <div className="mp-moment-action-group">
          <button
            type="button"
            className={`mp-moment-action ${moment.myReaction ? 'reacted' : ''}`}
            aria-label="React to post"
            aria-expanded={reactionPickerOpen}
            onClick={onTogglePicker}
          >
            <Heart size={18} fill={moment.myReaction ? 'currentColor' : 'none'} />
            <span>{moment.likes}</span>
          </button>
          <button type="button" className="mp-moment-action" aria-label="Open comments" onClick={onOpen}>
            <MessageCircle size={18} />
            <span>{moment.comments.length}</span>
          </button>
        </div>
        {reactionPickerOpen && (
          <div className="mp-moment-reaction-picker">
            {reactionKinds.map((kind) => (
              <button
                key={kind}
                type="button"
                className={`mp-moment-reaction-picker-btn ${moment.myReaction === kind ? 'active' : ''}`}
                aria-label={`React with ${kind}`}
                onClick={() => onReact(kind)}
              >
                {REACTION_EMOJI[kind]}
              </button>
            ))}
          </div>
        )}
      </div>
    </article>
  );
}

export function MomentsPage({
  avatarState,
  onOpenAuthor,
  onDetailChange,
}: {
  avatarState: AvatarRenderState;
  onOpenAuthor: (name: string) => void;
  onDetailChange?: (open: boolean) => void;
}) {
  const [moments, setMoments] = useState<Moment[]>(demoMoments);
  const [view, setView] = useState<SocialView>({ kind: 'tab', tab: 'feed' });
  const [reactionPickerId, setReactionPickerId] = useState<string | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [sort, setSort] = useState<'recent' | 'hot'>('recent');
  const [searchQuery, setSearchQuery] = useState('');
  const [followed, setFollowed] = useState<Set<string>>(() => new Set(['carol', 'emma']));
  const [commentInput, setCommentInput] = useState('');
  const [circles, setCircles] = useState<Circle[]>([
    { id: 'close-friends', name: 'Close Friends', description: 'People I know personally.', memberKeys: ['carol', 'emma'] },
    { id: 'design', name: 'Design peers', description: 'Product and design collaborators.', memberKeys: ['alice', 'carol', 'emma'] },
  ]);
  const [newCircleName, setNewCircleName] = useState('');
  const activeTab = view.kind === 'tab' ? view.tab : view.from;
  const selectedMoment = view.kind === 'detail'
    ? moments.find((moment) => moment.id === view.momentId) ?? null
    : null;

  const publicMoments = useMemo(() => {
    const rows = moments.filter((moment) => moment.audience === 'public');
    return sort === 'hot' ? [...rows].sort((left, right) => right.likes - left.likes) : rows;
  }, [moments, sort]);

  const searchResults = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return [];
    return demoContacts.filter((contact) => (
      contact.name.toLowerCase().includes(query)
      || contact.note.toLowerCase().includes(query)
      || contact.key.toLowerCase().includes(query)
    ));
  }, [searchQuery]);

  function toggleReaction(id: string, kind: ReactionKind) {
    setMoments((current) => current.map((moment) => {
      if (moment.id !== id) return moment;
      const counts = { ...(moment.reactionCounts ?? {}) };
      if (moment.myReaction === kind) {
        counts[kind] = Math.max(0, (counts[kind] ?? 1) - 1);
        return { ...moment, myReaction: undefined, reactionCounts: counts, likes: Math.max(0, moment.likes - 1) };
      }
      if (moment.myReaction) counts[moment.myReaction] = Math.max(0, (counts[moment.myReaction] ?? 1) - 1);
      counts[kind] = (counts[kind] ?? 0) + 1;
      return { ...moment, myReaction: kind, reactionCounts: counts, likes: moment.likes + (moment.myReaction ? 0 : 1) };
    }));
    setReactionPickerId(null);
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
      likes: 0,
      reactionCounts: {},
      comments: [],
    }, ...current]);
    setComposerOpen(false);
    setView({ kind: 'tab', tab: 'feed' });
  }

  function addComment(momentId: string) {
    const text = commentInput.trim();
    if (!text) return;
    const comment: MomentComment = {
      id: `comment-${Date.now()}`,
      name: 'Alice Chen',
      avatar: 'AC',
      avatarUrl: demoAvatarUrls.alice,
      avatarGradient: GRADIENTS[0],
      text,
      time: 'Just now',
    };
    setMoments((current) => current.map((moment) => (
      moment.id === momentId ? { ...moment, comments: [...moment.comments, comment] } : moment
    )));
    setCommentInput('');
  }

  function openMoment(moment: Moment) {
    setView({ kind: 'detail', momentId: moment.id, from: activeTab });
    setReactionPickerId(null);
    onDetailChange?.(true);
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
            onOpen={() => openMoment(moment)}
            onOpenAuthor={onOpenAuthor}
            onTogglePicker={() => setReactionPickerId((current) => current === moment.id ? null : moment.id)}
            onReact={(kind) => toggleReaction(moment.id, kind)}
          />
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
            allowClear
            prefix={<Search size={16} />}
            placeholder="Search people by name or handle"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
          />
        </div>
        {!searchQuery.trim() && (
          <div className="mp-social-empty">
            <Search size={22} />
            <Text strong>Find people across your federations</Text>
            <Text type="secondary">Search resolves public profiles and exact federated handles.</Text>
          </div>
        )}
        {searchQuery.trim() && searchResults.length === 0 && (
          <div className="mp-social-empty">
            <Text strong>No people found</Text>
            <Text type="secondary">Try a display name or exact handle.</Text>
          </div>
        )}
        <div className="mp-social-people-list">
          {searchResults.map((contact) => (
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
      </div>
    );
  }

  function renderCircles() {
    return (
      <div className="mp-social-panel" data-social-scope="circles">
        <div className="mp-circle-create">
          <Input
            value={newCircleName}
            placeholder="New circle name"
            onChange={(event) => setNewCircleName(event.target.value)}
            onPressEnter={() => {
              const name = newCircleName.trim();
              if (!name) return;
              setCircles((current) => [...current, { id: `circle-${Date.now()}`, name, description: 'Private audience', memberKeys: [] }]);
              setNewCircleName('');
            }}
          />
          <button
            type="button"
            aria-label="Create circle"
            disabled={!newCircleName.trim()}
            onClick={() => {
              const name = newCircleName.trim();
              if (!name) return;
              setCircles((current) => [...current, { id: `circle-${Date.now()}`, name, description: 'Private audience', memberKeys: [] }]);
              setNewCircleName('');
            }}
          >
            <Plus size={18} />
          </button>
        </div>
        <div className="mp-circle-list">
          {circles.map((circle) => (
            <article key={circle.id} className="mp-circle-card">
              <div className="mp-circle-heading">
                <span className="mp-circle-icon"><Users size={18} /></span>
                <span>
                  <Text strong>{circle.name}</Text>
                  <Text type="secondary">{circle.description}</Text>
                </span>
                <button
                  type="button"
                  aria-label={`Delete ${circle.name}`}
                  onClick={() => setCircles((current) => current.filter((item) => item.id !== circle.id))}
                >
                  <Trash2 size={16} />
                </button>
              </div>
              <div className="mp-circle-members">
                {circle.memberKeys.map((key) => {
                  const contact = demoContacts.find((item) => item.key === key);
                  if (!contact) return null;
                  return (
                    <button
                      key={key}
                      type="button"
                      aria-label={`Remove ${contact.name} from ${circle.name}`}
                      onClick={() => setCircles((current) => current.map((item) => (
                        item.id === circle.id
                          ? { ...item, memberKeys: item.memberKeys.filter((memberKey) => memberKey !== key) }
                          : item
                      )))}
                    >
                      <IdentityAvatar name={contact.name} initials={contact.avatar} src={contact.avatarUrl} size={32} />
                      <span>{contact.name}</span>
                    </button>
                  );
                })}
                {circle.memberKeys.length === 0 && <Text type="secondary">No people in this circle.</Text>}
              </div>
              <select
                aria-label={`Add person to ${circle.name}`}
                value=""
                onChange={(event) => {
                  const key = event.target.value;
                  if (!key) return;
                  setCircles((current) => current.map((item) => (
                    item.id === circle.id && !item.memberKeys.includes(key)
                      ? { ...item, memberKeys: [...item.memberKeys, key] }
                      : item
                  )));
                }}
              >
                <option value="">Add person...</option>
                {demoContacts
                  .filter((contact) => !circle.memberKeys.includes(contact.key))
                  .map((contact) => <option key={contact.key} value={contact.key}>{contact.name}</option>)}
              </select>
            </article>
          ))}
        </div>
      </div>
    );
  }

  if (selectedMoment) {
    return (
      <div className="mp-page mp-page--detail" data-prototype-page="social-detail">
        <header className="mp-detail-header">
          <button type="button" className="mp-thread-back" aria-label="Back" onClick={() => {
            setView({
              kind: 'tab',
              tab: view.kind === 'detail' ? view.from : activeTab,
            });
            onDetailChange?.(false);
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
            onOpen={() => undefined}
            onOpenAuthor={onOpenAuthor}
            onTogglePicker={() => setReactionPickerId((current) => current === selectedMoment.id ? null : selectedMoment.id)}
            onReact={(kind) => toggleReaction(selectedMoment.id, kind)}
          />
          <section className="mp-social-comments">
            <div className="mp-social-comments-title">{selectedMoment.comments.length} comments</div>
            {selectedMoment.comments.map((comment) => (
              <article key={comment.id} className="mp-moment-comment">
                <IdentityAvatar
                  name={comment.name}
                  initials={comment.avatar}
                  src={comment.avatarUrl}
                  size={32}
                  renderState={avatarState}
                  onClick={() => onOpenAuthor(comment.name)}
                />
                <div className="mp-moment-comment-body">
                  <button type="button" className="mp-actor-link" onClick={() => onOpenAuthor(comment.name)}>{comment.name}</button>
                  <span className="mp-moment-comment-text">{comment.text}</span>
                  <Text type="secondary" className="mp-moment-comment-time">{comment.time}</Text>
                </div>
              </article>
            ))}
            <div className="mp-moment-comment-input-row">
              <input
                type="text"
                className="mp-moment-comment-input"
                placeholder="Add a comment..."
                value={commentInput}
                onChange={(event) => setCommentInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    addComment(selectedMoment.id);
                  }
                }}
              />
              <button
                type="button"
                className={`mp-moment-comment-send ${commentInput.trim() ? 'active' : ''}`}
                aria-label="Send comment"
                disabled={!commentInput.trim()}
                onClick={() => addComment(selectedMoment.id)}
              >
                <Send size={14} />
              </button>
            </div>
          </section>
        </div>
      </div>
    );
  }

  return (
    <div className="mp-page" data-prototype-page="social">
      <header className="mp-header mp-social-header">
        <span>
          <h1 className="mp-header-title">Moments</h1>
          <Text type="secondary">Your federated social space</Text>
        </span>
        <button type="button" className="mp-header-action" aria-label="New post" onClick={() => setComposerOpen(true)}>
          <ImagePlus size={20} />
        </button>
      </header>

      <nav className="mp-social-scope" aria-label="Social scopes">
        {socialTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            aria-current={activeTab === tab.id ? 'page' : undefined}
            className={activeTab === tab.id ? 'active' : ''}
            onClick={() => setView({ kind: 'tab', tab: tab.id })}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {activeTab === 'feed' && (
        <>
          <div className="mp-social-context">Posts from people and groups you follow.</div>
          {renderFeed(moments)}
        </>
      )}
      {activeTab === 'explore' && (
        <>
          <div className="mp-social-context mp-social-context--split">
            <span>Public posts from joined federations.</span>
            <span className="mp-social-sort">
              {(['recent', 'hot'] as const).map((option) => (
                <button key={option} type="button" className={sort === option ? 'active' : ''} onClick={() => setSort(option)}>
                  {option === 'recent' ? 'Recent' : 'Hot'}
                </button>
              ))}
            </span>
          </div>
          {renderFeed(publicMoments)}
        </>
      )}
      {activeTab === 'search' && renderSearch()}
      {activeTab === 'circles' && renderCircles()}

      {composerOpen && <NewMomentSheet onClose={() => setComposerOpen(false)} onSubmit={handleNewPost} />}
    </div>
  );
}
