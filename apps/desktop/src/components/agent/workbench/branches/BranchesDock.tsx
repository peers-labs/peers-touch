import { useMemo } from 'react';
import { Button, theme } from 'antd';
import { useTranslation } from 'react-i18next';

import { useChatStore, type ChatMessage } from '../../../../store/chat';
import { useWorkbenchTabsStore } from '../../../../store/workbenchTabs';

interface BranchRow {
  message: ChatMessage;
  kind: 'origin' | 'alternate';
}

// Peers-native equivalent of Trae Side Chat: a conversation keeps one
// branching timeline. Regenerating from an earlier message forks a new
// continuation and marks the old legs as superseded. This dock lists the
// real branch markers already projected in the chat store and re-enters a
// line through the existing selectAgentActiveBranch command — no parallel
// session persistence is invented.
function projectBranchRows(messages: readonly ChatMessage[]): BranchRow[] {
  const rows: BranchRow[] = [];
  for (const message of messages) {
    if (message.replacedBy || message.operation === 'branch') {
      rows.push({ message, kind: 'origin' });
    } else if (message.replacementOf) {
      rows.push({ message, kind: 'alternate' });
    }
  }
  return rows.sort((a, b) => b.message.timestamp - a.message.timestamp);
}

function snippetOf(message: ChatMessage): string {
  const text = (message.content || '').trim();
  if (text) return text.replace(/\s+/g, ' ').slice(0, 140);
  if (message.toolName) return message.toolName;
  return message.role;
}

export function BranchesDock() {
  const { token } = theme.useToken();
  const { t, i18n } = useTranslation('chat');
  const active = useWorkbenchTabsStore((s) => s.active === 'branches');
  const messages = useChatStore((s) => s.messages);
  const branchFromMessage = useChatStore((s) => s.branchFromMessage);

  const rows = useMemo(() => projectBranchRows(messages), [messages]);

  if (!active) return null;

  if (rows.length === 0) {
    return (
      <div
        data-pt-workbench-branches-empty
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          padding: 24,
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: 12, color: token.colorTextTertiary, lineHeight: 1.6 }}>
          {t('chat.workbench.branches.empty')}
        </div>
      </div>
    );
  }

  return (
    <div
      data-pt-workbench-branches
      style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '12px 12px 20px' }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {rows.map(({ message, kind }) => {
          const time = new Date(message.timestamp).toLocaleString(i18n.language, {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          });
          return (
            <div
              key={message.id}
              data-pt-workbench-branch-item={message.id}
              data-pt-workbench-branch-kind={kind}
              style={{
                borderRadius: 10,
                border: `1px solid ${token.colorBorderSecondary}`,
                padding: '10px 12px',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
                <span style={{ color: token.colorTextTertiary }}>
                  {kind === 'origin'
                    ? t('chat.workbench.branches.superseded')
                    : t('chat.workbench.branches.alternate')}
                </span>
                <span style={{ color: token.colorTextQuaternary }}>{time}</span>
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: token.colorTextSecondary,
                  lineHeight: 1.5,
                  display: '-webkit-box',
                  WebkitLineClamp: 3,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                }}
              >
                {snippetOf(message)}
              </div>
              <div>
                <Button
                  size="small"
                  data-pt-workbench-branch-switch={message.id}
                  onClick={() => {
                    void branchFromMessage(message.id);
                  }}
                >
                  {t('chat.workbench.branches.switch')}
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
