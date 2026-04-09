import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Flexbox } from 'react-layout-kit';
import { Popover, Typography, theme, Divider } from 'antd';
import { Button, toast } from '@lobehub/ui';
import { Check, Globe } from 'lucide-react';
import { UserSquareAvatar } from './common/UserSquareAvatar';
import { PlatformLogo } from './common/PlatformLogo';
import { useAccountIdentityStore } from '../store/accountIdentity';
import { EVENT, eventBus } from '../kernel/events';

const { Text } = Typography;

interface Props {
  children: ReactNode;
}

export function UserProfilePopover({ children }: Props) {
  const { token } = theme.useToken();
  const [open, setOpen] = useState(false);
  const { accounts, activeAccountId, load, switchAccount } = useAccountIdentityStore();
  const activeAccount = useMemo(
    () => accounts.find((item) => item.id === activeAccountId) || accounts[0],
    [accounts, activeAccountId],
  );

  useEffect(() => {
    if (open) {
      load();
    }
  }, [open, load]);

  const userName = activeAccount?.name || 'User';
  const userAvatar = activeAccount?.avatar_url || undefined;

  const content = (
    <Flexbox gap={16} style={{ width: 300, padding: 4 }}>
      <Flexbox horizontal align="center" gap={12}>
        <AvatarDisplay url={userAvatar} name={userName} size={48} />
        <Flexbox gap={2} style={{ flex: 1 }}>
          <Text strong style={{ fontSize: 15 }}>{userName}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {accounts.length > 0
              ? `${accounts.length} account${accounts.length > 1 ? 's' : ''} available`
              : 'No account connected'}
          </Text>
        </Flexbox>
      </Flexbox>

      {accounts.length > 0 && (
        <>
          <Divider style={{ margin: 0 }} />
          <Flexbox gap={6}>
            <Text type="secondary" style={{ fontSize: 12 }}>Choose active account</Text>
            {accounts.map((account) => {
              const isActive = activeAccount?.id === account.id;
              const providerId = account.provider || 'unknown';
              const onSelect = async () => {
                if (isActive) return;
                try {
                  await switchAccount(account.id);
                } catch {
                  toast.error('Failed to switch account');
                }
              };
              return (
                <Flexbox
                  key={account.id}
                  horizontal
                  align="center"
                  gap={8}
                  style={{
                    border: `1px solid ${isActive ? token.colorPrimary : token.colorBorderSecondary}`,
                    borderRadius: 8,
                    padding: '8px 10px',
                    cursor: isActive ? 'default' : 'pointer',
                    background: isActive ? `${token.colorPrimary}10` : 'transparent',
                  }}
                  onClick={onSelect}
                >
                  <PlatformLogo providerId={providerId} size={14} />
                  <Text style={{ fontSize: 13, flex: 1 }}>
                    {account.name}
                  </Text>
                  {isActive && <Check size={12} color={token.colorPrimary} />}
                </Flexbox>
              );
            })}
          </Flexbox>
        </>
      )}

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
        Manage Account
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

function AvatarDisplay({ url, name, size }: { url?: string; name: string; size: number }) {
  return <UserSquareAvatar url={url} name={name} size={size} />;
}

export function useUserAvatar(): { url?: string; name: string; provider?: string } {
  const accounts = useAccountIdentityStore((s) => s.accounts);
  const activeAccountId = useAccountIdentityStore((s) => s.activeAccountId);

  return useMemo(() => {
    const active = accounts.find((item) => item.id === activeAccountId) || accounts[0];
    return {
      url: active?.avatar_url || undefined,
      name: active?.name || 'User',
      provider: active?.provider || undefined,
    };
  }, [accounts, activeAccountId]);
}
