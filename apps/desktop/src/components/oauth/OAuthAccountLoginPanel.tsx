import { useEffect, useMemo, useState } from 'react';
import { Flexbox } from 'react-layout-kit';
import { Button, Popconfirm, Tag, Tooltip, Typography, message, theme } from 'antd';
import { Clock, LogIn, RefreshCw, ShieldCheck, Unlink } from 'lucide-react';
import { useOAuth2Store } from '../../store/oauth2';
import { OAuth2ConnectModal } from '../settings/OAuth2ConnectModal';
import { LarkSimulateLoginModal } from '../settings/LarkSimulateLoginModal';
import type { OAuth2Connection, OAuth2ProviderSummary } from '../../services/desktop_api';
import { PlatformLogo } from '../common/PlatformLogo';
import { UserSquareAvatar } from '../common/UserSquareAvatar';

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
  tip,
}: {
  provider: OAuth2ProviderSummary;
  onSignIn: () => void;
  signInLabel?: string;
  tip?: string;
}) {
  const { token } = theme.useToken();
  const providerColor = provider.color || token.colorPrimary;
  const hasCreds = provider.has_credentials;
  const isDeveloping = provider.status === 'coming_soon';
  const effectiveTip = isDeveloping ? 'Developing' : tip;

  return (
    <Flexbox
      style={{
        padding: 16,
        borderRadius: 12,
        border: `1px dashed ${token.colorBorderSecondary}`,
        background: token.colorFillQuaternary,
        minWidth: 280,
        maxWidth: 340,
        flex: '1 1 280px',
      }}
      gap={10}
    >
      <Flexbox horizontal align="center" gap={12}>
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
            {isDeveloping ? 'Developing' : hasCreds ? 'Not signed in' : 'Credentials not configured'}
          </Text>
        </Flexbox>
      </Flexbox>

      {hasCreds && !isDeveloping ? (
        <Button
          size="small"
          type="primary"
          icon={<LogIn size={14} />}
          onClick={onSignIn}
          style={{ alignSelf: 'flex-start', background: providerColor }}
        >
          {signInLabel || 'Sign In'}
        </Button>
      ) : (
        <Text type="secondary" style={{ fontSize: 11, paddingLeft: 4 }}>
          {isDeveloping ? 'This provider is under development.' : 'Configure credentials in Settings - Connections first.'}
        </Text>
      )}
      {effectiveTip && (
        <Text type="secondary" style={{ fontSize: 11, paddingLeft: 4 }}>
          {effectiveTip}
        </Text>
      )}
    </Flexbox>
  );
}

interface Props {
  showDescription?: boolean;
  onAuthStateChange?: (hasActiveConnection: boolean) => void;
}

export function OAuthAccountLoginPanel({ showDescription = true, onAuthStateChange }: Props) {
  const { providers, connections, loadAll, disconnect, refreshToken } = useOAuth2Store();
  const [signInProvider, setSignInProvider] = useState<OAuth2ProviderSummary | null>(null);
  const [simulateOpen, setSimulateOpen] = useState(false);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const connectionMap = useMemo(() => {
    const m: Record<string, OAuth2Connection> = {};
    for (const c of connections) m[c.provider_id] = c;
    return m;
  }, [connections]);

  const oauth2AccountProviders = useMemo(
    () => providers.filter(p => p.id !== 'lark_simulate'),
    [providers],
  );
  const simulateAccountProviders = useMemo(() => {
    const lark = providers.find(p => p.id === 'lark');
    if (!lark) return [];
    return [{
      ...lark,
      id: 'lark_simulate',
      has_credentials: true,
      description: 'Scan QR code for web simulated login',
    } as OAuth2ProviderSummary];
  }, [providers]);

  useEffect(() => {
    if (!onAuthStateChange) return;
    const hasActive = connections.some((conn) => isValidUserAccount(conn) && conn.status === 'active');
    onAuthStateChange(hasActive);
  }, [connections, onAuthStateChange]);

  const handleSignIn = (provider: OAuth2ProviderSummary) => {
    if (provider.id === 'lark_simulate') {
      setSimulateOpen(true);
      return;
    }
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

  return (
    <Flexbox gap={16} style={{ flexShrink: 0 }}>
      {showDescription && (
        <Text type="secondary" style={{ fontSize: 12 }}>
          OAuth2 identities for your account. You can skip profile completion and continue.
        </Text>
      )}

      <Flexbox gap={10}>
        <Text strong style={{ fontSize: 14, paddingLeft: 2 }}>OAuth 2</Text>
        <Flexbox horizontal gap={12} style={{ flexWrap: 'wrap' }}>
          {oauth2AccountProviders.map(provider => {
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
              />
            );
          })}
        </Flexbox>
      </Flexbox>

      <Flexbox gap={8}>
        <Flexbox gap={2}>
          <Text strong style={{ fontSize: 14, paddingLeft: 2 }}>Simulated Login</Text>
          <Text type="secondary" style={{ fontSize: 11, paddingLeft: 2 }}>
            Tip: Scan QR for quick onboarding in development; use OAuth 2 for long-term stable integration.
          </Text>
        </Flexbox>
        <Flexbox horizontal gap={12} style={{ flexWrap: 'wrap' }}>
          {simulateAccountProviders.map(provider => {
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
                signInLabel="Simulated Login"
                tip="Scan QR to sign in quickly."
              />
            );
          })}
        </Flexbox>
      </Flexbox>

      <OAuth2ConnectModal
        provider={signInProvider}
        open={!!signInProvider}
        onClose={() => {
          setSignInProvider(null);
          loadAll();
        }}
      />
      <LarkSimulateLoginModal
        open={simulateOpen}
        onClose={() => {
          setSimulateOpen(false);
          loadAll();
        }}
      />
    </Flexbox>
  );
}
