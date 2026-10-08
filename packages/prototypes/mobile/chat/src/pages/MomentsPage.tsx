import { createElement, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Avatar, Typography } from 'antd';
import {
  ArrowLeft,
  Ban,
  BarChart3,
  Check,
  ChevronRight,
  CircleAlert,
  ExternalLink,
  Globe2,
  Heart,
  ImagePlus,
  Link as LinkIcon,
  LoaderCircle,
  LockKeyhole,
  MapPin,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Repeat2,
  Search,
  Send,
  Share2,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  UserRound,
  UserMinus,
  UserPlus,
  UsersRound,
  X,
} from 'lucide-react';
import type { Moment, MomentComment, ReactionKind } from '../types';
import { GRADIENTS, REACTION_EMOJI } from '../types';
import { demoMoments } from '../data';

const { Text } = Typography;

export type MomentsEvidenceScenario =
  | 'social-parity'
  | 'social-content-types'
  | 'social-private-pending'
  | 'social-recovery-required'
  | 'social-source-unavailable'
  | 'social-revoked';

type SocialView = 'feed' | 'search' | 'profile' | 'circles';
type SocialScope = 'home' | 'explore';
type MediaPreview = { momentId: string; kind: 'image' | 'video' };

type AudienceOption = {
  id: 'PUBLIC' | 'FOLLOWERS' | 'FRIENDS' | 'CIRCLE' | 'GROUP' | 'CUSTOM_ALLOW' | 'CUSTOM_DENY' | 'SELF';
  label: string;
  detail: string;
  icon: typeof Globe2;
  requiresTarget?: boolean;
};

const AUDIENCES: AudienceOption[] = [
  { id: 'PUBLIC', label: 'Public', detail: 'Anyone can read it', icon: Globe2 },
  { id: 'FOLLOWERS', label: 'Followers', detail: 'Anyone following you', icon: UsersRound },
  { id: 'FRIENDS', label: 'Friends', detail: 'Accepted friends only', icon: ShieldCheck },
  { id: 'CIRCLE', label: 'Circle', detail: 'Choose a private audience list', icon: UsersRound, requiresTarget: true },
  { id: 'GROUP', label: 'Group', detail: 'Choose a conversation', icon: UsersRound, requiresTarget: true },
  { id: 'CUSTOM_ALLOW', label: 'Selected people', detail: 'Choose one or more people', icon: UserRound, requiresTarget: true },
  { id: 'CUSTOM_DENY', label: 'Followers except', detail: 'Choose people to exclude', icon: UserMinus, requiresTarget: true },
  { id: 'SELF', label: 'Only me', detail: 'Your trusted devices', icon: LockKeyhole },
];

type CircleItem = {
  id: string;
  name: string;
  description: string;
  members: string[];
};

const CIRCLES: CircleItem[] = [
  { id: 'family', name: 'Family', description: 'The people closest to you', members: ['Bob Lee', 'Carol Li', 'Emma Liu', 'David Wu'] },
  { id: 'studio', name: 'Studio', description: 'Design collaborators', members: ['Carol Li', 'Grace Kim', 'Henry Wang'] },
];

const GROUPS = [
  { id: 'weekend', name: 'Weekend plans', detail: '6 active members' },
  { id: 'design', name: 'Product Design', detail: '8 active members' },
];

const PEOPLE = [
  { id: 'bob', name: 'Bob Lee', handle: '@bob@bob.remote' },
  { id: 'carol', name: 'Carol Li', handle: '@carol@alice.station' },
  { id: 'emma', name: 'Emma Liu', handle: '@emma@eve.remote' },
  { id: 'david', name: 'David Wu', handle: '@david@alice.station' },
];

const EXTRA_COMMENTS: MomentComment[] = Array.from({ length: 10 }, (_, index) => ({
  id: `extra-${index + 1}`,
  name: PEOPLE[index % PEOPLE.length].name,
  avatar: PEOPLE[index % PEOPLE.length].name.split(' ').map((part) => part[0]).join(''),
  avatarGradient: GRADIENTS[(index + 2) % GRADIENTS.length],
  text: `A concise follow-up on the launch, note ${index + 1}.`,
  time: `${index + 2}h`,
}));

function preparedMoments(): Moment[] {
  const base = demoMoments.map((moment, index) => ({
    ...moment,
    source: index === 0 ? 'alice.station' : 'bob.remote',
    audience: index === 0 ? 'Friends' : 'Public',
    reason: index === 0 ? 'You are friends' : 'Explore',
    remote: index !== 0,
    contentKind: moment.images?.length ? 'image' as const : 'text' as const,
    comments: index === 0 ? [...moment.comments, ...EXTRA_COMMENTS] : moment.comments,
  }));
  return [
    ...base,
    {
      id: 'mo-poll', name: 'Grace Kim', avatar: 'GK', avatarGradient: GRADIENTS[4], time: '3 days ago',
      text: 'Help us choose the next community meetup format.',
      source: 'grace.remote', audience: 'Followers', reason: 'You follow Grace', remote: true,
      contentKind: 'poll', poll: { question: 'Which format works best?', options: ['Workshop', 'Open space', 'Lightning talks'] },
      likes: 12, reactionCounts: { like: 9, celebrate: 3 }, comments: [],
    },
    {
      id: 'mo-link', name: 'David Wu', avatar: 'DW', avatarGradient: GRADIENTS[5], time: '4 days ago',
      text: 'A practical guide to resilient federation.',
      source: 'alice.station', audience: 'Public', reason: 'Explore',
      contentKind: 'link', link: { title: 'Building resilient federated networks', url: 'peers.example/research/federation' },
      likes: 18, reactionCounts: { like: 18 }, comments: [],
    },
    {
      id: 'mo-location', name: 'Emma Liu', avatar: 'EL', avatarGradient: GRADIENTS[7], time: '5 days ago',
      text: 'A quiet place for the next design walk.',
      source: 'eve.remote', audience: 'Friends', reason: 'You are friends', remote: true,
      contentKind: 'location', location: { name: 'Waterfront Park', address: '18 Harbor Walk' },
      likes: 21, reactionCounts: { love: 12, like: 9 }, comments: [],
    },
    {
      id: 'mo-repost', name: 'Bob Lee', avatar: 'BL', avatarGradient: GRADIENTS[2], time: '6 days ago',
      text: 'Worth reading before our architecture review.',
      source: 'bob.remote', audience: 'Friends', reason: 'You are friends', remote: true,
      contentKind: 'repost', repost: { author: 'Alice Chen', text: 'A short note on keeping one source of truth across client projections.' },
      likes: 9, reactionCounts: { like: 9 }, comments: [],
    },
    {
      id: 'mo-video', name: 'Carol Li', avatar: 'CL', avatarGradient: GRADIENTS[3], time: '1 week ago',
      text: 'Prototype walkthrough from this morning.',
      source: 'alice.station', audience: 'Circle', reason: 'Studio circle',
      contentKind: 'video', videoLabel: '01:42', likes: 16, reactionCounts: { celebrate: 6, like: 10 }, comments: [],
    },
  ];
}

