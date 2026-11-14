import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Empty, Flex, ScrollArea } from '@peers-touch/ui';
import { makeTranslate, usePrefs } from '../../prefs';
import { seedForTopic } from './conversation-data';
import { Composer, type ComposerDraft } from './Composer';
import { MessageBubble } from './MessageBubble';
import type { ConversationMessage } from './types';

/**
 * Dominant conversation rail: owns the local turn state machine for the
 * prototype. A send appends a user leg immediately; while a turn is
 * streaming the composer explains the FIFO queue and later sends keep a
 * queue position instead of starting parallel execution. Stop cancels the
 * in-flight leg with a cancelled terminal state — never a silent drop.
 */
export function ConversationPane({ topicId, topicTitle }: {
  topicId: string | null;
  topicTitle: string;
}) {
  const prefs = usePrefs();
  const t = makeTranslate(prefs.locale);
  const seed = useMemo(() => (topicId ? seedForTopic(topicId) : []), [topicId]);

  const [messages, setMessages] = useState<readonly ConversationMessage[]>(seed);
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const timers = useRef<number[]>([]);

  useEffect(() => () => timers.current.forEach((timer) => window.clearTimeout(timer)), []);

  // Re-seed when the selected topic changes, mirroring per-topic restoration.
  useEffect(() => {
    timers.current.forEach((timer) => window.clearTimeout(timer));
    timers.current = [];
    setMessages(seed);
    setStreamingId(null);
  }, [seed]);

  const streaming = streamingId !== null;
  const queuedCount = messages.filter((message) => message.status === 'queued').length;

  const stop = useCallback(() => {
    timers.current.forEach((timer) => window.clearTimeout(timer));
    timers.current = [];
    setStreamingId((current) => {
      if (!current) return null;
      setMessages((previous) => previous.map((message) =>
        message.id === current
          ? {
            ...message,
            status: 'cancelled',
            typedError: {
              errorType: 'LIFECYCLE_CANCELLED',
              text: t('agent.stop.cancelled'),
              resolutionLabel: t('agent.stop.restart'),
            },
          }
          : message));
      return null;
    });
  }, [t]);

  const answerClarification = useCallback((messageId: string, toolId: string, answer: string) => {
    setMessages((previous) => previous.map((message) => {
      if (message.id !== messageId || !message.tools) return message;
      return {
        ...message,
        tools: message.tools.map((tool) => (
          tool.id === toolId && tool.clarification
            ? {
              ...tool,
              status: 'completed' as const,
              clarification: { ...tool.clarification, answer },
            }
            : tool
        )),
      };
    }));
  }, []);

  const send = useCallback((draft: ComposerDraft) => {
    const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const userMessage: ConversationMessage = {
      id: `user-${Date.now()}`,
      turnId: `turn-${Date.now()}`,
      role: 'user',
      status: 'completed',
      timestamp: now,
      content: draft.text,
      attachments: draft.attachments.length ? draft.attachments : undefined,
    };

    if (streaming) {
      setMessages((previous) => [
        ...previous,
        { ...userMessage, status: 'queued', queuePosition: queuedCount + 1 },
      ]);
      return;
    }

    const assistantId = `assistant-${Date.now()}`;
    const assistantMessage: ConversationMessage = {
      id: assistantId,
      turnId: userMessage.turnId,
      role: 'assistant',
      status: 'streaming',
      timestamp: now,
      model: draft.modelId,
      content: '',
      thinking: draft.fullAccess
        ? t('agent.reply.fullAccessThinking')
        : t('agent.reply.thinking'),
      thinkingDone: false,
    };

    setMessages((previous) => [...previous, userMessage, assistantMessage]);
    setStreamingId(assistantId);

    const timer = window.setTimeout(() => {
      setMessages((previous) => previous.map((message) =>
        message.id === assistantId
          ? {
            ...message,
            status: 'completed',
            thinkingDone: true,
            content: t('agent.reply.ack', {
              workspace: draft.workspaceId,
              model: draft.modelId,
            }),
          }
          : message.status === 'queued'
            ? { ...message, status: 'completed', queuePosition: undefined }
            : message));
      setStreamingId(null);
    }, 1600);
    timers.current.push(timer);
  }, [queuedCount, streaming, t]);

  if (!topicId) {
    return (
      <Flex className="pa-conversation-pane" direction="column">
        <Empty className="pa-conversation__empty" description={t('agent.conversation.empty')} />
      </Flex>
    );
  }

  return (
    <Flex className="pa-conversation-pane" direction="column">
      <ScrollArea className="pa-message-list">
        <div className="pa-message-list__inner" aria-label={topicTitle}>
          {messages.map((message) => (
            <MessageBubble
              key={message.id}
              message={message}
              onClarificationAnswered={(toolId, answer) =>
                answerClarification(message.id, toolId, answer)}
            />
          ))}
        </div>
      </ScrollArea>
      <Composer
        streaming={streaming}
        blockedReason={streaming ? t('agent.composer.blocked', { count: queuedCount }) : undefined}
        onSend={send}
        onStop={stop}
      />
    </Flex>
  );
}
