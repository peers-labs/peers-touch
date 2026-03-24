import { useEffect, useState, useMemo } from 'react';
import { Flexbox } from 'react-layout-kit';
import { Typography, Spin, Empty, theme, message, Button, Alert, Tag, Tooltip, Divider, Popconfirm } from 'antd';
import {
  RefreshCw, FolderOpen, User, ShieldCheck, Clock, LogIn, Unlink, KeyRound,
} from 'lucide-react';
import { useOAuth2Store } from '../../store/oauth2';
import { OAuth2ProviderCard } from './OAuth2ProviderCard';
import { OAuth2ConnectModal } from './OAuth2ConnectModal';
import { LarkSimulateLoginModal } from './LarkSimulateLoginModal';
import type { OAuth2ProviderSummary, OAuth2Connection } from '../../services/desktop_api';
import { UserSquareAvatar } from '../common/UserSquareAvatar';
import { PlatformLogo } from '../common/PlatformLogo';

const { Title, Text } = Typography;

const CATEGORY_LABELS: Record<string, string> = {
  developer: 'Developer Platforms',
  social: 'Social Media',
  enterprise: 'Enterprise',
  other: 'Other',
};

const CATEGORY_ORDER = ['developer', 'enterprise', 'social', 'other'];

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
            {hasCreds ? 'Not signed in' : 'Credentials not configured'}
          </Text>
        </Flexbox>
      </Flexbox>

      {hasCreds ? (
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
          Configure credentials in the Connections section below first.
        </Text>
      )}
      {tip && (
        <Text type="secondary" style={{ fontSize: 11, paddingLeft: 4 }}>
          {tip}
        </Text>
      )}
    </Flexbox>
  );
}

// ── Main Panel ──

export function OAuth2Tab() {
  const { token } = theme.useToken();
  const { providers, connections, loading, loadAll, disconnect, refreshToken, reload } = useOAuth2Store();
  const [signInProvider, setSignInProvider] = useState<OAuth2ProviderSummary | null>(null);
  const [simulateOpen, setSimulateOpen] = useState(false);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const grouped = useMemo(() => {
    const groups: Record<string, OAuth2ProviderSummary[]> = {};
    for (const p of providers) {
      const cat = p.category || 'other';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(p);
    }
    for (const cat of Object.keys(groups)) {
      groups[cat].sort((a, b) => {
        if (a.status === 'coming_soon' && b.status !== 'coming_soon') return 1;
        if (a.status !== 'coming_soon' && b.status === 'coming_soon') return -1;
        return 0;
      });
    }
    return groups;
  }, [providers]);

  const connectionMap = useMemo(() => {
    const m: Record<string, OAuth2Connection> = {};
    for (const c of connections) m[c.provider_id] = c;
    return m;
  }, [connections]);

  const accountProviders = useMemo(() =>
    providers.filter(p => p.status !== 'coming_soon'),
    [providers],
  );
  const oauth2AccountProviders = useMemo(
    () => accountProviders.filter(p => p.id !== 'lark_simulate'),
    [accountProviders],
  );
  const simulateAccountProviders = useMemo(() => {
    const lark = providers.find(p => p.id === 'lark');
    if (!lark) return [];
    const simulateProvider: OAuth2ProviderSummary = {
      ...lark,
      id: 'lark_simulate',
      name: lark.name,
      has_credentials: true,
      description: 'Scan QR code for web simulated login',
    };
    return [simulateProvider];
  }, [providers]);

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

  return (
    <Flexbox gap={0} style={{ padding: '8px 24px 24px', height: '100%', overflow: 'auto' }}>
      {/* Page header */}
      <Flexbox horizontal justify="space-between" align="center" style={{ marginBottom: 24, flexShrink: 0 }}>
        <Flexbox gap={4}>
          <Title level={5} style={{ margin: 0 }}>OAuth</Title>
          <Text type="secondary" style={{ fontSize: 13 }}>
            Authorize your accounts on connected platforms, and manage platform registrations.
          </Text>
        </Flexbox>
        <Button
          size="small"
          icon={<RefreshCw size={14} />}
          onClick={() => reload()}
        >
          Reload
        </Button>
      </Flexbox>

      {/* ═══ Section 1: Accounts (U2S) ═══ */}
      <Flexbox gap={16} style={{ marginBottom: 32, flexShrink: 0 }}>
        <Flexbox gap={2}>
          <Flexbox horizontal align="center" gap={8}>
            <User size={16} style={{ color: token.colorPrimary }} />
            <Text strong style={{ fontSize: 15 }}>Accounts</Text>
          </Flexbox>
          <Text type="secondary" style={{ fontSize: 12, paddingLeft: 24 }}>
            Your personal login sessions. Sign in to let the Agent act on your behalf.
          </Text>
        </Flexbox>

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
      </Flexbox>

      <Divider style={{ margin: '0 0 24px', flexShrink: 0 }} />

      {/* ═══ Section 2: Connections (S2S) ═══ */}
      <Flexbox gap={16} style={{ flexShrink: 0, paddingBottom: 24 }}>
        <Flexbox gap={2}>
          <Flexbox horizontal align="center" gap={8}>
            <KeyRound size={16} style={{ color: token.colorTextTertiary }} />
            <Text strong style={{ fontSize: 15 }}>Connections</Text>
            <Tag style={{ margin: 0, fontSize: 10, borderRadius: 4, lineHeight: '16px' }}>Admin</Tag>
          </Flexbox>
          <Text type="secondary" style={{ fontSize: 12, paddingLeft: 24 }}>
            Server-side OAuth2 app registration. Configure credentials to enable user sign-in above.
          </Text>
        </Flexbox>

        <Alert
          type="info"
          showIcon
          icon={<FolderOpen size={16} style={{ marginTop: 2 }} />}
          message={
            <span>
              OAuth2 credentials (<code>client_id</code> / <code>client_secret</code>) are configured in{' '}
              <code>~/.peers-touch/oauth2/&lt;provider&gt;.yml</code>.
              You can also add custom providers by creating new YAML files in that directory.
            </span>
          }
          style={{ borderRadius: 8 }}
        />

        {CATEGORY_ORDER.map(cat => {
          const items = grouped[cat];
          if (!items || items.length === 0) return null;
          return (
            <Flexbox key={cat} gap={12}>
              <Text
                strong
                style={{
                  fontSize: 12,
                  color: token.colorTextTertiary,
                  textTransform: 'uppercase',
                  letterSpacing: 1,
                }}
              >
                {CATEGORY_LABELS[cat] || cat}
              </Text>
              <Flexbox horizontal gap={12} style={{ flexWrap: 'wrap' }}>
                {items.map(p => (
                  <OAuth2ProviderCard key={p.id} provider={p} />
                ))}
              </Flexbox>
            </Flexbox>
          );
        })}
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
