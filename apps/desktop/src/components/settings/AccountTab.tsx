import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { Flexbox } from 'react-layout-kit';
import { Tooltip, toast } from '@lobehub/ui';
import {
  Input,
  AutoComplete,
  Select,
  Spin,
  Tag,
  Typography,
  theme,
} from 'antd';
import {
  Camera,
  Clock3,
  Copy,
  Hash,
  IdCard,
  Link2,
  MapPin,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import { Button, Empty as LobeEmpty } from '@lobehub/ui';
import {
  api,
  type AccountProfile,
  type AccountProfileLink,
  type ProfileUpdateResult,
} from '../../services/desktop_api';
import { UserSquareAvatar } from '../common/UserSquareAvatar';
import { identityRuntime } from '../../kernel/identityRuntime';
import { useAccountIdentityStore } from '../../store/accountIdentity';
import { useSessionStore } from '../../store/session';
import { useTranslation } from 'react-i18next';
import { SettingsContainer, SettingsSection } from './SettingsLayout';
import {
  accountLoginProviderLocaleKey,
  resolveAccountLoginProvider,
} from './accountIdentityPresentation';
import { log } from '../../utils/logger';
import { DeviceLinkPanel } from './DeviceLinkPanel';

const { Text, Title } = Typography;
const { TextArea } = Input;

// Mirrors `PROFILE_IMAGE_UPLOAD_PROGRESS_EVENT` in
// apps/desktop/src-tauri/src/interface/tauri_commands/profile.rs.
const PROFILE_IMAGE_UPLOAD_PROGRESS_EVENT = 'profile-image-upload-progress';
type ProfileImageField = 'avatar' | 'header';
type ImageProgress = Record<ProfileImageField, number>;
type PendingImage = Partial<Record<ProfileImageField, string>>;

function usePrefersReducedMotion(): boolean {
  const query = '(prefers-reduced-motion: reduce)';
  const [reduced, setReduced] = useState(
    () => typeof window !== 'undefined' && window.matchMedia?.(query)?.matches === true,
  );
  useEffect(() => {
    const media = window.matchMedia(query);
    const onChange = () => setReduced(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

// Optimistic preview of a locally picked image while it streams to the
// Station. The blurred layer is immediately visible; a crisp copy is
// revealed bottom-up by `progress` (real multipart bytes), like a bottle
// filling. Reduced-motion users get the crisp image immediately; the
// determinate progress bar is rendered by the caller as a sibling of the
// interactive control, so progress/live semantics never nest inside a
// role="button" element.
function OptimisticImageLayer({
  url,
  progress,
  radius,
  reducedMotion,
}: {
  url: string;
  progress: number;
  radius: number;
  reducedMotion: boolean;
}) {
  const { token } = theme.useToken();
  const fraction = Math.max(0, Math.min(1, progress));
  const imageStyle: CSSProperties = {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    borderRadius: radius,
  };

  if (reducedMotion) {
    return <img src={url} alt="" aria-hidden style={imageStyle} />;
  }

  return (
    <>
      <img
        src={url}
        alt=""
        aria-hidden
        style={{ ...imageStyle, filter: 'blur(10px) saturate(0.9)', transform: 'scale(1.1)', opacity: 0.92 }}
      />
      <img
        src={url}
        alt=""
        aria-hidden
        style={{
          ...imageStyle,
          clipPath: `inset(${((1 - fraction) * 100).toFixed(2)}% 0 0 0)`,
          // motion.fast role (tokens.md §8): small continuous state reveal.
          transition: `clip-path ${token.motionDurationMid} linear`,
        }}
      />
    </>
  );
}

// Screen-reader progress announcement. Must stay a sibling of the
// role="button" surface (ARIA forbids role=status/progressbar inside a button).
function UploadLiveRegion({ fieldKey, percent }: { fieldKey: string; percent: number }) {
  const { t } = useTranslation('provider');
  return (
    <span
      role="status"
      aria-live="polite"
      style={{
        position: 'absolute',
        width: 1,
        height: 1,
        padding: 0,
        margin: -1,
        overflow: 'hidden',
        clip: 'rect(0 0 0 0)',
        whiteSpace: 'nowrap',
        border: 0,
      }}
    >
      {t(fieldKey, { percent })}
    </span>
  );
}

// Determinate progress bar for reduced-motion users; a sibling (not a child)
// of the interactive surface.
function UploadProgressBar({ percent }: { percent: number }) {
  const { token } = theme.useToken();
  return (
    <div
      role="progressbar"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
      style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 4, background: 'rgba(0,0,0,0.28)' }}
    >
      <div style={{ height: '100%', width: `${percent}%`, background: token.colorPrimary }} />
    </div>
  );
}

function preloadImage(url: string): Promise<void> {
  return new Promise((resolve) => {
    if (!url) {
      resolve();
      return;
    }
    const image = new Image();
    const settle = () => resolve();
    image.onload = settle;
    image.onerror = settle;
    image.src = url;
    window.setTimeout(settle, 1200);
  });
}

const COMMON_TIMEZONES = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Sao_Paulo',
  'America/Argentina/Buenos_Aires',
  'America/Mexico_City',
  'America/Toronto',
  'America/Vancouver',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Moscow',
  'Europe/Istanbul',
  'Europe/Rome',
  'Europe/Madrid',
  'Europe/Amsterdam',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Asia/Singapore',
  'Asia/Hong_Kong',
  'Asia/Taipei',
  'Asia/Kolkata',
  'Asia/Bangkok',
  'Asia/Dubai',
  'Asia/Jakarta',
  'Australia/Sydney',
  'Australia/Melbourne',
  'Pacific/Auckland',
  'Pacific/Honolulu',
  'Africa/Cairo',
  'Africa/Lagos',
  'Africa/Johannesburg',
];

function detectedTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch {
    return '';
  }
}

function buildTimezoneOptions(t: (key: string) => string): { label: string; value: string }[] {
  const detected = detectedTimezone();
  const set = new Set(COMMON_TIMEZONES);
  if (detected) set.add(detected);
  const sorted = Array.from(set).sort((a, b) => a.localeCompare(b));
  return sorted.map((tz) => ({
    label: tz === detected ? `${tz} ${t('provider.account.timezone.detected')}` : tz,
    value: tz,
  }));
}

function formatDate(date?: string) {
  if (!date) return '—';
  const value = new Date(date);
  if (Number.isNaN(value.getTime())) return '—';
  return value.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function normalizeProfile(profile: AccountProfile): AccountProfile {
  return {
    ...profile,
    note: profile.note || '',
    avatar: profile.avatar || '',
    header: profile.header || '',
    region: profile.region || '',
    timezone: profile.timezone || '',
    tags: Array.isArray(profile.tags) ? profile.tags : [],
    links: Array.isArray(profile.links) ? profile.links : [],
    peers_touch: {
      network_id: profile.peers_touch?.network_id || '',
    },
  };
}

function applyProfileMutationRevision(
  current: AccountProfile | null,
  result: ProfileUpdateResult,
): AccountProfile | null {
  if (!current) return current;
  return {
    ...current,
    profile_revision: result.profile.profile_revision,
  };
}

function createEmptyLink(): AccountProfileLink {
  return { label: '', url: '' };
}

function copyToClipboard(text: string, t: (key: string, opts?: Record<string, unknown>) => string) {
  navigator.clipboard.writeText(text).then(
    () => toast.success(t('provider.account.identity.copied')),
    () => toast.error(t('provider.account.identity.copyFailed')),
  );
}

async function pickImageFile(): Promise<string | null> {
  try {
    return await api.pickImageFile();
  } catch {
    return null;
  }
}

const AVATAR_RADIUS = 12;

function EditableAvatar({
  src,
  fallbackText,
  size,
  uploading,
  pendingUrl,
  progress,
  onUpload,
}: {
  src?: string;
  fallbackText: string;
  size: number;
  uploading: boolean;
  pendingUrl?: string;
  progress: number;
  onUpload: () => void;
}) {
  const { token } = theme.useToken();
  const reducedMotion = usePrefersReducedMotion();
  // The edit affordance is shown on hover and on keyboard focus — never
  // hover-only (accessibility.md §5).
  const [editHint, setEditHint] = useState(false);

  return (
    <div
      data-pt-account-avatar-url={src || ''}
      style={{ position: 'relative', flexShrink: 0, width: size, height: size, borderRadius: AVATAR_RADIUS, overflow: 'hidden' }}
    >
      <div
        role="button"
        tabIndex={0}
        aria-busy={uploading}
        aria-label={fallbackText}
        onClick={() => !uploading && onUpload()}
        onKeyDown={(event) => {
          if (!uploading && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault();
            onUpload();
          }
        }}
        onMouseEnter={() => setEditHint(true)}
        onMouseLeave={() => setEditHint(false)}
        onFocus={() => setEditHint(true)}
        onBlur={() => setEditHint(false)}
        style={{
          position: 'relative',
          width: '100%',
          height: '100%',
          borderRadius: AVATAR_RADIUS,
          cursor: uploading ? 'wait' : 'pointer',
        }}
      >
        <UserSquareAvatar
          remoteUrl={src}
          name={fallbackText}
          size={size}
          radius={AVATAR_RADIUS}
          border={`2px solid ${token.colorBorderSecondary}`}
        />

        {pendingUrl && (
          <OptimisticImageLayer
            url={pendingUrl}
            progress={progress}
            radius={AVATAR_RADIUS}
            reducedMotion={reducedMotion}
          />
        )}

        <div
          style={{
            position: 'absolute',
            bottom: 0,
            right: 0,
            width: 24,
            height: 24,
            borderRadius: 6,
            background: token.colorPrimary,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: `2px solid ${token.colorBgContainer}`,
            boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
          }}
        >
          {uploading ? (
            <Spin size="small" style={{ fontSize: 10 }} />
          ) : (
            <Camera size={12} style={{ color: '#fff' }} />
          )}
        </div>

        {!uploading && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              borderRadius: AVATAR_RADIUS,
              background: 'rgba(0,0,0,0.25)',
              opacity: editHint ? 1 : 0,
              transition: `opacity ${token.motionDurationMid}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Pencil size={20} style={{ color: '#fff' }} />
          </div>
        )}
      </div>

      {uploading && reducedMotion && (
        <UploadProgressBar percent={Math.round(progress * 100)} />
      )}
      {uploading && (
        <UploadLiveRegion
          fieldKey="provider.account.avatarHeader.uploadingProgress"
          percent={Math.round(progress * 100)}
        />
      )}
    </div>
  );
}

const HEADER_HEIGHT = 120;
const HEADER_RADIUS = 12;

function EditableHeaderBanner({
  src,
  uploading,
  pendingUrl,
  progress,
  onUpload,
  t,
}: {
  src?: string;
  uploading: boolean;
  pendingUrl?: string;
  progress: number;
  onUpload: () => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const { token } = theme.useToken();
  const reducedMotion = usePrefersReducedMotion();
  const [editHint, setEditHint] = useState(false);

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: HEADER_HEIGHT,
        borderRadius: HEADER_RADIUS,
        overflow: 'hidden',
        background: `linear-gradient(135deg, ${token.colorPrimaryBg} 0%, ${token.colorBgLayout} 100%)`,
        border: `1px solid ${token.colorBorderSecondary}`,
      }}
    >
      <div
        role="button"
        tabIndex={0}
        aria-busy={uploading}
        aria-label={t('provider.account.identity.changeHeader')}
        onClick={() => !uploading && onUpload()}
        onKeyDown={(event) => {
          if (!uploading && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault();
            onUpload();
          }
        }}
        onMouseEnter={() => setEditHint(true)}
        onMouseLeave={() => setEditHint(false)}
        onFocus={() => setEditHint(true)}
        onBlur={() => setEditHint(false)}
        style={{
          position: 'absolute',
          inset: 0,
          cursor: uploading ? 'wait' : 'pointer',
          borderRadius: HEADER_RADIUS,
        }}
      >
        {src && (
          <img
            src={src}
            alt=""
            aria-hidden
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              borderRadius: HEADER_RADIUS,
            }}
          />
        )}

        {pendingUrl && (
          <OptimisticImageLayer
            url={pendingUrl}
            progress={progress}
            radius={HEADER_RADIUS}
            reducedMotion={reducedMotion}
          />
        )}

        {uploading && (
          <div
            style={{
              position: 'absolute',
              top: 8,
              right: 8,
              width: 28,
              height: 28,
              borderRadius: 8,
              background: 'rgba(0,0,0,0.45)',
              display: 'grid',
              placeItems: 'center',
            }}
          >
            <Spin size="small" />
          </div>
        )}

        {!uploading && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: 'rgba(0,0,0,0.3)',
              opacity: editHint ? 1 : 0,
              transition: `opacity ${token.motionDurationMid}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              borderRadius: HEADER_RADIUS,
            }}
          >
            <Camera size={16} style={{ color: '#fff' }} />
            <Text style={{ color: '#fff', fontSize: 12 }}>
              {t('provider.account.identity.changeHeader')}
            </Text>
          </div>
        )}
      </div>

      {uploading && reducedMotion && (
        <UploadProgressBar percent={Math.round(progress * 100)} />
      )}
      {uploading && (
        <UploadLiveRegion
          fieldKey="provider.account.avatarHeader.uploadingProgress"
          percent={Math.round(progress * 100)}
        />
      )}
    </div>
  );
}

