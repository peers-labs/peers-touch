import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import {
  Wrench,
  Loader2,
  ChevronRight,
  ChevronDown,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RotateCcw,
  Workflow,
  Globe,
  ListChecks,
  Circle,
  CircleDot,
  FilePenLine,
  FilePlus2,
  TerminalSquare,
} from 'lucide-react';
import type { ToolCallInfo, DelegationTaskInfo } from '../../store/chat';
import { ToolExecutionOwner } from '../../gen/proto/domain/agent/agent_pb';
import { useAgentCapabilityStore } from '../../store/agentCapabilities';
import {
  logToolDecisionFailure,
  logToolRecoveryFailure,
  reconnectAgentToolExecutor,
  resolveToolCallProjection,
  submitAgentToolDecision,
  toolRuntime,
} from '../../runtimes/toolRuntime';
import { useTranslation } from 'react-i18next';
import { ClarificationQuestion } from './ClarificationQuestion';

// LobeHub/antd Tag color values mapped to north-star status tones.
type ToolTagTone = 'neutral' | 'success' | 'error' | 'warning' | 'processing';

function ToolTag({ tone = 'neutral', children }: { tone?: ToolTagTone; children: ReactNode }) {
  return <span className={`sc-tool-tag is-${tone}`}>{children}</span>;
}

function tagToneFromStatusColor(color: string): ToolTagTone {
  if (color === 'success') return 'success';
  if (color === 'error') return 'error';
  if (color === 'warning' || color === 'processing') return color;
  return 'neutral';
}

function executionOwnerLocaleKey(owner: ToolExecutionOwner): string {
  if (owner === ToolExecutionOwner.STATION) return 'station';
  if (owner === ToolExecutionOwner.CLIENT_CAPABILITY) return 'clientCapability';
  return 'unknown';
}

function policyLocaleKey(policy: string): string {
  const normalized = policy.trim().toLowerCase();
  if (normalized === 'manual') return 'manual';
  if (normalized === 'allow_list') return 'allowList';
  if (normalized === 'auto') return 'auto';
  if (normalized === 'deny' || normalized === 'disabled') return 'deny';
  return 'unknown';
}

function ToolGovernanceRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="sc-tool-gov-row">
      <span className="sc-tool-gov-row__label">{label}</span>
      <span className="sc-tool-gov-row__value">{value}</span>
    </div>
  );
}

// --- Station builtin tool cards (web_fetch / todo) ---

type TodoCardItem = {
  id?: string;
  content: string;
  status?: string;
  position?: number;
};

function parseTodoPayload(raw: string | undefined): TodoCardItem[] | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as { items?: TodoCardItem[] };
    if (!Array.isArray(parsed.items)) return undefined;
    return [...parsed.items].sort(
      (a, b) => (a.position ?? 0) - (b.position ?? 0),
    );
  } catch {
    return undefined;
  }
}

