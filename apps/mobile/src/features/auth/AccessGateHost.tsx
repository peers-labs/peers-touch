import { useState } from 'react';
import { Button, Card, Input, Typography } from 'antd';
import { ArrowLeft, LockKeyhole, Server, ShieldAlert } from 'lucide-react';

import { useMobileI18n } from '../../app/mobileI18n';
import logo from '../../assets/logo.png';
import { LanguageSwitcher } from '../../components/LanguageSwitcher';
import {
  ACCESS_GATE_TYPE_AUTH_LOGIN,
  accessDecisionMessage,
  isAccessBlocked,
  type AccessDecision,
  type StationLoginInput,
} from './authSession';

const { Text, Title } = Typography;

export function AccessGateHost({
  decision,
  stationLabel,
  stationUrl,
  error,
  loading,
  onBack,
  onLogin,
}: {
  decision: AccessDecision | null;
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
  const currentGate = decision?.gates.find((gate) => gate.gateId === decision.currentGateId);
  const requiresLogin = currentGate?.type === ACCESS_GATE_TYPE_AUTH_LOGIN
    || currentGate?.type === 'ACCESS_GATE_TYPE_AUTH_LOGIN'
    || !currentGate;
  const blocked = isAccessBlocked(decision);
  const blockedMessage = accessDecisionMessage(decision);

  async function submitLogin() {
    if (!canLogin || loading || blocked) return;
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
            {blocked ? t('mobile.auth.blockedTitle') : t('mobile.auth.title')}
          </Title>
        </div>
      </section>

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
          {blocked ? <ShieldAlert size={18} /> : <LockKeyhole size={18} />}
          <Text type="secondary">
            {blocked ? (blockedMessage || t('mobile.auth.blockedSubtitle')) : t('mobile.auth.subtitle')}
          </Text>
        </div>

        {!blocked && requiresLogin ? (
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
        ) : null}

        {error ? (
          <Text type="danger" className="auth-error">
            {error}
          </Text>
        ) : null}

        <div className="auth-actions">
          <Button icon={<ArrowLeft size={16} />} onClick={onBack}>
            {t('mobile.auth.changeStation')}
          </Button>
          {!blocked && requiresLogin ? (
            <Button type="primary" loading={loading} disabled={!canLogin || loading} onClick={submitLogin}>
              {t('mobile.auth.login')}
            </Button>
          ) : null}
        </div>
      </Card>
    </main>
  );
}
