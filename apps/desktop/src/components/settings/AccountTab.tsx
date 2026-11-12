import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import {
  Button,
  Empty,
  Icon,
  IconButton,
  Select,
  Spin,
  Tag,
  TextArea,
  TextField,
  Tooltip,
} from '@peers-touch/ui';
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
import { SettingsContainer, SettingsSection, SettingsRow } from './SettingsLayout';
import {
  accountLoginProviderLocaleKey,
  resolveAccountLoginProvider,
} from './accountIdentityPresentation';
import { log } from '../../utils/logger';
import { DeviceLinkPanel } from './DeviceLinkPanel';
import { notifyError, notifySuccess } from '../../ui/feedback';

// Mirrors `PROFILE_IMAGE_UPLOAD_PROGRESS_EVENT` in
// apps/desktop/src-tauri/src/interface/tauri_commands/profile.rs.
const PROFILE_IMAGE_UPLOAD_PROGRESS_EVENT = 'profile-image-upload-progress';
// antd motionDurationMid equivalent for the optimistic image reveal.
const MOTION_DURATION_MID = '0.2s';
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
// interactive control, so progress/live semantics never nest inside the
// upload button.
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
          transition: `clip-path ${MOTION_DURATION_MID} linear`,
        }}
      />
    </>
  );
}

// Screen-reader progress announcement. Must stay a sibling of the upload
// button (ARIA forbids role=status/progressbar inside a button).
function UploadLiveRegion({ fieldKey, percent }: { fieldKey: string; percent: number }) {
  const { t } = useTranslation('provider');
  return (
    <span
      role="status"
      aria-live="polite"
      className="pt-sr-only"
    >
      {t(fieldKey, { percent })}
    </span>
  );
}

