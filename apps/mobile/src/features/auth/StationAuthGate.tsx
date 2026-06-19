import { useState } from 'react';
import { Button, Card, Input, Typography } from 'antd';
import { ArrowLeft, LockKeyhole, Server } from 'lucide-react';

import { useMobileI18n } from '../../app/mobileI18n';
import logo from '../../assets/logo.png';
import { LanguageSwitcher } from '../../components/LanguageSwitcher';
import { StationNetworkIntro } from '../../components/StationNetworkIntro';
import type { StationLoginInput } from './authSession';

const { Text, Title } = Typography;

export function StationAuthGate({
  stationLabel,
  stationUrl,
  error,
  loading,
  onBack,
  onLogin,
}: {
  stationLabel: string;
  stationUrl: string;
  error: string | null;
  loading: boolean;
  onBack: () => void;
  onLogin: (input: Omit<StationLoginInput, 'stationUrl'>) => Promise<void>;
}) {
  const { t } = useMobileI18n();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const canLogin = Boolean(email.trim() && password);
  const networkIntroLabels = {
    title: t('auth.network.title'),
    personal: t('auth.network.personal'),
    actor: t('auth.network.actor'),
    relay: t('auth.network.relay'),
    relayLink: t('auth.network.relayLink'),
    alice: t('auth.network.alice'),
    service: t('auth.network.service'),
    station: t('auth.network.station'),
    bob: t('auth.network.bob'),
    agent: t('auth.network.agent'),
    joining: t('auth.network.joining'),
    yourStation: t('auth.network.yourStation'),
    messageFlow: t('auth.network.messageFlow'),
    imageFlow: t('auth.network.imageFlow'),
    fileFlow: t('auth.network.fileFlow'),
    taskFlow: t('auth.network.taskFlow'),
  };

  async function submitLogin() {
    if (!canLogin || loading) return;
    await onLogin({ email, password });
    setPassword('');
  }

  return (
    <main className="auth-gate-screen">
      <section className="auth-gate-brand">
        <div className="launch-brand-top">
          <img src={logo} alt="Peers Touch" className="launch-logo" />
          <LanguageSwitcher />
        </div>
        <div>
          <Text className="launch-kicker">{t('mobile.launch.brand')}</Text>
          <Title level={1} className="auth-gate-title">
            {t('mobile.auth.title')}
          </Title>
        </div>
      </section>

      <div className="station-network-panel">
        <StationNetworkIntro
          selectedStationName={stationLabel}
          labels={networkIntroLabels}
        />
      </div>

      <Card className="auth-gate-card" bordered={false}>
        <div className="auth-station-summary">
          <span className="auth-station-icon">
            <Server size={18} />
          </span>
          <span className="auth-station-copy">
            <Text strong>{stationLabel}</Text>
            <Text type="secondary" ellipsis>
              {stationUrl}
            </Text>
          </span>
        </div>

        <div className="auth-gate-copy">
          <LockKeyhole size={18} />
          <Text type="secondary">{t('mobile.auth.subtitle')}</Text>
        </div>

        <div className="auth-fields">
          <Input
            value={email}
            placeholder={t('mobile.auth.email')}
            inputMode="email"
            autoCapitalize="none"
            autoCorrect="off"
            onChange={(event) => setEmail(event.target.value)}
            onPressEnter={submitLogin}
          />
          <Input.Password
            value={password}
            placeholder={t('mobile.auth.password')}
            autoComplete="current-password"
            onChange={(event) => setPassword(event.target.value)}
            onPressEnter={submitLogin}
          />
        </div>

        {error ? (
          <Text type="danger" className="auth-error">
            {error}
          </Text>
        ) : null}

        <div className="auth-actions">
          <Button icon={<ArrowLeft size={16} />} onClick={onBack}>
            {t('mobile.auth.changeStation')}
          </Button>
          <Button type="primary" loading={loading} disabled={!canLogin || loading} onClick={submitLogin}>
            {t('mobile.auth.login')}
          </Button>
        </div>
      </Card>
    </main>
  );
}
