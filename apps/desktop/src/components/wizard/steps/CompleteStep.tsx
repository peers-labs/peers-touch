import { Flexbox } from 'react-layout-kit';
import { Button, theme } from 'antd';
import { PartyPopper, Check } from 'lucide-react';
import type { WizardStep } from '../../../services/api';

interface Props {
  step: WizardStep;
  wizardContext: Record<string, any>;
  onComplete: () => void;
}

function resolveTemplate(text: string, ctx: Record<string, any>): string {
  return text.replace(/\{\{\.(\w+)\.(\w+)\}\}/g, (_, stepId, field) => {
    return ctx[stepId]?.[field] ?? '';
  });
}

export function CompleteStep({ step, wizardContext, onComplete }: Props) {
  const { token } = theme.useToken();
  const summary = step.summary || [];

  return (
    <Flexbox align="center" justify="center" gap={40} style={{ minHeight: '100%', padding: '40px 24px' }}>
      <Flexbox align="center" gap={20}>
        <div
          style={{
            width: 88,
            height: 88,
            borderRadius: 24,
            background: 'linear-gradient(135deg, #43e97b, #38f9d7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 8px 32px rgba(67, 233, 123, 0.3)',
          }}
        >
          <PartyPopper size={44} color="#fff" />
        </div>
        <h1 style={{ fontSize: 32, fontWeight: 700, color: token.colorText, margin: 0 }}>
          {resolveTemplate(step.title, wizardContext)}
        </h1>
        {step.desc && (
          <p style={{ fontSize: 16, color: token.colorTextSecondary, margin: 0, textAlign: 'center', maxWidth: 420 }}>
            {resolveTemplate(step.desc, wizardContext)}
          </p>
        )}
      </Flexbox>

      {summary.length > 0 && (
        <Flexbox gap={12} style={{ width: '100%', maxWidth: 420 }}>
          {summary.map((item, i) => (
            <Flexbox
              key={i}
              horizontal
              gap={12}
              align="center"
              style={{
                padding: '12px 16px',
                borderRadius: 10,
                background: token.colorSuccessBg,
                border: `1px solid ${token.colorSuccessBorder}`,
              }}
            >
              <Check size={18} color={token.colorSuccess} style={{ flexShrink: 0 }} />
              <span style={{ fontSize: 14, color: token.colorText }}>
                {resolveTemplate(item, wizardContext)}
              </span>
            </Flexbox>
          ))}
        </Flexbox>
      )}

      <Button
        type="primary"
        size="large"
        onClick={onComplete}
        style={{
          height: 52,
          paddingInline: 56,
          fontSize: 17,
          fontWeight: 600,
          borderRadius: 26,
          background: 'linear-gradient(135deg, #667eea, #764ba2)',
          border: 'none',
        }}
      >
        Enter Agent Box
      </Button>
    </Flexbox>
  );
}
