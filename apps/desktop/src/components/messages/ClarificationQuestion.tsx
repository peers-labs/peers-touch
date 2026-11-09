import { useState } from 'react';
import { Button, TextArea } from '@peers-touch/ui';
import { useTranslation } from 'react-i18next';
import type { ToolCallInfo } from '../../store/chat';
import { toolRuntime } from '../../runtimes/toolRuntime';

export function ClarificationQuestion({ tool }: { tool: ToolCallInfo }) {
  const { t } = useTranslation('chat');
  const [answer, setAnswer] = useState('');
  const [other, setOther] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  let question: { prompt?: string; choices?: string[] } = {};
  try { question = JSON.parse(tool.args || '{}'); } catch { /* Station rejects malformed questions. */ }
  const waiting = tool.status === 'approval_required';
  const choices = Array.isArray(question.choices) ? question.choices : [];

  async function submit() {
    if (submitting || !waiting || !answer.trim()) return;
    setSubmitting(true);
    setError('');
    try {
      const response = await toolRuntime.submitDecision(tool.id, true, answer.trim());
      if (!response.accepted) setError(response.outcome_error?.locale_key || response.error_code);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="sc-clarify" data-pt-agent-clarification={tool.id}>
      <strong className="sc-clarify__prompt">{question.prompt}</strong>
      {waiting && (
        <>
          <div className="sc-clarify__choices">
            {choices.map((choice) => (
              <Button
                key={choice}
                actionId={`clarification-choice-${choice}`}
                density="compact"
                emphasis={!other && answer === choice ? 'primary' : 'secondary'}
                label={choice}
                availability={submitting ? { kind: 'disabled', reason: choice } : undefined}
                onActivate={() => { setOther(false); setAnswer(choice); }}
                data-pt-agent-clarification-choice={choice}
              />
            ))}
            {choices.length > 0 && (
              <Button
                actionId="clarification-other"
                density="compact"
                emphasis={other ? 'primary' : 'secondary'}
                label={t('chat.clarification.other')}
                availability={submitting ? { kind: 'disabled', reason: t('chat.clarification.other') } : undefined}
                onActivate={() => { setOther(true); setAnswer(''); }}
                data-pt-agent-clarification-other
              />
            )}
          </div>
          {(other || choices.length === 0) && (
            <TextArea
              className="sc-clarify__input"
              value={answer}
              disabled={submitting}
              maxLength={4000}
              rows={3}
              onChange={(event) => setAnswer(event.target.value)}
              data-pt-agent-clarification-input
            />
          )}
          <Button
            actionId="clarification-submit"
            density="compact"
            emphasis="primary"
            execution={submitting ? 'pending' : undefined}
            label={t('chat.clarification.submit')}
            availability={!answer.trim() ? { kind: 'disabled', reason: t('chat.clarification.submit') } : undefined}
            onActivate={() => void submit()}
            data-pt-agent-clarification-submit
          />
        </>
      )}
      {tool.result && (
        <p className="sc-clarify__answer" data-pt-agent-clarification-answer>
          {tool.result}
        </p>
      )}
      {error && <p className="sc-clarify__error">{t(error)}</p>}
    </div>
  );
}
