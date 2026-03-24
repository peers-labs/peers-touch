import { useEffect, useState, useCallback } from 'react';
import { Flexbox } from 'react-layout-kit';
import { Popover, Typography, Button, theme, Divider, message, Input } from 'antd';
import { Check, Edit2, Globe, Bot } from 'lucide-react';
import { api, type OAuth2Connection, type UserPreferences } from '../services/desktop_api';
import { UserSquareAvatar } from './common/UserSquareAvatar';
import { PlatformLogo } from './common/PlatformLogo';

const { Text } = Typography;

interface Props {
  children: React.ReactNode;
}

export function UserProfilePopover({ children }: Props) {
  const { token } = theme.useToken();
  const [open, setOpen] = useState(false);
  const [prefs, setPrefs] = useState<UserPreferences>({});
  const [connections, setConnections] = useState<OAuth2Connection[]>([]);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState('');

  const load = useCallback(async () => {
    try {
      const [p, c] = await Promise.all([
        api.getPreferences(),
        api.oauth2ListConnections().catch(() => []),
      ]);
      setPrefs(p);
      setConnections(c || []);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const updatePrefs = async (update: Partial<UserPreferences>) => {
    const next = { ...prefs, ...update };
    setPrefs(next);
    window.dispatchEvent(new CustomEvent('user-preferences-updated', { detail: next }));
    try {
      await api.setPreferences(update);
    } catch {
      message.error('Failed to save');
    }
  };

  const handleSetAvatar = (url: string, provider?: string) => {
    updatePrefs({ user_avatar: url, user_avatar_provider: provider });
  };

  const handleSaveName = () => {
    if (nameInput.trim()) {
      updatePrefs({ user_name: nameInput.trim() });
    }
    setEditingName(false);
  };

  const userName = prefs.user_name || 'User';
  const userAvatar = prefs.user_avatar;

  const content = (
    <Flexbox gap={16} style={{ width: 280, padding: 4 }}>
      <Flexbox horizontal align="center" gap={12}>
        <AvatarDisplay url={userAvatar} name={userName} size={48} />
        <Flexbox gap={2} style={{ flex: 1 }}>
          {editingName ? (
            <Flexbox horizontal gap={4}>
              <Input
                size="small"
                value={nameInput}
                onChange={e => setNameInput(e.target.value)}
                onPressEnter={handleSaveName}
                autoFocus
                style={{ flex: 1 }}
              />
              <Button size="small" type="primary" icon={<Check size={12} />} onClick={handleSaveName} />
            </Flexbox>
          ) : (
            <Flexbox horizontal align="center" gap={4}>
              <Text strong style={{ fontSize: 15 }}>{userName}</Text>
              <Edit2
                size={12}
                style={{ cursor: 'pointer', color: token.colorTextSecondary }}
                onClick={() => { setNameInput(userName === 'User' ? '' : userName); setEditingName(true); }}
              />
            </Flexbox>
          )}
          <Text type="secondary" style={{ fontSize: 12 }}>
            {connections.length > 0
              ? `${connections.length} platform${connections.length > 1 ? 's' : ''} connected`
              : 'No platforms connected'}
          </Text>
        </Flexbox>
      </Flexbox>

      {connections.length > 0 && (
        <>
          <Divider style={{ margin: 0 }} />
          <Flexbox gap={8}>
            <Text type="secondary" style={{ fontSize: 12 }}>Choose avatar source</Text>
            <Flexbox horizontal gap={8} style={{ flexWrap: 'wrap' }}>
              <AvatarOption
                selected={!userAvatar}
                onClick={() => handleSetAvatar('', '')}
                fallback={<Bot size={16} color="#764ba2" />}
                label="Default"
                color="#764ba2"
              />

              {connections.map(conn => {
                const isSelected = prefs.user_avatar_provider === conn.provider_id;
                return (
                  <AvatarOption
                    key={conn.provider_id}
                    selected={isSelected}
                    onClick={() => handleSetAvatar(conn.avatar_url, conn.provider_id)}
                    avatarUrl={conn.avatar_url}
                    fallback={<PlatformLogo providerId={conn.provider_id} size={16} />}
                    label={conn.provider_name || conn.provider_id}
                    color={token.colorPrimary}
                  />
                );
              })}
            </Flexbox>
          </Flexbox>
        </>
      )}

      {connections.length > 0 && (
        <>
          <Divider style={{ margin: 0 }} />
          <Flexbox gap={6}>
            <Text type="secondary" style={{ fontSize: 12 }}>Connected accounts</Text>
            {connections.map(conn => {
              return (
                <Flexbox key={conn.provider_id} horizontal align="center" gap={8}>
                  <PlatformLogo providerId={conn.provider_id} size={14} />
                  <Text style={{ fontSize: 13, flex: 1 }}>
                    {conn.provider_name}
                  </Text>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {conn.user_name || conn.user_id}
                  </Text>
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
            const event = new CustomEvent('navigate-settings-tab', { detail: 'oauth' });
            window.dispatchEvent(event);
          }, 100);
        }}
      >
        Manage Connections
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

function AvatarOption({
  selected,
  onClick,
  avatarUrl,
  fallback,
  label,
  color,
}: {
  selected: boolean;
  onClick: () => void;
  avatarUrl?: string;
  fallback: React.ReactNode;
  label: string;
  color: string;
}) {
  const { token } = theme.useToken();
  return (
    <Flexbox
      align="center"
      gap={4}
      style={{
        cursor: 'pointer',
        padding: 6,
        borderRadius: 8,
        border: `2px solid ${selected ? color : 'transparent'}`,
        background: selected ? color + '10' : 'transparent',
        transition: 'all 0.2s',
      }}
      onClick={onClick}
    >
      {avatarUrl ? (
        <UserSquareAvatar url={avatarUrl} name={label} size={32} radius={8} />
      ) : (
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            background: token.colorFillSecondary,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {fallback}
        </div>
      )}
      <Text style={{ fontSize: 10, maxWidth: 50, textAlign: 'center' }} ellipsis>
        {label}
      </Text>
      {selected && (
        <Check size={10} color={color} />
      )}
    </Flexbox>
  );
}

export function useUserAvatar(): { url?: string; name: string } {
  const [data, setData] = useState<{ url?: string; name: string }>({ name: 'User' });

  useEffect(() => {
    api.getPreferences()
      .then(prefs => {
        setData({
          url: prefs.user_avatar || undefined,
          name: prefs.user_name || 'User',
        });
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as UserPreferences | undefined;
      if (!detail) return;
      setData({
        url: detail.user_avatar || undefined,
        name: detail.user_name || 'User',
      });
    };
    window.addEventListener('user-preferences-updated', handler);
    return () => window.removeEventListener('user-preferences-updated', handler);
  }, []);

  return data;
}
