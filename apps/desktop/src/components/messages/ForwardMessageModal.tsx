import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import { Input, toast } from '@lobehub/ui';
import { Modal, theme } from 'antd';
import { Search } from 'lucide-react';
import type { ChatMessage } from '../../store/chat';
import { useChatStore } from '../../store/chat';
import { useAgentStore } from '../../store/agent';
import { AgentIconTile } from '../agent/AgentIconTile';
import { buildForwardedContent } from '../../utils/forwardContent';
import { openAgentChatSession } from '../../utils/openAgentChatSession';

interface ForwardMessageModalProps {
  open: boolean;
  messages: ChatMessage[];
  onClose: () => void;
}

// Forward one or more agent messages into another agent's new conversation
// (R9). Mirrors LobeHub forwardMessages: serialize to a Markdown transcript,
// pick a target agent, open a fresh session and send. No new backend — the
// target session's sendMessage persists via conversation_created. Agent-scoped.
export function ForwardMessageModal({ open, messages, onClose }: ForwardMessageModalProps) {
  const { token } = theme.useToken();
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
      if (ok) toast.success(t('chat.messageForward.success', { name: target.title || target.name }));
    } catch {
      toast.error(t('chat.messageForward.error'));
    }
  };

  return (
    <Modal open={open} onCancel={onClose} footer={null} title={t('chat.messageForward.title')} width={420}>
      <Flexbox data-pt-agent-forward-modal gap={12} style={{ paddingTop: 4 }}>
        <Input
          data-pt-agent-forward-search
          prefix={<Search size={15} />}
          placeholder={t('chat.messageForward.searchPlaceholder')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Flexbox gap={2} style={{ maxHeight: 360, overflowY: 'auto' }}>
          {targets.length === 0 && (
            <div style={{ padding: '20px 0', textAlign: 'center', color: token.colorTextTertiary, fontSize: 13 }}>
              {t('chat.messageForward.empty')}
            </div>
          )}
          {targets.map((agent) => (
            <Flexbox
              data-pt-agent-forward-target={agent.id}
              key={agent.id}
              horizontal
              align="center"
              gap={10}
              onClick={() => void handlePick(agent.name)}
              style={{
                padding: '8px 10px',
                borderRadius: token.borderRadius,
                cursor: 'pointer',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = token.colorFillTertiary)}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <AgentIconTile agent={agent} size={32} />
              <Flexbox style={{ minWidth: 0 }}>
                <span style={{ fontSize: 13, fontWeight: 500, color: token.colorText }}>
                  {agent.title || agent.name}
                </span>
                {agent.description && (
                  <span
                    style={{
                      fontSize: 12,
                      color: token.colorTextTertiary,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {agent.description}
                  </span>
                )}
              </Flexbox>
            </Flexbox>
          ))}
        </Flexbox>
      </Flexbox>
    </Modal>
  );
}
