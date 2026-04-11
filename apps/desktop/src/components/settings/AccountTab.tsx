import { useEffect, useMemo, useState } from 'react';
import { Flexbox } from 'react-layout-kit';
import { Button, Tooltip, toast } from '@lobehub/ui';
import {
  App,
  Avatar,
  Collapse,
  Empty,
  Input,
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
  Globe,
  Hash,
  Link2,
  MapPin,
  Pencil,
  Plus,
  Save,
  Trash2,
} from 'lucide-react';
import { api, type AccountProfile, type AccountProfileLink } from '../../services/desktop_api';
import { useAccountIdentityStore } from '../../store/accountIdentity';
import { useTranslation } from 'react-i18next';
import { OAuth2Tab } from './OAuth2Tab';

const { Text, Title } = Typography;
const { TextArea } = Input;

// ── Common IANA timezone list (representative subset) ──

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

// ── Helpers ──

function copyToClipboard(text: string, t: (key: string, opts?: Record<string, unknown>) => string) {
  navigator.clipboard.writeText(text).then(
    () => toast.success(t('provider.account.identity.copied')),
    () => toast.error(t('provider.account.identity.copyFailed')),
  );
}

async function pickImageFile(): Promise<string | null> {
  try {
    const path = await api.pickImageFile();
    return typeof path === 'string' && path ? path : null;
  } catch {
    return null;
  }
}

// ── Section title ──

function SectionTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <Flexbox gap={2}>
      <Title level={5} style={{ margin: 0 }}>
        {title}
      </Title>
      {subtitle ? (
        <Text type="secondary" style={{ fontSize: 12 }}>
          {subtitle}
        </Text>
      ) : null}
    </Flexbox>
  );
}

// ── Clickable avatar with edit badge ──

function EditableAvatar({
  src,
  fallbackText,
  size,
  uploading,
  onUpload,
}: {
  src?: string;
  fallbackText: string;
  size: number;
  uploading: boolean;
  onUpload: () => void;
}) {
  const { token } = theme.useToken();

  return (
    <div
      onClick={() => !uploading && onUpload()}
      style={{
        position: 'relative',
        cursor: uploading ? 'wait' : 'pointer',
        flexShrink: 0,
        width: size,
        height: size,
      }}
    >
      <Avatar
        src={src || undefined}
        size={size}
        style={{
          background: token.colorPrimaryBg,
          color: token.colorPrimary,
          border: `2px solid ${token.colorBorderSecondary}`,
          fontSize: size * 0.38,
          fontWeight: 700,
        }}
      >
        {(fallbackText || 'P').slice(0, 1).toUpperCase()}
      </Avatar>

      {/* Edit badge — bottom-right corner */}
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          right: 0,
          width: 24,
          height: 24,
          borderRadius: '50%',
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

      {/* Hover overlay */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: '50%',
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
    </div>
  );
}

// ── Header image banner with edit ──

function EditableHeaderBanner({
  src,
  uploading,
  onUpload,
  t,
}: {
  src?: string;
  uploading: boolean;
  onUpload: () => void;
  t: (key: string) => string;
}) {
  const { token } = theme.useToken();

  return (
    <div
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
      }}
    >
      {/* Hover overlay */}
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
    </div>
  );
}

// ── Read-only identity field ──

