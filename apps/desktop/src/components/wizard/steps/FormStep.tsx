import { useState } from 'react';
import { Flexbox } from 'react-layout-kit';
import { Button, Select, Input, Typography, theme } from 'antd';
import { ClipboardList } from 'lucide-react';

const { Text } = Typography;
import * as Icons from 'lucide-react';
import type { WizardStep } from '../../../services/desktop_api';

interface Props {
  step: WizardStep;
  onNext: (data: Record<string, any>) => void;
  onBack: () => void;
}

function getIcon(name: string, size = 20) {
  const Icon = (Icons as Record<string, any>)[
    name.replace(/(^|[-_])(\w)/g, (_, _p, c: string) => c.toUpperCase())
  ];
  return Icon ? <Icon size={size} /> : null;
}

export function FormStep({ step, onNext, onBack }: Props) {
  const { token } = theme.useToken();
  const fields = step.fields || [];

  const [values, setValues] = useState<Record<string, string>>(() => {
    const defaults: Record<string, string> = {};
    for (const f of fields) {
      if (f.default) defaults[f.id] = f.default;
    }
    return defaults;
  });

  const setValue = (id: string, val: string) => {
    setValues((prev) => ({ ...prev, [id]: val }));
  };

  const allValid = fields.every((f) => !f.required || values[f.id]);

  const handleSubmit = () => {
    onNext(values);
  };

  return (
    <Flexbox align="center" justify="center" gap={32} style={{ minHeight: '100%', padding: '40px 24px' }}>
      <Flexbox align="center" gap={12}>
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 16,
            background: 'linear-gradient(135deg, #f093fb, #f5576c)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <ClipboardList size={28} color="#fff" />
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

      <Flexbox gap={20} style={{ width: '100%', maxWidth: 420 }}>
        {fields.map((field) => (
          <Flexbox key={field.id} gap={8}>
            {field.hint && (
              <Text
                type="secondary"
                style={{
                  fontSize: 13,
                  lineHeight: 1.5,
                  padding: '8px 12px',
                  borderRadius: 8,
                  background: token.colorInfoBg,
                  border: `1px solid ${token.colorInfoBorder}`,
                  whiteSpace: 'pre-line',
                }}
              >
                {field.hint}
              </Text>
            )}
            {field.type === 'single_select' && field.options && field.options.length <= 6 ? (
              <Flexbox gap={8}>
                {field.options.map((opt) => (
                  <div
                    key={opt.value}
                    onClick={() => setValue(field.id, opt.value)}
                    style={{
                      padding: '14px 18px',
                      borderRadius: 12,
                      cursor: 'pointer',
                      background: values[field.id] === opt.value ? token.colorPrimaryBg : token.colorFillQuaternary,
                      border: `2px solid ${values[field.id] === opt.value ? token.colorPrimary : token.colorBorderSecondary}`,
                      transition: 'all 0.2s',
                    }}
                  >
                    <Flexbox horizontal gap={12} align="center">
                      {opt.icon && (
                        <div
                          style={{
                            width: 36,
                            height: 36,
                            borderRadius: 8,
                            background: values[field.id] === opt.value ? token.colorPrimary : token.colorFillSecondary,
                            color: values[field.id] === opt.value ? '#fff' : token.colorTextSecondary,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0,
                            transition: 'all 0.2s',
                          }}
                        >
                          {getIcon(opt.icon, 18)}
                        </div>
                      )}
                      <Flexbox gap={2}>
                        <span style={{ fontWeight: 600, fontSize: 15, color: token.colorText }}>{opt.label}</span>
                        {opt.desc && (
                          <span style={{ fontSize: 12, color: token.colorTextSecondary }}>{opt.desc}</span>
                        )}
                      </Flexbox>
                    </Flexbox>
                  </div>
                ))}
              </Flexbox>
            ) : field.type === 'select' || field.type === 'single_select' ? (
              <Flexbox gap={4}>
                <span style={{ fontSize: 13, fontWeight: 500, color: token.colorText }}>{field.label}</span>
                <Select
                  value={values[field.id]}
                  onChange={(val) => setValue(field.id, val)}
                  options={field.options?.map((o) => ({ value: o.value, label: o.label }))}
                  style={{ width: '100%' }}
                  size="large"
                />
              </Flexbox>
            ) : field.type === 'password' ? (
              <Flexbox gap={4}>
                <span style={{ fontSize: 13, fontWeight: 500, color: token.colorText }}>{field.label}</span>
                <Input.Password
                  value={values[field.id] || ''}
                  onChange={(e) => setValue(field.id, e.target.value)}
                  placeholder={field.placeholder || `Enter ${field.label}`}
                  size="large"
                />
              </Flexbox>
            ) : field.type === 'textarea' ? (
              <Flexbox gap={4}>
                <span style={{ fontSize: 13, fontWeight: 500, color: token.colorText }}>{field.label}</span>
                <Input.TextArea
                  value={values[field.id] || ''}
                  onChange={(e) => setValue(field.id, e.target.value)}
                  placeholder={field.placeholder}
                  rows={3}
                  size="large"
                />
              </Flexbox>
            ) : (
              <Flexbox gap={4}>
                <span style={{ fontSize: 13, fontWeight: 500, color: token.colorText }}>{field.label}</span>
                <Input
                  value={values[field.id] || ''}
                  onChange={(e) => setValue(field.id, e.target.value)}
                  placeholder={field.placeholder}
                  size="large"
                />
              </Flexbox>
            )}
          </Flexbox>
        ))}
      </Flexbox>

      <Flexbox horizontal gap={12}>
        <Button size="large" onClick={onBack} style={{ height: 44, paddingInline: 32, borderRadius: 22 }}>
          Back
        </Button>
        <Button
          type="primary"
          size="large"
          onClick={handleSubmit}
          disabled={!allValid}
          style={{ height: 44, paddingInline: 32, borderRadius: 22 }}
        >
          Continue
        </Button>
      </Flexbox>
    </Flexbox>
  );
}
