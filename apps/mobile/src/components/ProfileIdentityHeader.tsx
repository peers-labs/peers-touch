import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Icon, Tag, Text } from '@peers-touch/ui';
import { useMobileI18n } from '../app/mobileI18n';
import { MobileAvatar } from './MobileAvatar';
import { useAvatarAsset } from '../runtimes/avatarAssetRuntime';
import type { ProfileImageField } from '../runtimes/profileImageRuntime';

export interface ProfileIdentityStats {
  readonly posts: number | null;
  readonly following: number | null;
  readonly followers: number | null;
}

export interface ProfileIdentityHeaderProps {
  readonly actorPtid: string;
  readonly displayName: string;
  /** Federated handle or other secondary locator line. */
  readonly handle?: string;
  readonly avatar?: string;
  /** Cover artwork (PeerProfile.header). */
  readonly cover?: string;
  readonly tags?: readonly string[];
  readonly stats?: ProfileIdentityStats;
  readonly joined?: string;
  readonly online?: boolean;
  /** Self renders the pine avatar + long-press image editing; peers are read-only. */
  readonly self?: boolean;
  /**
   * Whether the cover bleeds under the status bar. True for the standalone
   * settings tab (no in-page nav bar); false inside a detail route that
   * already renders its own page header.
   */
  readonly bleed?: boolean;
  readonly editingImage?: ProfileImageField | null;
  readonly imageEditUnavailableReason?: string | undefined;
  readonly onPickImage?: (field: ProfileImageField) => void;
}

const HOLD_MS = 500;
const HOLD_CANCEL_PX = 12;

/** Long-press detector matching the chat gesture grammar (500ms, 12px slop). */
function useLongPress(onHold: () => void) {
  const timer = useRef<number | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const cancel = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    start.current = null;
  };
  useEffect(() => cancel, []);
  return {
    onPointerDown: (event: ReactPointerEvent) => {
      if (event.button !== 0) return;
      start.current = { x: event.clientX, y: event.clientY };
      timer.current = window.setTimeout(onHold, HOLD_MS);
    },
    onPointerMove: (event: ReactPointerEvent) => {
      if (!start.current || timer.current === null) return;
      if (Math.hypot(event.clientX - start.current.x, event.clientY - start.current.y) > HOLD_CANCEL_PX) cancel();
    },
    onPointerUp: cancel,
    onPointerLeave: cancel,
  };
}

/**
 * Single profile identity header shared by the self settings tab and every
 * peer profile route (contacts + social), so all "view a profile" surfaces
 * share one layout: edge cover, overlapping identity avatar, left-aligned
 * name/handle and a horizontal statistics row.
 */
export function ProfileIdentityHeader({
  actorPtid,
  displayName,
  handle,
  avatar,
  cover,
  tags,
  stats,
  joined,
  online,
  self = false,
  bleed = false,
  editingImage = null,
  imageEditUnavailableReason,
  onPickImage,
}: ProfileIdentityHeaderProps) {
  const { t, language } = useMobileI18n();
  const coverAsset = useAvatarAsset(cover ?? '');
  const [editMode, setEditMode] = useState(false);
  const rootRef = useRef<HTMLElement | null>(null);
  const coverHold = useLongPress(() => self && setEditMode(true));
  const avatarHold = useLongPress(() => self && setEditMode(true));

  useEffect(() => {
    if (!editMode) return;
    const onDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setEditMode(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [editMode]);

  const joinedDate = joined ? new Date(joined) : null;
  const joinedLabel = joinedDate && Number.isFinite(joinedDate.getTime())
    ? new Intl.DateTimeFormat(language, { year: 'numeric', month: 'short' }).format(joinedDate) : '';

  const imageAction = (field: ProfileImageField) => {
    const disabled = Boolean(imageEditUnavailableReason) || Boolean(editingImage);
    const reason = imageEditUnavailableReason
      ?? (editingImage ? t('mobile.settings.profile.imageBusy') : undefined);
    return <button
      type="button"
      className="mobile-me-edit-button"
      data-acceptance-id={`settings-profile-${field}-edit`}
      data-action-id={`settings.profile.change-${field}`}
      aria-label={t(field === 'avatar' ? 'mobile.settings.profile.changeAvatar' : 'mobile.settings.profile.changeCover')}
      aria-disabled={disabled || undefined}
      title={reason}
      disabled={disabled}
      onClick={() => {
        onPickImage?.(field);
        setEditMode(false);
      }}
    >
      <Icon iconId="edit" size={15} />
    </button>;
  };

  const editable = self && Boolean(onPickImage);
  const className = [
    'mobile-me-identity',
    self ? 'is-self' : 'is-peer',
    bleed ? 'is-bleed' : 'is-contained',
    editMode ? 'is-editing' : '',
  ].filter(Boolean).join(' ');

  return (
    <header ref={rootRef} className={className} data-me-profile data-profile-self={self || undefined}>
      <div className="mobile-me-cover" data-hero-cover {...(editable ? coverHold : {})}>
        {coverAsset.src ? <img src={coverAsset.src} alt="" /> : null}
        {editable ? (
          <span className="mobile-me-cover-action mobile-me-edit-chip">{imageAction('header')}</span>
        ) : null}
      </div>
      <div className="mobile-me-identity-body">
        <div className="mobile-me-avatar" data-hero-avatar {...(editable ? avatarHold : {})}>
          <MobileAvatar
            self={self}
            size={68}
            identityKey={actorPtid}
            name={displayName}
            src={avatar}
          />
          {editable ? (
            <span className="mobile-me-avatar-action mobile-me-edit-chip">{imageAction('avatar')}</span>
          ) : null}
        </div>
        <div className="mobile-me-name-row">
          <Text strong className="mobile-me-name" data-hero-name>{displayName}</Text>
          {tags?.[0] ? <Tag data-hero-tag>{tags[0]}</Tag> : null}
          {!self && typeof online === 'boolean' ? (
            <Tag tone={online ? 'success' : 'neutral'}>
              {online ? t('mobile.social.online') : t('mobile.social.offline')}
            </Tag>
          ) : null}
        </div>
        {handle ? <Text tone="secondary" data-hero-handle>{handle}</Text> : null}
        {stats ? (
          <div className="mobile-me-statistics" data-hero-stats>
            {([['posts', stats.posts], ['following', stats.following], ['followers', stats.followers]] as const).map(([key, count]) => (
              <span key={key}><Text strong>{count ?? t('mobile.launch.unavailable')}</Text>
                <Text tone="secondary">{t(`mobile.settings.stats.${key}`)}</Text></span>
            ))}
            {self && joinedLabel ? (
              <Text tone="secondary">{t('mobile.settings.profile.joined', { date: joinedLabel })}</Text>
            ) : null}
          </div>
        ) : null}
      </div>
    </header>
  );
}
