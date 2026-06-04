import { useEffect, useMemo, useRef, useState } from 'react';
import { Flexbox } from 'react-layout-kit';
import { Tooltip, toast } from '@lobehub/ui';
import { useSessionStore } from '../../store/session';
import {
  Empty,
  Input,
  AutoComplete,
  List,
  Modal,
  Select,
  Spin,
  Tag,
  Typography,
  theme,
} from 'antd';
import {
  Camera,
  Ban,
  Clock3,
  Copy,
  Hash,
  Link2,
  MapPin,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import { Button } from '@lobehub/ui';
import { api, type AccountProfile, type AccountProfileLink, type Friend } from '../../services/desktop_api';
import { UserSquareAvatar } from '../common/UserSquareAvatar';
import { useAccountIdentityStore } from '../../store/accountIdentity';
import { useTranslation } from 'react-i18next';
import { SettingsContainer, SettingsSection } from './SettingsLayout';

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
  try {
    return await api.pickImageFile();
  } catch {
    return null;
  }
}

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
    </div>
  );
}

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
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [uploadingHeader, setUploadingHeader] = useState(false);
  const [blockedOpen, setBlockedOpen] = useState(false);
  const [blockedLoading, setBlockedLoading] = useState(false);
  const [blockedUsers, setBlockedUsers] = useState<Friend[]>([]);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const timezoneOptions = useMemo(() => buildTimezoneOptions(t), [t]);

  const loadProfile = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const next = normalizeProfile(await api.profileGet());
      setProfile(next);

      if (next.avatar) {
        api.accountSyncAvatar(next.avatar).then(() => {
          return api.syncUserProfile();
        }).then((result) => {
          if (result?.avatar_url) {
            useSessionStore.getState().updateAvatar(result.avatar_url);
          }
        }).catch(() => {});
        useAccountIdentityStore.getState().load();
        useSessionStore.getState().updateAvatar(next.avatar);
      }
    } catch (error: any) {
      if (!silent) toast.error(error?.message || t('provider.account.failedToLoad'));
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    loadProfile(false);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  const autoSave = (nextProfile: AccountProfile) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      setSaving(true);
      try {
        await api.profileUpdate({
          display_name: nextProfile.display_name.trim(),
          note: nextProfile.note.trim(),
          region: nextProfile.region.trim(),
          timezone: nextProfile.timezone.trim(),
          tags: nextProfile.tags.map((tg) => tg.trim()).filter(Boolean),
          links: nextProfile.links
            .map((l) => ({ label: l.label.trim(), url: l.url.trim() }))
            .filter((l) => l.label || l.url),
        });
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

  const handleUploadAvatar = async () => {
    if (uploadingAvatar) return;
    const path = await pickImageFile();
    if (!path) return;

    setUploadingAvatar(true);
    try {
      const next = normalizeProfile(await api.profileUploadAvatarOss({ file_path: path }));
      setProfile(next);

      if (next.avatar) {
        // Warm the local cache and refresh identity store; the avatar component
        // will render the cached file as soon as resolveLocal returns.
        api.accountSyncAvatar(next.avatar).then(() => {
          return api.syncUserProfile();
        }).then((result) => {
          if (result?.avatar_url) {
            useSessionStore.getState().updateAvatar(result.avatar_url);
          }
        }).catch((error: any) => {
          toast.error(error?.message || t('provider.account.avatarHeader.failedToUploadAvatar'));
        });
        useAccountIdentityStore.getState().load();
        useSessionStore.getState().updateAvatar(next.avatar);
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
      toast.success(t('provider.account.avatarHeader.headerUpdated'));
    } catch (error: any) {
      toast.error(error?.message || t('provider.account.avatarHeader.failedToUploadHeader'));
    } finally {
      setUploadingHeader(false);
    }
  };

  const loadBlockedUsers = async () => {
    setBlockedLoading(true);
    try {
      const response = await api.friendChatListBlockedUsers();
      setBlockedUsers(response.blockedUsers ?? []);
    } catch (error: any) {
      toast.error(error?.message || t('provider.account.relationship.loadBlockedFailed'));
    } finally {
      setBlockedLoading(false);
    }
  };

  const openBlockedUsers = () => {
    setBlockedOpen(true);
    void loadBlockedUsers();
  };

  const confirmUnblockUser = (targetDid: string) => {
    Modal.confirm({
      title: t('provider.account.relationship.unblockConfirmTitle'),
      content: t('provider.account.relationship.unblockConfirmBody', { did: targetDid }),
      okText: t('provider.account.relationship.unblock'),
      cancelText: t('common.action.cancel', { ns: 'common' }),
      onOk: async () => {
        try {
          await api.friendChatUnblockUser(targetDid);
          await loadBlockedUsers();
          toast.success(t('provider.account.relationship.unblockSuccess'));
        } catch (error: any) {
          toast.error(error?.message || t('provider.account.relationship.unblockFailed'));
          throw error;
        }
      },
    });
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
        <Empty description={t('provider.account.noProfile')} />
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
              onUpload={handleUploadAvatar}
            />
          </div>

          <Flexbox gap={8} style={{ flex: 1, minWidth: 0, paddingTop: 44 }}>
            <Flexbox horizontal align="center" gap={10} style={{ flexWrap: 'wrap' }}>
              <Title level={4} style={{ margin: 0 }}>
                {profile.display_name || profile.username}
              </Title>
              <Tag color="processing" style={{ margin: 0 }}>
                @{profile.username}
              </Tag>
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
          <IdentityField label={t('provider.account.identity.ptid')} value={profile.peers_touch.network_id} copiable t={t} />
        </Flexbox>
      </SettingsSection>
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
                placeholder="Label (e.g. GitHub)"
                style={{ flex: 1, fontSize: 12 }}
                size="small"
              />
              <Input
                value={link.url}
                onChange={(e) => onLinkChange(index, 'url', e.target.value)}
                placeholder="https://..."
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

      <SettingsSection
        title={t('provider.account.relationship.title')}
        subtitle={t('provider.account.relationship.subtitle')}
      >
        <Flexbox
          horizontal
          align="center"
          justify="space-between"
          gap={16}
          style={{
            padding: '12px 14px',
            borderRadius: 12,
            border: `1px solid ${token.colorBorderSecondary}`,
            background: token.colorFillQuaternary,
          }}
        >
          <Flexbox horizontal align="center" gap={10} style={{ minWidth: 0 }}>
            <Flexbox
              align="center"
              justify="center"
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                background: token.colorErrorBg,
                color: token.colorError,
                flexShrink: 0,
              }}
            >
              <Ban size={17} />
            </Flexbox>
            <Flexbox gap={2} style={{ minWidth: 0 }}>
              <Text strong>{t('provider.account.relationship.blockedUsers')}</Text>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {t('provider.account.relationship.blockedUsersDesc')}
              </Text>
            </Flexbox>
          </Flexbox>
          <Button icon={<Ban size={14} />} onClick={openBlockedUsers}>
            {t('provider.account.relationship.manageBlocked')}
          </Button>
        </Flexbox>
      </SettingsSection>

      <Modal
        title={t('provider.account.relationship.blockedUsers')}
        open={blockedOpen}
        footer={null}
        onCancel={() => setBlockedOpen(false)}
        destroyOnClose
      >
        <Spin spinning={blockedLoading}>
          {blockedUsers.length > 0 ? (
            <List
              dataSource={blockedUsers}
              renderItem={(item) => (
                <List.Item
                  actions={[
                    <Button
                      key="unblock"
                      size="small"
                      icon={<RotateCcw size={13} />}
                      onClick={() => confirmUnblockUser(item.actorId)}
                    >
                      {t('provider.account.relationship.unblock')}
                    </Button>,
                  ]}
                >
                  <List.Item.Meta
                    title={<Text copyable>{item.actorId}</Text>}
                    description={<Tag color="error">{t('provider.account.relationship.blocked')}</Tag>}
                  />
                </List.Item>
              )}
            />
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('provider.account.relationship.noBlockedUsers')} />
          )}
        </Spin>
      </Modal>

    </SettingsContainer>
  );
}
