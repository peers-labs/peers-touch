import { useMemo } from 'react';
import { Flexbox } from 'react-layout-kit';
import { Typography, Spin, Empty, theme, Button, Alert, Tag } from 'antd';
import { RefreshCw, FolderOpen, KeyRound, User } from 'lucide-react';
import { useOAuth2Store } from '../../store/oauth2';
import { OAuth2ProviderCard } from './OAuth2ProviderCard';
import type { OAuth2ProviderSummary } from '../../services/desktop_api';
import { OAuthAccountLoginPanel } from '../oauth/OAuthAccountLoginPanel';

const { Title, Text } = Typography;

const CATEGORY_LABELS: Record<string, string> = {
  developer: 'Developer Platforms',
  social: 'Social Media',
  enterprise: 'Enterprise',
  other: 'Other',
};

const CATEGORY_ORDER = ['developer', 'enterprise', 'social', 'other'];

type OAuth2TabView = 'account' | 'auth' | 'connections';

export function OAuth2Tab({ view = 'auth' }: { view?: OAuth2TabView }) {
  const { token } = theme.useToken();
  const { providers, loading, error, reload } = useOAuth2Store();

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

  if (loading && providers.length === 0) {
    return (
      <Flexbox align="center" justify="center" style={{ padding: 60 }}>
        <Spin />
      </Flexbox>
    );
  }

  const showAccounts = view === 'account' || view === 'auth';
  const showConnections = view === 'connections';
  const titleMap: Record<OAuth2TabView, string> = {
    account: 'Account',
    auth: 'Auth',
    connections: 'Connections',
  };
  const descMap: Record<OAuth2TabView, string> = {
    account: 'Your account center. Sign-in methods are managed here.',
    auth: 'Authentication methods and session status.',
    connections: 'Server-side OAuth2 app registrations for integration use.',
  };

  return (
    <Flexbox gap={0} style={{ padding: '8px 24px 24px', height: '100%', overflow: 'auto' }}>
      <Flexbox horizontal justify="space-between" align="center" style={{ marginBottom: 24, flexShrink: 0 }}>
        <Flexbox gap={4}>
          <Title level={5} style={{ margin: 0 }}>{titleMap[view]}</Title>
          <Text type="secondary" style={{ fontSize: 13 }}>
            {descMap[view]}
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

      {error && (
        <Alert
          type="error"
          showIcon
          message="OAuth providers load failed"
          description={error}
          style={{ marginBottom: 16, borderRadius: 8 }}
        />
      )}

      {providers.length === 0 && !loading && (
        <Flexbox align="center" justify="center" style={{ padding: 60 }}>
          <Empty description={error ? 'OAuth2 providers unavailable' : 'No OAuth2 providers available'} />
        </Flexbox>
      )}

      {showAccounts && providers.length > 0 && (
        <Flexbox gap={16} style={{ marginBottom: 24, flexShrink: 0 }}>
          <Flexbox gap={2}>
            <Flexbox horizontal align="center" gap={8}>
              <User size={16} style={{ color: token.colorPrimary }} />
              <Text strong style={{ fontSize: 15 }}>Sign-in Methods</Text>
            </Flexbox>
          </Flexbox>
          <OAuthAccountLoginPanel />
        </Flexbox>
      )}

      {showConnections && providers.length > 0 && (
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
            type="warning"
            showIcon
            message={
              <span>
                Historical background: Connections was originally surfaced with account sign-in for local OAuth2 client bootstrap.
                Current positioning: admin-level integration registry. Future vision: team-level OAuth client management.
              </span>
            }
            style={{ borderRadius: 8 }}
          />

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
      )}
    </Flexbox>
  );
}

export function AccountTab() {
  return <OAuth2Tab view="account" />;
}

export function AuthTab() {
  return <OAuth2Tab view="auth" />;
}

export function ConnectionsTab() {
  return <OAuth2Tab view="connections" />;
}
