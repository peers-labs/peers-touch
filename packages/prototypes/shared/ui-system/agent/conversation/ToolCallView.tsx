import type { IconId } from '@peers-touch/ui-assets';
import {
  Alert, Button, Card, CodeDiff, Icon, Spin, Tag, TerminalSurface, Text,
} from '@peers-touch/ui';
import { makeTranslate, usePrefs, type Translate } from '../../prefs';
import { ClarificationView } from './ClarificationView';
import type { ToolCallView as ToolModel, ToolKind, ToolStatus } from './types';

const KIND_ICON: Record<ToolKind, IconId> = {
  shell: 'terminal',
  'file-write': 'edit',
  'file-read': 'file-text',
  'web-fetch': 'globe',
  todo: 'list-checks',
  clarification: 'message-square-text',
  delegation: 'users',
};

const STATUS_TONE: Record<ToolStatus, 'info' | 'warning' | 'success' | 'danger' | 'neutral'> = {
  running: 'info',
  approval_required: 'warning',
  completed: 'success',
  failed: 'danger',
  cancelled: 'warning',
};

function statusLabel(status: ToolStatus, t: Translate): string {
  const map: Record<ToolStatus, string> = {
    running: t('agent.tool.running'),
    approval_required: t('agent.tool.approval'),
    completed: t('agent.tool.completed'),
    failed: t('agent.tool.failed'),
    cancelled: t('agent.tool.cancelled'),
  };
  return map[status];
}

/**
 * One tool call card. All production card families (shell / file / fetch /
 * todo / clarification / delegation) map onto peers-ui primitives; the new
 * TerminalSurface owns shell output and CodeDiff owns file changes.
 */
export function ToolCallView({
  tool,
  onClarificationAnswered,
}: {
  tool: ToolModel;
  onClarificationAnswered?: (toolId: string, answer: string) => void;
}) {
  const { t } = usePrefsTranslation();
  const running = tool.status === 'running';

  return (
    <Card
      flat
      className="pa-tool"
      headerClassName="pa-tool__header"
      data-pt-tool-name={tool.title}
      data-pt-tool-status={tool.status}
      heading={(
        <span className="pa-tool__head">
          <Icon iconId={KIND_ICON[tool.kind]} size={15} className="pa-tool__icon" />
          <Text strong className="pa-tool__title">{tool.title}</Text>
        </span>
      )}
      actions={(
        <Tag tone={STATUS_TONE[tool.status]} data-pt-tool-status-tag={tool.status}>
          {running && <Spin size="small" active label="" />}
          {statusLabel(tool.status, t)}
        </Tag>
      )}
    >
      {tool.kind === 'clarification' && tool.clarification && (
        <ClarificationView
          model={tool.clarification}
          onAnswered={(answer) => onClarificationAnswered?.(tool.id, answer)}
        />
      )}

      {tool.kind === 'shell' && (
        <ShellBody tool={tool} />
      )}

      {tool.kind === 'file-write' && (
        <FileWriteBody tool={tool} />
      )}

      {tool.kind === 'file-read' && (
        <div className="pa-tool__row">
          <Icon iconId="file-text" size={14} />
          <Text tone="secondary" truncate>{tool.path}</Text>
        </div>
      )}

      {tool.kind === 'web-fetch' && (
        <div className="pa-tool__row">
          <Icon iconId="globe" size={14} />
          <Text tone="secondary" truncate>{tool.path}</Text>
          <Icon iconId="external-link" size={13} label={t('agent.tool.openSource')} />
        </div>
      )}

      {tool.kind === 'todo' && (
        <div className="pa-tool__row">
          <Icon iconId="list-checks" size={14} />
          <Text tone="secondary">{tool.path}</Text>
        </div>
      )}

      {tool.kind === 'delegation' && (
        <Text tone="secondary" className="pa-tool__delegation">
          {tool.delegationSummary}
        </Text>
      )}

      {(tool.status === 'failed' || tool.status === 'cancelled') && tool.errorText && (
        <Alert
          tone={tool.status === 'cancelled' ? 'warning' : 'danger'}
          title={tool.errorType}
          description={tool.errorText}
          action={tool.resolutionLabel
            ? (
              <Button
                actionId={`tool.retry.${tool.id}`}
                emphasis="quiet"
                density="compact"
                leading={<Icon iconId="rotate-ccw" size={13} />}
                label={tool.resolutionLabel}
              />
            )
            : undefined}
        />
      )}
    </Card>
  );
}

function ShellBody({ tool }: { tool: ToolModel }) {
  const { t } = usePrefsTranslation();
  return (
    <div className="pa-tool__shell">
      <TerminalSurfaceShim tool={tool} />
      <div className="pa-tool__meta">
        {typeof tool.exitCode === 'number' && (
          <Tag tone={tool.exitCode === 0 ? 'success' : 'danger'}>
            {t('agent.tool.exitCode', { code: tool.exitCode })}
          </Tag>
        )}
        {typeof tool.durationMs === 'number' && (
          <Text tone="muted" className="pa-tool__duration">
            {(tool.durationMs / 1000).toFixed(1)}s
          </Text>
        )}
        {tool.stdoutTruncated && <Tag tone="warning">{t('agent.tool.stdoutTruncated')}</Tag>}
        {tool.stderrTruncated && <Tag tone="warning">{t('agent.tool.stderrTruncated')}</Tag>}
      </div>
    </div>
  );
}

function FileWriteBody({ tool }: { tool: ToolModel }) {
  const { t } = usePrefsTranslation();
  return (
    <div className="pa-tool__file">
      <div className="pa-tool__row">
        {tool.changeType && <Tag tone="info">{tool.changeType}</Tag>}
        <Text tone="secondary" truncate>{tool.path}</Text>
        {tool.diffTruncated && <Tag tone="warning">{t('agent.tool.diffTruncated')}</Tag>}
      </div>
      {tool.diffBefore !== undefined && tool.diffAfter !== undefined && (
        <CodeDiff
          before={tool.diffBefore}
          after={tool.diffAfter}
          beforeLabel={t('agent.tool.before')}
          afterLabel={t('agent.tool.after')}
        />
      )}
      <div className="pa-tool__meta pa-tool__digests">
        {tool.beforeDigest && <Text tone="muted" className="pa-tool__digest">{tool.beforeDigest}</Text>}
        {tool.afterDigest && <Text tone="muted" className="pa-tool__digest">{tool.afterDigest}</Text>}
      </div>
    </div>
  );
}

function TerminalSurfaceShim({ tool }: { tool: ToolModel }) {
  return (
    <TerminalSurface
      lines={(tool.lines ?? []).map((line) => ({
        id: line.id,
        stream: line.stream,
        text: line.text,
      }))}
      status={tool.status === 'completed'
        ? 'exited'
        : tool.status === 'cancelled'
          ? 'killed'
          : tool.status === 'failed'
            ? 'exited'
            : 'running'}
      exitCode={tool.exitCode}
      command={tool.command}
      cwd={tool.cwd}
      maxHeight={200}
    />
  );
}

function usePrefsTranslation() {
  const prefs = usePrefs();
  return { t: makeTranslate(prefs.locale) };
}