// Determinate progress bar for reduced-motion users; a sibling (not a child)
// of the interactive surface.
function UploadProgressBar({ percent }: { percent: number }) {
  return (
    <div
      role="progressbar"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
      className="sc-account-upload-bar"
    >
      <div className="sc-account-upload-bar__fill" style={{ width: `${percent}%` }} />
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
    () => notifySuccess(t('provider.account.identity.copied')),
    () => notifyError(t('provider.account.identity.copyFailed')),
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
  actionLabel,
  onUpload,
}: {
  src?: string;
  fallbackText: string;
  size: number;
  uploading: boolean;
  pendingUrl?: string;
  progress: number;
  actionLabel: string;
  onUpload: () => void;
}) {
  const reducedMotion = usePrefersReducedMotion();

  return (
    <div
      data-pt-account-avatar-url={src || ''}
      data-uploading={uploading ? 'true' : undefined}
      className="sc-account-avatar"
      style={{ width: size, height: size, borderRadius: AVATAR_RADIUS }}
    >
      <div
        className="sc-account-avatar__surface"
        style={{ borderRadius: AVATAR_RADIUS }}
      >
        <UserSquareAvatar
          remoteUrl={src}
          name={fallbackText}
          size={size}
          radius={AVATAR_RADIUS}
          border="2px solid var(--pt-border)"
        />

        {pendingUrl && (
          <OptimisticImageLayer
            url={pendingUrl}
            progress={progress}
            radius={AVATAR_RADIUS}
            reducedMotion={reducedMotion}
          />
        )}
      </div>

      {/* Corner edit control, revealed on hover/focus (prototype
          .sk-identity-avatar-action grammar); a peers IconButton invokes the
          Tauri-native image picker, so no browser file input is needed. */}
      <span className="sc-account-avatar__action">
        {uploading ? (
          <span className="sc-account-image-action__tile" aria-busy="true">
            <Spin active size="small" />
          </span>
        ) : (
          <IconButton
            actionId="account.avatar-change"
            iconId="edit"
            iconSize={15}
            density="compact"
            emphasis="quiet"
            label={actionLabel}
            data-pt-account-avatar-edit
            onActivate={onUpload}
          />
        )}
      </span>

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
  const reducedMotion = usePrefersReducedMotion();

  return (
    <div
      className="sc-account-banner"
      data-uploading={uploading ? 'true' : undefined}
    >
      <div className="sc-account-banner__surface">
        {src && (
          <img
            src={src}
            alt=""
            aria-hidden
            className="sc-account-banner__image"
          />
        )}

        {pendingUrl && (
          <OptimisticImageLayer
            url={pendingUrl}
            progress={progress}
            radius={0}
            reducedMotion={reducedMotion}
          />
        )}

        {/* Corner edit control revealed on hover/focus (prototype
            .sk-banner-action grammar). */}
        <span className="sc-account-banner__action">
          {uploading ? (
            <span className="sc-account-image-action__tile" aria-busy="true">
              <Spin active size="small" />
            </span>
          ) : (
            <IconButton
              actionId="account.header-change"
              iconId="edit"
              iconSize={15}
              density="compact"
              emphasis="quiet"
              label={t('provider.account.identity.changeHeader')}
              data-pt-account-header-edit
              onActivate={onUpload}
            />
          )}
        </span>
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
  return (
    <div
      data-pt-account-identity={identityKey}
      className="sk-identity-field"
    >
      <span>{label}</span>
      <code>
        {prefix}
        {value || '—'}
      </code>
      {copiable && value ? (
        <IconButton
          actionId={`account-copy-${identityKey ?? 'field'}`}
          iconId="copy"
          iconSize={13}
          density="compact"
          emphasis="quiet"
          label={t('common.action.copy', { ns: 'common' })}
          onActivate={() => copyToClipboard(value, t)}
        />
      ) : null}
    </div>
  );
}

const AUTO_SAVE_DELAY = 800;

export function AccountTab() {
  const { t } = useTranslation('provider');
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
      if (!silent) notifyError(error?.message || t('provider.account.failedToLoad'));
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
          notifyError(t('provider.account.failedToUpdate'));
        } else {
          notifySuccess(t('provider.account.saved'));
        }
        // Do not setProfile here — local state is already up-to-date.
        // Overwriting with the server response causes controlled inputs
        // to re-render and lose cursor position / focus (the "flicker" bug).
      } catch (error: any) {
        notifyError(error?.message || t('provider.account.failedToUpdate'));
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
        notifyError(t('provider.account.avatarHeader.failedToUploadAvatar'));
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
      notifySuccess(t('provider.account.avatarHeader.avatarUpdated'));
    } catch (error: any) {
      notifyError(error?.message || t('provider.account.avatarHeader.failedToUploadAvatar'));
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
        notifyError(t('provider.account.avatarHeader.failedToUploadHeader'));
        return;
      }
      const next = normalizeProfile(result.profile);
      // Let the browser cache the committed banner before removing the local
      // preview, so the authoritative swap is seamless.
      await preloadImage(next.header || '');
      setProfile(next);
      clearPendingImage('header');
      committed = true;
      notifySuccess(t('provider.account.avatarHeader.headerUpdated'));
    } catch (error: any) {
      notifyError(error?.message || t('provider.account.avatarHeader.failedToUploadHeader'));
    } finally {
      if (!committed) clearPendingImage('header');
      setUploadingHeader(false);
    }
  };

  if (loading) {
    return (
      <div className="sc-account__state">
        <Spin active />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="sc-account__state">
        <Empty
          icon={<Icon iconId="contact" size={32} />}
          description={t('provider.account.noProfile')}
        />
      </div>
    );
  }

  return (
    <SettingsContainer>
      {saving && (
        <p className="sc-account__saving">
          {t('provider.account.autoSaving', { defaultValue: 'Saving...' })}
        </p>
      )}
      {/* ── Section 1: Identity Overview ── */}
      <SettingsSection
        title={t('provider.account.identity.title')}
        subtitle={t('provider.account.identity.subtitle')}
      >
        <div className="sk-identity" data-pt-account-identity>
          <div className="sk-banner" data-has-image={profile.header ? 'true' : 'false'}>
            <EditableHeaderBanner
              src={profile.header || undefined}
              uploading={uploadingHeader}
              pendingUrl={pendingImage.header}
              progress={uploadProgress.header}
              onUpload={handleUploadHeader}
              t={t}
            />
          </div>

          <div className="sk-identity-card">
            <div className="sk-identity-row">
              <div className="sk-identity-avatar">
                <EditableAvatar
                  src={profile.avatar || undefined}
                  fallbackText={profile.display_name || profile.username}
                  size={80}
                  uploading={uploadingAvatar}
                  pendingUrl={pendingImage.avatar}
                  progress={uploadProgress.avatar}
                  actionLabel={t('provider.account.identity.changeAvatar')}
                  onUpload={handleUploadAvatar}
                />
              </div>

              <div className="sk-identity-meta">
                <div className="sk-identity-names" data-pt-account-identity-summary>
                  <strong>{profile.display_name || profile.username}</strong>
                  <Tag tone="info">@{profile.username}</Tag>
                  {loginProviderLabel ? (
                    <Tag data-pt-account-login-provider>{loginProviderLabel}</Tag>
                  ) : null}
                </div>
                <div className="sk-identity-stats">
                  <span><strong>{profile.statuses_count}</strong>{t('provider.account.identity.posts')}</span>
                  <span><strong>{profile.following_count}</strong>{t('provider.account.identity.following')}</span>
                  <span><strong>{profile.followers_count}</strong>{t('provider.account.identity.followers')}</span>
                  <span className="sk-identity-joined">
                    {t('provider.account.identity.created', { date: formatDate(profile.created_at) })}
                  </span>
                </div>
              </div>
            </div>

            <div className="sk-identity-fields">
              <IdentityField label={t('provider.account.identity.preferredUsername')} value={profile.username} prefix="@" copiable t={t} />
              <IdentityField
                identityKey="ptid"
                label={t('provider.account.identity.ptid')}
                value={profile.peers_touch.network_id}
                copiable
                t={t}
              />
            </div>
          </div>
        </div>
      </SettingsSection>
      <DeviceLinkPanel />
      {/* ── Section 2: Public Profile (editable, auto-save) ── */}
      <SettingsSection
        title={t('provider.account.profile.title')}
        subtitle={t('provider.account.profile.subtitle')}
      >
        <SettingsRow label={t('provider.account.identity.name')}>
          <TextField
            value={profile.display_name}
            onValueChange={(value) => onFieldChange('display_name', value)}
            placeholder={t('provider.account.identity.name')}
            maxLength={60}
            aria-label={t('provider.account.identity.name')}
          />
        </SettingsRow>

        <SettingsRow vertical label={t('provider.account.profile.bio')}>
          <TextArea
            framing="embedded"
            value={profile.note}
            onValueChange={(value) => onFieldChange('note', value)}
            rows={4}
            maxLength={280}
            characterCount
            placeholder={t('provider.account.profile.bioPlaceholder')}
            data-bio-value={profile.note}
          />
        </SettingsRow>

        <div className="sk-form-grid">
          <SettingsRow label={t('provider.account.profile.region')} description={t('provider.account.profile.regionOptional')}>
            <TextField
              value={profile.region}
              onValueChange={(value) => onFieldChange('region', value)}
              placeholder={t('provider.account.profile.regionPlaceholder')}
              maxLength={120}
              aria-label={t('provider.account.profile.region')}
            />
          </SettingsRow>
          <SettingsRow label={t('provider.account.profile.timezone')} description={t('provider.account.profile.timezoneOptional')}>
            <Select<string>
              searchable
              clearable
              createValue={(query) => query}
              value={profile.timezone || undefined}
              options={timezoneOptions}
              placeholder={t('provider.account.profile.timezonePlaceholder')}
              onValueChange={(value) => onFieldChange('timezone', typeof value === 'string' ? value : '')}
            />
          </SettingsRow>
        </div>

        <SettingsRow vertical label={t('provider.account.profile.tags')} description={t('provider.account.profile.tagsDesc')}>
          <Select<string>
            multiple
            searchable
            clearable
            createValue={(query) => query}
            value={profile.tags}
            options={[]}
            placeholder={t('provider.account.profile.tagsPlaceholder')}
            onValueChange={(value) => {
              if (Array.isArray(value)) onFieldChange('tags', value);
            }}
          />
        </SettingsRow>

        <SettingsRow vertical label={t('provider.account.profile.links')} description={t('provider.account.profile.linksDesc')}>
          <div className="sk-links-list">
            <div className="sk-links-head">
              <span><Icon iconId="link-2" size={13} /> {t('provider.account.profile.linksDesc')}</span>
              <Button
                actionId="account-add-link"
                emphasis="quiet"
                density="compact"
                leading={<Icon iconId="plus" size={13} />}
                label={t('provider.account.profile.addLink')}
                onActivate={addLink}
              />
            </div>
            {profile.links.map((link, index) => (
              <div key={`link-${index}`} className="sk-link-row">
                <TextField
                  value={link.label}
                  onValueChange={(value) => onLinkChange(index, 'label', value)}
                  placeholder={t('provider.account.profile.linkLabelPlaceholder')}
                  aria-label={`${t('provider.account.profile.linkLabelPlaceholder')} ${index + 1}`}
                />
                <TextField
                  value={link.url}
                  onValueChange={(value) => onLinkChange(index, 'url', value)}
                  placeholder={t('provider.account.profile.linkUrlPlaceholder')}
                  aria-label={`${t('provider.account.profile.linkUrlPlaceholder')} ${index + 1}`}
                />
                <Tooltip label={t('common.action.delete', { ns: 'common' })}>
                  <IconButton
                    actionId={`account-remove-link-${index}`}
                    iconId="delete"
                    iconSize={14}
                    density="compact"
                    emphasis="quiet"
                    tone="danger"
                    label={t('common.action.delete', { ns: 'common' })}
                    onActivate={() => removeLink(index)}
                  />
                </Tooltip>
              </div>
            ))}
            {profile.links.length === 0 ? (
              <p className="sk-field-hint">{t('provider.account.profile.noLinks')}</p>
            ) : null}
          </div>
        </SettingsRow>
      </SettingsSection>
    </SettingsContainer>
  );
}
