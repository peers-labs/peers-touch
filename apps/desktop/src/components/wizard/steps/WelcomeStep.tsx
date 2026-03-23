import { Flexbox } from 'react-layout-kit';
import { Button, theme } from 'antd';
import { Sparkles } from 'lucide-react';
import * as Icons from 'lucide-react';
import type { WizardStep } from '../../../services/api';

interface Props {
  step: WizardStep;
  branding?: { title?: string; logo?: string; primary_color?: string };
  onNext: () => void;
}

function getIcon(name: string, size = 20) {
  const Icon = (Icons as Record<string, any>)[
    name.replace(/(^|[-_])(\w)/g, (_, _p, c: string) => c.toUpperCase())
  ];
  return Icon ? <Icon size={size} /> : <Sparkles size={size} />;
}

export function WelcomeStep({ step, branding, onNext }: Props) {
  const { token } = theme.useToken();
  const features = step.features || [];

  return (
    <Flexbox align="center" justify="center" gap={40} style={{ minHeight: '100%', padding: '40px 24px' }}>
      <Flexbox align="center" gap={20}>
        <div
          style={{
            width: 88,
            height: 88,
            borderRadius: 24,
            background: `linear-gradient(135deg, ${branding?.primary_color || '#667eea'}, #764ba2)`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: `0 8px 32px ${branding?.primary_color || 'rgba(102,126,234,0.3)'}40`,
          }}
        >
          {branding?.logo ? (
            <img src={branding.logo} alt="" style={{ width: 52, height: 52, objectFit: 'contain' }} />
          ) : (
            <Sparkles size={44} color="#fff" />
          )}
        </div>
        <h1 style={{ fontSize: 32, fontWeight: 700, color: token.colorText, margin: 0 }}>
          {step.title}
        </h1>
        {step.desc && (
          <p style={{ fontSize: 16, color: token.colorTextSecondary, margin: 0, textAlign: 'center', maxWidth: 420 }}>
            {step.desc}
          </p>
        )}
      </Flexbox>

      {features.length > 0 && (
        <Flexbox gap={16} style={{ width: '100%', maxWidth: 420 }}>
          {features.map((f) => (
            <Flexbox
              key={f.title}
              horizontal
              gap={16}
              align="center"
              style={{
                padding: '16px 20px',
                borderRadius: 12,
                background: token.colorFillQuaternary,
                border: `1px solid ${token.colorBorderSecondary}`,
              }}
            >
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 10,
                  background: token.colorPrimaryBg,
                  color: token.colorPrimary,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                {getIcon(f.icon)}
              </div>
              <Flexbox gap={2}>
                <span style={{ fontWeight: 600, fontSize: 15, color: token.colorText }}>{f.title}</span>
                <span style={{ fontSize: 13, color: token.colorTextSecondary }}>{f.desc}</span>
              </Flexbox>
            </Flexbox>
          ))}
        </Flexbox>
      )}

      <Button type="primary" size="large" onClick={onNext} style={{ height: 48, paddingInline: 48, fontSize: 16, borderRadius: 24 }}>
        Let's get started
      </Button>
    </Flexbox>
  );
}
