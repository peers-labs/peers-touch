import { useState } from 'react';
import { Flexbox } from 'react-layout-kit';
import { Button, theme } from 'antd';
import { LogIn } from 'lucide-react';
import { OAuthAccountLoginPanel } from '../oauth/OAuthAccountLoginPanel';

interface Props {
  onNext: () => void;
  allowSkip?: boolean;
}

export function OAuthSignInStep({ onNext, allowSkip = true }: Props) {
  const { token } = theme.useToken();
  const [hasActiveConnection, setHasActiveConnection] = useState(false);

  return (
    <Flexbox align="center" justify="center" gap={24} style={{ minHeight: '100%', padding: '28px 24px' }}>
      <Flexbox align="center" gap={10}>
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
          Sign in to start
        </h2>
        <p style={{ fontSize: 15, color: token.colorTextSecondary, margin: 0, textAlign: 'center', maxWidth: 460 }}>
          Choose an OAuth provider to sign in. You can continue now and complete your account profile later.
        </p>
      </Flexbox>

      <Flexbox
        style={{
          width: '100%',
          maxWidth: 920,
          borderRadius: 16,
          border: `1px solid ${token.colorBorderSecondary}`,
          background: token.colorFillQuaternary,
          padding: 18,
          maxHeight: 360,
          overflow: 'auto',
        }}
      >
        <OAuthAccountLoginPanel showDescription={false} onAuthStateChange={setHasActiveConnection} />
      </Flexbox>

      <Flexbox horizontal gap={12}>
        {allowSkip && (
          <Button size="large" onClick={onNext} style={{ height: 44, paddingInline: 32, borderRadius: 22 }}>
            Skip
          </Button>
        )}
        <Button
          type="primary"
          size="large"
          onClick={onNext}
          disabled={!hasActiveConnection && !allowSkip}
          style={{ height: 44, paddingInline: 32, borderRadius: 22 }}
        >
          Continue
        </Button>
      </Flexbox>
    </Flexbox>
  );
}
