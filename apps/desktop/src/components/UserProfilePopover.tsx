import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import { Popover, Typography, Divider } from 'antd';
import { Button } from '@lobehub/ui';
import { Globe } from 'lucide-react';
import { UserSquareAvatar } from './common/UserSquareAvatar';
import { useSessionStore } from '../store/session';
import { EVENT, eventBus } from '../kernel/events';

const { Text } = Typography;

interface Props {
  children: ReactNode;
}

export function UserProfilePopover({ children }: Props) {
  const [open, setOpen] = useState(false);
  const { t } = useTranslation('layout');
  const currentUser = useSessionStore((s) => s.currentUser);

  const userName = currentUser?.name || t('layout.user.defaultName');
  const userEmail = currentUser?.email || '';
  const userAvatar = currentUser?.avatarUrl || undefined;

  const content = (
    <Flexbox gap={16} style={{ width: 300, padding: 4 }}>
      <Flexbox horizontal align="center" gap={12}>
        <UserSquareAvatar url={userAvatar} name={userName} size={48} />
        <Flexbox gap={2} style={{ flex: 1 }}>
          <Text strong style={{ fontSize: 15 }}>{userName}</Text>
          {userEmail ? (
            <Text type="secondary" style={{ fontSize: 12 }}>{userEmail}</Text>
          ) : (
            <Text type="secondary" style={{ fontSize: 12 }}>
              {t('layout.user.noAccount')}
            </Text>
          )}
        </Flexbox>
      </Flexbox>

      <Divider style={{ margin: 0 }} />

      <Button
        block
        icon={<Globe size={14} />}
        onClick={() => {
          setOpen(false);
          window.location.hash = '#/settings';
          setTimeout(() => {
            eventBus.publish(EVENT.NAVIGATION_REQUESTED, { resource: 'settings', id: 'account' });
          }, 100);
        }}
      >
        {t('layout.user.manageAccount')}
      </Button>
    </Flexbox>
  );

  return (
    <Popover
      content={content}
      trigger="click"
      placement="rightBottom"
      open={open}
      onOpenChange={setOpen}
      arrow={false}
    >
      {children}
    </Popover>
  );
}

export function useUserAvatar(): { url?: string; name: string; provider?: string } {
  const currentUser = useSessionStore((s) => s.currentUser);
  const { t } = useTranslation('layout');

  return useMemo(() => ({
    url: currentUser?.avatarUrl || undefined,
    name: currentUser?.name || t('layout.user.defaultName'),
    provider: currentUser?.loginProvider || currentUser?.loginMethod || undefined,
  }), [currentUser, t]);
}
