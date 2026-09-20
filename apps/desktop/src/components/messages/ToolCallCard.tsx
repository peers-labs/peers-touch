import { useState, useSyncExternalStore } from 'react';
import { Flexbox } from 'react-layout-kit';
import { Tag } from '@lobehub/ui';
import { theme } from 'antd';
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
} from 'lucide-react';
import type { ToolCallInfo, DelegationTaskInfo } from '../../store/chat';
import { ToolExecutionOwner } from '../../gen/proto/domain/agent/agent_pb';
import { usePortalStore } from '../../store/portal';
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

function ToolGovernanceRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  const { token } = theme.useToken();
  return (
    <Flexbox horizontal align="flex-start" justify="space-between" gap={12}>
      <span style={{ color: token.colorTextTertiary, fontSize: 11 }}>{label}</span>
      <span
        style={{
          color: token.colorTextSecondary,
          fontSize: 11,
          minWidth: 0,
          overflowWrap: 'anywhere',
          textAlign: 'right',
        }}
      >
        {value}
      </span>
    </Flexbox>
  );
}

// --- Delegation helpers ---

function delegationStatusColor(status: DelegationTaskInfo['status']) {
  if (status === 'completed') return 'success';
  if (status === 'failed') return 'error';
  if (status === 'timeout') return 'warning';
  return 'default';
}

