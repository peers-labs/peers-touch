import { useEffect, useRef, useState } from 'react';
import { Alert, Button } from '@lobehub/ui';
import { Modal, QRCode, Result, Spin, Typography } from 'antd';
import { Flexbox } from 'react-layout-kit';
import { CheckCircle2, XCircle } from 'lucide-react';
import { api, type LarkBotCredentials, type OAuth2Connection } from '../../services/desktop_api';
import { useOAuth2Store } from '../../store/oauth2';
import { PlatformLogo } from '../common/PlatformLogo';
import { useTranslation } from 'react-i18next';

const { Text, Title } = Typography;

type LoginState = 'loading' | 'pending' | 'success' | 'expired' | 'error';

export type LarkQRIntent = 'oauth' | 'bot';

interface Props {
  open: boolean;
  onClose: () => void;
  /** oauth = OAuth simulate only; bot = create app + return credentials, also upserts lark_simulate */
  intent?: LarkQRIntent;
  /** App name when creating bot (default: "Agent Box Bot") */
  appName?: string;
  /** Called on success. For bot intent, receives credentials + channel_id when persisted */
  onSuccess?: (result: { connection?: OAuth2Connection; bot?: LarkBotCredentials; channel_id?: string }) => void;
}

function normalizeSimulateError(raw: string | undefined, t: (key: string) => string): string {
  const text = (raw || '').trim();
  const lower = text.toLowerCase();
  if (lower === 'not found' || lower.includes('404')) {
    return t('provider.lark.simulateApiUnavailable');
  }
  if (lower === 'session not found') {
    return t('provider.lark.sessionNotFound');
  }
  if (!text) {
    return t('provider.lark.simulateFailedGeneric');
  }
  return text;
}