export function MomentsPage({
  scenario = 'social-parity',
  onImmersiveVisibilityChange,
}: {
  scenario?: MomentsEvidenceScenario;
  onImmersiveVisibilityChange?: (visible: boolean) => void;
}) {
  const [moments, setMoments] = useState<Moment[]>(preparedMoments);
  const [scope, setScope] = useState<SocialScope>('home');
  const [exploreSort, setExploreSort] = useState<'recent' | 'hot'>('recent');
  const [view, setView] = useState<SocialView>('feed');
  const [activeCommentComposerId, setActiveCommentComposerId] = useState<string | null>(null);
  const [expandedCommentListId, setExpandedCommentListId] = useState<string | null>(null);
  const [mediaPreview, setMediaPreview] = useState<MediaPreview | null>(null);
  const [actionMomentId, setActionMomentId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [reactionPickerId, setReactionPickerId] = useState<string | null>(null);
  const [showComposer, setShowComposer] = useState(false);
  const [showAudience, setShowAudience] = useState(false);
  const [showSort, setShowSort] = useState(false);
  const [targetAudience, setTargetAudience] = useState<AudienceOption | null>(null);
  const [newPostText, setNewPostText] = useState('A quiet afternoon, shared with the people I trust.');
  const [audience, setAudience] = useState<AudienceOption>(AUDIENCES[2]);
  const [commentInputs, setCommentInputs] = useState<Record<string, string>>({});
  const actionMoment = moments.find((moment) => moment.id === actionMomentId);
  const previewMoment = moments.find((moment) => moment.id === mediaPreview?.momentId);

  useEffect(() => {
    setView('feed');
    setScope('home');
    setActiveCommentComposerId(null);
    setExpandedCommentListId(null);
  }, [scenario]);

  useEffect(() => {
    onImmersiveVisibilityChange?.(view !== 'feed' || Boolean(targetAudience));
    return () => onImmersiveVisibilityChange?.(false);
  }, [onImmersiveVisibilityChange, targetAudience, view]);

  const visibleMoments = useMemo(
    () => {
      const scoped = scope === 'home'
        ? moments
        : moments.filter((moment) => moment.audience === 'Public' || moment.remote);
      if (scenario === 'social-content-types') {
        return [...scoped].sort((left, right) => {
          const leftRich = left.contentKind && !['text', 'image'].includes(left.contentKind) ? 1 : 0;
          const rightRich = right.contentKind && !['text', 'image'].includes(right.contentKind) ? 1 : 0;
          return rightRich - leftRich;
        });
      }
      return exploreSort === 'hot' && scope === 'explore'
        ? [...scoped].sort((left, right) => right.likes - left.likes)
        : scoped;
    },
    [exploreSort, moments, scenario, scope],
  );

  function navigate(next: SocialView) {
    onImmersiveVisibilityChange?.(next !== 'feed');
    setView(next);
  }

  function toggleReaction(id: string, kind: ReactionKind) {
    setMoments((current) => current.map((moment) => {
      if (moment.id !== id) return moment;
      const counts = { ...(moment.reactionCounts ?? {}) };
      if (moment.myReaction === kind) {
        counts[kind] = Math.max(0, (counts[kind] ?? 1) - 1);
        if (!counts[kind]) delete counts[kind];
        return { ...moment, myReaction: undefined, reactionCounts: counts, likes: Math.max(0, moment.likes - 1) };
      }
      if (moment.myReaction) {
        counts[moment.myReaction] = Math.max(0, (counts[moment.myReaction] ?? 1) - 1);
        if (!counts[moment.myReaction]) delete counts[moment.myReaction];
      }
      counts[kind] = (counts[kind] ?? 0) + 1;
      return { ...moment, myReaction: kind, reactionCounts: counts, likes: moment.likes + (moment.myReaction ? 0 : 1) };
    }));
    setReactionPickerId(null);
  }

  function addComment(momentId: string) {
    const text = (commentInputs[momentId] ?? '').trim();
    if (!text) return;
    const comment: MomentComment = {
      id: `c-${Date.now()}`,
      name: 'Alice Chen',
      avatar: 'AC',
      avatarGradient: GRADIENTS[0],
      text,
      time: 'Just now',
    };
    setMoments((current) => current.map((moment) => (
      moment.id === momentId ? { ...moment, comments: [...moment.comments, comment] } : moment
    )));
    setCommentInputs((current) => ({ ...current, [momentId]: '' }));
  }

  function publishPost() {
    const text = newPostText.trim();
    if (!text) return;
    const moment: Moment = {
      id: `mo-${Date.now()}`,
      name: 'Alice Chen',
      avatar: 'AC',
      avatarGradient: GRADIENTS[0],
      time: 'Just now',
      text,
      source: 'alice.station',
      audience: audience.label,
      reason: 'You published this',
      images: audience.id === 'PUBLIC' ? undefined : [GRADIENTS[6]],
      contentKind: audience.id === 'PUBLIC' ? 'text' : 'image',
      likes: 0,
      reactionCounts: {},
      comments: [],
    };
    setMoments((current) => [moment, ...current]);
    setScope('home');
    setActiveCommentComposerId(null);
    setShowComposer(false);
  }

  function deletePost(momentId: string) {
    setMoments((current) => current.filter((moment) => moment.id !== momentId));
    setReactionPickerId(null);
    setActiveCommentComposerId((current) => current === momentId ? null : current);
    setExpandedCommentListId((current) => current === momentId ? null : current);
    setActionMomentId(null);
    setConfirmDeleteId(null);
  }

  if (targetAudience) {
    return (
      <AudienceTargetPickerPage
        audience={targetAudience}
        onBack={() => {
          onImmersiveVisibilityChange?.(false);
          setTargetAudience(null);
          setShowAudience(true);
        }}
        onDone={(detail) => {
          setAudience({ ...targetAudience, detail });
          onImmersiveVisibilityChange?.(false);
          setTargetAudience(null);
        }}
      />
    );
  }

  if (view === 'search') {
    return <SocialSearchPage onBack={() => navigate('feed')} onOpenProfile={() => navigate('profile')} />;
  }
  if (view === 'profile') {
    return <SocialProfilePage moments={moments} onBack={() => navigate('feed')} onOpenMoment={(id) => {
      setActiveCommentComposerId(id);
      navigate('feed');
    }} />;
  }
  if (view === 'circles') {
    return <CirclePage onBack={() => navigate('feed')} />;
  }
  return (
    <div className="mp-page mp-social-page">
      <header className="mp-header">
        <h1 className="mp-header-title">Moments</h1>
        <div className="mp-social-header-actions">
          <IconButton label="Search people" onClick={() => navigate('search')}><Search size={19} /></IconButton>
          <IconButton label="Manage circles" onClick={() => navigate('circles')}><UsersRound size={19} /></IconButton>
          <IconButton label="New post" onClick={() => setShowComposer(true)}><ImagePlus size={20} /></IconButton>
        </div>
      </header>

      <div className="mp-social-scope" aria-label="Moment scope">
        {(['home', 'explore'] as const).map((item) => (
          <button
            key={item}
            type="button"
            className={scope === item ? 'active' : ''}
            onClick={() => setScope(item)}
          >
            {item === 'home' ? 'Home' : 'Explore'}
          </button>
        ))}
      </div>

      <div className="mp-social-context">
        <span>{scope === 'home' ? 'Posts shared with you' : 'Public activity across your Federation'}</span>
        {scope === 'explore' ? (
          <button type="button" onClick={() => setShowSort(true)}>
            <SlidersHorizontal size={13} /> {exploreSort === 'recent' ? 'Recent' : 'Hot'}
          </button>
        ) : <span>Latest</span>}
      </div>

      <div className="mp-moments-feed">
        {visibleMoments.map((moment) => (
          <MomentArticle
            key={moment.id}
            moment={moment}
            scenario={moment.id === moments[0]?.id ? scenario : 'social-parity'}
            pickerOpen={reactionPickerId === moment.id}
            commentComposerOpen={activeCommentComposerId === moment.id}
            commentsExpanded={expandedCommentListId === moment.id}
            onOpenProfile={() => navigate('profile')}
            onTogglePicker={() => setReactionPickerId(
              reactionPickerId === moment.id ? null : moment.id,
            )}
            onReact={(kind) => toggleReaction(moment.id, kind)}
            onToggleCommentComposer={() => setActiveCommentComposerId((current) => (
              current === moment.id ? null : moment.id
            ))}
            onToggleMoreComments={() => setExpandedCommentListId((current) => (
              current === moment.id ? null : moment.id
            ))}
            commentText={commentInputs[moment.id] ?? ''}
            onCommentChange={(value) => setCommentInputs((current) => ({
              ...current,
              [moment.id]: value,
            }))}
            onComment={() => addComment(moment.id)}
            onOpenMedia={(kind) => setMediaPreview({ momentId: moment.id, kind })}
            onOpenActions={() => setActionMomentId(moment.id)}
          />
        ))}
      </div>

      {showComposer && (
        <div className="mp-action-sheet-backdrop" role="presentation">
          <section className="mp-action-sheet mp-social-composer-sheet" role="dialog" aria-label="New Moment">
            <div className="mp-action-sheet-handle" />
            <header className="mp-social-sheet-header">
              <button type="button" aria-label="Close composer" onClick={() => setShowComposer(false)}><X size={20} /></button>
              <h2>New Moment</h2>
              <button type="button" className="primary" disabled={!newPostText.trim()} onClick={publishPost}>Publish</button>
            </header>
            <textarea
              aria-label="Moment text"
              value={newPostText}
              onChange={(event) => setNewPostText(event.target.value)}
              placeholder="What's on your mind?"
            />
            <div className="mp-social-media-preview" aria-label="Selected image">
              <div style={{ background: GRADIENTS[6] }} />
              <button type="button" aria-label="Remove image"><X size={15} /></button>
            </div>
            <button type="button" className="mp-social-audience-row" onClick={() => setShowAudience(true)}>
              <span className="mp-social-audience-icon">{createElement(audience.icon, { size: 17 })}</span>
              <span><strong>{audience.label}</strong><small>{audience.detail}</small></span>
              <ChevronRight size={17} />
            </button>
            <div className="mp-social-composer-meta">
              <span><ShieldCheck size={14} /> Private content is encrypted on this device</span>
              <span>{newPostText.length}/5000</span>
            </div>
          </section>
        </div>
      )}

      {showAudience && (
        <div className="mp-action-sheet-backdrop mp-social-audience-backdrop" role="presentation">
          <section className="mp-action-sheet mp-social-audience-sheet" role="dialog" aria-label="Choose audience">
            <div className="mp-action-sheet-handle" />
            <header className="mp-social-sheet-header">
              <button type="button" aria-label="Back to composer" onClick={() => setShowAudience(false)}><ArrowLeft size={20} /></button>
              <h2>Audience</h2>
              <span className="mp-social-sheet-spacer" />
            </header>
            <p className="mp-social-sheet-copy">Choose exactly who can read this Moment.</p>
            <div className="mp-social-audience-list">
              {AUDIENCES.map((option) => {
                const Icon = option.icon;
                return (
                  <button key={option.id} type="button" onClick={() => {
                    if (option.requiresTarget) {
                      setShowAudience(false);
                      onImmersiveVisibilityChange?.(true);
                      setTargetAudience(option);
                      return;
                    }
                    setAudience(option);
                    setShowAudience(false);
                  }}>
                    <span className="mp-social-audience-icon"><Icon size={18} /></span>
                    <span><strong>{option.label}</strong><small>{option.detail}</small></span>
                    {audience.id === option.id ? <Check size={18} /> : <ChevronRight size={17} />}
                  </button>
                );
              })}
            </div>
          </section>
        </div>
      )}

      {showSort && (
        <div className="mp-action-sheet-backdrop mp-social-sort-backdrop" role="presentation">
          <section className="mp-action-sheet mp-social-sort-sheet" role="dialog" aria-label="Sort Explore">
            <div className="mp-action-sheet-handle" />
            <header className="mp-social-sheet-header">
              <button type="button" aria-label="Close sort" onClick={() => setShowSort(false)}><X size={20} /></button>
              <h2>Sort Explore</h2>
              <span className="mp-social-sheet-spacer" />
            </header>
            <div className="mp-social-choice-list">
              {([
                { id: 'recent' as const, label: 'Recent', detail: 'Newest public activity first' },
                { id: 'hot' as const, label: 'Hot', detail: 'Most active public Moments first' },
              ]).map((option) => (
                <button key={option.id} type="button" onClick={() => {
                  setExploreSort(option.id);
                  setShowSort(false);
                }}>
                  <span><strong>{option.label}</strong><small>{option.detail}</small></span>
                  {exploreSort === option.id ? <Check size={18} /> : null}
                </button>
              ))}
            </div>
          </section>
        </div>
      )}

      {mediaPreview && previewMoment && (
        <MediaPreviewOverlay
          moment={previewMoment}
          kind={mediaPreview.kind}
          onClose={() => setMediaPreview(null)}
        />
      )}

      {actionMoment && (
        <div className="mp-action-sheet-backdrop" role="presentation">
          <section className="mp-action-sheet mp-social-compact-sheet" role="dialog" aria-label="Moment actions">
            <div className="mp-action-sheet-handle" />
            <div className="mp-action-group">
              {actionMoment.name === 'Alice Chen' ? (
                <button type="button" className="mp-action-item danger" onClick={() => {
                  setActionMomentId(null);
                  setConfirmDeleteId(actionMoment.id);
                }}>
                  <Trash2 size={18} /> Delete Moment
                </button>
              ) : (
                <button type="button" className="mp-action-item danger" onClick={() => setActionMomentId(null)}>
                  <Ban size={18} /> Block {actionMoment.name}
                </button>
              )}
            </div>
            <button type="button" className="mp-action-item mp-action-cancel" onClick={() => setActionMomentId(null)}>Cancel</button>
          </section>
        </div>
      )}

      {confirmDeleteId && (
        <div className="mp-action-sheet-backdrop" role="presentation">
          <section className="mp-action-sheet mp-social-confirm-sheet" role="alertdialog" aria-label="Delete Moment">
            <div className="mp-action-sheet-handle" />
            <div className="mp-social-confirm-copy">
              <Trash2 size={20} />
              <div><strong>Delete this Moment?</strong><p>Future feed, comment, media and recovery access will be revoked.</p></div>
            </div>
            <div className="mp-social-confirm-actions">
              <button type="button" onClick={() => setConfirmDeleteId(null)}>Cancel</button>
              <button type="button" className="danger" onClick={() => deletePost(confirmDeleteId)}>Delete</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function MomentArticle({
  moment,
  scenario,
  pickerOpen,
  commentComposerOpen,
  commentsExpanded,
  onOpenProfile,
  onTogglePicker,
  onReact,
  onToggleCommentComposer,
  onToggleMoreComments,
  commentText,
  onCommentChange,
  onComment,
  onOpenMedia,
  onOpenActions,
}: {
  moment: Moment;
  scenario: MomentsEvidenceScenario;
  pickerOpen: boolean;
  commentComposerOpen: boolean;
  commentsExpanded: boolean;
  onOpenProfile: () => void;
  onTogglePicker: () => void;
  onReact: (kind: ReactionKind) => void;
  onToggleCommentComposer: () => void;
  onToggleMoreComments: () => void;
  commentText: string;
  onCommentChange: (value: string) => void;
  onComment: () => void;
  onOpenMedia: (kind: 'image' | 'video') => void;
  onOpenActions: () => void;
}) {
  const reactionList: ReactionKind[] = ['like', 'love', 'laugh', 'wow', 'celebrate'];
  const totalReactions = Object.values(moment.reactionCounts ?? {}).reduce((sum, count) => sum + (count ?? 0), 0);
  const hidesPlaintext = scenario === 'social-recovery-required' || scenario === 'social-revoked';
  const interactionsDisabled = hidesPlaintext || scenario === 'social-source-unavailable';
  const visibleComments = commentsExpanded ? moment.comments : moment.comments.slice(0, 10);
  const hiddenCommentCount = Math.max(0, moment.comments.length - visibleComments.length);
  return (
    <article className="mp-social-moment">
      <div className="mp-social-author-row">
        <button type="button" className="mp-social-author" onClick={onOpenProfile}>
          <Avatar size={42} style={{ background: moment.avatarGradient, borderRadius: 14 }}>{moment.avatar}</Avatar>
          <span>
            <strong>{moment.name}</strong>
            <small>{moment.source} · {moment.time}</small>
          </span>
        </button>
        {!hidesPlaintext && (
          <button type="button" className="mp-social-more" aria-label={`Actions for ${moment.name}'s Moment`} onClick={onOpenActions}>
            <MoreHorizontal size={18} />
          </button>
        )}
      </div>

      {!hidesPlaintext && (
        <div className="mp-social-body">
          <span>{moment.text}</span>
          {moment.images?.length ? (
            <button type="button" className="mp-social-image" aria-label="Preview image" style={{ background: moment.images[0] }} onClick={() => onOpenMedia('image')} />
          ) : null}
        </div>
      )}
      {!hidesPlaintext && moment.contentKind === 'video' && (
        <button type="button" className="mp-social-content-addon mp-social-video" onClick={() => onOpenMedia('video')}>
          <span><Play size={24} fill="currentColor" /></span>
          <small>{moment.videoLabel} · Encrypted video</small>
        </button>
      )}
      {!hidesPlaintext && moment.link && (
        <button type="button" className="mp-social-content-addon">
          <span className="mp-social-content-icon"><LinkIcon size={17} /></span>
          <span><strong>{moment.link.title}</strong><small>{moment.link.url}</small></span>
          <ExternalLink size={16} />
        </button>
      )}
      {!hidesPlaintext && moment.poll && (
        <div className="mp-social-poll">
          <strong><BarChart3 size={16} /> {moment.poll.question}</strong>
          {moment.poll.options.map((option) => <span key={option}>{option}</span>)}
        </div>
      )}
      {!hidesPlaintext && moment.repost && (
        <div className="mp-social-repost">
          <strong><Repeat2 size={15} /> {moment.repost.author}</strong>
          <span>{moment.repost.text}</span>
        </div>
      )}
      {!hidesPlaintext && moment.location && (
        <div className="mp-social-content-addon">
          <span className="mp-social-content-icon"><MapPin size={17} /></span>
          <span><strong>{moment.location.name}</strong><small>{moment.location.address}</small></span>
          <span />
        </div>
      )}

      <ScenarioState scenario={scenario} />

      <div className="mp-social-trust-meta">
        {moment.remote ? <Globe2 size={13} /> : <ShieldCheck size={13} />}
        <span>{moment.audience} · {moment.reason}</span>
      </div>
      {!hidesPlaintext && totalReactions > 0 ? (
        <div className="mp-moment-reaction-summary">
          {reactionList.map((kind) => {
            const count = moment.reactionCounts?.[kind] ?? 0;
            return count ? <span key={kind} className={moment.myReaction === kind ? 'mp-moment-reaction-tag mine' : 'mp-moment-reaction-tag'}>{REACTION_EMOJI[kind]} {count}</span> : null;
          })}
        </div>
      ) : null}
      <div className="mp-moment-actions">
        <div className="mp-moment-action-group">
          <button type="button" disabled={interactionsDisabled} className={moment.myReaction ? 'mp-moment-action reacted' : 'mp-moment-action'} aria-label="React" onClick={onTogglePicker}><Heart size={18} fill={moment.myReaction ? 'currentColor' : 'none'} /></button>
          <button type="button" disabled={hidesPlaintext} className={commentComposerOpen ? 'mp-moment-action active' : 'mp-moment-action'} aria-label={commentComposerOpen ? 'Hide comment composer' : 'Add comment'} onClick={onToggleCommentComposer}>
            <MessageCircle size={18} /><span>{moment.comments.length}</span>
          </button>
          <button
            type="button"
            className="mp-moment-action mp-moment-action--share"
            aria-label="Share unavailable"
            title="Share unavailable"
            disabled
          >
            <Share2 size={18} />
          </button>
        </div>
        {pickerOpen && !interactionsDisabled ? <ReactionPicker active={moment.myReaction} onReact={onReact} /> : null}
      </div>

      {!hidesPlaintext && (moment.comments.length > 0 || commentComposerOpen) && (
        <section className="mp-social-comments mp-social-comments-inline" aria-label={`Comments on ${moment.name}'s Moment`}>
          {visibleComments.map((comment) => (
            <div key={comment.id} className="mp-moment-comment">
              <Avatar size={28} style={{ background: comment.avatarGradient, borderRadius: 9 }}>{comment.avatar}</Avatar>
              <div className="mp-moment-comment-body">
                <Text strong className="mp-moment-comment-name">{comment.name}</Text>
                <span className="mp-moment-comment-text">{comment.text}</span>
                <Text type="secondary" className="mp-moment-comment-time">{comment.time} · Reply</Text>
              </div>
            </div>
          ))}
          {moment.comments.length > 10 && (
            <button type="button" className="mp-social-comments-more" onClick={onToggleMoreComments}>
              {commentsExpanded ? 'Show fewer comments' : `View ${hiddenCommentCount} more comments`}
            </button>
          )}
          {commentComposerOpen && moment.comments.length === 0 && (
            <div className="mp-social-empty-inline">No comments yet.</div>
          )}
          {commentComposerOpen && !interactionsDisabled && (
            <div className="mp-social-comment-composer-inline">
              <input aria-label="Add a comment" value={commentText} onChange={(event) => onCommentChange(event.target.value)} placeholder="Add a comment..." />
              <button type="button" aria-label="Send comment" disabled={!commentText.trim()} onClick={onComment}><Send size={16} /></button>
            </div>
          )}
        </section>
      )}
    </article>
  );
}

function MediaPreviewOverlay({
  moment,
  kind,
  onClose,
}: {
  moment: Moment;
  kind: 'image' | 'video';
  onClose: () => void;
}) {
  return (
    <div className="mp-social-media-overlay" role="presentation" onClick={onClose}>
      <section className="mp-social-media-dialog" role="dialog" aria-modal="true" aria-label={`${kind === 'image' ? 'Image' : 'Video'} preview`} onClick={(event) => event.stopPropagation()}>
        <header>
          <span>{moment.name}</span>
          <button type="button" aria-label="Close media preview" onClick={onClose}><X size={20} /></button>
        </header>
        {kind === 'image' ? (
          <div className="mp-social-media-canvas" style={{ background: moment.images?.[0] ?? GRADIENTS[0] }} />
        ) : (
          <div className="mp-social-media-canvas mp-social-media-video">
            <span><Play size={30} fill="currentColor" /></span>
            <small>{moment.videoLabel} · Tap to play</small>
          </div>
        )}
        <footer>{moment.text}</footer>
      </section>
    </div>
  );
}

function ScenarioState({ scenario }: { scenario: MomentsEvidenceScenario }) {
  if (scenario === 'social-parity' || scenario === 'social-content-types') return null;
  const states = {
    'social-private-pending': {
      icon: <LoaderCircle className="mp-spin" size={18} />,
      title: 'Delivery pending',
      detail: 'Bob Station is unavailable. This Moment will retry with the same delivery identity.',
      action: 'Check delivery',
      tone: 'pending',
    },
    'social-recovery-required': {
      icon: <LockKeyhole size={18} />,
      title: 'Recovery required',
      detail: 'Restore this trusted device before reading private history.',
      action: 'Start recovery',
      tone: 'blocking',
    },
    'social-source-unavailable': {
      icon: <CircleAlert size={18} />,
      title: 'Source temporarily unavailable',
      detail: 'Verified content remains readable. New comments and reactions are paused.',
      action: 'Retry',
      tone: 'warning',
    },
    'social-revoked': {
      icon: <Trash2 size={18} />,
      title: 'Moment deleted or access revoked',
      detail: 'New reads, interactions and recovery are blocked. Saved copies cannot be remotely erased.',
      action: 'Back to Moments',
      tone: 'danger',
    },
  } as const;
  const state = states[scenario];
  return (
    <section className={`mp-social-state ${state.tone}`} role="status">
      <span>{state.icon}</span>
      <div><strong>{state.title}</strong><p>{state.detail}</p></div>
      <button type="button"><RefreshCw size={15} /> {state.action}</button>
    </section>
  );
}

function AudienceTargetPickerPage({
  audience,
  onBack,
  onDone,
}: {
  audience: AudienceOption;
  onBack: () => void;
  onDone: (detail: string) => void;
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const singleOptions = audience.id === 'CIRCLE'
    ? CIRCLES.map((circle) => ({
      id: circle.id,
      name: circle.name,
      detail: `${circle.members.length} people`,
    }))
    : audience.id === 'GROUP'
      ? GROUPS
      : [];
  const visiblePeople = PEOPLE.filter((person) => (
    `${person.name} ${person.handle}`.toLowerCase().includes(query.trim().toLowerCase())
  ));
  const customAudience = audience.id === 'CUSTOM_ALLOW' || audience.id === 'CUSTOM_DENY';
  const title = audience.id === 'CIRCLE'
    ? 'Choose Circle'
    : audience.id === 'GROUP'
      ? 'Choose Group'
      : audience.id === 'CUSTOM_DENY'
        ? 'Exclude followers'
        : 'Choose people';

  return (
    <div className="mp-detail-page mp-social-target-page">
      <header className="mp-detail-header">
        <IconButton label="Back to audiences" onClick={onBack}><ArrowLeft size={20} /></IconButton>
        <h1 className="mp-detail-header-title">{title}</h1>
        {customAudience && (
          <button
            type="button"
            className="mp-social-header-commit"
            disabled={selectedIds.length === 0}
            onClick={() => {
              const names = PEOPLE.filter((person) => selectedIds.includes(person.id)).map((person) => person.name);
              onDone(audience.id === 'CUSTOM_DENY'
                ? `Followers except ${names.join(', ')}`
                : names.join(', '));
            }}
          >
            Done
          </button>
        )}
      </header>
      <div className="mp-social-target-copy">
        <ShieldCheck size={17} />
        <span>
          {audience.id === 'CUSTOM_DENY'
            ? 'The base audience stays Followers. Selected people are excluded.'
            : 'The selected target is stored as canonical audience identity.'}
        </span>
      </div>
      {customAudience && (
        <div className="mp-social-search mp-social-target-search">
          <label><Search size={17} /><input aria-label="Search audience people" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search people" /></label>
        </div>
      )}
      <div className="mp-social-choice-list mp-social-target-list">
        {singleOptions.map((option) => (
          <button key={option.id} type="button" onClick={() => onDone(`${option.name} · ${option.detail}`)}>
            <span className="mp-social-audience-icon"><UsersRound size={18} /></span>
            <span><strong>{option.name}</strong><small>{option.detail}</small></span>
            <ChevronRight size={17} />
          </button>
        ))}
        {customAudience && visiblePeople.map((person) => {
          const selected = selectedIds.includes(person.id);
          return (
            <button key={person.id} type="button" onClick={() => setSelectedIds((current) => (
              selected ? current.filter((id) => id !== person.id) : [...current, person.id]
            ))}>
              <span className="mp-social-selection-check">{selected ? <Check size={16} /> : null}</span>
              <span><strong>{person.name}</strong><small>{person.handle}</small></span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SocialSearchPage({ onBack, onOpenProfile }: { onBack: () => void; onOpenProfile: () => void }) {
  return (
    <div className="mp-detail-page">
      <header className="mp-detail-header">
        <IconButton label="Back to Moments" onClick={onBack}><ArrowLeft size={20} /></IconButton>
        <h1 className="mp-detail-header-title">Search people</h1>
      </header>
      <div className="mp-social-search">
        <label><Search size={17} /><input aria-label="Search people" defaultValue="@bob@bob.remote" /></label>
        <p>People in your active Federation</p>
        <button type="button" className="mp-social-person-row" onClick={onOpenProfile}>
          <Avatar size={44} style={{ background: GRADIENTS[2], borderRadius: 14 }}>BL</Avatar>
          <span><strong>Bob Lee</strong><small>@bob@bob.remote · Friend</small></span>
          <ChevronRight size={18} />
        </button>
      </div>
    </div>
  );
}

function SocialProfilePage({ moments, onBack, onOpenMoment }: { moments: Moment[]; onBack: () => void; onOpenMoment: (id: string) => void }) {
  const [following, setFollowing] = useState(true);
  const [blocked, setBlocked] = useState(false);
  const [showActions, setShowActions] = useState(false);
  const [confirmBlock, setConfirmBlock] = useState(false);
  return (
    <div className="mp-detail-page">
      <header className="mp-detail-header">
        <IconButton label="Back to Moments" onClick={onBack}><ArrowLeft size={20} /></IconButton>
        <h1 className="mp-detail-header-title">Profile</h1>
        <IconButton label="Profile actions" onClick={() => setShowActions(true)}><MoreHorizontal size={20} /></IconButton>
      </header>
      <section className="mp-social-profile">
        <Avatar size={72} style={{ background: GRADIENTS[2], borderRadius: 22 }}>BL</Avatar>
        <h2>Bob Lee</h2>
        <p>@bob@bob.remote</p>
        <div className="mp-social-profile-meta"><Globe2 size={14} /> Remote Station · Verified friend</div>
        <div className="mp-social-profile-actions">
          <button type="button" className="primary" disabled={blocked} onClick={() => setFollowing((current) => !current)}>
            {following ? <Check size={16} /> : <UserPlus size={16} />} {blocked ? 'Blocked' : following ? 'Following' : 'Follow'}
          </button>
          <button type="button" disabled={blocked}><MessageCircle size={16} /> Message</button>
        </div>
        {blocked && <div className="mp-social-profile-blocked" role="status"><Ban size={15} /> Social authority confirms this actor is blocked.</div>}
        <div className="mp-social-profile-stats"><span><strong>24</strong>Posts</span><span><strong>18</strong>Following</span><span><strong>41</strong>Followers</span></div>
      </section>
      <section className="mp-social-profile-feed">
        <h3>Recent Moments</h3>
        {moments.slice(0, 2).map((moment) => <button key={moment.id} type="button" onClick={() => onOpenMoment(moment.id)}><span>{moment.text}</span><ChevronRight size={17} /></button>)}
      </section>
      {showActions && (
        <div className="mp-action-sheet-backdrop" role="presentation">
          <section className="mp-action-sheet mp-social-compact-sheet" role="dialog" aria-label="Profile actions">
            <div className="mp-action-sheet-handle" />
            <div className="mp-action-group">
              <button type="button" className={blocked ? 'mp-action-item' : 'mp-action-item danger'} onClick={() => {
                setShowActions(false);
                if (blocked) {
                  setBlocked(false);
                  return;
                }
                setConfirmBlock(true);
              }}>
                <Ban size={18} /> {blocked ? 'Unblock Bob Lee' : 'Block Bob Lee'}
              </button>
            </div>
            <button type="button" className="mp-action-item mp-action-cancel" onClick={() => setShowActions(false)}>Cancel</button>
          </section>
        </div>
      )}
      {confirmBlock && (
        <div className="mp-action-sheet-backdrop" role="presentation">
          <section className="mp-action-sheet mp-social-confirm-sheet" role="alertdialog" aria-label="Block Bob Lee">
            <div className="mp-action-sheet-handle" />
            <div className="mp-social-confirm-copy">
              <Ban size={20} />
              <div><strong>Block Bob Lee?</strong><p>New feed, detail, interaction and recovery access will be denied after authoritative readback.</p></div>
            </div>
            <div className="mp-social-confirm-actions">
              <button type="button" onClick={() => setConfirmBlock(false)}>Cancel</button>
              <button type="button" className="danger" onClick={() => {
                setBlocked(true);
                setFollowing(false);
                setConfirmBlock(false);
              }}>Block</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function CirclePage({ onBack }: { onBack: () => void }) {
  const [circles, setCircles] = useState<CircleItem[]>(CIRCLES);
  const [selectedCircleId, setSelectedCircleId] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ circleId?: string; name: string; description: string } | null>(null);
  const [memberPickerOpen, setMemberPickerOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const selectedCircle = circles.find((circle) => circle.id === selectedCircleId);

  function saveCircle() {
    if (!editing?.name.trim()) return;
    if (editing.circleId) {
      setCircles((current) => current.map((circle) => (
        circle.id === editing.circleId
          ? { ...circle, name: editing.name.trim(), description: editing.description.trim() }
          : circle
      )));
    } else {
      const id = `circle-${Date.now()}`;
      setCircles((current) => [...current, {
        id,
        name: editing.name.trim(),
        description: editing.description.trim() || 'Private audience list',
        members: [],
      }]);
      setSelectedCircleId(id);
    }
    setEditing(null);
  }

  if (selectedCircle && memberPickerOpen) {
    return (
      <CircleMemberPickerPage
        circle={selectedCircle}
        onBack={() => setMemberPickerOpen(false)}
        onAdd={(name) => {
          setCircles((current) => current.map((circle) => (
            circle.id === selectedCircle.id && !circle.members.includes(name)
              ? { ...circle, members: [...circle.members, name] }
              : circle
          )));
        }}
      />
    );
  }

  if (selectedCircle) {
    return (
      <div className="mp-detail-page">
        <header className="mp-detail-header">
          <IconButton label="Back to Circles" onClick={() => setSelectedCircleId(null)}><ArrowLeft size={20} /></IconButton>
          <h1 className="mp-detail-header-title">{selectedCircle.name}</h1>
          <IconButton label="Rename circle" onClick={() => setEditing({
            circleId: selectedCircle.id,
            name: selectedCircle.name,
            description: selectedCircle.description,
          })}><Pencil size={19} /></IconButton>
        </header>
        <div className="mp-social-circle-copy"><ShieldCheck size={18} /><span>{selectedCircle.description}. Membership is publisher-private.</span></div>
        <section className="mp-social-circle-detail">
          <div className="mp-social-section-heading">
            <span><strong>Members</strong><small>{selectedCircle.members.length} people</small></span>
            <button type="button" onClick={() => setMemberPickerOpen(true)}><UserPlus size={16} /> Add</button>
          </div>
          {selectedCircle.members.map((member) => (
            <div key={member} className="mp-social-member-row">
              <Avatar size={36} style={{ background: GRADIENTS[2], borderRadius: 11 }}>{member.split(' ').map((part) => part[0]).join('')}</Avatar>
              <span><strong>{member}</strong><small>Canonical actor identity</small></span>
              <button type="button" aria-label={`Remove ${member}`} onClick={() => setCircles((current) => current.map((circle) => (
                circle.id === selectedCircle.id
                  ? { ...circle, members: circle.members.filter((name) => name !== member) }
                  : circle
              )))}><UserMinus size={17} /></button>
            </div>
          ))}
          {selectedCircle.members.length === 0 && <div className="mp-social-empty-inline">No members yet. Add people before publishing to this Circle.</div>}
        </section>
        <section className="mp-social-danger-group">
          <button type="button" onClick={() => setConfirmDelete(true)}><Trash2 size={17} /> Delete Circle</button>
        </section>
        {editing && (
          <CircleEditSheet editing={editing} onChange={setEditing} onCancel={() => setEditing(null)} onSave={saveCircle} />
        )}
        {confirmDelete && (
          <div className="mp-action-sheet-backdrop" role="presentation">
            <section className="mp-action-sheet mp-social-confirm-sheet" role="alertdialog" aria-label="Delete Circle">
              <div className="mp-action-sheet-handle" />
              <div className="mp-social-confirm-copy">
                <Trash2 size={20} />
                <div><strong>Delete {selectedCircle.name}?</strong><p>Existing posts keep their canonical audience snapshot. New publishes cannot target this Circle.</p></div>
              </div>
              <div className="mp-social-confirm-actions">
                <button type="button" onClick={() => setConfirmDelete(false)}>Cancel</button>
                <button type="button" className="danger" onClick={() => {
                  setCircles((current) => current.filter((circle) => circle.id !== selectedCircle.id));
                  setSelectedCircleId(null);
                  setConfirmDelete(false);
                }}>Delete</button>
              </div>
            </section>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="mp-detail-page">
      <header className="mp-detail-header">
        <IconButton label="Back to Moments" onClick={onBack}><ArrowLeft size={20} /></IconButton>
        <h1 className="mp-detail-header-title">Circles</h1>
        <IconButton label="Create circle" onClick={() => setEditing({ name: '', description: '' })}><Plus size={19} /></IconButton>
      </header>
      <div className="mp-social-circle-copy"><ShieldCheck size={18} /><span>Circles are private audience lists. Members cannot see the full list.</span></div>
      <div className="mp-social-circle-list">
        {circles.map((circle) => (
          <button key={circle.id} type="button" onClick={() => setSelectedCircleId(circle.id)}>
            <span className="mp-social-audience-icon"><UsersRound size={18} /></span>
            <span><strong>{circle.name}</strong><small>{circle.description} · {circle.members.length} members</small></span>
            <ChevronRight size={17} />
          </button>
        ))}
      </div>
      {editing && (
        <CircleEditSheet editing={editing} onChange={setEditing} onCancel={() => setEditing(null)} onSave={saveCircle} />
      )}
    </div>
  );
}

function CircleEditSheet({
  editing,
  onChange,
  onCancel,
  onSave,
}: {
  editing: { circleId?: string; name: string; description: string };
  onChange: (next: { circleId?: string; name: string; description: string }) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <div className="mp-action-sheet-backdrop" role="presentation">
      <section className="mp-action-sheet mp-social-circle-editor" role="dialog" aria-label={editing.circleId ? 'Rename Circle' : 'Create Circle'}>
        <div className="mp-action-sheet-handle" />
        <header className="mp-social-sheet-header">
          <button type="button" aria-label="Close Circle editor" onClick={onCancel}><X size={20} /></button>
          <h2>{editing.circleId ? 'Edit Circle' : 'New Circle'}</h2>
          <button type="button" className="primary" disabled={!editing.name.trim()} onClick={onSave}>Save</button>
        </header>
        <div className="mp-social-form">
          <label><span>Name</span><input value={editing.name} onChange={(event) => onChange({ ...editing, name: event.target.value })} placeholder="Circle name" /></label>
          <label><span>Description</span><textarea value={editing.description} onChange={(event) => onChange({ ...editing, description: event.target.value })} placeholder="Who belongs here?" /></label>
        </div>
      </section>
    </div>
  );
}

function CircleMemberPickerPage({
  circle,
  onBack,
  onAdd,
}: {
  circle: CircleItem;
  onBack: () => void;
  onAdd: (name: string) => void;
}) {
  const [query, setQuery] = useState('');
  const visible = PEOPLE.filter((person) => `${person.name} ${person.handle}`.toLowerCase().includes(query.toLowerCase()));
  return (
    <div className="mp-detail-page">
      <header className="mp-detail-header">
        <IconButton label="Back to Circle" onClick={onBack}><ArrowLeft size={20} /></IconButton>
        <h1 className="mp-detail-header-title">Add people</h1>
      </header>
      <div className="mp-social-search">
        <label><Search size={17} /><input aria-label="Search Circle members" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search people" /></label>
        <p>People in your active Federation</p>
        {visible.map((person) => {
          const added = circle.members.includes(person.name);
          return (
            <div key={person.id} className="mp-social-member-row">
              <Avatar size={40} style={{ background: GRADIENTS[2], borderRadius: 12 }}>{person.name.split(' ').map((part) => part[0]).join('')}</Avatar>
              <span><strong>{person.name}</strong><small>{person.handle}</small></span>
              <button type="button" disabled={added} onClick={() => onAdd(person.name)}>{added ? <Check size={17} /> : <UserPlus size={17} />}</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ReactionPicker({ active, onReact }: { active?: ReactionKind; onReact: (kind: ReactionKind) => void }) {
  const kinds: ReactionKind[] = ['like', 'love', 'laugh', 'wow', 'celebrate'];
  return (
    <div className="mp-moment-reaction-picker" aria-label="Choose reaction">
      {kinds.map((kind) => <button key={kind} type="button" className={active === kind ? 'mp-moment-reaction-picker-btn active' : 'mp-moment-reaction-picker-btn'} aria-label={kind} onClick={() => onReact(kind)}>{REACTION_EMOJI[kind]}</button>)}
    </div>
  );
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return <button type="button" className="mp-header-action" aria-label={label} onClick={onClick}>{children}</button>;
}
