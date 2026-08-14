import { Flexbox } from 'react-layout-kit';
import { theme } from 'antd';
import { Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface FollowUpChipsProps {
  suggestions: string[];
  onSelect: (suggestion: string) => void;
}

export function FollowUpChips({ suggestions, onSelect }: FollowUpChipsProps) {
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');

  if (!suggestions.length) return null;

  return (
    <Flexbox gap={8} style={{ paddingBlock: 8, paddingInlineStart: 40 }}>
      <Flexbox horizontal align="center" gap={4}>
        <Sparkles size={12} style={{ color: token.colorTextQuaternary }} />
        <span style={{ fontSize: 11, color: token.colorTextQuaternary }}>
          {t('chat.followUp.title')}
        </span>
      </Flexbox>
      <Flexbox horizontal gap={8} style={{ flexWrap: 'wrap' }}>
        {suggestions.map((suggestion) => (
          <button
            key={suggestion}
            onClick={() => onSelect(suggestion)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '6px 12px',
              borderRadius: token.borderRadiusSM,
              border: `1px solid ${token.colorBorderSecondary}`,
              background: token.colorFillQuaternary,
              color: token.colorText,
              fontSize: 13,
              cursor: 'pointer',
              transition: 'all 0.2s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = token.colorPrimary;
              e.currentTarget.style.background = token.colorPrimaryBg;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = token.colorBorderSecondary;
              e.currentTarget.style.background = token.colorFillQuaternary;
            }}
          >
            {suggestion}
          </button>
        ))}
      </Flexbox>
    </Flexbox>
  );
}
