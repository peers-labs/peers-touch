import {
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useT } from '../i18n';
import { Icon, IconButton, MomentPoll, Text, TextField } from '@peers-touch/ui';
import type {
  Moment,
  MomentComment,
  ReactionKind,
} from '../types';
import {
  REACTION_EMOJI,
  REACTION_KINDS,
  type IconName,
} from '../types';
import { demoAvatarUrls, demoMediaBackgrounds, preparedMomentsData } from './moments.data';
import { IdentityAvatar } from '../components/IdentityAvatar';
import { ReactionChip } from '../../../../shared/ReactionChip';
import { ReactionPicker } from '../../../../shared/ReactionPicker';

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
  iconId: IconName;
  requiresTarget?: boolean;
};

const AUDIENCES: AudienceOption[] = [
  { id: 'PUBLIC', label: 'Public', detail: 'Anyone can read it', iconId: 'globe' },
  { id: 'FOLLOWERS', label: 'Followers', detail: 'Anyone following you', iconId: 'users-round' },
  { id: 'FRIENDS', label: 'Friends', detail: 'Accepted friends only', iconId: 'shield-check' },
  { id: 'CIRCLE', label: 'Circle', detail: 'Choose a private audience list', iconId: 'users-round', requiresTarget: true },
  { id: 'GROUP', label: 'Group', detail: 'Choose a conversation', iconId: 'users-round', requiresTarget: true },
  { id: 'CUSTOM_ALLOW', label: 'Selected people', detail: 'Choose one or more people', iconId: 'user-round', requiresTarget: true },
  { id: 'CUSTOM_DENY', label: 'Followers except', detail: 'Choose people to exclude', iconId: 'user-minus', requiresTarget: true },
  { id: 'SELF', label: 'Only me', detail: 'Your trusted devices', iconId: 'lock-keyhole' },
];

const COMPOSER_DRAFT_STORAGE_KEY =
  'peers-touch.prototype.moments.composer-draft.v1';

interface PrototypeComposerDraft {
  readonly text: string;
  readonly imageSelected: boolean;
  readonly audienceId: AudienceOption['id'];
  readonly audienceDetail: string;
}

