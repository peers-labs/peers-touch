import { Flexbox } from 'react-layout-kit';
import { Button, theme } from 'antd';
import { Sparkles, Code, Users, Zap } from 'lucide-react';

interface Props {
  onNext: () => void;
}

export function WelcomeStep({ onNext }: Props) {
  const { token } = theme.useToken();

  const features = [
    { icon: <Code size={20} />, title: 'Create', desc: 'Write code, build features, and automate tasks' },
    { icon: <Users size={20} />, title: 'Collaborate', desc: 'Multi-agent orchestration for complex workflows' },
    { icon: <Zap size={20} />, title: 'Evolve', desc: 'Learns your preferences over time with memory' },
  ];

  return (
    <Flexbox align="center" justify="center" gap={40} style={{ minHeight: '100%', padding: '40px 24px' }}>
      <Flexbox align="center" gap={20}>
        <div
          style={{
            width: 88,
            height: 88,
            borderRadius: 24,
            background: 'linear-gradient(135deg, #667eea, #764ba2)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 8px 32px rgba(102, 126, 234, 0.3)',
          }}
        >
          <Sparkles size={44} color="#fff" />
        </div>
        <h1 style={{ fontSize: 32, fontWeight: 700, color: token.colorText, margin: 0 }}>
          Nice to meet you
        </h1>
        <p style={{ fontSize: 16, color: token.colorTextSecondary, margin: 0, textAlign: 'center', maxWidth: 420 }}>
          Agent Box is your personal AI assistant that can read files, execute commands, search the web, and much more.
        </p>
      </Flexbox>

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
              {f.icon}
            </div>
            <Flexbox gap={2}>
              <span style={{ fontWeight: 600, fontSize: 15, color: token.colorText }}>{f.title}</span>
              <span style={{ fontSize: 13, color: token.colorTextSecondary }}>{f.desc}</span>
            </Flexbox>
          </Flexbox>
        ))}
      </Flexbox>

      <Button type="primary" size="large" onClick={onNext} style={{ height: 48, paddingInline: 48, fontSize: 16, borderRadius: 24 }}>
        Let's get started
      </Button>
    </Flexbox>
  );
}