function IdentityField({
  label,
  value,
  prefix,
  copiable,
  identityKey,
  t,
}: {
  label: string;
  value: string;
  prefix?: string;
  copiable?: boolean;
  identityKey?: string;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  const { token } = theme.useToken();
  return (
    <Flexbox
      data-pt-account-identity={identityKey}
      gap={4}
      style={{ flex: '1 1 240px', minWidth: 200 }}
    >
      <Text type="secondary" style={{ fontSize: 12 }}>
        {label}
      </Text>
      <Flexbox
        horizontal
        align="center"
        gap={8}
        style={{
          padding: '6px 12px',
          borderRadius: 8,
          background: token.colorFillQuaternary,
          minHeight: 36,
        }}
      >
        <Text
          style={{ fontSize: 13, flex: 1, wordBreak: 'break-all' }}
          ellipsis={{ tooltip: value }}
        >
          {prefix}
          {value || '—'}
        </Text>
        {copiable && value ? (
          <Tooltip title={t('common.action.copy', { ns: 'common' })}>
            <Copy
              size={14}
              style={{ color: token.colorTextTertiary, cursor: 'pointer', flexShrink: 0 }}
              onClick={() => copyToClipboard(value, t)}
            />
          </Tooltip>
        ) : null}
      </Flexbox>
    </Flexbox>
  );
}

function StatChip({ label, value }: { label: string; value: number }) {
  const { token } = theme.useToken();
  return (
    <Flexbox
      align="center"
      gap={2}
      style={{
        padding: '4px 12px',
        borderRadius: 8,
        background: token.colorFillQuaternary,
      }}
    >
      <Text strong style={{ fontSize: 16, lineHeight: 1.2 }}>
        {value}
      </Text>
      <Text type="secondary" style={{ fontSize: 11 }}>
        {label}
      </Text>
    </Flexbox>
  );
}

const AUTO_SAVE_DELAY = 800;

export function AccountTab() {
  const { t } = useTranslation('provider');
  const { token } = theme.useToken();
  const activeAccount = useAccountIdentityStore((state) => (
    state.accounts.find((account) => account.id === state.activeAccountId) ?? null
  ));
  const sessionLoginProvider = useSessionStore((state) => (
    state.currentUser?.loginProvider ?? state.currentUser?.loginMethod
  ));
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [uploadingHeader, setUploadingHeader] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<ImageProgress>({ avatar: 0, header: 0 });
  const [pendingImage, setPendingImage] = useState<PendingImage>({});
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const timezoneOptions = useMemo(() => buildTimezoneOptions(t), [t]);
  const loginProvider = resolveAccountLoginProvider({
    accountProvider: activeAccount?.provider,
    sessionProvider: sessionLoginProvider,
  });
  const loginProviderKey = accountLoginProviderLocaleKey(loginProvider);
  const loginProviderLabel = loginProviderKey ? t(loginProviderKey) : loginProvider;

  const syncCurrentProfileIdentity = async (fallbackAvatar?: string) => {
    await identityRuntime.refreshCurrentProfile(fallbackAvatar);
  };

  const loadProfile = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const next = normalizeProfile(await api.profileGet());
      setProfile(next);

      if (next.avatar) {
        syncCurrentProfileIdentity(next.avatar).catch((error) => {
          log.warn('settings', 'account profile identity sync failed', error);
        });
      }
    } catch (error: any) {
      if (!silent) toast.error(error?.message || t('provider.account.failedToLoad'));
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    loadProfile(false);
    let unlisten: UnlistenFn | undefined;
    listen<{ field: ProfileImageField; sent: number; total: number }>(
      PROFILE_IMAGE_UPLOAD_PROGRESS_EVENT,
      (event) => {
        const { field, sent, total } = event.payload;
        if (field !== 'avatar' && field !== 'header') return;
        const fraction = total > 0 ? Math.min(1, sent / total) : 0;
        setUploadProgress((current) =>
          fraction !== 1 && Math.abs(current[field] - fraction) < 0.005
            ? current
            : { ...current, [field]: fraction },
        );
      },
    )
      .then((unsubscribe) => {
        unlisten = unsubscribe;
      })
      .catch((error) => {
        log.warn('settings', 'profile image progress listener failed', error);
      });
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      unlisten?.();
    };
  }, []);

  const autoSave = (nextProfile: AccountProfile) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      setSaving(true);
      try {
        const result = await api.profileUpdate({
          display_name: nextProfile.display_name.trim(),
          note: nextProfile.note.trim(),
          region: nextProfile.region.trim(),
          timezone: nextProfile.timezone.trim(),
          tags: nextProfile.tags.map((tg) => tg.trim()).filter(Boolean),
          links: nextProfile.links
            .map((l) => ({ label: l.label.trim(), url: l.url.trim() }))
            .filter((l) => l.label || l.url),
          observed_revision: nextProfile.profile_revision,
        });
        setProfile((current) => applyProfileMutationRevision(current, result));
        if (result.outcome === 'PROFILE_UPDATE_OUTCOME_CONFLICT') {
          toast.error(t('provider.account.failedToUpdate'));
        } else {
          toast.success(t('provider.account.saved'));
        }
        // Do not setProfile here — local state is already up-to-date.
        // Overwriting with the server response causes controlled inputs
        // to re-render and lose cursor position / focus (the "flicker" bug).
      } catch (error: any) {
        toast.error(error?.message || t('provider.account.failedToUpdate'));
      } finally {
        setSaving(false);
      }
    }, AUTO_SAVE_DELAY);
  };

  const onFieldChange = <K extends keyof AccountProfile>(key: K, value: AccountProfile[K]) => {
    setProfile((current) => {
      if (!current) return current;
      const next = { ...current, [key]: value };
      autoSave(next);
      return next;
    });
  };

  const onLinkChange = (index: number, key: keyof AccountProfileLink, value: string) => {
    setProfile((current) => {
      if (!current) return current;
      const nextLinks = current.links.map((item, i) =>
        i === index ? { ...item, [key]: value } : item,
      );
      const next = { ...current, links: nextLinks };
      autoSave(next);
      return next;
    });
  };

  const addLink = () => {
    setProfile((current) =>
      current ? { ...current, links: [...current.links, createEmptyLink()] } : current,
    );
  };

  const removeLink = (index: number) => {
    setProfile((current) => {
      if (!current) return current;
      const next = { ...current, links: current.links.filter((_, i) => i !== index) };
      autoSave(next);
      return next;
    });
  };

  // The picked file is shown immediately (optimistic local preview) and
  // crispness follows the real upload byte progress; any non-committed result
  // rolls the preview back so the surface never pretends success.
  const beginPendingImage = (field: ProfileImageField, path: string) => {
    setPendingImage((current) => ({ ...current, [field]: convertFileSrc(path) }));
    setUploadProgress((current) => ({ ...current, [field]: 0 }));
  };
  const clearPendingImage = (field: ProfileImageField) => {
    setPendingImage((current) => ({ ...current, [field]: undefined }));
    setUploadProgress((current) => ({ ...current, [field]: 0 }));
  };

  const handleUploadAvatar = async () => {
    if (uploadingAvatar) return;
    const path = await pickImageFile();
    if (!path) return;

    setUploadingAvatar(true);
    beginPendingImage('avatar', path);
    let committed = false;
    try {
      const result = await api.profileUploadAvatarOss({ file_path: path });
      if (result.outcome === 'PROFILE_UPDATE_OUTCOME_CONFLICT') {
        setProfile((current) => applyProfileMutationRevision(current, result));
        toast.error(t('provider.account.avatarHeader.failedToUploadAvatar'));
        return;
      }
      const next = normalizeProfile(result.profile);
      if (next.avatar) {
        // Resolve/materialize the remote avatar in the native cache before
        // removing the optimistic preview, so the swap to the authoritative
        // image does not wait on a cold download.
        try {
          await api.avatarResolveLocal(next.avatar);
        } catch (error) {
          log.warn('settings', 'avatar cache warm-up failed before commit', error);
        }
        await syncCurrentProfileIdentity(next.avatar);
      }
      setProfile(next);
      clearPendingImage('avatar');
      committed = true;
      toast.success(t('provider.account.avatarHeader.avatarUpdated'));
    } catch (error: any) {
      toast.error(error?.message || t('provider.account.avatarHeader.failedToUploadAvatar'));
    } finally {
      if (!committed) clearPendingImage('avatar');
      setUploadingAvatar(false);
    }
  };

  const handleUploadHeader = async () => {
    if (uploadingHeader) return;
    const path = await pickImageFile();
    if (!path) return;

    setUploadingHeader(true);
    beginPendingImage('header', path);
    let committed = false;
    try {
      const result = await api.profileUploadHeaderOss({ file_path: path });
      if (result.outcome === 'PROFILE_UPDATE_OUTCOME_CONFLICT') {
        setProfile((current) => applyProfileMutationRevision(current, result));
        toast.error(t('provider.account.avatarHeader.failedToUploadHeader'));
        return;
      }
      const next = normalizeProfile(result.profile);
      // Let the browser cache the committed banner before removing the local
      // preview, so the authoritative swap is seamless.
      await preloadImage(next.header || '');
      setProfile(next);
      clearPendingImage('header');
      committed = true;
      toast.success(t('provider.account.avatarHeader.headerUpdated'));
    } catch (error: any) {
      toast.error(error?.message || t('provider.account.avatarHeader.failedToUploadHeader'));
    } finally {
      if (!committed) clearPendingImage('header');
      setUploadingHeader(false);
    }
  };

  if (loading) {
    return (
      <Flexbox align="center" justify="center" style={{ padding: 64 }}>
        <Spin />
      </Flexbox>
    );
  }

  if (!profile) {
    return (
      <Flexbox align="center" justify="center" style={{ padding: 64 }}>
        <LobeEmpty icon={IdCard} title={t('provider.account.noProfile')} />
      </Flexbox>
    );
  }

  return (
    <SettingsContainer>
      {saving && (
        <Text type="secondary" style={{ fontSize: 11, textAlign: 'right' }}>
          {t('provider.account.autoSaving', { defaultValue: 'Saving...' })}
        </Text>
      )}
      {/* ── Section 1: Identity Overview ── */}
      <SettingsSection
        title={t('provider.account.identity.title')}
        subtitle={t('provider.account.identity.subtitle')}
      >

        <EditableHeaderBanner
          src={profile.header || undefined}
          uploading={uploadingHeader}
          pendingUrl={pendingImage.header}
          progress={uploadProgress.header}
          onUpload={handleUploadHeader}
          t={t}
        />

        <Flexbox horizontal gap={20} align="flex-start" style={{ flexWrap: 'wrap', marginTop: -40 }}>
          <div style={{ marginLeft: 16 }}>
            <EditableAvatar
              src={profile.avatar || undefined}
              fallbackText={profile.display_name || profile.username}
              size={80}
              uploading={uploadingAvatar}
              pendingUrl={pendingImage.avatar}
              progress={uploadProgress.avatar}
              onUpload={handleUploadAvatar}
            />
          </div>

          <Flexbox gap={8} style={{ flex: 1, minWidth: 0, paddingTop: 44 }}>
            <Flexbox
              data-pt-account-identity-summary
              horizontal
              align="center"
              gap={10}
              style={{ flexWrap: 'wrap' }}
            >
              <Title level={4} style={{ margin: 0 }}>
                {profile.display_name || profile.username}
              </Title>
              <Tag color="processing" style={{ margin: 0 }}>
                @{profile.username}
              </Tag>
              {loginProviderLabel ? (
                <Tag data-pt-account-login-provider style={{ margin: 0 }}>
                  {loginProviderLabel}
                </Tag>
              ) : null}
            </Flexbox>

            <Flexbox horizontal gap={16} style={{ flexWrap: 'wrap' }}>
              <StatChip label={t('provider.account.identity.posts')} value={profile.statuses_count} />
              <StatChip label={t('provider.account.identity.following')} value={profile.following_count} />
              <StatChip label={t('provider.account.identity.followers')} value={profile.followers_count} />
              <Text type="secondary" style={{ fontSize: 12, alignSelf: 'center' }}>
                {t('provider.account.identity.created', { date: formatDate(profile.created_at) })}
              </Text>
            </Flexbox>
          </Flexbox>
        </Flexbox>

        <Flexbox horizontal gap={16} style={{ flexWrap: 'wrap' }}>
          <IdentityField label={t('provider.account.identity.preferredUsername')} value={profile.username} prefix="@" copiable t={t} />
          <IdentityField
            identityKey="ptid"
            label={t('provider.account.identity.ptid')}
            value={profile.peers_touch.network_id}
            copiable
            t={t}
          />
        </Flexbox>
      </SettingsSection>
      <DeviceLinkPanel />
      {/* ── Section 2: Public Profile (editable, auto-save) ── */}
      <SettingsSection
        title={t('provider.account.profile.title')}
        subtitle={t('provider.account.profile.subtitle')}
        style={{ gap: 18 }}
      >

        <Flexbox gap={6}>
          <Text strong style={{ fontSize: 13 }}>
            {t('provider.account.identity.name')}
          </Text>
          <Input
            value={profile.display_name}
            onChange={(e) => onFieldChange('display_name', e.target.value)}
            placeholder={t('provider.account.identity.name')}
            maxLength={60}
          />
        </Flexbox>

        <Flexbox gap={6}>
          <Text strong style={{ fontSize: 13 }}>
            {t('provider.account.profile.bio')}
          </Text>
          <TextArea
            value={profile.note}
            onChange={(e) => onFieldChange('note', e.target.value)}
            rows={4}
            maxLength={280}
            showCount
            placeholder={t('provider.account.profile.bioPlaceholder')}
            style={{ resize: 'vertical' }}
          />
        </Flexbox>

        <Flexbox horizontal gap={16} style={{ flexWrap: 'wrap' }}>
          <Flexbox gap={6} style={{ flex: '1 1 280px', minWidth: 240 }}>
            <Flexbox horizontal align="center" gap={6}>
              <MapPin size={14} style={{ color: token.colorTextTertiary }} />
              <Text strong style={{ fontSize: 13 }}>
                {t('provider.account.profile.region')}
              </Text>
              <Text type="secondary" style={{ fontSize: 11 }}>
                {t('provider.account.profile.regionOptional')}
              </Text>
            </Flexbox>
            <Input
              value={profile.region}
              onChange={(e) => onFieldChange('region', e.target.value)}
              placeholder={t('provider.account.profile.regionPlaceholder')}
              maxLength={120}
            />
          </Flexbox>

          <Flexbox gap={6} style={{ flex: '1 1 280px', minWidth: 240 }}>
            <Flexbox horizontal align="center" gap={6}>
              <Clock3 size={14} style={{ color: token.colorTextTertiary }} />
              <Text strong style={{ fontSize: 13 }}>
                {t('provider.account.profile.timezone')}
              </Text>
              <Text type="secondary" style={{ fontSize: 11 }}>
                {t('provider.account.profile.timezoneOptional')}
              </Text>
            </Flexbox>
            <AutoComplete
              value={profile.timezone || undefined}
              onChange={(value) => onFieldChange('timezone', value || '')}
              options={timezoneOptions}
              placeholder={t('provider.account.profile.timezonePlaceholder')}
              allowClear
              style={{ width: '100%' }}
              filterOption={(input, option) =>
                (option?.label as string ?? '').toLowerCase().includes(input.toLowerCase())
              }
            />
          </Flexbox>
        </Flexbox>

        <Flexbox gap={6}>
          <Flexbox horizontal align="center" gap={6}>
            <Hash size={14} style={{ color: token.colorTextTertiary }} />
            <Text strong style={{ fontSize: 13 }}>
              {t('provider.account.profile.tags')}
            </Text>
            <Text type="secondary" style={{ fontSize: 11 }}>
              {t('provider.account.profile.tagsDesc')}
            </Text>
          </Flexbox>
          <Select
            mode="tags"
            value={profile.tags}
            onChange={(value) => onFieldChange('tags', value)}
            placeholder={t('provider.account.profile.tagsPlaceholder')}
            style={{ width: '100%' }}
            tokenSeparators={[',']}
          />
        </Flexbox>

        <Flexbox gap={10}>
          <Flexbox horizontal justify="space-between" align="center" gap={12}>
            <Flexbox horizontal align="center" gap={6}>
              <Link2 size={14} style={{ color: token.colorTextTertiary }} />
              <Text strong style={{ fontSize: 13 }}>
                {t('provider.account.profile.links')}
              </Text>
              <Text type="secondary" style={{ fontSize: 11 }}>
                {t('provider.account.profile.linksDesc')}
              </Text>
            </Flexbox>
            <Button size="small" icon={<Plus size={14} />} onClick={addLink}>
              {t('provider.account.profile.addLink')}
            </Button>
          </Flexbox>

          {profile.links.length === 0 ? (
            <Text type="secondary" style={{ fontSize: 12, paddingLeft: 4 }}>
              {t('provider.account.profile.noLinks')}
            </Text>
          ) : null}

          {profile.links.map((link, index) => (
            <Flexbox
              key={`link-${index}`}
              horizontal
              gap={8}
              align="center"
              style={{
                padding: '8px 12px',
                borderRadius: 10,
                border: `1px solid ${token.colorBorderSecondary}`,
                background: token.colorFillQuaternary,
              }}
            >
              <Input
                value={link.label}
                onChange={(e) => onLinkChange(index, 'label', e.target.value)}
                placeholder={t('provider.account.profile.linkLabelPlaceholder')}
                style={{ flex: 1, fontSize: 12 }}
                size="small"
              />
              <Input
                value={link.url}
                onChange={(e) => onLinkChange(index, 'url', e.target.value)}
                placeholder={t('provider.account.profile.linkUrlPlaceholder')}
                style={{ flex: 2, fontSize: 12 }}
                size="small"
              />
              <Tooltip title={t('common.action.delete', { ns: 'common' })}>
                <Button
                  size="small"
                  type="text"
                  danger
                  icon={<Trash2 size={14} />}
                  onClick={() => removeLink(index)}
                />
              </Tooltip>
            </Flexbox>
          ))}
        </Flexbox>
      </SettingsSection>

    </SettingsContainer>
  );
}
