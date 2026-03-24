import { useState, useEffect, useRef, useCallback } from 'react';
import { Flexbox } from 'react-layout-kit';
import { Button, Spin, Typography, theme } from 'antd';
import { LogIn, CheckCircle, XCircle, QrCode } from 'lucide-react';
import { api } from '../../../services/desktop_api';
import type { WizardStep, SimulateLoginPoll } from '../../../services/desktop_api';

const { Text } = Typography;

interface Props {
  step: WizardStep;
  onNext: (data: Record<string, any>) => void;
  onBack: () => void;
}

type LoginState = 'idle' | 'loading' | 'pending' | 'success' | 'expired' | 'error';

export function OAuthLoginStep({ step, onNext, onBack }: Props) {
  const { token } = theme.useToken();
  const config = step.config || {};
  const method = config.method as string || 'simulate';
  const provider = config.provider as string || 'lark';

  const [state, setState] = useState<LoginState>('idle');
  const [qrValue, setQrValue] = useState('');
  const [connection, setConnection] = useState<SimulateLoginPoll['connection']>(undefined);
  const [errorMsg, setErrorMsg] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const cleanup = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const startLogin = async () => {
    cleanup();
    setState('loading');

    if (method === 'simulate' && provider === 'lark') {
      try {
        const result = await api.oauthSimulateLarkStart();
        setQrValue(result.qr_value);
        setState('pending');

        pollRef.current = setInterval(async () => {
          try {
            const poll = await api.oauthSimulateLarkPoll(result.session_id);
            if (poll.status === 'success' && poll.connection) {
              cleanup();
              setConnection(poll.connection);
              setState('success');
            } else if (poll.status === 'expired') {
              cleanup();
              setState('expired');
            } else if (poll.status === 'error') {
              cleanup();
              setErrorMsg(poll.error || 'Login failed');
              setState('error');
            }
          } catch {
            // Keep polling
          }
        }, 2000);
      } catch (e: unknown) {
        setErrorMsg(e instanceof Error ? e.message : 'Failed to start login');
        setState('error');
      }
    } else if (method === 'standard') {
      try {
        const result = await api.oauth2Authorize(provider);
        if (result.auth_url) {
          window.open(result.auth_url, '_blank', 'width=600,height=700');
          setState('pending');
          pollRef.current = setInterval(async () => {
            try {
              const conns = await api.oauth2ListConnections();
              const conn = conns.find((c) => c.provider_id === provider && c.status === 'active');
              if (conn) {
                cleanup();
                setConnection(conn);
                setState('success');
              }
            } catch {
              // Keep polling
            }
          }, 2000);
        }
      } catch (e: unknown) {
        setErrorMsg(e instanceof Error ? e.message : 'Failed to start auth');
        setState('error');
      }
    }
  };

  const handleContinue = () => {
    const data: Record<string, any> = {};
    if (connection) {
      data.user_name = connection.user_name;
      data.avatar = connection.avatar_url;
      data.email = connection.email;
      data.provider_id = connection.provider_id;
    }
    onNext(data);
  };

  useEffect(() => {
    if (state === 'idle') {
      startLogin();
    }
  }, []);

  return (
    <Flexbox align="center" justify="center" gap={32} style={{ minHeight: '100%', padding: '40px 24px' }}>
      <Flexbox align="center" gap={12}>
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 16,
            background: 'linear-gradient(135deg, #4facfe, #00f2fe)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <LogIn size={28} color="#fff" />
        </div>
        <h2 style={{ fontSize: 26, fontWeight: 700, color: token.colorText, margin: 0 }}>
          {step.title}
        </h2>
        {step.desc && (
          <p style={{ fontSize: 15, color: token.colorTextSecondary, margin: 0, textAlign: 'center', maxWidth: 400 }}>
            {step.desc}
          </p>
        )}
      </Flexbox>

      <Flexbox
        align="center"
        justify="center"
        gap={16}
        style={{
          width: '100%',
          maxWidth: 420,
          padding: 24,
          borderRadius: 16,
          background: token.colorFillQuaternary,
          border: `1px solid ${token.colorBorderSecondary}`,
          minHeight: 240,
        }}
      >
        {state === 'loading' && <Spin size="large" />}

        {state === 'pending' && qrValue && (
          <Flexbox align="center" gap={16}>
            <QrCode size={24} color={token.colorTextSecondary} />
            <Text style={{ fontSize: 14, color: token.colorTextSecondary }}>
              Scan with Lark (飞书) to login
            </Text>
            <div
              style={{
                width: 200,
                height: 200,
                background: '#fff',
                borderRadius: 12,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden',
              }}
            >
              <img
                src={qrValue}
                alt="QR Code"
                style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                onError={() => {
                  /* QR might be a value, not an image URL */
                }}
              />
            </div>
            <Spin size="small" />
            <Text type="secondary" style={{ fontSize: 13 }}>Waiting for scan...</Text>
          </Flexbox>
        )}

        {state === 'pending' && !qrValue && (
          <Flexbox align="center" gap={12}>
            <Spin size="large" />
            <Text type="secondary">Waiting for authentication...</Text>
          </Flexbox>
        )}

        {state === 'success' && connection && (
          <Flexbox align="center" gap={16}>
            <CheckCircle size={48} color={token.colorSuccess} />
            <Text strong style={{ fontSize: 18 }}>Login Successful</Text>
            <Flexbox align="center" gap={4}>
              {connection.avatar_url && (
                <img
                  src={connection.avatar_url}
                  alt=""
                  style={{ width: 48, height: 48, borderRadius: '50%' }}
                />
              )}
              <Text style={{ fontSize: 16 }}>{connection.user_name}</Text>
              {connection.email && (
                <Text type="secondary" style={{ fontSize: 13 }}>{connection.email}</Text>
              )}
            </Flexbox>
          </Flexbox>
        )}

        {state === 'expired' && (
          <Flexbox align="center" gap={12}>
            <XCircle size={48} color={token.colorWarning} />
            <Text>QR code expired</Text>
            <Button onClick={startLogin}>Retry</Button>
          </Flexbox>
        )}

        {state === 'error' && (
          <Flexbox align="center" gap={12}>
            <XCircle size={48} color={token.colorError} />
            <Text type="danger">{errorMsg}</Text>
            <Button onClick={startLogin}>Retry</Button>
          </Flexbox>
        )}
      </Flexbox>

      <Flexbox horizontal gap={12}>
        <Button size="large" onClick={onBack} style={{ height: 44, paddingInline: 32, borderRadius: 22 }}>
          Back
        </Button>
        {state === 'success' ? (
          <Button type="primary" size="large" onClick={handleContinue} style={{ height: 44, paddingInline: 32, borderRadius: 22 }}>
            Continue
          </Button>
        ) : !step.required ? (
          <Button size="large" onClick={() => onNext({})} style={{ height: 44, paddingInline: 32, borderRadius: 22 }}>
            Skip
          </Button>
        ) : null}
      </Flexbox>
    </Flexbox>
  );
}