function IdentityField({
  label,
  value,
  prefix,
  copiable,
  t,
}: {
  label: string;
  value: string;
  prefix?: string;
  copiable?: boolean;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  const { token } = theme.useToken();
  return (
    <Flexbox gap={4} style={{ flex: '1 1 240px', minWidth: 200 }}>
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

// ── Stat chip ──

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

// ── Main component ──

export function AccountTab() {
  const { t } = useTranslation('provider');
  const { token } = theme.useToken();
  const { modal } = App.useApp();
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [draft, setDraft] = useState<AccountProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [uploadingHeader, setUploadingHeader] = useState(false);

  const timezoneOptions = useMemo(() => buildTimezoneOptions(t), [t]);

  // Silent reload: don't show full-page spinner, only update data
  const loadProfile = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const next = normalizeProfile(await api.profileGet());
      setProfile(next);
      setDraft((prev) => (silent && prev ? { ...next, ...draftOnlyFields(prev, next) } : next));

      // Sync avatar to sidebar identity store
      if (next.avatar) {
        api.accountSyncAvatar(next.avatar).catch(() => {});
        useAccountIdentityStore.getState().load();
      }
    } catch (error: any) {
      if (!silent) toast.error(error?.message || t('provider.account.failedToLoad'));
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    loadProfile(false);
  }, []);

  const hasChanges = useMemo(() => {
    if (!profile || !draft) return false;
    return JSON.stringify(profile) !== JSON.stringify(draft);
  }, [draft, profile]);

  const onFieldChange = <K extends keyof AccountProfile>(key: K, value: AccountProfile[K]) => {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
  };

  const onLinkChange = (index: number, key: keyof AccountProfileLink, value: string) => {
    setDraft((current) => {
      if (!current) return current;
      const nextLinks = current.links.map((item, i) =>
        i === index ? { ...item, [key]: value } : item,
      );
      return { ...current, links: nextLinks };
    });
  };

  const addLink = () => {
    setDraft((current) =>
      current ? { ...current, links: [...current.links, createEmptyLink()] } : current,
    );
  };

  const removeLink = (index: number) => {
    setDraft((current) => {
      if (!current) return current;
      return { ...current, links: current.links.filter((_, i) => i !== index) };
    });
  };

  const resetDraft = () => {
    if (!profile || !hasChanges) return;
    modal.confirm({
      title: t('provider.account.discardConfirm.title'),
      content: t('provider.account.discardConfirm.content'),
      okText: t('provider.account.discardConfirm.ok'),
      cancelText: t('provider.account.discardConfirm.cancel'),
      onOk: () => setDraft(profile),
    });
  };

  const saveProfile = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const next = normalizeProfile(
        await api.profileUpdate({
          note: draft.note.trim(),
          region: draft.region.trim(),
          timezone: draft.timezone.trim(),
          tags: draft.tags.map((t) => t.trim()).filter(Boolean),
          links: draft.links
            .map((l) => ({ label: l.label.trim(), url: l.url.trim() }))
            .filter((l) => l.label || l.url),
        }),
      );
      setProfile(next);
      setDraft(next);
      toast.success(t('provider.account.saved'));
    } catch (error: any) {
      toast.error(error?.message || t('provider.account.failedToUpdate'));
    } finally {
      setSaving(false);
    }
  };

  // Upload avatar: pick file → upload to OSS → sync to sidebar
  const handleUploadAvatar = async () => {
    if (uploadingAvatar) return;
    const path = await pickImageFile();
    if (!path) return;

    setUploadingAvatar(true);
    try {
      const next = normalizeProfile(await api.profileUploadAvatarOss({ file_path: path }));
      setProfile(next);
      setDraft((d) => (d ? { ...next, ...draftOnlyFields(d, next) } : next));

      // Sync sidebar avatar immediately
      if (next.avatar) {
        api.accountSyncAvatar(next.avatar).catch(() => {});
        useAccountIdentityStore.getState().load();
      }

      toast.success(t('provider.account.avatarHeader.avatarUpdated'));
    } catch (error: any) {
      toast.error(error?.message || t('provider.account.avatarHeader.failedToUploadAvatar'));
    } finally {
      setUploadingAvatar(false);
    }
  };

  const handleUploadHeader = async () => {
    if (uploadingHeader) return;
    const path = await pickImageFile();
    if (!path) return;

    setUploadingHeader(true);
    try {
      const next = normalizeProfile(await api.profileUploadHeaderOss({ file_path: path }));
      setProfile(next);
      setDraft((d) => (d ? { ...next, ...draftOnlyFields(d, next) } : next));
      toast.success(t('provider.account.avatarHeader.headerUpdated'));
    } catch (error: any) {
      toast.error(error?.message || t('provider.account.avatarHeader.failedToUploadHeader'));
    } finally {
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

  if (!draft) {
    return (
      <Flexbox align="center" justify="center" style={{ padding: 64 }}>
        <Empty description={t('provider.account.noProfile')} />
      </Flexbox>
    );
  }

  return (
    <Flexbox gap={20} style={{ padding: '16px 24px 24px', height: '100%', overflow: 'auto' }}>
      {/* ── Header bar ── */}
      <Flexbox horizontal justify="space-between" align="center" gap={12}>
        <Flexbox gap={4}>
          <Title level={4} style={{ margin: 0 }}>
            {t('provider.account.title')}
          </Title>
          <Text type="secondary">
            {t('provider.account.subtitle')}
          </Text>
        </Flexbox>
        <Flexbox horizontal gap={8}>
          <Button onClick={resetDraft} disabled={!hasChanges || saving}>
            {t('provider.account.reset')}
          </Button>
          <Button
            type="primary"
            icon={<Save size={14} />}
            onClick={saveProfile}
            loading={saving}
            disabled={!hasChanges}
          >
            {t('provider.account.save')}
          </Button>
        </Flexbox>
      </Flexbox>

      {/* ── Section 1: Identity Overview — avatar inline with edit badge ── */}
      <Flexbox
        gap={16}
        style={{
          padding: 20,
          borderRadius: 16,
          background: token.colorBgContainer,
          border: `1px solid ${token.colorBorderSecondary}`,
        }}
      >
        <SectionTitle
          title={t('provider.account.identity.title')}
          subtitle={t('provider.account.identity.subtitle')}
        />

        {/* Header banner (clickable) */}
        <EditableHeaderBanner
          src={draft.header || undefined}
          uploading={uploadingHeader}
          onUpload={handleUploadHeader}
          t={t}
        />

        {/* Avatar + name + stats row */}
        <Flexbox horizontal gap={20} align="flex-start" style={{ flexWrap: 'wrap', marginTop: -40 }}>
          <div style={{ marginLeft: 16 }}>
            <EditableAvatar
              src={draft.avatar || undefined}
              fallbackText={draft.display_name || draft.username}
              size={80}
              uploading={uploadingAvatar}
              onUpload={handleUploadAvatar}
            />
          </div>

          <Flexbox gap={8} style={{ flex: 1, minWidth: 0, paddingTop: 44 }}>
            <Flexbox horizontal align="center" gap={10} style={{ flexWrap: 'wrap' }}>
              <Title level={4} style={{ margin: 0 }}>
                {draft.display_name || draft.username}
              </Title>
              <Tag color="processing" style={{ margin: 0 }}>
                @{draft.username}
              </Tag>
            </Flexbox>

            <Flexbox horizontal gap={16} style={{ flexWrap: 'wrap' }}>
              <StatChip label={t('provider.account.identity.posts')} value={draft.statuses_count} />
              <StatChip label={t('provider.account.identity.following')} value={draft.following_count} />
              <StatChip label={t('provider.account.identity.followers')} value={draft.followers_count} />
              <Text type="secondary" style={{ fontSize: 12, alignSelf: 'center' }}>
                {t('provider.account.identity.created', { date: formatDate(draft.created_at) })}
              </Text>
            </Flexbox>
          </Flexbox>
        </Flexbox>

        <Flexbox horizontal gap={16} style={{ flexWrap: 'wrap' }}>
          <IdentityField label={t('provider.account.identity.name')} value={draft.display_name} t={t} />
          <IdentityField label={t('provider.account.identity.preferredUsername')} value={draft.username} prefix="@" copiable t={t} />
          <IdentityField label={t('provider.account.identity.ptid')} value={draft.peers_touch.network_id} copiable t={t} />
        </Flexbox>
      </Flexbox>

      {/* ── Section 2: Public Profile (editable) ── */}
      <Flexbox
        gap={18}
        style={{
          padding: 20,
          borderRadius: 16,
          background: token.colorBgContainer,
          border: `1px solid ${token.colorBorderSecondary}`,
        }}
      >
        <SectionTitle
          title={t('provider.account.profile.title')}
          subtitle={t('provider.account.profile.subtitle')}
        />

        {/* Bio */}
        <Flexbox gap={6}>
          <Text strong style={{ fontSize: 13 }}>
            {t('provider.account.profile.bio')}
          </Text>
          <TextArea
            value={draft.note}
            onChange={(e) => onFieldChange('note', e.target.value)}
            rows={4}
            maxLength={280}
            showCount
            placeholder={t('provider.account.profile.bioPlaceholder')}
            style={{ resize: 'vertical' }}
          />
        </Flexbox>

        {/* Region & Timezone */}
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
              value={draft.region}
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
            <Select
              value={draft.timezone || undefined}
              onChange={(value) => onFieldChange('timezone', value || '')}
              options={timezoneOptions}
              placeholder={t('provider.account.profile.timezonePlaceholder')}
              allowClear
              showSearch
              style={{ width: '100%' }}
              filterOption={(input, option) =>
                (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
              }
            />
          </Flexbox>
        </Flexbox>

        {/* Tags */}
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
            value={draft.tags}
            onChange={(value) => onFieldChange('tags', value)}
            placeholder={t('provider.account.profile.tagsPlaceholder')}
            style={{ width: '100%' }}
            tokenSeparators={[',']}
          />
        </Flexbox>

        {/* Links */}
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
            <Button size="small" icon={<Plus size={12} />} onClick={addLink}>
              {t('provider.account.profile.addLink')}
            </Button>
          </Flexbox>

          {draft.links.length === 0 ? (
            <Text type="secondary" style={{ fontSize: 12, paddingLeft: 4 }}>
              {t('provider.account.profile.noLinks')}
            </Text>
          ) : null}

          {draft.links.map((link, index) => (
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
                placeholder="Label (e.g. GitHub)"
                style={{ flex: 1 }}
                size="small"
              />
              <Input
                value={link.url}
                onChange={(e) => onLinkChange(index, 'url', e.target.value)}
                placeholder="https://..."
                style={{ flex: 2 }}
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
      </Flexbox>

      {/* ── Section 3: OAuth Connections (collapsed) ── */}
      <Collapse
        items={[
          {
            key: 'oauth',
            label: (
              <Flexbox horizontal align="center" gap={8}>
                <Globe size={14} />
                <Text strong>{t('provider.oauth.tab.oauthConnections')}</Text>
              </Flexbox>
            ),
            children: <OAuth2Tab />,
          },
        ]}
        style={{
          background: token.colorBgContainer,
          borderRadius: 16,
          border: `1px solid ${token.colorBorderSecondary}`,
          overflow: 'hidden',
        }}
      />
    </Flexbox>
  );
}

// Preserve the user's in-flight edits for fields that weren't changed by the image upload.
function draftOnlyFields(
  currentDraft: AccountProfile,
  freshFromServer: AccountProfile,
): Partial<AccountProfile> {
  const overrides: Partial<AccountProfile> = {};
  if (currentDraft.note !== freshFromServer.note) overrides.note = currentDraft.note;
  if (currentDraft.region !== freshFromServer.region) overrides.region = currentDraft.region;
  if (currentDraft.timezone !== freshFromServer.timezone) overrides.timezone = currentDraft.timezone;
  if (JSON.stringify(currentDraft.tags) !== JSON.stringify(freshFromServer.tags))
    overrides.tags = currentDraft.tags;
  if (JSON.stringify(currentDraft.links) !== JSON.stringify(freshFromServer.links))
    overrides.links = currentDraft.links;
  return overrides;
}
