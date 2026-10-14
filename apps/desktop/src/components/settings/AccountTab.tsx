import { useEffect, useMemo, useState } from 'react';
import { Flexbox } from 'react-layout-kit';
import { Tooltip, toast } from '@lobehub/ui';
import {
  Empty,
  Alert,
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
  Link2,
  MapPin,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import { Button } from '@lobehub/ui';
import {
  api,
  type AccountProfile,
  type AccountProfileLink,
} from '../../services/desktop_api';
import { UserSquareAvatar } from '../common/UserSquareAvatar';
import { useProfileStore } from '../../store/profile';
import { useAccountIdentityStore } from '../../store/accountIdentity';
import { useSessionStore } from '../../store/session';
import { useTranslation } from 'react-i18next';
import { SettingsContainer, SettingsSection } from './SettingsLayout';
import {
  accountLoginProviderLocaleKey,
  resolveAccountLoginProvider,
} from './accountIdentityPresentation';
import { log } from '../../utils/logger';

const { Text, Title } = Typography;
const { TextArea } = Input;

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
  return api.pickImageFile();
}

function EditableAvatar({
  src,
  fallbackText,
  size,
  uploading,
  disabled,
  label,
  onUpload,
}: {
  src?: string;
  fallbackText: string;
  size: number;
  uploading: boolean;
  disabled: boolean;
  label: string;
  onUpload: () => void;
}) {
  const { token } = theme.useToken();

  return (
    <button
      type="button"
      disabled={uploading || disabled}
      aria-label={label}
      data-pt-account-avatar-url={src || ''}
      onClick={() => !uploading && onUpload()}
      style={{
        position: 'relative',
        cursor: uploading ? 'wait' : 'pointer',
        flexShrink: 0,
        width: size,
        height: size,
        border: 0,
        padding: 0,
        background: 'transparent',
      }}
    >
      <UserSquareAvatar
        remoteUrl={src}
        name={fallbackText}
        size={size}
        radius={12}
        border={`2px solid ${token.colorBorderSecondary}`}
      />

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

      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: 12,
          background: 'rgba(0,0,0,0.25)',
          opacity: 0,
          transition: 'opacity 0.2s',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLElement).style.opacity = '1';
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.opacity = '0';
        }}
      >
        {!uploading && <Pencil size={20} style={{ color: '#fff' }} />}
      </div>
    </button>
  );
}

