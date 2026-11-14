import {
  Alert, Button, Collapsible, FileTypeGlyph, Flex, Icon, Markdown, Tag, Text,
} from '@peers-touch/ui';
import { makeTranslate, usePrefs, type Translate } from '../../prefs';
import { ToolCallView } from './ToolCallView';
import { TurnAttributionView } from './TurnAttributionView';
import type { ConversationMessage } from './types';

/**
 * One conversation row. User and assistant legs share the reading column
 * but keep distinct surfaces: user input is an ink-tinted flat panel,
 * assistant output is a neutral surface with Markdown, folded reasoning,
 * tool cards, attribution and typed-error recovery.
 */
export function MessageBubble({
  message,
  onClarificationAnswered,
}: {
  message: ConversationMessage;
  onClarificationAnswered?: (toolId: string, answer: string) => void;
}) {
  if (message.role === 'user') return <UserBubble message={message} />;
  if (message.role === 'system') return <SystemNotice message={message} />;
  return (
    <AssistantBubble
      message={message}
      onClarificationAnswered={onClarificationAnswered}
    />
  );
}

function UserBubble({ message }: { message: ConversationMessage }) {
  const { t } = usePrefsTranslation();
  return (
    <div
      className="pa-msg pa-msg--user"
      data-pt-agent-message="user"
      data-pt-agent-message-id={message.id}
      data-pt-agent-delivery={message.amended ? 'amended' : undefined}
    >
      <Flex direction="row" align="center" gap={8} className="pa-msg__meta">
        <Text tone="muted" className="pa-msg__time">{message.timestamp}</Text>
        {message.queuePosition !== undefined && (
          <Tag tone="info" data-pt-agent-turn-queue={message.queuePosition}>
            {t('agent.queue.position', { position: message.queuePosition })}
          </Tag>
        )}
        {message.amended && (
          <Tag tone="warning" data-pt-agent-delivery-amended>
            {t('agent.delivery.amended')}
          </Tag>
        )}
      </Flex>
      <div className="pa-msg__bubble pa-msg__bubble--user">
        {message.attachments && message.attachments.length > 0 && (
          <div className="pa-msg__attachments">
            {message.attachments.map((attachment) => (
              <span key={attachment.id} className="pa-attachment">
                <FileTypeGlyph
                  filename={attachment.name}
                  mimeType={attachment.kind === 'image' ? 'image/png' : 'text/markdown'}
                  size={16}
                />
                <Text tone="secondary" truncate className="pa-attachment__name">
                  {attachment.name}
                </Text>
                <Text tone="muted" className="pa-attachment__size">
                  {attachment.sizeLabel}
                </Text>
              </span>
            ))}
          </div>
        )}
        <Text className="pa-msg__text">{message.content}</Text>
      </div>
    </div>
  );
}

function AssistantBubble({
  message,
  onClarificationAnswered,
}: {
  message: ConversationMessage;
  onClarificationAnswered?: (toolId: string, answer: string) => void;
}) {
  const { t } = usePrefsTranslation();
  const streaming = message.status === 'streaming';
  return (
    <div
      className="pa-msg pa-msg--assistant"
      data-pt-agent-message="assistant"
      data-pt-agent-message-id={message.id}
      data-pt-agent-operation-status={message.status}
    >
      <Flex direction="row" align="center" gap={8} className="pa-msg__meta">
        <Icon iconId="bot" size={15} label="Agent" />
        {message.model && <Text tone="muted" className="pa-msg__model">{message.model}</Text>}
        <Text tone="muted" className="pa-msg__time">{message.timestamp}</Text>
        <StatusTag status={message.status} t={t} />
      </Flex>

      <div className="pa-msg__bubble pa-msg__bubble--assistant">
        {message.attribution && (
          <TurnAttributionView entries={message.attribution} />
        )}

        {message.thinking && (
          <Collapsible
            title={(
              <span className="pa-thinking__summary">
                <Icon iconId="brain" size={14} />
                {t('agent.message.thinking')}
                {!message.thinkingDone && <Tag tone="info">{t('agent.message.thinkingLive')}</Tag>}
              </span>
            )}
          >
            <Text tone="secondary" className="pa-thinking__body">{message.thinking}</Text>
          </Collapsible>
        )}

        {message.tools && message.tools.length > 0 && (
          <div className="pa-msg__tools" data-pt-agent-tool-call-group>
            {message.tools.map((tool) => (
              <ToolCallView
                key={tool.id}
                tool={tool}
                onClarificationAnswered={onClarificationAnswered}
              />
            ))}
          </div>
        )}

        {message.content && (
          <Markdown content={message.content} className="pa-msg__markdown" />
        )}

        {streaming && !message.content && (
          <Text tone="muted" className="pa-msg__pending">{t('agent.message.streaming')}</Text>
        )}

        {message.typedError && (
          <Alert
            tone={message.status === 'cancelled' ? 'warning' : 'danger'}
            title={message.typedError.errorType}
            description={message.typedError.text}
            data-pt-agent-message-error={message.typedError.errorType}
            action={(
              <Button
                actionId={`message.retry.${message.id}`}
                emphasis="quiet"
                density="compact"
                leading={<Icon iconId="rotate-ccw" size={13} />}
                label={message.typedError.resolutionLabel}
              />
            )}
          />
        )}

        {message.followUps && message.followUps.length > 0 && (
          <Flex direction="row" gap={8} className="pa-msg__followups">
            {message.followUps.map((followUp) => (
              <Button
                key={followUp}
                actionId={`followup.${message.id}.${followUp}`}
                emphasis="secondary"
                density="compact"
                label={followUp}
              />
            ))}
          </Flex>
        )}
      </div>
    </div>
  );
}

function SystemNotice({ message }: { message: ConversationMessage }) {
  return (
    <div className="pa-msg pa-msg--system" role="status">
      <Text tone="muted" className="pa-msg__system-text">{message.content}</Text>
    </div>
  );
}

function StatusTag({ status, t }: { status: ConversationMessage['status']; t: Translate }) {
  switch (status) {
    case 'queued':
      return <Tag tone="info">{t('agent.status.queued')}</Tag>;
    case 'streaming':
      return <Tag tone="info">{t('agent.status.streaming')}</Tag>;
    case 'failed':
      return <Tag tone="danger">{t('agent.status.failed')}</Tag>;
    case 'cancelled':
      return <Tag tone="warning">{t('agent.status.cancelled')}</Tag>;
    case 'completed':
      return <Tag tone="success">{t('agent.status.completed')}</Tag>;
  }
}

function usePrefsTranslation() {
  const prefs = usePrefs();
  return { t: makeTranslate(prefs.locale) };
}
