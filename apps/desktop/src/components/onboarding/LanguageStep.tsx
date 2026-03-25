import { useState } from 'react';
import { Flexbox } from 'react-layout-kit';
import { Button, Select, theme } from 'antd';
import { Globe } from 'lucide-react';

const LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'zh-CN', label: '中文 (简体)' },
  { value: 'ja', label: '日本語' },
];

interface Props {
  initial: string;
  onNext: (language: string) => void;
  onBack: () => void;
}

export function LanguageStep({ initial, onNext, onBack }: Props) {
  const [language, setLanguage] = useState(initial || 'en');
  const { token } = theme.useToken();

  return (
    <Flexbox align="center" justify="center" gap={36} style={{ minHeight: '100%', padding: '40px 24px' }}>
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
          <Globe size={28} color="#fff" />
        </div>
        <h2 style={{ fontSize: 26, fontWeight: 700, color: token.colorText, margin: 0 }}>
          Which language?
        </h2>
        <p style={{ fontSize: 15, color: token.colorTextSecondary, margin: 0, textAlign: 'center' }}>
          Choose the language Peers Touch should respond in.
        </p>
      </Flexbox>

      <Select
        value={language}
        onChange={setLanguage}
        options={LANGUAGES}
        size="large"
        style={{ width: 280 }}
      />

      <Flexbox horizontal gap={12}>
        <Button size="large" onClick={onBack} style={{ height: 44, paddingInline: 32, borderRadius: 22 }}>
          Back
        </Button>
        <Button type="primary" size="large" onClick={() => onNext(language)} style={{ height: 44, paddingInline: 32, borderRadius: 22 }}>
          Next
        </Button>
      </Flexbox>
    </Flexbox>
  );
}
