import { Plus, Send, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { Button as PtButton, Tooltip as PtTooltip } from '@peers-touch/ui';

interface FollowUpChipsProps {
  suggestions: string[];
  onInsert: (suggestion: string) => void;
  onSend: (suggestion: string) => void;
  disabled?: boolean;
}

export function FollowUpChips({ suggestions, onInsert, onSend, disabled }: FollowUpChipsProps) {
  const { t } = useTranslation('chat');
  const [expanded, setExpanded] = useState<string | null>(null);

  if (!suggestions.length) return null;

  return (
    <div className="sc-followup">
      <div className="sc-followup__label">
        <Sparkles size={12} />
        <span>{t('chat.followUp.title')}</span>
      </div>
      <div className="sc-followup__chips">
        {suggestions.map((suggestion) => (
          <div key={suggestion} className="sc-followup__chip-group">
            <button
              type="button"
              className={`sc-followup__chip${expanded === suggestion ? ' is-expanded' : ''}`}
              data-pt-agent-follow-up={suggestion}
              aria-expanded={expanded === suggestion}
              onClick={() => setExpanded(expanded === suggestion ? null : suggestion)}
            >
              {suggestion}
            </button>
            {expanded === suggestion && (
              <>
                <PtTooltip label={t('chat.followUp.addToInput', { suggestion })}>
                  <PtButton
                    actionId={`follow-up-add-${suggestion}`}
                    className="sc-followup__action"
                    data-pt-agent-follow-up-action="add"
                    emphasis="quiet"
                    density="compact"
                    leading={<Plus size={14} />}
                    aria-label={t('chat.followUp.addToInput', { suggestion })}
                    onActivate={() => { onInsert(suggestion); setExpanded(null); }}
                  />
                </PtTooltip>
                <PtTooltip label={t('chat.followUp.replyNow', { suggestion })}>
                  <PtButton
                    actionId={`follow-up-send-${suggestion}`}
                    className="sc-followup__action"
                    data-pt-agent-follow-up-action="send"
                    emphasis="quiet"
                    density="compact"
                    leading={<Send size={14} />}
                    aria-label={t('chat.followUp.replyNow', { suggestion })}
                    onActivate={() => { onSend(suggestion); setExpanded(null); }}
                    availability={disabled
                      ? { kind: 'disabled', reason: t('chat.followUp.replyNow', { suggestion }) }
                      : undefined}
                  />
                </PtTooltip>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
