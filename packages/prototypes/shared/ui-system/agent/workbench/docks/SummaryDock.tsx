/**
 * SummaryDock — task overview projected from the live conversation.
 *
 * Parity with production TaskSummaryDock: every metric is derived from the
 * turn/tool-call stream, no backend "task summary" or token/TODO metric is
 * invented. Error and pending-approval tiles are tone-tinted only when > 0.
 */
import { Descriptions, Empty, Grid, ScrollArea, Statistic, Text } from '@peers-touch/ui';
import { makeTranslate, usePrefs } from '../../../prefs';
import type { ConversationMessage } from '../../conversation/types';
import { projectSummary } from '../types';

interface SummaryDockProps {
  messages: readonly ConversationMessage[];
  title: string;
  agentName: string;
}

interface MetricTile {
  key: string;
  label: string;
  value: number;
  tone?: 'danger' | 'warning';
}

export function SummaryDock({ messages, title, agentName }: SummaryDockProps) {
  const prefs = usePrefs();
  const t = makeTranslate(prefs.locale);
  const summary = projectSummary(messages, title, agentName);

  if (!summary) {
    return (
      <div className="pa-wb-dock pa-wb-dock--centered" data-pt-wb-summary-empty>
        <Empty description={t('agent.wb.summary.empty')} />
      </div>
    );
  }

  const metrics: MetricTile[] = [
    { key: 'turns', label: t('agent.wb.summary.turns'), value: summary.turns },
    { key: 'replies', label: t('agent.wb.summary.replies'), value: summary.replies },
    { key: 'tools', label: t('agent.wb.summary.toolCalls'), value: summary.toolCalls },
    {
      key: 'errors', label: t('agent.wb.summary.toolErrors'), value: summary.toolErrors,
      tone: summary.toolErrors > 0 ? 'danger' : undefined,
    },
    {
      key: 'pending', label: t('agent.wb.summary.pending'), value: summary.pendingApprovals,
      tone: summary.pendingApprovals > 0 ? 'warning' : undefined,
    },
    { key: 'queued', label: t('agent.wb.summary.queued'), value: summary.queuedTurns },
  ];

  return (
    <ScrollArea className="pa-wb-dock" data-pt-wb-summary
      data-pt-wb-summary-turns={summary.turns}
      data-pt-wb-summary-tools={summary.toolCalls}
      data-pt-wb-summary-pending={summary.pendingApprovals}>
      <Text strong className="pa-wb-summary__title">{summary.title}</Text>
      <Descriptions
        className="pa-wb-summary__facts"
        items={[
          { id: 'agent', label: t('agent.wb.summary.agent'), content: summary.agentName || '—' },
          { id: 'model', label: t('agent.wb.summary.model'), content: summary.model || '—' },
          {
            id: 'elapsed', label: t('agent.wb.summary.elapsed'),
            content: summary.elapsedLabel ?? '—',
          },
        ]}
      />
      <Grid columns={3} gap={8} className="pa-wb-summary__grid">
        {metrics.map(metric => (
          <div key={metric.key} className="pa-wb-metric" data-tone={metric.tone}
            data-pt-wb-summary-metric={metric.key}>
            <Statistic
              label={metric.label}
              value={metric.value}
              valueStyle={metric.tone ? { color: `var(--pt-${metric.tone})` } : undefined}
            />
          </div>
        ))}
      </Grid>
    </ScrollArea>
  );
}
