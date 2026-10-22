import { useState } from 'react';
import { Button, Flex, Input, Typography } from 'antd';
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
    <Flex vertical gap={8} data-pt-agent-clarification={tool.id}>
      <Typography.Text strong>{question.prompt}</Typography.Text>
      {waiting && (
        <>
          <Flex gap={8} wrap>
            {choices.map((choice) => (
              <Button
                key={choice}
                disabled={submitting}
                type={!other && answer === choice ? 'primary' : 'default'}
                onClick={() => { setOther(false); setAnswer(choice); }}
                data-pt-agent-clarification-choice={choice}
              >{choice}</Button>
            ))}
            {choices.length > 0 && (
              <Button
                disabled={submitting}
                type={other ? 'primary' : 'default'}
                onClick={() => { setOther(true); setAnswer(''); }}
                data-pt-agent-clarification-other
              >{t('chat.clarification.other')}</Button>
            )}
          </Flex>
          {(other || choices.length === 0) && (
            <Input.TextArea
              value={answer}
              disabled={submitting}
              maxLength={4000}
              autoSize={{ minRows: 2, maxRows: 6 }}
              onChange={(event) => setAnswer(event.target.value)}
              data-pt-agent-clarification-input
            />
          )}
          <Button
            type="primary"
            loading={submitting}
            disabled={!answer.trim()}
            onClick={() => void submit()}
            data-pt-agent-clarification-submit
          >{t('chat.clarification.submit')}</Button>
        </>
      )}
      {tool.result && (
        <Typography.Paragraph data-pt-agent-clarification-answer>
          {tool.result}
        </Typography.Paragraph>
      )}
      {error && <Typography.Text type="danger">{t(error)}</Typography.Text>}
    </Flex>
  );
}
