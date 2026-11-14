import { useState } from 'react';
import { Button, Tag, Text, TextArea } from '@peers-touch/ui';
import { makeTranslate, usePrefs } from '../../prefs';
import type { ClarificationView as ClarificationModel } from './types';

/**
 * In-reading-path decision card (production ClarificationQuestion parity):
 * choices + optional free-text Other, one explicit submit, and a terminal
 * answer tag after the decision. Local-only state — no runtime dispatch.
 */
export function ClarificationView({
  model,
  onAnswered,
}: {
  model: ClarificationModel;
  onAnswered?: (answer: string) => void;
}) {
  const prefs = usePrefs();
  const t = makeTranslate(prefs.locale);
  const [answer, setAnswer] = useState(model.answer ?? '');
  const [other, setOther] = useState(false);
  const answered = Boolean(model.answer);

  if (answered) {
    return (
      <div className="pa-clarify pa-clarify--done" data-pt-agent-clarification-answer>
        <Text strong className="pa-clarify__prompt">{model.prompt}</Text>
        <Tag tone="success" className="pa-clarify__answer">{model.answer}</Tag>
      </div>
    );
  }

  const submit = () => {
    const value = answer.trim();
    if (!value) return;
    setAnswer(value);
    onAnswered?.(value);
  };

  return (
    <div className="pa-clarify" data-pt-agent-clarification>
      <Text strong className="pa-clarify__prompt">{model.prompt}</Text>
      <div className="pa-clarify__choices">
        {model.choices.map((choice) => (
          <Button
            key={choice}
            actionId={`clarification-choice-${choice}`}
            density="compact"
            emphasis={!other && answer === choice ? 'primary' : 'secondary'}
            label={choice}
            data-pt-agent-clarification-choice={choice}
            onActivate={() => { setOther(false); setAnswer(choice); }}
          />
        ))}
        {model.choices.length > 0 && (
          <Button
            actionId="clarification-other"
            density="compact"
            emphasis={other ? 'primary' : 'secondary'}
            label={t('agent.clarify.other')}
            data-pt-agent-clarification-other
            onActivate={() => { setOther(true); setAnswer(''); }}
          />
        )}
      </div>
      {(other || model.choices.length === 0) && (
        <TextArea
          className="pa-clarify__input"
          value={answer}
          maximumRows={4}
          minimumRows={3}
          maxLength={4000}
          data-pt-agent-clarification-input
          onValueChange={setAnswer}
        />
      )}
      <Button
        actionId="clarification-submit"
        density="compact"
        emphasis="primary"
        label={t('agent.clarify.submit')}
        data-pt-agent-clarification-submit
        availability={!answer.trim()
          ? { kind: 'disabled', reason: t('agent.clarify.submit') }
          : undefined}
        onActivate={submit}
      />
    </div>
  );
}
