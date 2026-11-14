/**
 * BranchesDock — the conversation's branching timeline.
 *
 * Parity with production BranchesDock: regenerating from an earlier message
 * forks a continuation and marks old legs as superseded. Each marker lists
 * its kind (origin/superseded vs alternate), timestamp, a content snippet and
 * a switch entry. The prototype renders deterministic seeded markers; the
 * switch is a local selection, not a parallel session store.
 */
import { useState } from 'react';
import { Button, Empty, Flex, Icon, ScrollArea, Tag, Text } from '@peers-touch/ui';
import { makeTranslate, usePrefs } from '../../../prefs';
import { SEED_BRANCH_ROWS } from '../workbench-data';
import type { BranchRowSeed } from '../types';

export function BranchesDock() {
  const prefs = usePrefs();
  const t = makeTranslate(prefs.locale);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const rows = SEED_BRANCH_ROWS;

  if (rows.length === 0) {
    return (
      <div className="pa-wb-dock pa-wb-dock--centered" data-pt-wb-branches-empty>
        <Empty description={t('agent.wb.branches.empty')} />
      </div>
    );
  }

  return (
    <ScrollArea className="pa-wb-dock" data-pt-wb-branches>
      <Flex direction="column" gap={8}>
        {rows.map((row: BranchRowSeed) => {
          const isOrigin = row.kind === 'origin';
          const selected = selectedId === row.id;
          return (
            <Flex key={row.id} direction="column" gap={8}
              className="pa-wb-branch" data-pt-wb-branch-item={row.id}
              data-pt-wb-branch-kind={row.kind} data-selected={selected || undefined}>
              <Flex direction="row" align="center" gap={8}>
                <Tag tone={isOrigin ? 'warning' : 'info'}>
                  {isOrigin ? t('agent.wb.branches.superseded') : t('agent.wb.branches.alternate')}
                </Tag>
                <Text tone="muted" className="pa-wb-branch__time">{formatTime(row.at, prefs.locale)}</Text>
                {selected && <Tag tone="success" className="pa-wb-branch__current">{t('agent.wb.branches.current')}</Tag>}
              </Flex>
              <Text tone="secondary" className="pa-wb-branch__snippet">{row.snippet}</Text>
              <Flex direction="row" justify="flex-start">
                <Button actionId={`wb.branch.switch.${row.id}`} emphasis="quiet" density="compact"
                  label={t('agent.wb.branches.switch')}
                  leading={<Icon iconId="git-branch" size={13} />}
                  data-pt-wb-branch-switch={row.id}
                  onActivate={() => setSelectedId(row.id)} />
              </Flex>
            </Flex>
          );
        })}
      </Flex>
    </ScrollArea>
  );
}

function formatTime(iso: string, locale: string): string {
  return new Date(iso).toLocaleString(locale === 'zh-CN' ? 'zh-CN' : 'en', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}
