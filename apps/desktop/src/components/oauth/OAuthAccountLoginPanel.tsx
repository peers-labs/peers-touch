import { useEffect, useMemo, useState } from 'react';
import { Flexbox } from 'react-layout-kit';
import { Button } from '@lobehub/ui';
import { Typography, theme } from 'antd';
import { LogIn } from 'lucide-react';
import { useOAuth2Store } from '../../store/oauth2';
import { OAuth2ConnectModal } from '../settings/OAuth2ConnectModal';
import type { OAuth2Connection, OAuth2ProviderSummary } from '../../services/desktop_api';
import { PlatformLogo } from '../common/PlatformLogo';
import { useTranslation } from 'react-i18next';

const { Text } = Typography;

function isValidDate(dateStr?: string): boolean {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  return !isNaN(d.getTime()) && d.getFullYear() > 2000;
}

function isValidUserAccount(conn?: OAuth2Connection): conn is OAuth2Connection {
  if (!conn) return false;
  if (!conn.user_id || conn.user_id === 'unknown') return false;
  if (!isValidDate(conn.connected_at)) return false;
  return true;
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
  const { t } = useTranslation('provider');
  const { token } = theme.useToken();
  const providerColor = provider.color || token.colorPrimary;

  return (
    <Flexbox
      style={{
        padding: 16,
        borderRadius: 12,
        border: `1px dashed ${token.colorBorderSecondary}`,
        background: token.colorFillQuaternary,
        minWidth: 220,
        maxWidth: 260,
        flex: '1 1 220px',
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
          <Text type="secondary" style={{ fontSize: 12 }}>{t('provider.oauth.tab.loginWith', { name: provider.name })}</Text>
        </Flexbox>
        <Button
          size="small"
          type="primary"
          icon={<LogIn size={14} />}
          onClick={onSignIn}
          style={{ background: providerColor, flexShrink: 0 }}
        >
          {signInLabel || t('provider.oauth.tab.loginWith', { name: provider.name })}
        </Button>
      </Flexbox>
    </Flexbox>
  );
}

interface Props {
  showDescription?: boolean;
  onAuthStateChange?: (hasActiveConnection: boolean) => void;
  showSectionTitle?: boolean;
}

export function OAuthAccountLoginPanel({
  showDescription = true,
  onAuthStateChange,
  showSectionTitle = true,
}: Props) {
  const { t } = useTranslation('provider');
  const { providers, connections, loadAll } = useOAuth2Store();
  const [signInProvider, setSignInProvider] = useState<OAuth2ProviderSummary | null>(null);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const connectionMap = useMemo(() => {
    const m: Record<string, OAuth2Connection> = {};
    for (const c of connections) m[c.provider_id] = c;
    return m;
  }, [connections]);

  const oauth2AccountProviders = useMemo(
    () => providers.filter(p => p.id === 'github' || p.id === 'google'),
    [providers],
  );

  useEffect(() => {
    if (!onAuthStateChange) return;
    const hasActive = connections.some((conn) => isValidUserAccount(conn) && conn.status === 'active');
    onAuthStateChange(hasActive);
  }, [connections, onAuthStateChange]);

  const handleSignIn = (provider: OAuth2ProviderSummary) => {
    setSignInProvider(provider);
  };

  return (
    <Flexbox gap={16} style={{ flexShrink: 0 }}>
      {showDescription && (
        <Text type="secondary" style={{ fontSize: 12 }}>
          {t('provider.oauth.login.chooseLogin')}
        </Text>
      )}

      <Flexbox gap={10}>
        {showSectionTitle && <Text strong style={{ fontSize: 14, paddingLeft: 2 }}>{t('provider.oauth.login.title')}</Text>}
        <Flexbox horizontal gap={12} style={{ flexWrap: 'wrap' }}>
          {oauth2AccountProviders.map(provider => {
            const conn = connectionMap[provider.id];
            return (
              <UnsignedAccountCard
                key={provider.id}
                provider={provider}
                onSignIn={() => handleSignIn(provider)}
                signInLabel={conn && isValidUserAccount(conn) ? t('provider.oauth.tab.reconnect') : t('provider.oauth.tab.signIn')}
              />
            );
          })}
        </Flexbox>
      </Flexbox>

      <OAuth2ConnectModal
        provider={signInProvider}
        open={!!signInProvider}
        onCancel={() => {
          setSignInProvider(null);
          loadAll();
        }}
        onSuccess={() => {
          setSignInProvider(null);
          loadAll();
        }}
      />
    </Flexbox>
  );
}
