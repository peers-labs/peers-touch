import { useCallback, useRef, useEffect } from 'react';
import { Flexbox } from 'react-layout-kit';
import { Button } from '@lobehub/ui';
import { Input, theme } from 'antd';
import type { TextAreaRef } from 'antd/es/input/TextArea';
import { Bot, X, Send } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useInterventionStore } from '../../store/intervention';

const { TextArea } = Input;

/**
 * InterventionBar — inline prompt surface that appears above the chat input
 * when the agent requests user clarification mid-turn.
 */
export function InterventionBar() {
  const { t } = useTranslation('agent');
  const { token } = theme.useToken();

  const activeIntervention = useInterventionStore((s) => s.activeIntervention);
  const draft = useInterventionStore((s) => s.draft);
  const setDraft = useInterventionStore((s) => s.setDraft);
  const submit = useInterventionStore((s) => s.submit);
  const cancel = useInterventionStore((s) => s.cancel);
  const selectChoice = useInterventionStore((s) => s.selectChoice);
  const confirm = useInterventionStore((s) => s.confirm);

  const textareaRef = useRef<TextAreaRef>(null);

  useEffect(() => {
    if (activeIntervention?.type === 'text' && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [activeIntervention]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        submit();
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        cancel();
      }
    },
    [submit, cancel],
  );

  if (!activeIntervention) return null;

  return (
    <Flexbox
      style={{
        border: `1.5px solid ${token.colorPrimaryBorder}`,
        borderRadius: 12,
        background: token.colorPrimaryBg,
        padding: '12px 14px',
        marginBottom: 8,
        boxShadow: `0 2px 8px ${token.colorPrimaryBgHover}`,
      }}
      gap={10}
    >
      {/* Header: agent icon + prompt */}
      <Flexbox horizontal align="center" gap={8} style={{ minWidth: 0 }}>
        <Bot size={16} color={token.colorPrimary} style={{ flexShrink: 0 }} />
        <span
          style={{
            flex: 1,
            fontSize: 13,
            fontWeight: 600,
            color: token.colorText,
            lineHeight: 1.4,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {activeIntervention.prompt}
        </span>
        <button
          type="button"
          onClick={cancel}
          title={t('agent.intervention.cancel')}
          style={{
            border: 0,
            background: 'transparent',
            cursor: 'pointer',
            padding: 2,
            display: 'inline-flex',
            alignItems: 'center',
            color: token.colorTextTertiary,
            borderRadius: 4,
            flexShrink: 0,
          }}
        >
          <X size={14} />
        </button>
      </Flexbox>

      {/* Body: type-specific controls */}
      {activeIntervention.type === 'text' && (
        <Flexbox horizontal align="end" gap={8}>
          <TextArea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('agent.intervention.placeholder')}
            autoSize={{ minRows: 1, maxRows: 4 }}
            style={{
              flex: 1,
              fontSize: 13,
              borderRadius: 8,
              resize: 'none',
            }}
          />
          <Button
            type="primary"
            size="small"
            icon={<Send size={13} />}
            onClick={submit}
            disabled={!draft.trim()}
            style={{ borderRadius: 8, height: 32 }}
          >
            {t('agent.intervention.submit')}
          </Button>
        </Flexbox>
      )}

      {activeIntervention.type === 'choice' && (
        <Flexbox horizontal gap={8} wrap="wrap">
          {(activeIntervention.choices || []).map((choice) => (
            <Button
              key={choice}
              size="small"
              onClick={() => selectChoice(choice)}
              style={{
                borderRadius: 8,
                fontSize: 12,
                fontWeight: 500,
              }}
            >
              {choice}
            </Button>
          ))}
        </Flexbox>
      )}

      {activeIntervention.type === 'confirm' && (
        <Flexbox horizontal gap={8}>
          <Button
            type="primary"
            size="small"
            onClick={() => confirm(true)}
            style={{ borderRadius: 8 }}
          >
            {t('agent.intervention.confirm.yes')}
          </Button>
          <Button
            size="small"
            onClick={() => confirm(false)}
            style={{ borderRadius: 8 }}
          >
            {t('agent.intervention.confirm.no')}
          </Button>
        </Flexbox>
      )}
    </Flexbox>
  );
}
