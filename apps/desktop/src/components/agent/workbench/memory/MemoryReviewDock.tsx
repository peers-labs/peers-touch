import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge, Button, Empty, Spin, Tag, theme } from 'antd';
import { Check, Brain, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useAgentStore } from '../../../../store/agent';
import {
  AGENT_MEMORY_STATUS_CANDIDATE,
  AGENT_MEMORY_STATUS_CONFIRMED,
  AGENT_MEMORY_STATUS_REJECTED,
  type AgentMemoryEntry,
  listAgentMemories,
  reviewAgentMemory,
} from '../../../../services/desktop_api';

const POLL_MS = 12_000;

// TW-D7: heuristically extracted memories are born as candidates and never
// reach a Turn until a human confirms them here. Rejected entries are retained
// for audit but are never injected. The dock is a read-on-evidence review
// queue over the station-owned memory lifecycle, not a local second store.
export function MemoryReviewDock() {
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');
  const agentId = useAgentStore((state) => state.selectedAgent);

  const [open, setOpen] = useState(false);
  const [candidates, setCandidates] = useState<AgentMemoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [actingId, setActingId] = useState<string | null>(null);
  const agentRef = useRef(agentId);
  agentRef.current = agentId;

  const refresh = useCallback(async () => {
    const id = agentRef.current;
    if (!id) return;
    setLoading(true);
    try {
      const items = await listAgentMemories(id, AGENT_MEMORY_STATUS_CANDIDATE);
      setCandidates(items.filter((item) => item.status === 'candidate'));
    } catch {
      // The review queue is non-critical: fail closed to an empty queue rather
      // than surface fabricated candidates.
      setCandidates([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!agentId) return undefined;
    void refresh();
    const timer = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [agentId, refresh]);

  const decide = useCallback(
    async (memoryId: string, statusCode: typeof AGENT_MEMORY_STATUS_CONFIRMED | typeof AGENT_MEMORY_STATUS_REJECTED) => {
      if (!agentId) return;
      setActingId(memoryId);
      try {
        await reviewAgentMemory(agentId, memoryId, statusCode);
        setCandidates((current) => current.filter((item) => item.memoryId !== memoryId));
      } finally {
        setActingId(null);
      }
    },
    [agentId],
  );

  return (
    <>
      <div
        data-pt-memory-dock
        style={{ position: 'absolute', right: 14, bottom: 112, zIndex: 2 }}
      >
        <Badge count={candidates.length} size="small" offset={[-2, 2]}>
          <Button
            data-pt-memory-toggle
            type={open ? 'primary' : 'default'}
            shape="circle"
            size="large"
            icon={<Brain size={16} />}
            onClick={() => setOpen((value) => !value)}
            title={t('chat.memory.dock.title')}
            aria-label={t('chat.memory.dock.title')}
            style={{
              border: 0,
              background: open ? token.colorPrimary : token.colorFillQuaternary,
              color: open ? token.colorPrimaryText : token.colorTextSecondary,
            }}
          />
        </Badge>
      </div>
      {open ? (
        <div
          data-pt-memory-panel
          style={{
            position: 'absolute',
            right: 14,
            bottom: 156,
            width: 340,
            maxHeight: '46vh',
            overflowY: 'auto',
            zIndex: 3,
            background: token.colorBgElevated,
            border: `1px solid ${token.colorBorderSecondary}`,
            borderRadius: 10,
            boxShadow: token.boxShadowSecondary,
            padding: 12,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <strong>{t('chat.memory.panel.title')}</strong>
            <Button size="small" type="text" onClick={() => void refresh()} loading={loading}>
              {t('chat.memory.refresh')}
            </Button>
          </div>
          {loading && candidates.length === 0 ? (
            <Spin size="small" />
          ) : candidates.length === 0 ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={t('chat.memory.empty')}
              data-pt-memory-empty
            />
          ) : (
            candidates.map((item) => (
              <div
                key={item.memoryId}
                data-pt-memory-candidate={item.memoryId}
                style={{
                  border: `1px solid ${token.colorBorderSecondary}`,
                  borderRadius: 8,
                  padding: 8,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}
              >
                {item.layer ? <Tag>{item.layer}</Tag> : null}
                <div
                  data-pt-memory-content
                  style={{ fontSize: 12, color: token.colorText, whiteSpace: 'pre-wrap' }}
                >
                  {item.content}
                </div>
                <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                  <Button
                    size="small"
                    danger
                    icon={<X size={12} />}
                    loading={actingId === item.memoryId}
                    data-pt-memory-reject={item.memoryId}
                    onClick={() => void decide(item.memoryId, AGENT_MEMORY_STATUS_REJECTED)}
                  >
                    {t('chat.memory.reject')}
                  </Button>
                  <Button
                    size="small"
                    type="primary"
                    icon={<Check size={12} />}
                    loading={actingId === item.memoryId}
                    data-pt-memory-confirm={item.memoryId}
                    onClick={() => void decide(item.memoryId, AGENT_MEMORY_STATUS_CONFIRMED)}
                  >
                    {t('chat.memory.confirm')}
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      ) : null}
    </>
  );
}
