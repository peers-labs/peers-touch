import { useState, type ReactNode } from 'react';
import { Button, Card, Input, Typography } from 'antd';
import { LockKeyhole } from 'lucide-react';
import { useMobileI18n } from '../app/mobileI18n';
import { reauthenticatePin, submitPinUnlock, useSecurityProjection } from '../runtimes/securityRuntime';
import './native-pin.css';

export function NativePinHost({ children }: { children: ReactNode }) {
  const { t } = useMobileI18n();
  const { status, busy, errorKey } = useSecurityProjection();
  const [pin, setPin] = useState('');
  if (!status?.locked) return children;
  const submit = () => {
    const value = pin;
    setPin('');
    void submitPinUnlock(value);
  };
  return <main className="native-pin-screen" data-product-surface="security.pin-unlock">
    <Card className="native-pin-card" variant="borderless">
      <LockKeyhole size={32} />
      <Typography.Title level={2}>{t('mobile.settings.security.unlockTitle')}</Typography.Title>
      <Typography.Paragraph type="secondary">{t('mobile.settings.security.unlockBody')}</Typography.Paragraph>
      <form onSubmit={(event) => { event.preventDefault(); submit(); }} className="native-pin-form">
        <Input.Password value={pin} inputMode="numeric" autoComplete="off" maxLength={16}
          aria-label={t('mobile.settings.security.pin')} data-pin-field="unlock"
          onChange={(event) => setPin(event.target.value)} disabled={busy} />
        {errorKey ? <Typography.Text type="danger" role="alert">{t(errorKey)}</Typography.Text> : null}
        <Button type="primary" htmlType="submit" block loading={busy} disabled={pin.length < 4}>
          {t('mobile.settings.security.unlock')}
        </Button>
        <Button type="text" block disabled={busy} data-pin-action="forgot" onClick={() => {
          setPin(''); void reauthenticatePin();
        }}>{t('mobile.settings.security.forgotPin')}</Button>
      </form>
    </Card>
  </main>;
}
