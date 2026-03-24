import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Modal, QRCode, Result, Spin, Typography } from 'antd';
import { Flexbox } from 'react-layout-kit';
import { CheckCircle2, XCircle } from 'lucide-react';
import { api, type LarkBotCredentials, type OAuth2Connection } from '../../services/desktop_api';
import { useOAuth2Store } from '../../store/oauth2';
import { PlatformLogo } from '../common/PlatformLogo';

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

function normalizeSimulateError(raw?: string): string {
  const text = (raw || '').trim();
  const lower = text.toLowerCase();
  if (lower === 'not found' || lower.includes('404')) {
    return 'Simulated Login API is unavailable (404). Restart Agent Box backend with the latest code and retry.';
  }
  if (lower === 'session not found') {
    return 'Login session not found. It may have expired or the service restarted. Click Retry to generate a new QR code.';
  }
  if (!text) {
    return 'Simulated Login failed. Please retry.';
  }
  return text;
}

export function LarkSimulateLoginModal({ open, onClose, intent = 'oauth', appName, onSuccess }: Props) {
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
        setError(normalizeSimulateError(err?.message));
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
          setError(res.error || 'QR code expired');
          return;
        }
        if (timerRef.current) window.clearInterval(timerRef.current);
        timerRef.current = null;
        setState('error');
        setError(normalizeSimulateError(res.error));
      } catch (err: any) {
        if (timerRef.current) window.clearInterval(timerRef.current);
        timerRef.current = null;
        setState('error');
        setError(normalizeSimulateError(err?.message));
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
        setError(normalizeSimulateError(err?.message));
        setState('error');
      });
  };

  const title = createBot ? 'Create Lark Bot · Lark (飞书)' : 'Simulated Login · Lark (飞书)';
  const desc = createBot
    ? 'Scan with Lark (飞书) app to create a new bot and get App ID/Secret. OAuth simulate will also be connected.'
    : 'Use the Lark (飞书) app to scan the QR code below and complete authorization.';

  return (
    <Modal open={open} onCancel={onClose} footer={null} width={440} centered destroyOnClose>
      {state === 'loading' && (
        <Flexbox gap={16} align="center" style={{ padding: '24px 0' }}>
          <Spin size="large" />
          <Text type="secondary">
            {createBot ? 'Preparing Lark bot creation...' : 'Preparing Lark QR login...'}
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
                  ? 'After scanning, a new Lark app will be created with Bot enabled. App ID and Secret will be saved to your channel.'
                  : 'Simulated Login is based on a web QR session for quick onboarding; OAuth2 Login is better for long-term standard integration.'}
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
          title={createBot ? 'Lark Bot Created' : 'Lark Simulated Login Succeeded'}
          subTitle={
            createBot && bot
              ? `App ID: ${bot.app_id}`
              : connection
                ? `Welcome, ${connection.user_name || connection.user_id}`
                : 'Login session established'
          }
          extra={
            <Flexbox gap={12} direction="vertical">
              {createBot && bot?.publish_required && (
                <Alert
                  type="warning"
                  showIcon
                  message="需先发布应用"
                  description={
                    <span style={{ fontSize: 12 }}>
                      应用已创建，但需在飞书开放平台完成发布后才能使用长连接。请访问{' '}
                      <a href="https://open.larkoffice.com/app" target="_blank" rel="noreferrer">open.larkoffice.com</a>
                      {' '}→ 选择应用 → 版本管理与发布 → 创建版本 → 申请发布。审核通过后即可连接。
                    </span>
                  }
                  style={{ textAlign: 'left' }}
                />
              )}
              <Button type="primary" onClick={onClose}>Done</Button>
            </Flexbox>
          }
        />
      )}
      {state === 'expired' && (
        <Result
          status="warning"
          title="QR code expired"
          subTitle={error}
          extra={<Button type="primary" onClick={handleRetry}>Regenerate QR Code</Button>}
        />
      )}
      {state === 'error' && (
        <Result
          status="error"
          icon={<XCircle size={48} color="#ff4d4f" />}
          title={createBot ? 'Lark Bot Creation Failed' : 'Lark Simulated Login Failed'}
          subTitle={error}
          extra={<Button type="primary" onClick={handleRetry}>Retry</Button>}
        />
      )}
    </Modal>
  );
}
