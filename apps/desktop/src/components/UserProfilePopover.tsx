import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import { Popover, Typography, Divider, Spin, theme } from 'antd';
import { Button } from '@lobehub/ui';
import { Globe } from 'lucide-react';
import { useSessionStore } from '../store/session';
import { useFederationStore } from '../store/federation';
import { UserSquareAvatar } from './common/UserSquareAvatar';
import { FederatedHandle } from './FederatedHandle';
import { api, type AccountProfile } from '../services/desktop_api';
import { EVENT, eventBus } from '../kernel/events';

const { Text } = Typography;

function formatDate(date?: string) {
  if (!date) return '';
  const value = new Date(date);
  if (Number.isNaN(value.getTime())) return '';
  return value.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

interface Props {
  children: ReactNode;
}

export function UserProfilePopover({ children }: Props) {
  const [open, setOpen] = useState(false);
  const { t } = useTranslation('layout');
  const { token } = theme.useToken();
  const currentUser = useSessionStore((s) => s.currentUser);
  const federationSelf = useFederationStore((s) => s.self);

  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [loading, setLoading] = useState(false);

  const userName = currentUser?.name || t('layout.user.defaultName');
  const userAvatar = currentUser?.avatarUrl || undefined;

  const displayName = profile?.display_name || userName;
  const username = profile?.username || federationSelf?.preferredUsername || '';
  const homeStation = federationSelf?.homeStationDomain || '';
  const headerSrc = profile?.header || undefined;
  const avatarSrc = profile?.avatar || userAvatar;
  const bio = profile?.note || '';
  const createdAt = formatDate(profile?.created_at);

  const content = (
    <Flexbox gap={0} style={{ width: 320, overflow: 'hidden' }}>
      {/* Banner */}
      <div
        style={{
          width: '100%',
          height: 80,
          background: headerSrc
            ? `url(${headerSrc}) center/cover no-repeat`
            : `linear-gradient(135deg, ${token.colorPrimaryBg} 0%, ${token.colorBgLayout} 100%)`,
        }}
      />

      {/* Profile body */}
      <Flexbox gap={12} style={{ padding: '0 16px 16px' }}>
        {/* Avatar + name */}
        <Flexbox horizontal gap={12} align="flex-end" style={{ marginTop: -24 }}>
          <UserSquareAvatar
            remoteUrl={avatarSrc}
            name={displayName}
            size={56}
            radius={12}
            border={`2px solid ${token.colorBgContainer}`}
          />

          <Flexbox gap={2} style={{ paddingBottom: 4, minWidth: 0 }}>
            <Text strong style={{ fontSize: 15, lineHeight: 1.3 }} ellipsis>
              {displayName}
            </Text>
            {username && (
              <FederatedHandle
                localPart={username}
                home={homeStation}
                fontSize={12}
              />
            )}
          </Flexbox>
        </Flexbox>

        {/* Bio */}
        {bio && (
          <Text
            style={{ fontSize: 13, lineHeight: 1.5, color: token.colorText }}
            ellipsis={{ tooltip: bio }}
          >
            {bio}
          </Text>
        )}

        {/* Stats + created date */}
        {profile && (
          <Flexbox horizontal gap={16} align="center" style={{ flexWrap: 'wrap' }}>
            <Text style={{ fontSize: 12 }}>
              <Text strong>{profile.statuses_count}</Text>{' '}
              <Text type="secondary">{t('layout.user.posts', { defaultValue: 'posts' })}</Text>
            </Text>
            <Text style={{ fontSize: 12 }}>
              <Text strong>{profile.following_count}</Text>{' '}
              <Text type="secondary">
                {t('layout.user.following', { defaultValue: 'following' })}
              </Text>
            </Text>
            <Text style={{ fontSize: 12 }}>
              <Text strong>{profile.followers_count}</Text>{' '}
              <Text type="secondary">
                {t('layout.user.followers', { defaultValue: 'followers' })}
              </Text>
            </Text>
          </Flexbox>
        )}

        {createdAt && (
          <Text type="secondary" style={{ fontSize: 11 }}>
            {t('layout.user.joined', { defaultValue: 'Joined' })} {createdAt}
          </Text>
        )}

        {/* Loading indicator while fetching profile */}
        {loading && !profile && (
          <Flexbox align="center" style={{ padding: 8 }}>
            <Spin size="small" />
          </Flexbox>
        )}

        <Divider style={{ margin: 0 }} />

        <Button
          block
          icon={<Globe size={14} />}
          onClick={() => {
            setOpen(false);
            window.location.hash = '#/settings';
            setTimeout(() => {
              eventBus.publish(EVENT.NAVIGATION_REQUESTED, {
                resource: 'settings',
                id: 'account',
              });
            }, 100);
          }}
        >
          {t('layout.user.manageAccount')}
        </Button>
      </Flexbox>
    </Flexbox>
  );

  return (
    <Popover
      content={content}
      trigger="click"
      placement="rightBottom"
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen) {
          setLoading(true);
          api
            .profileGet()
            .then((p) => setProfile(p))
            .catch(() => {})
            .finally(() => setLoading(false));
        }
      }}
      arrow={false}
      overlayInnerStyle={{ padding: 0, overflow: 'hidden', borderRadius: 12 }}
    >
      {children}
    </Popover>
  );
}

export function useUserAvatar(): { url?: string; name: string; provider?: string } {
  const currentUser = useSessionStore((s) => s.currentUser);
  const { t } = useTranslation('layout');

  return useMemo(
    () => ({
      url: currentUser?.avatarUrl || undefined,
      name: currentUser?.name || t('layout.user.defaultName'),
      provider: currentUser?.loginProvider || currentUser?.loginMethod || undefined,
    }),
    [currentUser, t],
  );
}