export function DelegationResultsBlock({ results }: { results: DelegationTaskInfo[] }) {
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');

  return (
    <Flexbox gap={6} style={{ marginBottom: 8 }}>
      <Flexbox horizontal align="center" gap={6}>
        <Workflow size={13} style={{ color: token.colorTextSecondary }} />
        <span style={{ fontWeight: 500, color: token.colorTextSecondary }}>
          {t('chat.message.delegation.title')}
        </span>
        <Tag bordered={false} style={{ margin: 0, fontSize: 11 }}>
          {t('chat.message.delegation.summary', { count: results.length })}
        </Tag>
      </Flexbox>
      <Flexbox gap={6}>
        {results.map((result) => (
          <div
            key={result.taskId}
            style={{
              border: `1px solid ${token.colorBorderSecondary}`,
              borderRadius: 6,
              background: token.colorBgContainer,
              padding: '6px 8px',
            }}
          >
            <Flexbox horizontal align="center" gap={6} style={{ marginBottom: 4 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: token.colorText }}>
                {result.taskDescription}
              </span>
              <Tag bordered={false} color={delegationStatusColor(result.status)} style={{ margin: 0, fontSize: 11 }}>
                {t(`chat.message.delegation.status.${result.status}`)}
              </Tag>
            </Flexbox>
            {result.childToolset.length > 0 && (
              <div style={{ fontSize: 11, color: token.colorTextTertiary, marginBottom: 4 }}>
                {t('chat.message.delegation.tools', { tools: result.childToolset.join(', ') })}
              </div>
            )}
            <div style={{ fontSize: 11, color: token.colorTextTertiary, marginBottom: 4 }}>
              {t('chat.message.delegation.iterations', { count: result.toolIterations })}
            </div>
            {result.resultSummary && (
              <pre style={{
                margin: 0,
                padding: '4px 6px',
                borderRadius: 4,
                background: token.colorFillQuaternary,
                color: result.status === 'failed' ? token.colorErrorText : token.colorTextSecondary,
                fontSize: 11,
                overflow: 'auto',
                maxHeight: 140,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}>{result.resultSummary}</pre>
            )}
          </div>
        ))}
      </Flexbox>
    </Flexbox>
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
  const { token } = theme.useToken();
  const { t, i18n } = useTranslation(['chat', 'agent']);
  const projection = useSyncExternalStore(
    toolRuntime.subscribe,
    () => toolRuntime.getProjection(sourceTool.id),
    () => undefined,
  );
  const tool = resolveToolCallProjection(sourceTool, projection);
  const approvalRequired = tool.status === 'approval_required' && !!tool.approvalId;
  const executorUnavailable =
    approvalRequired
    && tool.error === 'agent.errors.executorUnavailable';
  const canSubmitDecision = approvalRequired &&
    tool.decisionRevision !== undefined &&
    !submittingDecision;
  const canApprove = canSubmitDecision && !executorUnavailable;
  const denied =
    tool.status === 'denied'
    || tool.status === 'error'
    || tool.status === 'expired';
  const approvalExpired =
    tool.status === 'expired'
    && tool.error === 'agent.errors.toolApprovalExpired';
  const unknownSideEffect = tool.status === 'unknown_side_effect';
  const visibleExpanded =
    expanded || approvalRequired || approvalExpired || unknownSideEffect;
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
      data-pt-agent-tool-call={tool.id}
      data-pt-agent-tool-turn={turnId}
      style={{ borderRadius: 6, overflow: 'hidden' }}
    >
      <div
        data-pt-agent-tool-call-toggle
        onClick={() => setExpanded(!visibleExpanded)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 8px',
          cursor: 'pointer',
          borderRadius: 6,
          fontSize: 12,
          color: token.colorTextSecondary,
          background: 'transparent',
          transition: 'background 0.15s',
        }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = token.colorFillQuaternary; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
      >
        {visibleExpanded
          ? <ChevronDown size={12} style={{ flexShrink: 0 }} />
          : <ChevronRight size={12} style={{ flexShrink: 0 }} />
        }
        {approvalRequired || unknownSideEffect
          ? <AlertTriangle size={12} style={{ color: token.colorWarning, flexShrink: 0 }} />
          : denied
            ? <XCircle size={12} style={{ color: token.colorError, flexShrink: 0 }} />
            : tool.pending
          ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite', color: token.colorPrimary, flexShrink: 0 }} />
          : <CheckCircle2 size={12} style={{ color: token.colorSuccess, flexShrink: 0 }} />
        }
        <span style={{ fontWeight: 500 }}>{tool.name}</span>
        <Tag bordered={false} color={statusColor} style={{ margin: 0, fontSize: 11 }}>
          {t(`chat.message.toolCall.status.${status}`)}
        </Tag>
        {tool.args && !visibleExpanded && (
          <span style={{ color: token.colorTextQuaternary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 300 }}>
            {tool.args.length > 60 ? tool.args.slice(0, 60) + '…' : tool.args}
          </span>
        )}
        {messageId && (
          <span
            role="button"
            tabIndex={0}
            style={{ marginLeft: 'auto', cursor: 'pointer', color: token.colorTextQuaternary, flexShrink: 0 }}
            onClick={(e) => {
              e.stopPropagation();
              usePortalStore.getState().openToolDetail(messageId, tool.id);
            }}
            title={t('chat.message.toolCall.openPanel')}
          >
            ⋯
          </span>
        )}
      </div>
      {visibleExpanded && (
        <div style={{
          padding: '4px 8px 8px 26px',
          fontSize: 12,
          color: token.colorTextTertiary,
        }}>
          {tool.args && (
            <div style={{ marginBottom: 4 }}>
              <div style={{ fontWeight: 500, marginBottom: 2, color: token.colorTextSecondary }}>{t('chat.message.toolCall.arguments')}</div>
              <pre style={{
                margin: 0,
                padding: '4px 8px',
                borderRadius: 4,
                background: token.colorFillQuaternary,
                fontSize: 11,
                overflow: 'auto',
                maxHeight: 120,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
              }}>{tool.args}</pre>
            </div>
          )}
          {tool.serverName && (
            <div style={{ marginBottom: 4 }}>
              <div style={{ fontWeight: 500, marginBottom: 2, color: token.colorTextSecondary }}>{t('chat.message.toolCall.server')}</div>
              <span>{tool.serverName}</span>
            </div>
          )}
          {governanceVisible && (
            <Flexbox
              data-pt-agent-tool-governance={tool.id}
              gap={4}
              style={{
                borderTop: `1px solid ${token.colorBorderSecondary}`,
                marginBottom: 8,
                marginTop: 6,
                paddingTop: 8,
              }}
            >
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
            </Flexbox>
          )}
          {tool.approvalActor && (
            <div style={{ marginBottom: 4 }}>
              <div style={{ fontWeight: 500, marginBottom: 2, color: token.colorTextSecondary }}>{t('chat.message.toolCall.approval')}</div>
              <span>
                {tool.status === 'denied'
                  ? t('chat.message.toolCall.deniedBy', { actor: tool.approvalActor })
                  : t('chat.message.toolCall.approvedBy', { actor: tool.approvalActor })}
              </span>
            </div>
          )}
          {approvalRequired && tool.approvalId && (
            <Flexbox horizontal gap={8} style={{ marginBottom: 8 }}>
              <button
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
                style={{
                  padding: '4px 10px',
                  borderRadius: 6,
                  border: 'none',
                  background: token.colorPrimary,
                  color: '#fff',
                  cursor: canApprove ? 'pointer' : 'not-allowed',
                  fontSize: 12,
                }}
              >
                {t('chat.message.toolCall.approve')}
              </button>
              <button
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
                style={{
                  padding: '4px 10px',
                  borderRadius: 6,
                  border: `1px solid ${token.colorErrorBorder}`,
                  background: token.colorErrorBg,
                  color: token.colorErrorText,
                  cursor: 'pointer',
                  fontSize: 12,
                }}
              >
                {t('agent.recovery.continueWithoutTool', { ns: 'agent' })}
              </button>
            </Flexbox>
          )}
          {toolErrorMessage && (
            <div
              data-pt-agent-tool-error={tool.error}
              style={{ marginBottom: 8, color: token.colorErrorText }}
            >
              {toolErrorMessage}
            </div>
          )}
          {executorUnavailable && (
            <button
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
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 10px',
                marginBottom: 8,
                borderRadius: 6,
                border: `1px solid ${token.colorBorder}`,
                background: token.colorBgContainer,
                color: token.colorText,
                cursor: reconnectingExecutor ? 'not-allowed' : 'pointer',
                fontSize: 12,
              }}
            >
              <RotateCcw size={12} />
              {t('agent.recovery.reconnectExecutor', { ns: 'agent' })}
            </button>
          )}
          {approvalExpired && onRequestAgain && (
            <button
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
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 10px',
                marginBottom: 8,
                borderRadius: 6,
                border: `1px solid ${token.colorBorder}`,
                background: token.colorBgContainer,
                color: token.colorText,
                cursor: requestingAgain ? 'not-allowed' : 'pointer',
                fontSize: 12,
              }}
            >
              <RotateCcw size={12} />
              {t('agent.recovery.requestAgain', { ns: 'agent' })}
            </button>
          )}
          {delegationResults.length > 0 && (
            <DelegationResultsBlock results={delegationResults} />
          )}
          {tool.result && (
            <div>
              <div style={{ fontWeight: 500, marginBottom: 2, color: token.colorTextSecondary }}>{t('chat.message.toolCall.result')}</div>
              <pre style={{
                margin: 0,
                padding: '4px 8px',
                borderRadius: 4,
                background: token.colorFillQuaternary,
                fontSize: 11,
                overflow: 'auto',
                maxHeight: 160,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
              }}>{tool.result}</pre>
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
  const { token } = theme.useToken();
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
      data-pt-agent-tool-call-group={turnId}
      style={{
        borderRadius: 8,
        border: `1px solid ${token.colorBorderSecondary}`,
        background: token.colorFillQuaternary,
        marginBottom: 8,
        overflow: 'hidden',
      }}
    >
      <div
        data-pt-agent-tool-call-group-toggle
        onClick={() => setExpanded(!visibleExpanded)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 10px',
          cursor: 'pointer',
          fontSize: 12,
          fontWeight: 500,
          color: token.colorTextSecondary,
        }}
      >
        {visibleExpanded
          ? <ChevronDown size={13} style={{ flexShrink: 0 }} />
          : <ChevronRight size={13} style={{ flexShrink: 0 }} />
        }
        <Wrench size={13} style={{ flexShrink: 0, color: token.colorTextTertiary }} />
        <span>{summary}</span>
        {pendingCount > 0 && (
          <Loader2 size={12} style={{ animation: 'spin 1s linear infinite', color: token.colorPrimary, marginLeft: 'auto' }} />
        )}
      </div>
      {visibleExpanded && (
        <div style={{ padding: '0 4px 4px', borderTop: `1px solid ${token.colorBorderSecondary}` }}>
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
    </div>
  );
}
