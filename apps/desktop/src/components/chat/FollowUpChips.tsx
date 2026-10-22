import { Flexbox } from 'react-layout-kit';
import { Button, theme } from 'antd';
import { Plus, Send, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useState } from 'react';

interface FollowUpChipsProps {
  suggestions: string[];
  onInsert: (suggestion: string) => void;
  onSend: (suggestion: string) => void;
  disabled?: boolean;
}

export function FollowUpChips({ suggestions, onInsert, onSend, disabled }: FollowUpChipsProps) {
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');
  const [expanded, setExpanded] = useState<string | null>(null);

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
          <Flexbox key={suggestion} horizontal align="center" gap={4}>
          <button
            type="button"
            data-pt-agent-follow-up={suggestion}
            aria-expanded={expanded === suggestion}
            onClick={() => setExpanded(expanded === suggestion ? null : suggestion)}
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
          {expanded === suggestion && (
            <>
              <Button
                size="small"
                type="text"
                icon={<Plus size={14} />}
                data-pt-agent-follow-up-action="add"
                aria-label={t('chat.followUp.addToInput', { suggestion })}
                title={t('chat.followUp.addToInput', { suggestion })}
                onClick={() => { onInsert(suggestion); setExpanded(null); }}
              />
              <Button
                size="small"
                type="text"
                icon={<Send size={14} />}
                disabled={disabled}
                data-pt-agent-follow-up-action="send"
                aria-label={t('chat.followUp.replyNow', { suggestion })}
                title={t('chat.followUp.replyNow', { suggestion })}
                onClick={() => { onSend(suggestion); setExpanded(null); }}
              />
            </>
          )}
          </Flexbox>
        ))}
      </Flexbox>
    </Flexbox>
  );
}