function TodoToolCard({ tool }: { tool: ToolCallInfo }) {
  const { t } = useTranslation('chat');
  const items =
    parseTodoPayload(tool.result) ?? parseTodoPayload(tool.args) ?? [];
  const doneCount = items.filter((item) => item.status === 'completed').length;

  return (
    <div className="sc-tool-stack sc-tool-subcard" data-pt-agent-tool="todo">
      <div className="sc-tool-row sc-tool-subcard__head">
        <ListChecks size={13} className="sc-tool-subcard__icon" />
        <span className="sc-tool-subcard__title">
          {t('chat.message.toolCall.todo.title')}
        </span>
        <ToolTag>
          {t('chat.message.toolCall.todo.progress', {
            done: doneCount,
            total: items.length,
          })}
        </ToolTag>
      </div>
      {items.length === 0 && (
        <span className="sc-tool-subcard__empty">
          {t('chat.message.toolCall.todo.empty')}
        </span>
      )}
      <div className="sc-tool-stack sc-tool-todo-list">
        {items.map((item, index) => {
          const completed = item.status === 'completed';
          const inProgress = item.status === 'in_progress';
          return (
            <div
              key={item.id || `${item.content}-${index}`}
              className={`sc-tool-todo-item${completed ? ' is-done' : ''}`}
            >
              {completed ? (
                <CheckCircle2 size={13} className="sc-tool-todo-item__icon is-success" />
              ) : inProgress ? (
                <CircleDot size={13} className="sc-tool-todo-item__icon is-processing" />
              ) : (
                <Circle size={13} className="sc-tool-todo-item__icon" />
              )}
              <span className="sc-tool-todo-item__text">{item.content}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WebFetchToolCard({ tool }: { tool: ToolCallInfo }) {
  const { t } = useTranslation('chat');

  let requestedUrl = '';
  try {
    requestedUrl = (JSON.parse(tool.args || '{}') as { url?: string }).url || '';
  } catch {
    requestedUrl = '';
  }
  let fetched: {
    url?: string;
    status?: number;
    content_type?: string;
    truncated?: boolean;
  } = {};
  try {
    fetched = JSON.parse(tool.result || '{}') as typeof fetched;
  } catch {
    fetched = {};
  }
  const displayUrl = fetched.url || requestedUrl;

  return (
    <div className="sc-tool-stack sc-tool-subcard" data-pt-agent-tool="web-fetch">
      <div className="sc-tool-row sc-tool-subcard__head">
        <Globe size={13} className="sc-tool-subcard__icon" />
        <span className="sc-tool-subcard__title">
          {t('chat.message.toolCall.webFetch.title')}
        </span>
        {fetched.status ? (
          <ToolTag tone="success">
            {t('chat.message.toolCall.webFetch.status', { status: fetched.status })}
          </ToolTag>
        ) : null}
      </div>
      {displayUrl && (
        <a
          className="sc-tool-link"
          href={displayUrl}
          target="_blank"
          rel="noreferrer"
          onClick={(event) => event.stopPropagation()}
        >
          {displayUrl}
        </a>
      )}
      {fetched.truncated && (
        <span className="sc-tool-subcard__empty">
          {t('chat.message.toolCall.webFetch.truncated')}
        </span>
      )}
    </div>
  );
}

function parseToolJSON(raw: string | undefined): Record<string, unknown> | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function clientToolOutput(raw: string | undefined): Record<string, unknown> | undefined {
  const envelope = parseToolJSON(raw);
  if (envelope && typeof envelope.output === 'object' && envelope.output !== null) {
    return envelope.output as Record<string, unknown>;
  }
  return envelope;
}

function WorkspaceFileCard({ tool }: { tool: ToolCallInfo }) {
  const { t } = useTranslation('chat');
  const args = parseToolJSON(tool.args);
  const output = clientToolOutput(tool.result);
  const isEdit = tool.name === 'local_file_edit';
  const path = asString(args?.path) || asString(output?.path);
  const oldText = asString(args?.old_string);
  const newText = asString(args?.new_string);
  const writeContent = asString(args?.content);

  return (
    <div className="sc-tool-stack sc-tool-subcard" data-pt-agent-tool="workspace-file">
      <div className="sc-tool-row sc-tool-subcard__head">
        {isEdit ? (
          <FilePenLine size={13} className="sc-tool-subcard__icon" />
        ) : (
          <FilePlus2 size={13} className="sc-tool-subcard__icon" />
        )}
        <span className="sc-tool-subcard__title">
          {t(
            isEdit
              ? 'chat.message.toolCall.workspace.edit'
              : 'chat.message.toolCall.workspace.write',
          )}
        </span>
        <span className="sc-tool-subcard__path">{path}</span>
      </div>
      {isEdit && oldText && (
        <pre className="sc-tool-pre sc-tool-pre--danger">{oldText}</pre>
      )}
      {(isEdit ? newText : writeContent) && (
        <pre className="sc-tool-pre sc-tool-pre--success">
          {isEdit ? newText : writeContent}
        </pre>
      )}
    </div>
  );
}

function WorkspaceShellCard({ tool }: { tool: ToolCallInfo }) {
  const { t } = useTranslation('chat');
  const args = parseToolJSON(tool.args);
  const command = asString(args?.command);
  const argList = Array.isArray(args?.args)
    ? (args!.args as unknown[]).map((value) => asString(value)).filter(Boolean)
    : [];
  const output = clientToolOutput(tool.result);
  const exitCode =
    output && (typeof output.exit_code === 'number' ? output.exit_code : undefined);

  return (
    <div className="sc-tool-stack sc-tool-subcard" data-pt-agent-tool="workspace-shell">
      <div className="sc-tool-row sc-tool-subcard__head">
        <TerminalSquare size={13} className="sc-tool-subcard__icon" />
        <span className="sc-tool-subcard__title">
          {t('chat.message.toolCall.workspace.shell')}
        </span>
        <code className="sc-tool-code">{[command, ...argList].join(' ')}</code>
        {typeof exitCode === 'number' && (
          <ToolTag tone={exitCode === 0 ? 'success' : 'error'}>
            {t('chat.message.toolCall.workspace.exit', { code: exitCode })}
          </ToolTag>
        )}
      </div>
      {typeof output?.stdout === 'string' && output.stdout && (
        <pre className="sc-tool-pre sc-tool-pre--tall">{output.stdout}</pre>
      )}
    </div>
  );
}

// --- Delegation helpers ---

function delegationStatusTone(status: DelegationTaskInfo['status']): ToolTagTone {
  if (status === 'completed') return 'success';
  if (status === 'failed') return 'error';
  if (status === 'timeout') return 'warning';
  return 'neutral';
}

export function DelegationResultsBlock({ results }: { results: DelegationTaskInfo[] }) {
  const { t } = useTranslation('chat');

  return (
    <div className="sc-tool-stack sc-tool-subcard">
      <div className="sc-tool-row sc-tool-subcard__head">
        <Workflow size={13} className="sc-tool-subcard__icon" />
        <span className="sc-tool-subcard__title">
          {t('chat.message.delegation.title')}
        </span>
        <ToolTag>{t('chat.message.delegation.summary', { count: results.length })}</ToolTag>
      </div>
      <div className="sc-tool-stack">
        {results.map((result) => (
          <div key={result.taskId} className="sc-tool-delegation">
            <div className="sc-tool-row sc-tool-delegation__head">
              <span className="sc-tool-delegation__desc">{result.taskDescription}</span>
              <ToolTag tone={delegationStatusTone(result.status)}>
                {t(`chat.message.delegation.status.${result.status}`)}
              </ToolTag>
            </div>
            {result.childToolset.length > 0 && (
              <div className="sc-tool-delegation__meta">
                {t('chat.message.delegation.tools', { tools: result.childToolset.join(', ') })}
              </div>
            )}
            <div className="sc-tool-delegation__meta">
              {t('chat.message.delegation.iterations', { count: result.toolIterations })}
            </div>
            {result.resultSummary && (
              <pre
                className={`sc-tool-pre${result.status === 'failed' ? ' sc-tool-pre--danger' : ''}`}
              >
                {result.resultSummary}
              </pre>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// --- Single tool call row ---

export function ToolCallItem({
  tool: sourceTool,
  messageId,
  turnId,
  onRequestAgain,
}: {
  tool: ToolCallInfo;
  messageId?: string;
  turnId?: string;
  onRequestAgain?: () => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [submittingDecision, setSubmittingDecision] = useState(false);
  const [reconnectingExecutor, setReconnectingExecutor] = useState(false);
  const [requestingAgain, setRequestingAgain] = useState(false);
  const { t, i18n } = useTranslation(['chat', 'agent']);
  const projection = useSyncExternalStore(
    toolRuntime.subscribe,
    () => toolRuntime.getProjection(sourceTool.id),
    () => undefined,
  );
  const tool = resolveToolCallProjection(sourceTool, projection);
  const approvalRequired = tool.status === 'approval_required' && !!tool.approvalId;
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (approvalRequired && tool.name !== 'ask_user') {
      cancelRef.current?.focus({ preventScroll: true });
    }
  }, [approvalRequired, tool.id, tool.name]);
  const executorUnavailable =
    approvalRequired
    && tool.error === 'agent.errors.executorUnavailable';
  const canSubmitDecision = approvalRequired &&
    tool.decisionRevision !== undefined &&
    !submittingDecision;
  const canApprove = canSubmitDecision && !executorUnavailable;
  const approvalDenied =
    tool.status === 'denied'
    && tool.error === 'agent.errors.toolApprovalDenied';
  const denied =
    approvalDenied
    || tool.status === 'error'
    || tool.status === 'expired';
  const approvalExpired =
    tool.status === 'expired'
    && tool.error === 'agent.errors.toolApprovalExpired';
  const unknownSideEffect = tool.status === 'unknown_side_effect';
  const visibleExpanded =
    expanded
    || approvalRequired
    || approvalDenied
    || approvalExpired
    || unknownSideEffect;
  const manifest = useAgentCapabilityStore((state) => {
    if (!tool.manifestId || !tool.manifestVersion) return undefined;
    return state.manifests.find(
      (item) =>
        item.capabilityId === tool.manifestId
        && item.version === tool.manifestVersion,
    );
  });
  const target =
    tool.targetDeviceId
    || tool.serverName
    || manifest?.sourceInstanceId
    || '';
  const expiresAt = tool.expiresAt
    ? new Date(tool.expiresAt)
    : undefined;
  const expiresAtLabel =
    expiresAt && !Number.isNaN(expiresAt.getTime())
      ? new Intl.DateTimeFormat(i18n.language, {
          dateStyle: 'medium',
          timeStyle: 'short',
        }).format(expiresAt)
      : '';
  const governanceVisible = Boolean(
    tool.source
    || target
    || tool.executionOwner !== undefined
    || manifest?.riskClass
    || tool.approvalPolicy
    || expiresAtLabel
    || tool.decisionId
    || tool.readinessSnapshotId,
  );
  const toolErrorMessage = tool.error
    ? (
        tool.error.startsWith('agent.')
          ? t(tool.error, { ns: 'agent' })
          : tool.error
      )
    : '';
  const status = tool.status || (tool.pending ? 'pending' : 'success');
  const statusColor = status === 'success' || status === 'approved'
    ? 'success'
    : status === 'error' || status === 'denied'
      ? 'error'
      : status === 'expired' || status === 'unknown_side_effect'
        ? 'warning'
      : status === 'cancelled'
        ? 'default'
        : status === 'approval_required'
          ? 'warning'
          : 'processing';

  const delegationResults = tool.delegationResults || [];

  return (
    <div
      className="sc-tool-item"
      data-pt-agent-tool-call={tool.id}
      data-pt-agent-tool-turn={turnId}
      data-pt-agent-tool-message={messageId}
    >
      <button
        type="button"
        className="sc-tool-item__toggle"
        data-pt-agent-tool-call-toggle
        aria-expanded={visibleExpanded}
        onClick={() => setExpanded(!visibleExpanded)}
      >
        {visibleExpanded
          ? <ChevronDown size={12} className="sc-tool-item__chevron" />
          : <ChevronRight size={12} className="sc-tool-item__chevron" />}
        {approvalRequired || unknownSideEffect
          ? <AlertTriangle size={12} className="sc-tool-item__status-icon is-warning" />
          : denied
            ? <XCircle size={12} className="sc-tool-item__status-icon is-error" />
            : tool.pending
              ? <Loader2 size={12} className="sc-tool-item__status-icon is-spinning is-processing" />
              : <CheckCircle2 size={12} className="sc-tool-item__status-icon is-success" />}
        <span className="sc-tool-item__name">{tool.name}</span>
        <ToolTag tone={tagToneFromStatusColor(statusColor)}>
          {t(`chat.message.toolCall.status.${status}`)}
        </ToolTag>
        {tool.args && !visibleExpanded && (
          <span className="sc-tool-item__args-ellipsis">
            {tool.args.length > 60 ? tool.args.slice(0, 60) + '…' : tool.args}
          </span>
        )}
      </button>
      {visibleExpanded && (
        <div className="sc-tool-item__body">
          {tool.name === 'ask_user' && <ClarificationQuestion key={tool.id} tool={tool} />}
          {(tool.name === 'todo_write' || tool.name === 'todo_update') && (
            <TodoToolCard key={tool.id} tool={tool} />
          )}
          {tool.name === 'web_fetch' && <WebFetchToolCard key={tool.id} tool={tool} />}
          {(tool.name === 'local_file_write' || tool.name === 'local_file_edit') && (
            <WorkspaceFileCard key={tool.id} tool={tool} />
          )}
          {tool.name === 'local_shell_exec' && (
            <WorkspaceShellCard key={tool.id} tool={tool} />
          )}
          {tool.args && tool.name !== 'ask_user' && tool.name !== 'todo_write' &&
            tool.name !== 'todo_update' && tool.name !== 'web_fetch' &&
            tool.name !== 'local_file_write' && tool.name !== 'local_file_edit' &&
            tool.name !== 'local_shell_exec' && (
            <div className="sc-tool-block">
              <div className="sc-tool-block__label">{t('chat.message.toolCall.arguments')}</div>
              <pre className="sc-tool-pre sc-tool-pre--tall">{tool.args}</pre>
            </div>
          )}
          {tool.serverName && (
            <div className="sc-tool-block">
              <div className="sc-tool-block__label">{t('chat.message.toolCall.server')}</div>
              <span>{tool.serverName}</span>
            </div>
          )}
          {governanceVisible && (
            <div className="sc-tool-governance" data-pt-agent-tool-governance={tool.id}>
              {tool.manifestId && (
                <ToolGovernanceRow
                  label={t('chat.message.toolCall.capability')}
                  value={`${tool.manifestId} @ ${tool.manifestVersion || '?'}`}
                />
              )}
              {target && (
                <ToolGovernanceRow
                  label={t('chat.message.toolCall.target')}
                  value={target}
                />
              )}
              {tool.executionOwner !== undefined && (
                <ToolGovernanceRow
                  label={t('chat.message.toolCall.authority')}
                  value={t(
                    `chat.message.toolCall.executionOwner.${executionOwnerLocaleKey(
                      tool.executionOwner,
                    )}`,
                  )}
                />
              )}
              {manifest?.riskClass && (
                <ToolGovernanceRow
                  label={t('chat.message.toolCall.risk')}
                  value={manifest.riskClass}
                />
              )}
              {tool.approvalPolicy && (
                <ToolGovernanceRow
                  label={t('chat.message.toolCall.policy')}
                  value={t(
                    `chat.message.toolCall.policy.${policyLocaleKey(
                      tool.approvalPolicy,
                    )}`,
                  )}
                />
              )}
              {expiresAtLabel && (
                <ToolGovernanceRow
                  label={t('chat.message.toolCall.expiresAt')}
                  value={expiresAtLabel}
                />
              )}
              {tool.decisionId && (
                <ToolGovernanceRow
                  label={t('chat.message.toolCall.decision')}
                  value={`${tool.decisionId} · r${tool.decisionRevision ?? 0}`}
                />
              )}
              {tool.readinessSnapshotId && (
                <ToolGovernanceRow
                  label={t('chat.message.toolCall.readiness')}
                  value={tool.readinessSnapshotId}
                />
              )}
              {tool.source && (
                <ToolGovernanceRow
                  label={t('chat.message.toolCall.source')}
                  value={tool.source}
                />
              )}
            </div>
          )}
          {tool.approvalActor && (
            <div className="sc-tool-block">
              <div className="sc-tool-block__label">{t('chat.message.toolCall.approval')}</div>
              <span>
                {tool.status === 'denied'
                  ? t('chat.message.toolCall.deniedBy', { actor: tool.approvalActor })
                  : t('chat.message.toolCall.approvedBy', { actor: tool.approvalActor })}
              </span>
            </div>
          )}
          {approvalRequired && tool.approvalId && tool.name !== 'ask_user' && (
            <div className="sc-tool-row sc-tool-decisions">
              <button
                type="button"
                className="sc-tool-btn sc-tool-btn--primary"
                data-pt-agent-tool-decision="approve"
                disabled={!canApprove}
                onClick={(event) => {
                  event.stopPropagation();
                  setExpanded(true);
                  setSubmittingDecision(true);
                  void submitAgentToolDecision(tool.id, true)
                    .catch((error: unknown) => logToolDecisionFailure(tool.id, error))
                    .finally(() => setSubmittingDecision(false));
                }}
              >
                {t('chat.message.toolCall.approve')}
              </button>
              <button
                ref={cancelRef}
                type="button"
                className="sc-tool-btn sc-tool-btn--danger"
                data-pt-agent-tool-recovery="continue-without-tool"
                disabled={!canSubmitDecision}
                onClick={(event) => {
                  event.stopPropagation();
                  setExpanded(true);
                  setSubmittingDecision(true);
                  void submitAgentToolDecision(tool.id, false)
                    .catch((error: unknown) => logToolDecisionFailure(tool.id, error))
                    .finally(() => setSubmittingDecision(false));
                }}
              >
                {t('agent.recovery.continueWithoutTool', { ns: 'agent' })}
              </button>
            </div>
          )}
          {toolErrorMessage && (
            <div className="sc-tool-error" data-pt-agent-tool-error={tool.error}>
              {toolErrorMessage}
            </div>
          )}
          {executorUnavailable && (
            <button
              type="button"
              className="sc-tool-btn sc-tool-btn--neutral"
              data-pt-agent-tool-recovery="reconnect-executor"
              disabled={reconnectingExecutor}
              onClick={(event) => {
                event.stopPropagation();
                setReconnectingExecutor(true);
                void reconnectAgentToolExecutor(tool.id)
                  .catch((error: unknown) =>
                    logToolRecoveryFailure(tool.id, error))
                  .finally(() => setReconnectingExecutor(false));
              }}
            >
              <RotateCcw size={12} />
              {t('agent.recovery.reconnectExecutor', { ns: 'agent' })}
            </button>
          )}
          {approvalExpired && onRequestAgain && (
            <button
              type="button"
              className="sc-tool-btn sc-tool-btn--neutral"
              data-pt-agent-tool-recovery="request-again"
              disabled={requestingAgain}
              onClick={(event) => {
                event.stopPropagation();
                setRequestingAgain(true);
                void onRequestAgain()
                  .catch((error: unknown) =>
                    logToolRecoveryFailure(tool.id, error))
                  .finally(() => setRequestingAgain(false));
              }}
            >
              <RotateCcw size={12} />
              {t('agent.recovery.requestAgain', { ns: 'agent' })}
            </button>
          )}
          {delegationResults.length > 0 && (
            <DelegationResultsBlock results={delegationResults} />
          )}
          {tool.result && tool.name !== 'ask_user' && tool.name !== 'todo_write' &&
            tool.name !== 'todo_update' && tool.name !== 'web_fetch' &&
            tool.name !== 'local_file_write' && tool.name !== 'local_file_edit' &&
            tool.name !== 'local_shell_exec' && (
            <div className="sc-tool-block">
              <div className="sc-tool-block__label">{t('chat.message.toolCall.result')}</div>
              <pre className="sc-tool-pre">{tool.result}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// --- Collapsed tool calls block ---

function hasActionableToolState(
  toolCalls: readonly ToolCallInfo[],
): boolean {
  return toolCalls.some((toolCall) => {
    const status = toolCall.status;
    const error = toolCall.error;
    return (
      status === 'approval_required'
      && Boolean(toolCall.approvalId)
    ) || (
      status === 'denied'
      && error === 'agent.errors.toolApprovalDenied'
    ) || (
      status === 'expired'
      && error === 'agent.errors.toolApprovalExpired'
    ) || (
      status === 'unknown_side_effect'
    );
  });
}

export function ToolCallsBlock({
  toolCalls,
  messageId,
  turnId,
  onRequestAgain,
}: {
  toolCalls: ToolCallInfo[];
  messageId?: string;
  turnId?: string;
  onRequestAgain?: () => Promise<void>;
}) {
  const projections = useSyncExternalStore(
    toolRuntime.subscribe,
    toolRuntime.getSnapshot,
    toolRuntime.getSnapshot,
  );
  const projectedToolCalls = toolCalls.map((toolCall) =>
    resolveToolCallProjection(toolCall, projections[toolCall.id]));
  const actionableToolState = hasActionableToolState(projectedToolCalls);
  const [expanded, setExpanded] = useState(false);
  const { t } = useTranslation('chat');
  const pendingCount = projectedToolCalls.filter((toolCall) =>
    toolCall.pending).length;
  const doneCount = projectedToolCalls.length - pendingCount;
  const visibleExpanded =
    expanded || actionableToolState || pendingCount > 0;

  const summary = pendingCount > 0
    ? t('chat.message.toolCall.using', { count: toolCalls.length })
    : t('chat.message.toolCall.used', { count: doneCount });

  return (
    <div
      className="sc-tool-card"
      data-pt-agent-tool-call-group={turnId}
      data-pt-agent-tool-call-total={toolCalls.length}
      data-pt-agent-tool-call-pending={pendingCount}
    >
      <button
        type="button"
        className="sc-tool-card__toggle"
        data-pt-agent-tool-call-group-toggle
        aria-expanded={visibleExpanded}
        onClick={() => setExpanded(!visibleExpanded)}
      >
        {visibleExpanded
          ? <ChevronDown size={13} className="sc-tool-card__chevron" />
          : <ChevronRight size={13} className="sc-tool-card__chevron" />}
        <Wrench size={13} className="sc-tool-card__wrench" />
        <span>{summary}</span>
        {pendingCount > 0 && (
          <Loader2 size={12} className="sc-tool-card__spinner is-spinning" />
        )}
      </button>
      {visibleExpanded && (
        <div className="sc-tool-card__items">
          {toolCalls.map((tc) => (
            <ToolCallItem
              key={tc.id}
              tool={tc}
              messageId={messageId}
              turnId={turnId}
              onRequestAgain={onRequestAgain}
            />
          ))}
        </div>
      )}
      {projectedToolCalls.filter((tool) => (
        tool.decisionId && !tool.pending && tool.status !== 'approval_required'
      )).map((tool) => (
        <div
          key={tool.id}
          role="status"
          className="sc-tool-card__receipt"
          data-pt-agent-tool-receipt={tool.id}
          data-pt-agent-tool-receipt-status={tool.status}
        >
          {tool.name} · {t(`chat.message.toolCall.status.${tool.status}`)}
        </div>
      ))}
    </div>
  );
}