function EditableHeaderBanner({
  src,
  uploading,
  disabled,
  onUpload,
  t,
}: {
  src?: string;
  uploading: boolean;
  disabled: boolean;
  onUpload: () => void;
  t: (key: string) => string;
}) {
  const { token } = theme.useToken();

  return (
    <button
      type="button"
      disabled={uploading || disabled}
      aria-label={t('provider.account.identity.changeHeader')}
      onClick={() => !uploading && onUpload()}
      style={{
        position: 'relative',
        width: '100%',
        height: 120,
        borderRadius: 12,
        overflow: 'hidden',
        cursor: uploading ? 'wait' : 'pointer',
        background: src
          ? `url(${src}) center/cover no-repeat`
          : `linear-gradient(135deg, ${token.colorPrimaryBg} 0%, ${token.colorBgLayout} 100%)`,
        border: `1px solid ${token.colorBorderSecondary}`,
        padding: 0,
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(0,0,0,0.3)',
          opacity: 0,
          transition: 'opacity 0.2s',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLElement).style.opacity = '1';
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.opacity = '0';
        }}
      >
        {uploading ? (
          <Spin size="small" />
        ) : (
          <>
            <Camera size={16} style={{ color: '#fff' }} />
            <Text style={{ color: '#fff', fontSize: 12 }}>
              {t('provider.account.identity.changeHeader')}
            </Text>
          </>
        )}
      </div>
    </button>
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

export function AccountTab() {
  const { t } = useTranslation('provider');
  const profile = useProfileStore((state) => state.profile);
  const loading = useProfileStore((state) => state.loading);
  const error = useProfileStore((state) => state.error);

  if (!profile) {
    return (
      <Flexbox align="center" gap={12} style={{ padding: 64 }}>
        {loading ? <Spin /> : <Empty description={t('provider.account.noProfile')} />}
        {error && <Alert type="warning" message={t(error)} showIcon />}
        <Button onClick={() => useProfileStore.getState().refresh()} disabled={loading}>
          {t('provider.account.profile.reload')}
        </Button>
      </Flexbox>
    );
  }
  return <AccountProfileEditor key={profile.peers_touch.network_id} canonicalProfile={profile} />;
}

function AccountProfileEditor({ canonicalProfile }: { canonicalProfile: AccountProfile }) {
  const { t } = useTranslation('provider');
  const { token } = theme.useToken();
  const activeAccount = useAccountIdentityStore((state) => (
    state.accounts.find((account) => account.id === state.activeAccountId) ?? null
  ));
  const sessionLoginProvider = useSessionStore((state) => (
    state.currentUser?.loginProvider ?? state.currentUser?.loginMethod
  ));
  const [profile, setProfile] = useState<AccountProfile>(() => normalizeProfile(canonicalProfile));
  const [dirty, setDirty] = useState(false);
  const [conflict, setConflict] = useState(false);
  const saving = useProfileStore((state) => state.saving);
  const error = useProfileStore((state) => state.error);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [uploadingHeader, setUploadingHeader] = useState(false);

  const timezoneOptions = useMemo(() => buildTimezoneOptions(t), [t]);
  const loginProvider = resolveAccountLoginProvider({
    accountProvider: activeAccount?.provider,
    sessionProvider: sessionLoginProvider,
  });
  const loginProviderKey = accountLoginProviderLocaleKey(loginProvider);
  const loginProviderLabel = loginProviderKey ? t(loginProviderKey) : loginProvider;

  useEffect(() => {
    if (!dirty) setProfile(normalizeProfile(canonicalProfile));
  }, [canonicalProfile, dirty]);

  const saveProfile = async () => {
    if (saving || !dirty || conflict) return;
    try {
        const result = await useProfileStore.getState().update({
          display_name: profile.display_name.trim(),
          note: profile.note.trim(),
          region: profile.region.trim(),
          timezone: profile.timezone.trim(),
          tags: profile.tags.map((tg) => tg.trim()).filter(Boolean),
          links: profile.links
            .map((l) => ({ label: l.label.trim(), url: l.url.trim() }))
            .filter((l) => l.label || l.url),
          observed_revision: profile.profile_revision,
        });
        if (result.outcome === 'PROFILE_UPDATE_OUTCOME_CONFLICT') {
          setConflict(true);
          return;
        }
        setProfile(normalizeProfile(result.profile));
        setDirty(false);
    } catch (failure) {
      log.warn('settings', 'Account profile save failed', failure);
      toast.error(t('provider.account.failedToUpdate'));
    }
  };

  const onFieldChange = <K extends keyof AccountProfile>(key: K, value: AccountProfile[K]) => {
    setProfile((current) => {
      const next = { ...current, [key]: value };
      return next;
    });
    setDirty(true);
  };

  const onLinkChange = (index: number, key: keyof AccountProfileLink, value: string) => {
    setProfile((current) => {
      const nextLinks = current.links.map((item, i) =>
        i === index ? { ...item, [key]: value } : item,
      );
      const next = { ...current, links: nextLinks };
      return next;
    });
    setDirty(true);
  };

  const addLink = () => {
    setProfile((current) => ({
      ...current, links: [...current.links, createEmptyLink()],
    }));
    setDirty(true);
  };

  const removeLink = (index: number) => {
    setProfile((current) => {
      const next = { ...current, links: current.links.filter((_, i) => i !== index) };
      return next;
    });
    setDirty(true);
  };

  const handleUploadAvatar = async () => {
    if (saving || dirty || uploadingAvatar) return;
    try {
      const path = await pickImageFile();
      if (!path) return;
      setUploadingAvatar(true);
      const result = await useProfileStore.getState().upload('avatar', path);
      if (result.outcome === 'PROFILE_UPDATE_OUTCOME_CONFLICT') {
        setConflict(true);
        toast.error(t('provider.account.avatarHeader.failedToUploadAvatar'));
        return;
      }
      const next = normalizeProfile(result.profile);
      setProfile(next);

      toast.success(t('provider.account.avatarHeader.avatarUpdated'));
    } catch (failure) {
      log.warn('settings', 'Account avatar upload failed', failure);
      toast.error(t('provider.account.avatarHeader.failedToUploadAvatar'));
    } finally {
      setUploadingAvatar(false);
    }
  };

  const handleUploadHeader = async () => {
    if (saving || dirty || uploadingHeader) return;
    try {
      const path = await pickImageFile();
      if (!path) return;
      setUploadingHeader(true);
      const result = await useProfileStore.getState().upload('header', path);
      if (result.outcome === 'PROFILE_UPDATE_OUTCOME_CONFLICT') {
        setConflict(true);
        toast.error(t('provider.account.avatarHeader.failedToUploadHeader'));
        return;
      }
      const next = normalizeProfile(result.profile);
      setProfile(next);
      toast.success(t('provider.account.avatarHeader.headerUpdated'));
    } catch (failure) {
      log.warn('settings', 'Account cover upload failed', failure);
      toast.error(t('provider.account.avatarHeader.failedToUploadHeader'));
    } finally {
      setUploadingHeader(false);
    }
  };

  return (
    <SettingsContainer>
      {(error || conflict) && <Alert type="warning" showIcon
        message={t(conflict ? 'provider.account.profile.conflict' : error || '')}
        action={<Button size="small" onClick={() => {
          setProfile(normalizeProfile(canonicalProfile));
          setDirty(false);
          setConflict(false);
        }}>{t('provider.account.profile.reload')}</Button>} />}
      {/* ── Section 1: Identity Overview ── */}
      <SettingsSection
        title={t('provider.account.identity.title')}
        subtitle={t('provider.account.identity.subtitle')}
      >

        <EditableHeaderBanner
          src={profile.header || undefined}
          uploading={uploadingHeader}
          disabled={saving || dirty}
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
              disabled={saving || dirty}
              label={t('provider.account.identity.changeAvatar')}
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
          <IdentityField identityKey="handle" label={t('provider.account.identity.handle')}
            value={canonicalProfile.federated_handle || canonicalProfile.acct} copiable t={t} />
          <IdentityField identityKey="home-station" label={t('provider.account.identity.homeStation')}
            value={canonicalProfile.home_station_domain} copiable t={t} />
        </Flexbox>
      </SettingsSection>
      <fieldset disabled={saving || conflict} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
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
      </fieldset>
      <Flexbox horizontal justify="flex-end" gap={8}>
        <Button disabled={!dirty || saving} onClick={() => {
          setProfile(normalizeProfile(canonicalProfile));
          setDirty(false);
          setConflict(false);
        }}>{t('provider.account.profile.discard')}</Button>
        <Button type="primary" loading={saving} disabled={!dirty || conflict}
          onClick={saveProfile}>{t('provider.account.profile.save')}</Button>
      </Flexbox>

    </SettingsContainer>
  );
}
