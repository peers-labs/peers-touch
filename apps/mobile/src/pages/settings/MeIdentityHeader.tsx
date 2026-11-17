import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Icon, Tag, Text } from '@peers-touch/ui';
import { useMobileI18n } from '../../app/mobileI18n';
import { MobileAvatar } from '../../components/MobileAvatar';
import { useAvatarAsset } from '../../runtimes/avatarAssetRuntime';
import type { ProfileImageField } from '../../runtimes/profileImageRuntime';

export interface MeIdentityHeaderModel {
  readonly actorPtid: string;
  readonly displayName: string;
  readonly handle: string;
  readonly avatar: string;
  readonly header: string;
  readonly tags: readonly string[];
  readonly posts: number | null;
  readonly following: number | null;
  readonly followers: number | null;
  readonly joined: string;
}
interface MeIdentityHeaderProps {
  readonly model: MeIdentityHeaderModel;
  readonly editingImage: ProfileImageField | null;
  readonly imageEditUnavailableReason?: string | undefined;
  readonly onPickImage: (field: ProfileImageField) => void;
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

export function MeIdentityHeader({ model, editingImage, imageEditUnavailableReason, onPickImage }: MeIdentityHeaderProps) {
  const { t, language } = useMobileI18n();
  const cover = useAvatarAsset(model.header);
  const [editMode, setEditMode] = useState(false);
  const rootRef = useRef<HTMLElement | null>(null);
  const coverHold = useLongPress(() => setEditMode(true));
  const avatarHold = useLongPress(() => setEditMode(true));

  // Editing is a transient, opt-in state: tapping outside the hero leaves it.
  useEffect(() => {
    if (!editMode) return;
    const onDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setEditMode(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [editMode]);

  const joinedDate = new Date(model.joined);
  const joined = model.joined && Number.isFinite(joinedDate.getTime())
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
        onPickImage(field);
        setEditMode(false);
      }}
    >
      <Icon iconId="edit" size={15} />
    </button>;
  };

  return <header ref={rootRef} className={`mobile-me-identity${editMode ? ' is-editing' : ''}`} data-me-profile>
    <div className="mobile-me-cover" data-hero-cover {...coverHold}>
      {cover.src ? <img src={cover.src} alt="" /> : null}
      <span className="mobile-me-cover-action mobile-me-edit-chip">{imageAction('header')}</span>
    </div>
    <div className="mobile-me-identity-body">
      <div className="mobile-me-avatar" data-hero-avatar {...avatarHold}>
        <MobileAvatar self size={68} identityKey={model.actorPtid} name={model.displayName} src={model.avatar} />
        <span className="mobile-me-avatar-action mobile-me-edit-chip">{imageAction('avatar')}</span>
      </div>
      <div className="mobile-me-name-row">
        <Text strong className="mobile-me-name" data-hero-name>{model.displayName}</Text>
        {model.tags[0] ? <Tag data-hero-tag>{model.tags[0]}</Tag> : null}
      </div>
      {model.handle ? <Text tone="secondary" data-hero-handle>{model.handle}</Text> : null}
      <div className="mobile-me-statistics" data-hero-stats>
        {([['posts', model.posts], ['following', model.following], ['followers', model.followers]] as const).map(([key, count]) => (
          <span key={key}><Text strong>{count ?? t('mobile.launch.unavailable')}</Text>
            <Text tone="secondary">{t(`mobile.settings.stats.${key}`)}</Text></span>
        ))}
        {joined ? <Text tone="secondary">{t('mobile.settings.profile.joined', { date: joined })}</Text> : null}
      </div>
    </div>
  </header>;
}
