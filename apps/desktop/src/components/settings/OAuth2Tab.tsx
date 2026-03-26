import { useEffect, useState, useMemo } from 'react';
import { Flexbox } from 'react-layout-kit';
import { Typography, Spin, Empty, theme, message, Button, Tag, Tooltip, Popconfirm } from 'antd';
import {
  RefreshCw, ShieldCheck, Clock, LogIn, Unlink,
} from 'lucide-react';
import { useOAuth2Store } from '../../store/oauth2';
import { OAuth2ConnectModal } from './OAuth2ConnectModal';
import type { OAuth2ProviderSummary, OAuth2Connection } from '../../services/desktop_api';
import { UserSquareAvatar } from '../common/UserSquareAvatar';
import { PlatformLogo } from '../common/PlatformLogo';

const { Text } = Typography;

function isValidDate(dateStr?: string): boolean {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  return !isNaN(d.getTime()) && d.getFullYear() > 2000;
}

function formatDate(dateStr?: string): string {
  if (!isValidDate(dateStr)) return '';
  const d = new Date(dateStr!);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function isValidUserAccount(conn?: OAuth2Connection): conn is OAuth2Connection {
  if (!conn) return false;
  if (!conn.user_id || conn.user_id === 'unknown') return false;
  if (!isValidDate(conn.connected_at)) return false;
  return true;
}

// ── Account Cards ──

function SignedInAccountCard({
  connection,
  provider,
  onRefresh,
  onSignOut,
}: {
  connection: OAuth2Connection;
  provider: OAuth2ProviderSummary;
  onRefresh: () => void;
  onSignOut: () => void;
}) {
  const { token } = theme.useToken();
  const providerColor = provider.color || token.colorPrimary;
  const isExpired = connection.status === 'expired';
  const isSimulate = connection.provider_id === 'lark_simulate';

  return (
    <Flexbox
      style={{
        padding: 16,
        borderRadius: 12,
        border: `1px solid ${providerColor}30`,
        background: `${providerColor}06`,
        minWidth: 280,
        maxWidth: 340,
        flex: '1 1 280px',
      }}
      gap={10}
    >
      <Flexbox horizontal align="center" gap={12}>
        <div style={{ position: 'relative', width: 48, height: 48, flexShrink: 0 }}>
          <UserSquareAvatar
            url={connection.avatar_url}
            name={connection.user_name || connection.user_id}
            size={48}
            radius={12}
            border={`2px solid ${providerColor}30`}
            background={`linear-gradient(135deg, ${providerColor}40, ${providerColor}20)`}
            fallback={(
              <PlatformLogo providerId={connection.provider_id || provider.id} size={24} color={providerColor} />
            )}
          />
          {!isSimulate && (
            <Flexbox
              align="center"
              justify="center"
              style={{
                position: 'absolute',
                bottom: -3, right: -3,
                width: 22, height: 22, borderRadius: '50%',
                background: providerColor,
                border: `2.5px solid ${token.colorBgContainer}`,
                boxShadow: `0 1px 3px ${providerColor}40`,
              }}
            >
              <PlatformLogo providerId={connection.provider_id || provider.id} size={11} color="#fff" />
            </Flexbox>
          )}
        </div>

        <Flexbox gap={2} style={{ flex: 1, minWidth: 0 }}>
          <Flexbox horizontal align="center" gap={6}>
            <Text strong style={{ fontSize: 14 }} ellipsis>
              {connection.user_name || connection.user_id}
            </Text>
            <Tag
              color={isExpired ? 'error' : 'success'}
              style={{ margin: 0, fontSize: 11, lineHeight: '18px', padding: '0 6px' }}
            >
              {isExpired ? 'Expired' : 'Active'}
            </Tag>
          </Flexbox>
          <Text type="secondary" style={{ fontSize: 12 }} ellipsis>
            {provider.name}
            {connection.email ? ` · ${connection.email}` : ''}
          </Text>
          {isSimulate && (
            <Text type="secondary" style={{ fontSize: 11 }}>
              Simulated Login Session
            </Text>
          )}
        </Flexbox>
      </Flexbox>

      <Flexbox horizontal gap={16} style={{ paddingLeft: 4 }}>
        {isValidDate(connection.connected_at) && (
          <Flexbox horizontal align="center" gap={4}>
            <Clock size={12} style={{ color: token.colorTextQuaternary }} />
            <Text type="secondary" style={{ fontSize: 11 }}>
              Authorized {formatDate(connection.connected_at)}
            </Text>
          </Flexbox>
        )}
        {isValidDate(connection.expires_at) && (
          <Flexbox horizontal align="center" gap={4}>
            <ShieldCheck size={12} style={{ color: isExpired ? token.colorError : token.colorTextQuaternary }} />
            <Text
              type="secondary"
              style={{ fontSize: 11, color: isExpired ? token.colorError : undefined }}
            >
              {isExpired ? 'Expired' : 'Refresh'} {formatDate(connection.expires_at)}
            </Text>
          </Flexbox>
        )}
      </Flexbox>

      {connection.scopes && connection.scopes.length > 0 && (
        <Flexbox horizontal gap={4} style={{ flexWrap: 'wrap', paddingLeft: 4 }}>
          {connection.scopes.slice(0, 5).map(s => (
            <Tag key={s} style={{ margin: 0, fontSize: 10, borderRadius: 4, padding: '0 4px' }}>{s}</Tag>
          ))}
          {connection.scopes.length > 5 && (
            <Tooltip title={connection.scopes.slice(5).join(', ')}>
              <Tag style={{ margin: 0, fontSize: 10, borderRadius: 4, padding: '0 4px' }}>
                +{connection.scopes.length - 5}
              </Tag>
            </Tooltip>
          )}
        </Flexbox>
      )}

      <Flexbox horizontal gap={8} style={{ paddingTop: 2 }}>
        {!isSimulate && (
          <Tooltip title="Refresh token">
            <Button size="small" icon={<RefreshCw size={14} />} onClick={onRefresh} />
          </Tooltip>
        )}
        <Popconfirm
          title="Sign out from this platform?"
          description="Your authorization will be revoked. You can sign in again later."
          onConfirm={onSignOut}
          okText="Sign Out"
          cancelText="Cancel"
        >
          <Button size="small" danger icon={<Unlink size={14} />}>Sign Out</Button>
        </Popconfirm>
      </Flexbox>
    </Flexbox>
  );
}

function UnsignedAccountCard({
  provider,
  onSignIn,
  signInLabel,
}: {
  provider: OAuth2ProviderSummary;
  onSignIn: () => void;
  signInLabel?: string;
}) {
  const { token } = theme.useToken();
  const providerColor = provider.color || token.colorPrimary;

  return (
    <Flexbox
      style={{
        padding: 16,
        borderRadius: 12,
        border: `1px dashed ${token.colorBorderSecondary}`,
        background: token.colorFillQuaternary,
        minWidth: 240,
        maxWidth: 320,
        flex: '1 1 240px',
      }}
      gap={10}
    >
      <Flexbox horizontal align="center" justify="space-between" gap={12}>
        <Flexbox
          align="center"
          justify="center"
          style={{
            width: 48, height: 48, borderRadius: 12,
            background: providerColor + '12', flexShrink: 0,
          }}
        >
          <PlatformLogo providerId={provider.id} size={24} color={providerColor} />
        </Flexbox>
        <Flexbox gap={2} style={{ flex: 1, minWidth: 0 }}>
          <Text strong style={{ fontSize: 14 }}>{provider.name}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            Ready to sign in
          </Text>
        </Flexbox>
        <Button
          size="small"
          type="primary"
          icon={<LogIn size={14} />}
          onClick={onSignIn}
          style={{ background: providerColor, flexShrink: 0 }}
        >
          {signInLabel || 'Sign in'}
        </Button>
      </Flexbox>
    </Flexbox>
  );
}

// ── Main Panel ──

export function OAuth2Tab() {
  const { providers, connections, loading, loadAll, disconnect, refreshToken, reload } = useOAuth2Store();
  const [signInProvider, setSignInProvider] = useState<OAuth2ProviderSummary | null>(null);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const connectionMap = useMemo(() => {
    const m: Record<string, OAuth2Connection> = {};
    for (const c of connections) m[c.provider_id] = c;
    return m;
  }, [connections]);

  const accountProviders = useMemo(() =>
    providers.filter((p) => ['github', 'google'].includes(p.id) && p.status !== 'coming_soon'),
    [providers],
  );

  const handleSignIn = (provider: OAuth2ProviderSummary) => {
    setSignInProvider(provider);
  };

  const handleSignOut = async (id: string) => {
    try {
      await disconnect(id);
      message.success('Signed out');
    } catch (err: any) {
      message.error(`Sign out failed: ${err.message}`);
    }
  };

  const handleRefresh = async (id: string) => {
    try {
      await refreshToken(id);
      message.success('Token refreshed');
    } catch (err: any) {
      message.error(`Refresh failed: ${err.message}`);
    }
  };

  if (loading && providers.length === 0) {
    return (
      <Flexbox align="center" justify="center" style={{ padding: 60 }}>
        <Spin />
      </Flexbox>
    );
  }

  if (providers.length === 0) {
    return (
      <Flexbox align="center" justify="center" style={{ padding: 60 }}>
        <Empty description="No OAuth2 providers available" />
      </Flexbox>
    );
  }

  if (accountProviders.length === 0) {
    return (
      <Flexbox align="center" justify="center" style={{ padding: 60 }}>
        <Empty description="No GitHub/Google providers available" />
      </Flexbox>
    );
  }

  return (
    <Flexbox gap={0} style={{ padding: '8px 24px 24px', height: '100%', overflow: 'auto' }}>
      <Flexbox horizontal justify="space-between" align="center" style={{ marginBottom: 24, flexShrink: 0 }}>
        <Text strong style={{ fontSize: 14 }}>OAuth 2</Text>
        <Button
          size="small"
          icon={<RefreshCw size={14} />}
          onClick={() => reload()}
        >
          Reload
        </Button>
      </Flexbox>

      <Flexbox gap={16} style={{ marginBottom: 32, flexShrink: 0 }}>
        <Flexbox gap={10}>
          <Flexbox horizontal gap={12} style={{ flexWrap: 'wrap' }}>
            {accountProviders.map(provider => {
              const conn = connectionMap[provider.id];
              if (isValidUserAccount(conn)) {
                return (
                  <SignedInAccountCard
                    key={provider.id}
                    connection={conn}
                    provider={provider}
                    onRefresh={() => handleRefresh(provider.id)}
                    onSignOut={() => handleSignOut(provider.id)}
                  />
                );
              }
              return (
                <UnsignedAccountCard
                  key={provider.id}
                  provider={provider}
                  onSignIn={() => handleSignIn(provider)}
                  signInLabel={conn ? 'Re-connect' : 'Sign in'}
                />
              );
            })}
          </Flexbox>
        </Flexbox>
      </Flexbox>

      {/* Sign In modal — only for Account (U2S), no callback URL shown */}
      <OAuth2ConnectModal
        provider={signInProvider}
        open={!!signInProvider}
        onClose={() => {
          setSignInProvider(null);
          loadAll();
        }}
      />
    </Flexbox>
  );
}

export function AccountTab() {
  return <OAuth2Tab />;
}

export function AuthTab() {
  return <OAuth2Tab />;
}

export function ConnectionsTab() {
  return <OAuth2Tab />;
}