function loadPrototypeComposerDraft(): PrototypeComposerDraft | null {
  if (typeof window === 'undefined') return null;
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(COMPOSER_DRAFT_STORAGE_KEY) ?? 'null',
    ) as PrototypeComposerDraft | null;
    if (!parsed || typeof parsed.text !== 'string') return null;
    if (!AUDIENCES.some((option) => option.id === parsed.audienceId)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function persistPrototypeComposerDraft(
  text: string,
  imageSelected: boolean,
  audience: AudienceOption,
): void {
  try {
    window.localStorage.setItem(COMPOSER_DRAFT_STORAGE_KEY, JSON.stringify({
      text,
      imageSelected,
      audienceId: audience.id,
      audienceDetail: audience.detail,
    } satisfies PrototypeComposerDraft));
  } catch {
    // The prototype remains usable when storage is unavailable.
  }
}

function clearPrototypeComposerDraft(): void {
  try {
    window.localStorage.removeItem(COMPOSER_DRAFT_STORAGE_KEY);
  } catch {
    // The prototype remains usable when storage is unavailable.
  }
}

type CircleItem = {
  id: string;
  name: string;
  description: string;
  members: string[];
};

const CIRCLES: CircleItem[] = [
  { id: 'family', name: 'Family', description: 'The people closest to you', members: ['Bob Zhang', 'Carol Li', 'Emma Liu', 'David Wu'] },
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

export function preparedMoments(): Moment[] {
  return preparedMomentsData();
}

export function MomentsPage({
  scenario = 'social-parity',
  onImmersiveVisibilityChange,
  searchTarget,
  onTargetConsumed,
}: {
  searchTarget?: { postId: string; commentId?: string };
  scenario?: MomentsEvidenceScenario;
  onImmersiveVisibilityChange?: (visible: boolean) => void;
  onTargetConsumed?: () => void;
}) {
  const t = useT();
  const restoredComposerDraft = useMemo(loadPrototypeComposerDraft, []);
  const restoredAudience = useMemo(() => {
    const base = AUDIENCES.find(
      (option) => option.id === restoredComposerDraft?.audienceId,
    ) ?? AUDIENCES[2]!;
    return restoredComposerDraft
      ? { ...base, detail: restoredComposerDraft.audienceDetail }
      : base;
  }, [restoredComposerDraft]);
  const [moments, setMoments] = useState<Moment[]>(preparedMoments);
  const [scope, setScope] = useState<SocialScope>('home');
  const [exploreSort, setExploreSort] = useState<'recent' | 'hot'>('recent');
  const [view, setView] = useState<SocialView>('feed');
  const [activeCommentComposerId, setActiveCommentComposerId] = useState<string | null>(null);
  const [expandedCommentListId, setExpandedCommentListId] = useState<string | null>(null);
  const [reactionPickerId, setReactionPickerId] = useState<string | null>(null);
  const [mediaPreview, setMediaPreview] = useState<MediaPreview | null>(null);
  const [actionMomentId, setActionMomentId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [showComposer, setShowComposer] = useState(false);
  const [showAudience, setShowAudience] = useState(false);
  const [showSort, setShowSort] = useState(false);
  const [composerImageSelected, setComposerImageSelected] = useState(
    restoredComposerDraft?.imageSelected ?? false,
  );
  const [targetAudience, setTargetAudience] = useState<AudienceOption | null>(null);
  const [newPostText, setNewPostText] = useState(
    restoredComposerDraft?.text
      ?? 'A quiet afternoon, shared with the people I trust.',
  );
  const [audience, setAudience] = useState<AudienceOption>(restoredAudience);
  const [commentInputs, setCommentInputs] = useState<Record<string, string>>({});
  const actionMoment = moments.find((moment) => moment.id === actionMomentId);
  const previewMoment = moments.find((moment) => moment.id === mediaPreview?.momentId);

  useEffect(() => {
    setView('feed');
    setScope('home');
    setActiveCommentComposerId(null);
    setExpandedCommentListId(null);
    setReactionPickerId(null);
  }, [scenario]);

  useEffect(() => {
    if (searchTarget?.commentId) setExpandedCommentListId(searchTarget.postId);
  }, [searchTarget]);

  useEffect(() => {
    if (!searchTarget) return;
    const post = document.querySelector<HTMLElement>(
      `[data-moment-id="${CSS.escape(searchTarget.postId)}"]`,
    );
    const target = searchTarget.commentId ? post?.querySelector<HTMLElement>(
      `[data-comment-id="${CSS.escape(searchTarget.commentId)}"]`,
    ) : post;
    // Defer consumption until the expanded comment list actually materializes.
    if (searchTarget.commentId && !target) return;
    target?.setAttribute('data-search-target', 'true');
    target?.scrollIntoView({ block: 'center' });
    target?.focus({ preventScroll: true });
    onTargetConsumed?.();
  }, [searchTarget, expandedCommentListId]);

  useEffect(() => {
    onImmersiveVisibilityChange?.(view !== 'feed');
    return () => onImmersiveVisibilityChange?.(false);
  }, [onImmersiveVisibilityChange, view]);

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
    setReactionPickerId(null);
    setView(next);
  }

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

  function votePoll(id: string, choices: number[]) {
    setMoments(current => current.map(moment => {
      const poll = moment.poll;
      if (moment.id !== id || !poll || poll.closed || choices.length < poll.minChoices || choices.length > poll.maxChoices
        || choices.some((value, index) => value < 0 || value >= poll.options.length
          || !Number.isInteger(value) || (index > 0 && choices[index - 1] >= value))) return moment;
      const counts = poll.voteCounts.map((count, index) => count
        - Number(poll.confirmedChoices.includes(index)) + Number(choices.includes(index)));
      return { ...moment, poll: { ...poll, confirmedChoices: [...choices], voteCounts: counts, voterCount: 1 } };
    }));
  }

  function addComment(momentId: string) {
    const text = (commentInputs[momentId] ?? '').trim();
    if (!text) return;
    const comment: MomentComment = {
      id: `c-${Date.now()}`,
      name: 'Alice Chen',
      avatar: 'AC',
      avatarUrl: demoAvatarUrls.alice,
      text,
      time: 'Just now',
    };
    setMoments((current) => current.map((moment) => (
      moment.id === momentId ? { ...moment, comments: [...moment.comments, comment] } : moment
    )));
    setExpandedCommentListId(momentId);
    setCommentInputs((current) => ({ ...current, [momentId]: '' }));
  }

  function publishPost() {
    const text = newPostText.trim();
    if (!text) return;
    const moment: Moment = {
      id: `mo-${Date.now()}`,
      name: 'Alice Chen',
      avatar: 'AC',
      avatarUrl: demoAvatarUrls.alice,
      time: 'Just now',
      text,
      source: 'alice.station',
      audience: audience.label,
      reason: 'You published this',
      images: composerImageSelected ? [demoMediaBackgrounds.teamReview] : undefined,
      contentKind: composerImageSelected ? 'image' : 'text',
      likes: 0,
      reactionCounts: {},
      comments: [],
    };
    setMoments((current) => [moment, ...current]);
    setScope('home');
    setActiveCommentComposerId(null);
    clearPrototypeComposerDraft();
    setNewPostText('');
    setComposerImageSelected(false);
    setAudience(AUDIENCES[2]!);
    setShowAudience(false);
    setTargetAudience(null);
    setShowComposer(false);
  }

  function closeComposer() {
    persistPrototypeComposerDraft(
      newPostText,
      composerImageSelected,
      audience,
    );
    setShowAudience(false);
    setTargetAudience(null);
    setShowComposer(false);
  }

  function clearComposer() {
    clearPrototypeComposerDraft();
    setNewPostText('');
    setComposerImageSelected(false);
    setAudience(AUDIENCES[2]!);
    setShowAudience(false);
    setTargetAudience(null);
  }

  function deletePost(momentId: string) {
    setMoments((current) => current.filter((moment) => moment.id !== momentId));
    setActiveCommentComposerId(null);
    setExpandedCommentListId(null);
    setActionMomentId(null);
    setConfirmDeleteId(null);
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
        <h1 className="mp-header-title">{t('mobile.moments.title')}</h1>
        <div className="mp-social-header-actions">
          <IconButton actionId="moments.people-search" iconId="contact" label={t('mobile.moments.searchPeopleShort')} emphasis="quiet"
            onActivate={() => navigate('search')} />
          <IconButton actionId="moments.circles" iconId="users-round" label={t('mobile.moments.manageCircles')} emphasis="quiet"
            onActivate={() => navigate('circles')} />
          <IconButton actionId="moments.new" iconId="image-plus" label={t('mobile.moments.newPostShort')} emphasis="quiet"
            onActivate={() => setShowComposer(true)} />
        </div>
      </header>

      <div className="mp-social-scope" aria-label={t('mobile.moments.scope')}>
        {(['home', 'explore'] as const).map((item) => (
          <button
            key={item}
            type="button"
            className={scope === item ? 'active' : ''}
            aria-pressed={scope === item}
            onClick={() => {
              setReactionPickerId(null);
              setScope(item);
            }}
          >
            {item === 'home' ? 'Home' : 'Explore'}
          </button>
        ))}
      </div>

      <div className="mp-social-context">
        <span>{scope === 'home' ? 'Posts shared with you' : 'Public activity across your Federation'}</span>
        {scope === 'explore' ? (
          <button type="button" onClick={() => setShowSort(true)}>
            <Icon iconId="sliders-horizontal" size={13} /> {exploreSort === 'recent' ? t('mobile.moments.sort.recent') : t('mobile.moments.sort.hot')}
          </button>
        ) : <span>{t('mobile.moments.sort.latest')}</span>}
      </div>

      <div className="mp-moments-feed">
        {visibleMoments.map((moment) => (
          <MomentArticle
            key={moment.id}
            moment={moment}
            scenario={moment.id === moments[0]?.id ? scenario : 'social-parity'}
            commentComposerOpen={activeCommentComposerId === moment.id}
            commentsExpanded={expandedCommentListId === moment.id}
            reactionPickerOpen={reactionPickerId === moment.id}
            onOpenProfile={() => navigate('profile')}
            onReact={(kind) => toggleReaction(moment.id, kind)}
            onVote={choices => votePoll(moment.id, choices)}
            onToggleReactionPicker={() =>
              setReactionPickerId((current) =>
                current === moment.id ? null : moment.id,
              )
            }
            onToggleCommentComposer={() => {
              setReactionPickerId(null);
              setActiveCommentComposerId((current) =>
                current === moment.id ? null : moment.id,
              );
            }}
            onToggleMoreComments={() => setExpandedCommentListId((current) => (
              current === moment.id ? null : moment.id
            ))}
            commentText={commentInputs[moment.id] ?? ''}
            onCommentChange={(value) => setCommentInputs((current) => ({
              ...current,
              [moment.id]: value,
            }))}
            onComment={() => addComment(moment.id)}
            onOpenMedia={(kind) => {
              setReactionPickerId(null);
              setMediaPreview({ momentId: moment.id, kind });
            }}
            onOpenActions={() => {
              setReactionPickerId(null);
              setActionMomentId(moment.id);
            }}
          />
        ))}
      </div>

      {showComposer && (
        <div
          className="mp-action-sheet-backdrop"
          role="presentation"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) closeComposer();
          }}
        >
          <section
            className="mp-action-sheet mp-social-composer-sheet"
            role="dialog"
            aria-label={t('mobile.moment.newAria')}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <div className="mp-action-sheet-handle" />
            <header className="mp-social-sheet-header">
              <button type="button" className="mp-social-clear" onClick={clearComposer}>{t('mobile.moments.clear')}</button>
              <h2>{t('mobile.moments.newPost')}</h2>
              <button type="button" className="mp-social-header-commit" disabled={!newPostText.trim()} onClick={publishPost}>{t('mobile.moments.publish')}</button>
            </header>
            <textarea
              aria-label={t('mobile.moment.compose.aria')}
              value={newPostText}
              onChange={(event) => setNewPostText(event.target.value)}
              placeholder={t('mobile.moments.placeholder')}
            />
            {composerImageSelected ? (
              <div className="mp-social-media-preview" aria-label={t('mobile.moments.selectedImage')}>
                <div style={{ background: demoMediaBackgrounds.teamReview }} />
                <button type="button" aria-label={t('mobile.moment.removeImage')} onClick={() => setComposerImageSelected(false)}>
                  <Icon iconId="close" size={15} />
                </button>
              </div>
            ) : (
              <button type="button" className="mp-social-media-add" aria-label={t('mobile.moment.addImage')} onClick={() => setComposerImageSelected(true)}>
                <Icon iconId="image-plus" size={22} />
                <span>{t('mobile.moment.addImage')}</span>
              </button>
            )}
            <button type="button" className="mp-social-audience-row" onClick={() => setShowAudience(true)}>
              <span className="mp-social-audience-icon"><Icon iconId={audience.iconId} size={17} /></span>
              <span><strong>{audience.label}</strong><small>{audience.detail}</small></span>
              <Icon iconId="chevron-right" size={17} />
            </button>
            <div className="mp-social-composer-meta">
              <span><Icon iconId="shield-check" size={14} /> Private content is encrypted on this device</span>
              <span>{newPostText.length}/5000</span>
            </div>
          </section>
        </div>
      )}

      {showAudience && (
        <div
          className="mp-action-sheet-backdrop mp-social-audience-backdrop"
          role="presentation"
          onPointerDown={(event) => {
            event.stopPropagation();
            setShowAudience(false);
          }}
        >
          <section
            className="mp-action-sheet mp-social-audience-sheet"
            role="dialog"
            aria-label={t('mobile.moments.audience.label')}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <div className="mp-action-sheet-handle" />
            <header className="mp-social-sheet-header">
              <span className="mp-social-sheet-spacer" />
              <h2>{t('mobile.moments.audience.label')}</h2>
              <span className="mp-social-sheet-spacer" />
            </header>
            <p className="mp-social-sheet-copy">{t('mobile.moments.audienceCopy')}</p>
            <div className="mp-social-audience-list">
              {AUDIENCES.map((option) => (
                <button key={option.id} type="button" onClick={() => {
                  if (option.requiresTarget) {
                    setTargetAudience(option);
                    return;
                  }
                  setAudience(option);
                  setShowAudience(false);
                }}>
                  <span className="mp-social-audience-icon"><Icon iconId={option.iconId} size={18} /></span>
                  <span><strong>{option.label}</strong><small>{option.detail}</small></span>
                  {audience.id === option.id ? <Icon iconId="check" size={18} /> : <Icon iconId="chevron-right" size={17} />}
                </button>
              ))}
            </div>
          </section>
        </div>
      )}

      {targetAudience && (
        <AudienceTargetPickerSheet
          audience={targetAudience}
          onDismiss={() => setTargetAudience(null)}
          onDone={(detail) => {
            setAudience({ ...targetAudience, detail });
            setTargetAudience(null);
            setShowAudience(false);
          }}
        />
      )}

      {showSort && (
        <div
          className="mp-action-sheet-backdrop mp-social-sort-backdrop"
          role="presentation"
          onPointerDown={() => setShowSort(false)}
        >
          <section
            className="mp-action-sheet mp-social-sort-sheet"
            role="dialog"
            aria-label={t('mobile.moment.sortAria')}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <div className="mp-action-sheet-handle" />
            <header className="mp-social-sheet-header">
              <span className="mp-social-sheet-spacer" />
              <h2>{t('mobile.moment.sortTitle')}</h2>
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
                  {exploreSort === option.id ? <Icon iconId="check" size={18} /> : null}
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
        <div
          className="mp-action-sheet-backdrop"
          role="presentation"
          onPointerDown={() => setActionMomentId(null)}
        >
          <section
            className="mp-action-sheet mp-social-compact-sheet"
            role="dialog"
            aria-label={t('mobile.moment.actionsAria')}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <div className="mp-action-sheet-handle" />
            <div className="mp-action-group">
              {actionMoment.name === 'Alice Chen' ? (
                <button type="button" className="mp-action-item danger" onClick={() => {
                  setActionMomentId(null);
                  setConfirmDeleteId(actionMoment.id);
                }}>
                  <Icon iconId="delete" size={18} /> {t('mobile.moments.deleteMoment')}
                </button>
              ) : (
                <button type="button" className="mp-action-item danger" onClick={() => setActionMomentId(null)}>
                  <Icon iconId="ban" size={18} /> {t('mobile.moment.block')} {actionMoment.name}
                </button>
              )}
            </div>
          </section>
        </div>
      )}

      {confirmDeleteId && (
        <div
          className="mp-action-sheet-backdrop"
          role="presentation"
          onPointerDown={() => setConfirmDeleteId(null)}
        >
          <section
            className="mp-action-sheet mp-social-confirm-sheet"
            role="alertdialog"
            aria-label={t('mobile.moments.deleteMoment')}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <div className="mp-action-sheet-handle" />
            <div className="mp-social-confirm-copy">
              <Icon iconId="delete" size={20} />
              <div><strong>{t('mobile.moments.delete.confirmTitle')}</strong><p>{t('mobile.moments.delete.confirmDescription')}</p></div>
            </div>
            <div className="mp-social-confirm-actions">
              <button type="button" onClick={() => setConfirmDeleteId(null)}>{t('mobile.chat.cancel')}</button>
              <button type="button" className="danger" onClick={() => deletePost(confirmDeleteId)}>{t('mobile.moments.delete.action')}</button>
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
  commentComposerOpen,
  commentsExpanded,
  reactionPickerOpen,
  onOpenProfile,
  onReact,
  onVote,
  onToggleReactionPicker,
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
  commentComposerOpen: boolean;
  commentsExpanded: boolean;
  reactionPickerOpen: boolean;
  onOpenProfile: () => void;
  onReact: (kind: ReactionKind) => void;
  onVote: (choices: number[]) => void;
  onToggleReactionPicker: () => void;
  onToggleCommentComposer: () => void;
  onToggleMoreComments: () => void;
  commentText: string;
  onCommentChange: (value: string) => void;
  onComment: () => void;
  onOpenMedia: (kind: 'image' | 'video') => void;
  onOpenActions: () => void;
}) {
  const t = useT();
  const hidesPlaintext = scenario === 'social-recovery-required' || scenario === 'social-revoked';
  const interactionsDisabled = hidesPlaintext || scenario === 'social-source-unavailable';
  const visibleComments = commentsExpanded ? moment.comments : moment.comments.slice(0, 10);
  const hiddenCommentCount = Math.max(0, moment.comments.length - visibleComments.length);
  const myReactions = new Set(moment.myReactions ?? []);
  return (
    <article className="mp-social-moment" data-moment-id={moment.id} tabIndex={-1}>
      <div className="mp-social-author-row">
        <button type="button" className="mp-social-author" onClick={onOpenProfile}>
          <IdentityAvatar name={moment.name} initials={moment.avatar} src={moment.avatarUrl} size={40} />
          <span>
            <strong>{moment.name}</strong>
            <small>{moment.source} · {moment.time}</small>
          </span>
        </button>
        {!hidesPlaintext ? (
          <button type="button" className="mp-social-more" aria-label={`Actions for ${moment.name}'s Moment`} onClick={onOpenActions}>
            <Icon iconId="more-horizontal" size={18} />
          </button>
        ) : null}
      </div>

      {!hidesPlaintext && (
        <div className="mp-social-body">
          <span>{moment.text}</span>
          {moment.images?.length ? (
            <button type="button" className="mp-social-image" aria-label={t('mobile.moments.previewImage')} style={{ background: moment.images[0] }} onClick={() => onOpenMedia('image')} />
          ) : null}
        </div>
      )}
      {!hidesPlaintext && moment.contentKind === 'video' && (
        <button type="button" className="mp-social-content-addon mp-social-video" onClick={() => onOpenMedia('video')}>
          <span><Icon iconId="play" size={24} /></span>
          <small>{moment.videoLabel} · Encrypted video</small>
        </button>
      )}
      {!hidesPlaintext && moment.link && (
        <button type="button" className="mp-social-content-addon">
          <span className="mp-social-content-icon"><Icon iconId="link" size={17} /></span>
          <span><strong>{moment.link.title}</strong><small>{moment.link.url}</small></span>
          <Icon iconId="external-link" size={16} />
        </button>
      )}
      {!hidesPlaintext && moment.poll && (
        <MomentPoll postId={moment.id} question={moment.poll.question}
          options={moment.poll.options.map((text, index) => ({ text, votes: moment.poll!.voteCounts[index] }))}
          minChoices={moment.poll.minChoices} maxChoices={moment.poll.maxChoices}
          confirmedChoices={moment.poll.confirmedChoices} totalVotes={moment.poll.voterCount}
          closed={moment.poll.closed} disabled={interactionsDisabled}
          pending={scenario === 'social-private-pending'} onSubmit={onVote}
          status={moment.poll.confirmedChoices.length ? t('moments.poll.state.committed') : undefined}
          copy={{ submit: t('moments.poll.submit'), replace: t('moments.poll.replace'), cancel: t('moments.poll.cancel'),
            retry: t('moments.poll.retry'), closed: t('moments.poll.closed'),
            choices: (min, max) => t('moments.poll.choices', { min, max }), total: votes => t('moments.poll.total', { votes }) }} />
      )}
      {!hidesPlaintext && moment.repost && (
        <div className="mp-social-repost">
          <strong><Icon iconId="repeat-2" size={15} /> {moment.repost.author}</strong>
          <span>{moment.repost.text}</span>
        </div>
      )}
      {!hidesPlaintext && moment.location && (
        <div className="mp-social-content-addon">
          <span className="mp-social-content-icon"><Icon iconId="map-pin" size={17} /></span>
          <span><strong>{moment.location.name}</strong><small>{moment.location.address}</small></span>
        </div>
      )}

      <ScenarioState scenario={scenario} />

      <div className="mp-social-trust-meta">
        <Icon iconId={moment.remote ? 'globe' : 'shield-check'} size={13} />
        <span>{moment.audience} · {moment.reason}</span>
      </div>

      {REACTION_KINDS.some(
        (kind) => (moment.reactionCounts?.[kind] ?? 0) > 0,
      ) ? (
        <div className="mp-moment-reaction-summary">
          {REACTION_KINDS.map((kind) => {
            const count = moment.reactionCounts?.[kind] ?? 0;
            if (count === 0) return null;
            return (
              <ReactionChip
                key={kind}
                touch
                scope="moment"
                reactionId={kind}
                emoji={REACTION_EMOJI[kind]}
                count={count}
                selected={myReactions.has(kind)}
                label={t('mobile.chat.reactWith').replace(
                  '{{reaction}}',
                  REACTION_EMOJI[kind],
                )}
                disabled={interactionsDisabled}
                onClick={() => onReact(kind)}
              />
            );
          })}
        </div>
      ) : null}

      <div className="mp-moment-actions">
        <div className="mp-moment-action-group">
          <ReactionChip
            touch
            scope="moment"
            disabled={interactionsDisabled}
            className="mp-moment-reaction-open"
            label={t('mobile.chat.addReaction')}
            expanded={reactionPickerOpen}
            onClick={onToggleReactionPicker}
          />
          <button type="button" disabled={hidesPlaintext}
            className={commentComposerOpen ? 'mp-moment-action active' : 'mp-moment-action'}
            aria-label={commentComposerOpen ? 'Hide comment composer' : 'Add comment'}
            aria-pressed={commentComposerOpen}
            onClick={onToggleCommentComposer}>
            <Icon iconId="message-circle" size={18} /><span className="mp-moment-action-count">{moment.comments.length}</span>
          </button>
          <button
            type="button"
            className="mp-moment-action mp-moment-action--share"
            aria-label={t('mobile.moment.shareUnavailable')}
            title={t('mobile.moment.shareUnavailable')}
            disabled
          >
            <Icon iconId="share-2" size={18} />
          </button>
        </div>
      </div>

      {reactionPickerOpen ? (
        <ReactionPicker
          className="mp-moment-reaction-picker"
          label={t('mobile.chat.addReaction')}
          items={REACTION_KINDS.map((kind) => ({
            id: kind,
            emoji: REACTION_EMOJI[kind],
            selected: myReactions.has(kind),
            label: t('mobile.chat.reactWith').replace(
              '{{reaction}}',
              REACTION_EMOJI[kind],
            ),
          }))}
          disabled={interactionsDisabled}
          onToggle={onReact}
        />
      ) : null}

      {!hidesPlaintext && (moment.comments.length > 0 || commentComposerOpen) && (
        <section className="mp-social-comments mp-social-comments-inline" aria-label={`Comments on ${moment.name}'s Moment`}>
          {visibleComments.map((comment) => (
            <div key={comment.id} className="mp-moment-comment" data-comment-id={comment.id} tabIndex={-1}>
              <IdentityAvatar name={comment.name} initials={comment.avatar} src={comment.avatarUrl} size={28} />
              <div className="mp-moment-comment-body">
                <span>
                  <Text strong className="mp-moment-comment-name">{comment.name}</Text>
                  {' '}
                  <span className="mp-moment-comment-text">{comment.text}</span>
                </span>
                <Text tone="muted" className="mp-moment-comment-time">{comment.time} · Reply</Text>
              </div>
            </div>
          ))}
          {moment.comments.length > 10 && (
            <button type="button" className="mp-social-comments-more" onClick={onToggleMoreComments}>
              {commentsExpanded ? 'Show fewer comments' : `View ${hiddenCommentCount} more comments`}
            </button>
          )}
          {commentComposerOpen && !interactionsDisabled && (
            <div className="mp-social-comment-composer-inline">
              <input aria-label={t('mobile.moment.commentAdd')} value={commentText} onChange={(event) => onCommentChange(event.target.value)} placeholder={t('mobile.moments.comment.placeholder')} />
              <button type="button" aria-label={t('mobile.moment.commentSend')} disabled={!commentText.trim()} onClick={onComment}>
                <Icon iconId="send" size={16} />
              </button>
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
  const t = useT();
  return (
    <div className="mp-social-media-overlay" role="presentation" onClick={onClose}>
      <section className="mp-social-media-dialog" role="dialog" aria-modal="true"
        aria-label={`${kind === 'image' ? 'Image' : 'Video'} preview`}
        onClick={(event) => event.stopPropagation()}>
        <header>
          <span>{moment.name}</span>
          <button type="button" aria-label={t('mobile.moment.closePreview')} onClick={onClose}>
            <Icon iconId="close" size={20} />
          </button>
        </header>
        {kind === 'image' ? (
          <div className="mp-social-media-canvas" style={{ background: moment.images?.[0] }} />
        ) : (
          <div className="mp-social-media-canvas mp-social-media-video">
            <span><Icon iconId="play" size={30} /></span>
            <small>{moment.videoLabel} · Tap to play</small>
          </div>
        )}
        <footer>{moment.text}</footer>
      </section>
    </div>
  );
}

function ScenarioState({ scenario }: { scenario: MomentsEvidenceScenario }) {
  const t = useT();
  if (scenario === 'social-parity' || scenario === 'social-content-types') return null;
  const states = {
    'social-private-pending': {
      iconId: 'refresh-ccw',
      title: 'Delivery pending',
      detail: 'Bob Station is unavailable. This Moment will retry with the same delivery identity.',
      action: 'Check delivery',
      tone: 'pending',
    },
    'social-recovery-required': {
      iconId: 'lock-keyhole',
      title: 'Recovery required',
      detail: 'Restore this trusted device before reading private history.',
      action: 'Start recovery',
      tone: 'blocking',
    },
    'social-source-unavailable': {
      iconId: 'attention',
      title: 'Source temporarily unavailable',
      detail: 'Verified content remains readable. New comments and reactions are paused.',
      action: 'Retry',
      tone: 'warning',
    },
    'social-revoked': {
      iconId: 'delete',
      title: 'Moment deleted or access revoked',
      detail: 'New reads, interactions and recovery are blocked. Saved copies cannot be remotely erased.',
      action: 'Back to Moments',
      tone: 'danger',
    },
  } as const;
  const state = states[scenario];
  return (
    <section className={`mp-social-state ${state.tone}`} role="status">
      <span><Icon iconId={state.iconId} size={18} /></span>
      <div><strong>{state.title}</strong><p>{state.detail}</p></div>
      <button type="button"><Icon iconId="refresh-ccw" size={15} /> {state.action}</button>
    </section>
  );
}

function AudienceTargetPickerSheet({
  audience,
  onDismiss,
  onDone,
}: {
  audience: AudienceOption;
  onDismiss: () => void;
  onDone: (detail: string) => void;
}) {
  const t = useT();
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
    <div
      className="mp-action-sheet-backdrop mp-social-target-backdrop"
      role="presentation"
      onPointerDown={(event) => {
        event.stopPropagation();
        onDismiss();
      }}
    >
      <section
        className="mp-action-sheet mp-social-target-sheet"
        role="dialog"
        aria-label={title}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="mp-action-sheet-handle" />
        <header className="mp-social-sheet-header">
          <span className="mp-social-sheet-spacer" />
          <h2>{title}</h2>
          {customAudience ? (
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
          ) : <span className="mp-social-sheet-spacer" />}
        </header>
        <div className="mp-social-target-copy">
          <Icon iconId="shield-check" size={17} />
          <span>
            {audience.id === 'CUSTOM_DENY'
              ? 'The base audience stays Followers. Selected people are excluded.'
              : 'The selected target is stored as canonical audience identity.'}
          </span>
        </div>
        {customAudience && (
          <div className="mp-social-search mp-social-target-search">
            <TextField
              aria-label={t('mobile.moments.audience.searchPeople')}
              placeholder={t('mobile.moments.audience.searchPeople')}
              value={query}
              clearable
              onClear={() => setQuery('')}
              leading={<Icon iconId="search" size={16} />}
              onValueChange={setQuery}
            />
          </div>
        )}
        <div className="mp-social-choice-list mp-social-target-list">
          {singleOptions.map((option) => (
            <button key={option.id} type="button" onClick={() => onDone(`${option.name} · ${option.detail}`)}>
              <span className="mp-social-audience-icon"><Icon iconId="users-round" size={18} /></span>
              <span><strong>{option.name}</strong><small>{option.detail}</small></span>
              <Icon iconId="chevron-right" size={17} />
            </button>
          ))}
          {customAudience && visiblePeople.map((person) => {
            const selected = selectedIds.includes(person.id);
            return (
              <button key={person.id} type="button" onClick={() => setSelectedIds((current) => (
                selected ? current.filter((id) => id !== person.id) : [...current, person.id]
              ))}>
                <span className="mp-social-selection-check">{selected ? <Icon iconId="check" size={16} /> : null}</span>
                <span><strong>{person.name}</strong><small>{person.handle}</small></span>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function SocialSearchPage({ onBack, onOpenProfile }: { onBack: () => void; onOpenProfile: () => void }) {
  const t = useT();
  return (
    <div className="mp-detail-page">
      <header className="mp-detail-header">
        <IconButton actionId="people-search.back" iconId="arrow-left" label={t('mobile.moments.backToMoments')} emphasis="quiet"
          onActivate={onBack} />
        <h1 className="mp-detail-header-title">{t('mobile.moments.searchPeopleShort')}</h1>
      </header>
      <div className="mp-social-search">
        <TextField
          aria-label={t('mobile.moments.searchPeopleShort')}
          defaultValue="@bob@bob.remote"
          leading={<Icon iconId="search" size={16} />}
        />
        <p>{t('mobile.moment.activeFederation')}</p>
        <button type="button" className="mp-social-person-row" onClick={onOpenProfile}>
          <IdentityAvatar name="Bob Lee" initials="BL" size={44} />
          <span><strong>Bob Lee</strong><small>@bob@bob.remote · {t('mobile.moment.friend')}</small></span>
          <span className="mp-row-chevron"><Icon iconId="chevron-right" size={18} /></span>
        </button>
      </div>
    </div>
  );
}

function SocialProfilePage({ moments, onBack, onOpenMoment }: { moments: Moment[]; onBack: () => void; onOpenMoment: (id: string) => void }) {
  const t = useT();
  const [following, setFollowing] = useState(true);
  const [blocked, setBlocked] = useState(false);
  const [showActions, setShowActions] = useState(false);
  const [confirmBlock, setConfirmBlock] = useState(false);
  return (
    <div className="mp-detail-page">
      <header className="mp-detail-header">
        <IconButton actionId="profile.back" iconId="arrow-left" label={t('mobile.moments.backToMoments')} emphasis="quiet"
          onActivate={onBack} />
        <h1 className="mp-detail-header-title">{t('mobile.moments.profileTitle')}</h1>
        <IconButton actionId="profile.actions" iconId="more-horizontal" label={t('mobile.moments.profileActions')} emphasis="quiet"
          onActivate={() => setShowActions(true)} />
      </header>
      <section className="mp-social-profile">
        <IdentityAvatar name="Bob Lee" initials="BL" size={72} />
        <h2>Bob Lee</h2>
        <p>@bob@bob.remote</p>
        <div className="mp-social-profile-meta"><Icon iconId="globe" size={14} /> Remote Station · Verified friend</div>
        <div className="mp-social-profile-actions">
          <button type="button" className="primary" disabled={blocked} onClick={() => setFollowing((current) => !current)}>
            {following ? <><Icon iconId="check" size={16} /> Following</> : <><Icon iconId="user-plus" size={16} /> Follow</>}
          </button>
          <button type="button" disabled={blocked}><Icon iconId="message-circle" size={16} /> Message</button>
        </div>
        {blocked && <div className="mp-social-profile-blocked" role="status"><Icon iconId="ban" size={15} /> Social authority confirms this actor is blocked.</div>}
      </section>
      <section className="mp-social-profile-feed">
        <h3>{t('mobile.moment.recentMoments')}</h3>
        {moments.slice(0, 2).map((moment) => <button key={moment.id} type="button" onClick={() => onOpenMoment(moment.id)}>
          <span>{moment.text}</span><Icon iconId="chevron-right" size={17} />
        </button>)}
      </section>
      {showActions && (
        <div className="mp-action-sheet-backdrop" role="presentation" onPointerDown={() => setShowActions(false)}>
          <section className="mp-action-sheet mp-social-compact-sheet" role="dialog" aria-label={t('mobile.moments.profileActions')}
            onPointerDown={(event) => event.stopPropagation()}>
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
                <Icon iconId="ban" size={18} /> {blocked ? 'Unblock Bob Lee' : 'Block Bob Lee'}
              </button>
            </div>
          </section>
        </div>
      )}
      {confirmBlock && (
        <div className="mp-action-sheet-backdrop" role="presentation" onPointerDown={() => setConfirmBlock(false)}>
          <section className="mp-action-sheet mp-social-confirm-sheet" role="alertdialog" aria-label={t('mobile.moment.blockTitle', { name: 'Bob Lee' })}
            onPointerDown={(event) => event.stopPropagation()}>
            <div className="mp-action-sheet-handle" />
            <div className="mp-social-confirm-copy">
              <Icon iconId="ban" size={20} />
              <div><strong>{t('mobile.moment.blockTitle', { name: 'Bob Lee' })}</strong><p>{t('mobile.moment.blockBody')}</p></div>
            </div>
            <div className="mp-social-confirm-actions">
              <button type="button" onClick={() => setConfirmBlock(false)}>{t('mobile.chat.cancel')}</button>
              <button type="button" className="danger" onClick={() => {
                setBlocked(true);
                setFollowing(false);
                setConfirmBlock(false);
              }}>{t('mobile.moment.block')}</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function CirclePage({ onBack }: { onBack: () => void }) {
  const t = useT();
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
          <IconButton actionId="circle.back" iconId="arrow-left" label={t('mobile.moments.backToCircles')} emphasis="quiet"
            onActivate={() => setSelectedCircleId(null)} />
          <h1 className="mp-detail-header-title">{selectedCircle.name}</h1>
          <IconButton actionId="circle.rename" iconId="pencil-line" label={t('mobile.moments.renameCircle')} emphasis="quiet"
            onActivate={() => setEditing({
              circleId: selectedCircle.id,
              name: selectedCircle.name,
              description: selectedCircle.description,
            })} />
        </header>
        <div className="mp-social-circle-copy"><Icon iconId="shield-check" size={18} /><span>{selectedCircle.description}. Membership is publisher-private.</span></div>
        <section className="mp-social-circle-detail">
          <div className="mp-social-section-heading">
            <span><strong>{t('mobile.moment.circleMembers')}</strong><small>{t('mobile.moment.circlePeople', { n: selectedCircle.members.length })}</small></span>
            <button type="button" onClick={() => setMemberPickerOpen(true)}><Icon iconId="user-plus" size={16} /> Add</button>
          </div>
          {selectedCircle.members.map((member) => (
            <div key={member} className="mp-social-member-row">
              <IdentityAvatar name={member} initials={member.split(' ').map(part => part[0]).join('')} size={36} />
              <span><strong>{member}</strong><small>{t('mobile.moment.circleIdentity')}</small></span>
              <button type="button" aria-label={`Remove ${member}`} onClick={() => setCircles((current) => current.map((circle) => (
                circle.id === selectedCircle.id
                  ? { ...circle, members: circle.members.filter((name) => name !== member) }
                  : circle
              )))}><Icon iconId="user-minus" size={17} /></button>
            </div>
          ))}
          {selectedCircle.members.length === 0 && <div className="mp-social-empty-inline">{t('mobile.moments.noMembers')}</div>}
        </section>
        <section className="mp-social-danger-group">
          <button type="button" onClick={() => setConfirmDelete(true)}><Icon iconId="delete" size={17} /> Delete Circle</button>
        </section>
        {editing && (
          <CircleEditSheet editing={editing} onChange={setEditing} onCancel={() => setEditing(null)} onSave={saveCircle} />
        )}
        {confirmDelete && (
          <div className="mp-action-sheet-backdrop" role="presentation" onPointerDown={() => setConfirmDelete(false)}>
            <section className="mp-action-sheet mp-social-confirm-sheet" role="alertdialog" aria-label={t('mobile.moments.deleteCircle')}
              onPointerDown={(event) => event.stopPropagation()}>
              <div className="mp-action-sheet-handle" />
              <div className="mp-social-confirm-copy">
                <Icon iconId="delete" size={20} />
                <div><strong>{t('mobile.moment.deleteCircleTitle', { name: selectedCircle.name })}</strong><p>{t('mobile.moment.deleteCircleBody')}</p></div>
              </div>
              <div className="mp-social-confirm-actions">
                <button type="button" onClick={() => setConfirmDelete(false)}>{t('mobile.chat.cancel')}</button>
                <button type="button" className="danger" onClick={() => {
                  setCircles((current) => current.filter((circle) => circle.id !== selectedCircle.id));
                  setSelectedCircleId(null);
                  setConfirmDelete(false);
                }}>{t('mobile.moments.delete.action')}</button>
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
        <IconButton actionId="circles.back" iconId="arrow-left" label={t('mobile.moments.backToMoments')} emphasis="quiet"
          onActivate={onBack} />
        <h1 className="mp-detail-header-title">{t('mobile.moments.circlesTitle')}</h1>
        <IconButton actionId="circles.create" iconId="plus" label={t('mobile.moments.createCircle')} emphasis="quiet"
          onActivate={() => setEditing({ name: '', description: '' })} />
      </header>
      <div className="mp-social-circle-copy"><Icon iconId="shield-check" size={18} /><span>{t('mobile.moments.circlesCopy')}</span></div>
      <div className="mp-social-circle-list">
        {circles.map((circle) => (
          <button key={circle.id} type="button" onClick={() => setSelectedCircleId(circle.id)}>
            <span className="mp-social-audience-icon"><Icon iconId="users-round" size={18} /></span>
            <span><strong>{circle.name}</strong><small>{circle.description} · {circle.members.length} members</small></span>
            <Icon iconId="chevron-right" size={17} />
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
  const t = useT();
  return (
    <div className="mp-action-sheet-backdrop" role="presentation" onPointerDown={onCancel}>
      <section className="mp-action-sheet mp-social-circle-editor" role="dialog"
        aria-label={editing.circleId ? 'Rename Circle' : 'Create Circle'}
        onPointerDown={(event) => event.stopPropagation()}>
        <div className="mp-action-sheet-handle" />
        <header className="mp-social-sheet-header">
          <span className="mp-social-sheet-spacer" />
          <h2>{editing.circleId ? 'Edit Circle' : 'New Circle'}</h2>
          <button type="button" className="primary" disabled={!editing.name.trim()} onClick={onSave}>{t('mobile.moments.save')}</button>
        </header>
        <div className="mp-social-form">
          <label><span>{t('mobile.moment.fieldName')}</span><input value={editing.name} onChange={(event) => onChange({ ...editing, name: event.target.value })} placeholder={t('mobile.moment.circleNamePlaceholder')} /></label>
          <label><span>{t('mobile.moment.fieldDescription')}</span><textarea value={editing.description} onChange={(event) => onChange({ ...editing, description: event.target.value })} placeholder={t('mobile.moment.circleDescriptionPlaceholder')} /></label>
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
  const t = useT();
  const [query, setQuery] = useState('');
  const visible = PEOPLE.filter((person) => `${person.name} ${person.handle}`.toLowerCase().includes(query.toLowerCase()));
  return (
    <div className="mp-detail-page">
      <header className="mp-detail-header">
        <IconButton actionId="circle-members.back" iconId="arrow-left" label={t('mobile.moments.backToCircle')} emphasis="quiet"
          onActivate={onBack} />
        <h1 className="mp-detail-header-title">{t('mobile.moments.addPeople')}</h1>
      </header>
      <div className="mp-social-search">
        <TextField
          aria-label={t('mobile.moment.searchCircleMembers')}
          placeholder={t('mobile.moments.audience.searchPeople')}
          value={query}
          clearable
          onClear={() => setQuery('')}
          leading={<Icon iconId="search" size={16} />}
          onValueChange={setQuery}
        />
        <p>{t('mobile.moment.activeFederation')}</p>
        {visible.map((person) => {
          const added = circle.members.includes(person.name);
          return (
            <div key={person.id} className="mp-social-member-row">
              <IdentityAvatar name={person.name} initials={person.name.split(' ').map(part => part[0]).join('')} size={40} />
              <span><strong>{person.name}</strong><small>{person.handle}</small></span>
              <button type="button" disabled={added} onClick={() => onAdd(person.name)}>
                {added ? <Icon iconId="check" size={17} /> : <Icon iconId="user-plus" size={17} />}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Keep ReactNode import used by future sub-views without churn.
export type MomentsNode = ReactNode;
