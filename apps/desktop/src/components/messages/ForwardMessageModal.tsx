import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, TextField } from '@peers-touch/ui';
import { Search } from 'lucide-react';
import type { ChatMessage } from '../../store/chat';
import { useChatStore } from '../../store/chat';
import { useAgentStore } from '../../store/agent';
import { AgentIconTile } from '../agent/AgentIconTile';
import { buildForwardedContent } from '../../utils/forwardContent';
import { openAgentChatSession } from '../../utils/openAgentChatSession';
import { notifySuccess, notifyError } from '../../ui/feedback';

interface ForwardMessageModalProps {
  open: boolean;
  messages: ChatMessage[];
  onClose: () => void;
}

// Forward one or more agent messages into another agent's new conversation
// (R9). Serialize to a Markdown transcript, pick a target agent, open a fresh
// session and send. No new backend — the target session's sendMessage persists
// via conversation_created. Agent-scoped.
export function ForwardMessageModal({ open, messages, onClose }: ForwardMessageModalProps) {
  const { t } = useTranslation('chat');
  const agents = useAgentStore((s) => s.agents);
  const selectedAgent = useAgentStore((s) => s.selectedAgent);
  const [query, setQuery] = useState('');

  const targets = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return agents
      .filter((a) => a.name !== selectedAgent)
      .filter((a) =>
        keyword ? `${a.title} ${a.name} ${a.description}`.toLowerCase().includes(keyword) : true,
      );
  }, [agents, selectedAgent, query]);

  const handlePick = async (agentName: string) => {
    const target = agents.find((a) => a.name === agentName);
    if (!target) return;
    const transcript = buildForwardedContent(messages, t('chat.messageForward.header'));
    if (!transcript.trim()) {
      onClose();
      return;
    }
    onClose();
    try {
      await openAgentChatSession(target, { forceNew: true, reason: 'forward' });
      const ok = useChatStore.getState().sendMessage(transcript);
      if (ok) notifySuccess(t('chat.messageForward.success', { name: target.title || target.name }));
    } catch {
      notifyError(t('chat.messageForward.error'));
    }
  };

  return (
    <Dialog
      open={open}
      onDismiss={onClose}
      title={t('chat.messageForward.title')}
      width={420}
      closeLabel={t('common.action.close', { ns: 'common' })}
    >
      <div className="sc-forward" data-pt-agent-forward-modal>
        <TextField
          data-pt-agent-forward-search
          leading={<Search size={15} />}
          placeholder={t('chat.messageForward.searchPlaceholder')}
          value={query}
          onValueChange={setQuery}
        />
        <div className="sc-forward__list">
          {targets.length === 0 && (
            <div className="sc-forward__empty">{t('chat.messageForward.empty')}</div>
          )}
          {targets.map((agent) => (
            <button
              type="button"
              key={agent.id}
              className="sc-forward__target"
              data-pt-agent-forward-target={agent.id}
              onClick={() => void handlePick(agent.name)}
            >
              <AgentIconTile agent={agent} size={32} />
              <span className="sc-forward__target-body">
                <span className="sc-forward__target-name">
                  {agent.title || agent.name}
                </span>
                {agent.description && (
                  <span className="sc-forward__target-desc">{agent.description}</span>
                )}
              </span>
            </button>
          ))}
        </div>
      </div>
    </Dialog>
  );
}
