/**
 * MemoryDock — the human review queue for heuristically extracted memories.
 *
 * Parity with production MemoryReviewDock: candidates never reach a Turn
 * until confirmed; rejected entries leave the queue; the queue fails closed
 * to empty rather than fabricating candidates. The prototype keeps the queue
 * in local state seeded from deterministic candidates — no station calls.
 */
import { useState } from 'react';
import {
  Button, Empty, Flex, Icon, IconButton, ScrollArea, Spin, Tag, Text,
} from '@peers-touch/ui';
import { makeTranslate, usePrefs } from '../../../prefs';
import { SEED_MEMORY_CANDIDATES } from '../workbench-data';
import type { MemoryCandidate } from '../types';

export function MemoryDock() {
  const prefs = usePrefs();
  const t = makeTranslate(prefs.locale);
  const [candidates, setCandidates] = useState<readonly MemoryCandidate[]>(SEED_MEMORY_CANDIDATES);
  const [actingId, setActingId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = () => {
    setRefreshing(true);
    window.setTimeout(() => setRefreshing(false), 350);
  };

  const decide = (memoryId: string) => {
    // Local projection of reviewAgentMemory: the entry leaves the candidate
    // queue after either confirmation or rejection.
    setActingId(memoryId);
    window.setTimeout(() => {
      setCandidates(previous => previous.filter(item => item.memoryId !== memoryId));
      setActingId(null);
    }, 200);
  };

  return (
    <div className="pa-wb-dock pa-wb-memory" data-pt-wb-memory-panel>
      <Flex direction="row" align="center" justify="space-between" className="pa-wb-memory__head">
        <Text strong>{t('agent.wb.memory.title')}</Text>
        <Spin active={refreshing} size="small">
          <IconButton actionId="wb.memory.refresh" iconId="refresh-cw" iconSize={13}
            label={t('agent.wb.memory.refresh')} emphasis="quiet" density="compact"
            data-pt-wb-memory-refresh onActivate={refresh} />
        </Spin>
      </Flex>
      <ScrollArea className="pa-wb-memory__list">
        {candidates.length === 0 ? (
          <div className="pa-wb-dock--centered" data-pt-wb-memory-empty>
            <Empty description={t('agent.wb.memory.empty')} />
          </div>
        ) : (
          <Flex direction="column" gap={8}>
            {candidates.map(item => (
              <Flex key={item.memoryId} direction="column" gap={6}
                className="pa-wb-memory__card" data-pt-wb-memory-candidate={item.memoryId}>
                <Tag tone="info" className="pa-wb-memory__layer">{item.layer}</Tag>
                <Text className="pa-wb-memory__content" data-pt-wb-memory-content>
                  {item.content}
                </Text>
                <Flex direction="row" gap={6} justify="flex-end">
                  <Button actionId={`wb.memory.reject.${item.memoryId}`} tone="danger" emphasis="quiet"
                    density="compact" label={t('agent.wb.memory.reject')}
                    leading={<Icon iconId="close" size={12} />}
                    data-pt-wb-memory-reject={item.memoryId}
                    availability={actingId === item.memoryId
                      ? { kind: 'disabled', reason: t('agent.wb.memory.title') } : undefined}
                    onActivate={() => decide(item.memoryId)} />
                  <Button actionId={`wb.memory.confirm.${item.memoryId}`} emphasis="primary"
                    density="compact" label={t('agent.wb.memory.confirm')}
                    leading={<Icon iconId="check" size={12} />}
                    data-pt-wb-memory-confirm={item.memoryId}
                    availability={actingId === item.memoryId
                      ? { kind: 'disabled', reason: t('agent.wb.memory.title') } : undefined}
                    onActivate={() => decide(item.memoryId)} />
                </Flex>
              </Flex>
            ))}
          </Flex>
        )}
      </ScrollArea>
    </div>
  );
}