export function LarkSimulateLoginModal({ open, onClose, intent = 'oauth', appName, onSuccess }: Props) {
  const { t } = useTranslation('provider');
  const [state, setState] = useState<LoginState>('loading');
  const [qrValue, setQrValue] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [error, setError] = useState('');
  const [connection, setConnection] = useState<OAuth2Connection | null>(null);
  const [bot, setBot] = useState<LarkBotCredentials | null>(null);
  const timerRef = useRef<number | null>(null);

  const createBot = intent === 'bot';

  useEffect(() => {
    if (!open) return;
    setState('loading');
    setQrValue('');
    setSessionId('');
    setError('');
    setConnection(null);
    setBot(null);
    api.oauthSimulateLarkStart(createBot ? { create_bot: true, app_name: appName } : undefined)
      .then((res) => {
        setQrValue(res.qr_value);
        setSessionId(res.session_id);
        setState('pending');
      })
      .catch((err: any) => {
        setError(normalizeSimulateError(err?.message, t));
        setState('error');
      });
  }, [open, createBot, appName]);

  useEffect(() => {
    if (!open || state !== 'pending' || !sessionId) return;
    timerRef.current = window.setInterval(async () => {
      try {
        const res = await api.oauthSimulateLarkPoll(sessionId);
        if (res.status === 'pending') return;
        if (res.status === 'success') {
          if (timerRef.current) window.clearInterval(timerRef.current);
          timerRef.current = null;
          setConnection(res.connection || null);
          setBot(res.bot || null);
          setState('success');
          await useOAuth2Store.getState().loadAll();
          onSuccess?.({ connection: res.connection, bot: res.bot, channel_id: res.channel_id });
          return;
        }
        if (res.status === 'expired') {
          if (timerRef.current) window.clearInterval(timerRef.current);
          timerRef.current = null;
          setState('expired');
          setError(res.error || t('provider.lark.qrExpired'));
          return;
        }
        if (timerRef.current) window.clearInterval(timerRef.current);
        timerRef.current = null;
        setState('error');
        setError(normalizeSimulateError(res.error, t));
      } catch (err: any) {
        if (timerRef.current) window.clearInterval(timerRef.current);
        timerRef.current = null;
        setState('error');
        setError(normalizeSimulateError(err?.message, t));
      }
    }, 2000);
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
      timerRef.current = null;
    };
  }, [open, sessionId, state, onSuccess]);

  const handleRetry = () => {
    setState('loading');
    setQrValue('');
    setSessionId('');
    setError('');
    setConnection(null);
    setBot(null);
    api.oauthSimulateLarkStart(createBot ? { create_bot: true, app_name: appName } : undefined)
      .then((res) => {
        setQrValue(res.qr_value);
        setSessionId(res.session_id);
        setState('pending');
      })
      .catch((err: any) => {
        setError(normalizeSimulateError(err?.message, t));
        setState('error');
      });
  };

  const title = createBot ? t('provider.lark.createBotTitle') : t('provider.lark.simulateTitle');
  const desc = createBot
    ? t('provider.lark.createBotDesc')
    : t('provider.lark.simulateDesc');

  return (
    <Modal open={open} onCancel={onClose} footer={null} width={440} centered destroyOnClose>
      {state === 'loading' && (
        <Flexbox gap={16} align="center" style={{ padding: '24px 0' }}>
          <Spin size="large" />
          <Text type="secondary">
            {createBot ? t('provider.lark.preparingBot') : t('provider.lark.preparingQr')}
          </Text>
        </Flexbox>
      )}
      {state === 'pending' && (
        <Flexbox gap={14} align="center" style={{ padding: '8px 0' }}>
          <Flexbox align="center" justify="center" style={{ width: 56, height: 56, borderRadius: 14, background: '#3370ff16' }}>
            <PlatformLogo providerId="lark" size={30} />
          </Flexbox>
          <Title level={5} style={{ margin: 0 }}>{title}</Title>
          <Text type="secondary" style={{ fontSize: 13, textAlign: 'center' }}>
            {desc}
          </Text>
          <QRCode value={qrValue} size={220} bordered />
          <Alert
            type="info"
            showIcon
            message={
              <span style={{ fontSize: 12 }}>
                {createBot
                  ? t('provider.lark.createBotInfo')
                  : t('provider.lark.simulateInfo')}
              </span>
            }
            style={{ borderRadius: 8 }}
          />
        </Flexbox>
      )}
      {state === 'success' && (
        <Result
          status="success"
          icon={<CheckCircle2 size={48} color="#52c41a" />}
          title={createBot ? t('provider.lark.botCreated') : t('provider.lark.simulateSucceeded')}
          subTitle={
            createBot && bot
              ? t('provider.lark.appId', { appId: bot.app_id })
              : connection
                ? t('provider.lark.welcomeUser', { name: connection.user_name || connection.user_id })
                : t('provider.lark.sessionEstablished')
          }
          extra={
            <Flexbox gap={12} direction="vertical">
              {createBot && bot?.publish_required && (
                <Alert
                  type="warning"
                  showIcon
                  message={t('provider.lark.publishRequired')}
                  description={
                    <span style={{ fontSize: 12 }}>
                      {t('provider.lark.publishDesc')}
                    </span>
                  }
                  style={{ textAlign: 'left' }}
                />
              )}
              <Button type="primary" onClick={onClose}>{t('provider.lark.done')}</Button>
            </Flexbox>
          }
        />
      )}
      {state === 'expired' && (
        <Result
          status="warning"
          title={t('provider.lark.qrExpired')}
          subTitle={error}
          extra={<Button type="primary" onClick={handleRetry}>{t('provider.lark.regenerateQr')}</Button>}
        />
      )}
      {state === 'error' && (
        <Result
          status="error"
          icon={<XCircle size={48} color="#ff4d4f" />}
          title={createBot ? t('provider.lark.botCreationFailed') : t('provider.lark.simulateFailed')}
          subTitle={error}
          extra={<Button type="primary" onClick={handleRetry}>{t('provider.lark.retry')}</Button>}
        />
      )}
    </Modal>
  );
}
