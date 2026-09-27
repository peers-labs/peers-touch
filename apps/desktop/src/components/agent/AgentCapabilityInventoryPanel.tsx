/* eslint-disable react-refresh/only-export-components */
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import { Alert, Empty, Select, Switch, message as antMessage, theme } from 'antd';
import { Button, Tag } from '@lobehub/ui';
import {
  BookOpen,
  Cpu,
  Monitor,
  Package,
  Plug,
  RefreshCw,
  Sparkles,
  Wrench,
  type LucideIcon,
} from 'lucide-react';

import {
  CapabilityApprovalPolicy,
  CapabilityAvailability,
  type CapabilityCatalogIssue,
  CapabilityReadinessState,
  CapabilitySourceKind,
  type AgentCapabilityBinding,
  type CapabilityManifest,
  type CapabilityReadiness,
} from '../../gen/proto/domain/agent/capability_pb';
import type { AgentCapabilityState } from '../../store/agentCapabilities';
import type { AgentTypedErrorPayload } from '../../services/desktop_api';

interface CapabilitySourcePresentation {
  icon: LucideIcon;
  iconKey: string;
  localeKey: string;
  order: number;
}

const UNKNOWN_SOURCE_PRESENTATION: CapabilitySourcePresentation = {
  icon: Package,
  iconKey: 'unknown',
  localeKey: 'unknown',
  order: Number.MAX_SAFE_INTEGER,
};

const SOURCE_PRESENTATIONS = new Map<
  CapabilitySourceKind,
  CapabilitySourcePresentation
>([
  [CapabilitySourceKind.BUILTIN_TOOL, {
    icon: Wrench,
    iconKey: 'builtin-tool',
    localeKey: 'builtinTool',
    order: 0,
  }],
  [CapabilitySourceKind.CLIENT_NATIVE, {
    icon: Monitor,
    iconKey: 'client-native',
    localeKey: 'clientNative',
    order: 1,
  }],
  [CapabilitySourceKind.MCP, {
    icon: Cpu,
    iconKey: 'mcp',
    localeKey: 'mcp',
    order: 2,
  }],
  [CapabilitySourceKind.CONNECTOR, {
    icon: Plug,
    iconKey: 'connector',
    localeKey: 'connector',
    order: 3,
  }],
  [CapabilitySourceKind.SKILL, {
    icon: Sparkles,
    iconKey: 'skill',
    localeKey: 'skill',
    order: 4,
  }],
  [CapabilitySourceKind.KNOWLEDGE, {
    icon: BookOpen,
    iconKey: 'knowledge',
    localeKey: 'knowledge',
    order: 5,
  }],
]);

const APPROVAL_POLICY_OPTIONS = [
  CapabilityApprovalPolicy.MANUAL,
  CapabilityApprovalPolicy.ALLOW_LIST,
  CapabilityApprovalPolicy.AUTO,
  CapabilityApprovalPolicy.DENY,
];

export interface CapabilityInventoryItem {
  key: string;
  label: string;
  manifest: CapabilityManifest;
  binding?: AgentCapabilityBinding;
  readiness?: CapabilityReadiness;
}

export type CapabilityCompatibilityState =
  | 'compatible'
  | 'degraded'
  | 'incompatible'
  | 'unknown';

interface AgentCapabilityInventoryPanelProps {
  agentId: string;
  agentVersion: number | bigint;
  manifests: CapabilityManifest[];
  bindings: AgentCapabilityBinding[];
  readiness: CapabilityReadiness[];
  catalogIssues: CapabilityCatalogIssue[];
  lastMutationError: AgentTypedErrorPayload | null;
  pendingMutations: AgentCapabilityState['pendingMutations'];
  loading: boolean;
  loadAgent: AgentCapabilityState['loadAgent'];
  upsertBinding: AgentCapabilityState['upsertBinding'];
  deleteBinding: AgentCapabilityState['deleteBinding'];
  focusCapabilityId?: string;
  focusPermissionKind?: string;
  focusRequestId?: string;
}

function capabilityKey(capabilityId: string, version: string): string {
  return `${encodeURIComponent(capabilityId)}@${encodeURIComponent(version)}`;
}

function capabilityLabel(manifest: CapabilityManifest): string {
  return (
    manifest.displayMetadata?.name.trim()
    || manifest.sourceInstanceId.trim()
    || manifest.capabilityId
  );
}

function capabilityVersionLabel(version: string): string {
  return version.length > 12 ? `${version.slice(0, 12)}…` : version;
}

function newestBinding(
  current: AgentCapabilityBinding | undefined,
  candidate: AgentCapabilityBinding,
): AgentCapabilityBinding {
  if (!current || candidate.revision > current.revision) return candidate;
  return current;
}

function newestReadiness(
  current: CapabilityReadiness | undefined,
  candidate: CapabilityReadiness,
): CapabilityReadiness {
  if (!current || candidate.bindingRevision > current.bindingRevision) return candidate;
  return current;
}

export function projectCapabilityInventory(
  manifests: CapabilityManifest[],
  bindings: AgentCapabilityBinding[],
  readiness: CapabilityReadiness[],
): CapabilityInventoryItem[] {
  const bindingsByCapability = new Map<string, AgentCapabilityBinding>();
  for (const binding of bindings) {
    if (binding.tombstonedAt) continue;
    const key = capabilityKey(binding.capabilityId, binding.capabilityVersion);
    bindingsByCapability.set(
      key,
      newestBinding(bindingsByCapability.get(key), binding),
    );
  }

  const readinessByCapability = new Map<string, CapabilityReadiness>();
  for (const item of readiness) {
    const key = capabilityKey(item.capabilityId, item.capabilityVersion);
    readinessByCapability.set(
      key,
      newestReadiness(readinessByCapability.get(key), item),
    );
  }

  return manifests
    .filter((manifest) => SOURCE_PRESENTATIONS.has(manifest.sourceKind))
    .map((manifest) => {
      const key = capabilityKey(manifest.capabilityId, manifest.version);
      return {
        key,
        label: capabilityLabel(manifest),
        manifest,
        binding: bindingsByCapability.get(key),
        readiness: readinessByCapability.get(key),
      };
    })
    .sort((left, right) => {
      const sourceDelta =
        capabilitySourcePresentation(left.manifest.sourceKind).order
        - capabilitySourcePresentation(right.manifest.sourceKind).order;
      if (sourceDelta !== 0) return sourceDelta;
      const labelDelta = left.label.localeCompare(right.label);
      if (labelDelta !== 0) return labelDelta;
      const idDelta = left.manifest.capabilityId.localeCompare(right.manifest.capabilityId);
      if (idDelta !== 0) return idDelta;
      return left.manifest.version.localeCompare(right.manifest.version);
    });
}

export function resolveFocusedCapabilityKey(
  items: CapabilityInventoryItem[],
  capabilityId?: string,
): string | undefined {
  if (!capabilityId) return undefined;
  return items.find(
    (item) => item.manifest.capabilityId === capabilityId,
  )?.key;
}

export function capabilitySourcePresentation(
  sourceKind: CapabilitySourceKind,
): CapabilitySourcePresentation {
  return SOURCE_PRESENTATIONS.get(sourceKind) ?? UNKNOWN_SOURCE_PRESENTATION;
}

export function projectCapabilityCompatibility(
  readiness: CapabilityReadiness | undefined,
): CapabilityCompatibilityState {
  switch (readiness?.state) {
    case CapabilityReadinessState.READY:
      return 'compatible';
    case CapabilityReadinessState.DEGRADED:
      return 'degraded';
    case CapabilityReadinessState.UNAVAILABLE:
    case CapabilityReadinessState.BLOCKED:
      return 'incompatible';
    default:
      return 'unknown';
  }
}

export function canBindCapability(manifest: CapabilityManifest): boolean {
  if (manifest.retiredAt) return false;
  return (
    manifest.availability === CapabilityAvailability.AVAILABLE
    || manifest.availability === CapabilityAvailability.DEGRADED
  );
}

export function isCapabilityBindingToggleDisabled(
  item: CapabilityInventoryItem,
  pending: boolean,
): boolean {
  if (pending) return true;
  if (item.binding?.enabled) return false;
  return !canBindCapability(item.manifest);
}

function CapabilitySourceIcon({
  sourceKind,
  size = 16,
}: {
  sourceKind: CapabilitySourceKind;
  size?: number;
}) {
  const presentation = capabilitySourcePresentation(sourceKind);
  const Icon = presentation.icon;
  return <Icon data-capability-source-icon={presentation.iconKey} size={size} />;
}

function readinessLocaleKey(state: CapabilityReadinessState): string {
  switch (state) {
    case CapabilityReadinessState.READY:
      return 'ready';
    case CapabilityReadinessState.DEGRADED:
      return 'degraded';
    case CapabilityReadinessState.UNAVAILABLE:
      return 'unavailable';
    case CapabilityReadinessState.BLOCKED:
      return 'blocked';
    default:
      return 'unknown';
  }
}

function readinessTagColor(
  state: CapabilityReadinessState,
): 'success' | 'warning' | 'error' | undefined {
  if (state === CapabilityReadinessState.READY) return 'success';
  if (state === CapabilityReadinessState.DEGRADED) return 'warning';
  if (
    state === CapabilityReadinessState.UNAVAILABLE
    || state === CapabilityReadinessState.BLOCKED
  ) {
    return 'error';
  }
  return undefined;
}

function availabilityLocaleKey(availability: CapabilityAvailability): string {
  switch (availability) {
    case CapabilityAvailability.AVAILABLE:
      return 'available';
    case CapabilityAvailability.DEGRADED:
      return 'degraded';
    case CapabilityAvailability.UNAVAILABLE:
      return 'unavailable';
    case CapabilityAvailability.BLOCKED:
      return 'blocked';
    default:
      return 'unknown';
  }
}

function approvalPolicyLocaleKey(policy: CapabilityApprovalPolicy): string {
  switch (policy) {
    case CapabilityApprovalPolicy.MANUAL:
      return 'manual';
    case CapabilityApprovalPolicy.ALLOW_LIST:
      return 'allowList';
    case CapabilityApprovalPolicy.AUTO:
      return 'auto';
    case CapabilityApprovalPolicy.DENY:
      return 'deny';
    default:
      return 'unspecified';
  }
}

function riskLocaleKey(riskClass: string): string | undefined {
  const normalized = riskClass.trim().toLowerCase();
  if (normalized === 'low' || normalized === 'medium' || normalized === 'high') {
    return normalized;
  }
  return undefined;
}

function CapabilityInfoRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  const { token } = theme.useToken();
  return (
    <Flexbox horizontal align="flex-start" justify="space-between" gap={16}>
      <span style={{ color: token.colorTextSecondary, fontSize: 12 }}>{label}</span>
      <span
        style={{
          color: token.colorText,
          fontSize: 12,
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

export function AgentCapabilityInventoryPanel({
  agentId,
  agentVersion,
  manifests,
  bindings,
  readiness,
  catalogIssues,
  lastMutationError,
  pendingMutations,
  loading,
  loadAgent,
  upsertBinding,
  deleteBinding,
  focusCapabilityId,
  focusPermissionKind,
  focusRequestId,
}: AgentCapabilityInventoryPanelProps) {
  const { t } = useTranslation('agent');
  const { token } = theme.useToken();
  const items = useMemo(
    () => projectCapabilityInventory(manifests, bindings, readiness),
    [bindings, manifests, readiness],
  );
  const catalogError = catalogIssues[0]?.error;
  const visibleError = lastMutationError
    ? {
        type: lastMutationError.error_type,
        localeKey: lastMutationError.locale_key,
      }
    : catalogError
      ? {
          type: catalogError.errorType,
          localeKey: catalogError.localeKey,
        }
      : null;
  const [selection, setSelection] = useState<{
    handledFocusRequestId?: string;
    key: string;
  }>({ key: '' });
  const focusedKey = resolveFocusedCapabilityKey(items, focusCapabilityId);
  const selectedKey = (
    focusRequestId
    && focusRequestId !== selection.handledFocusRequestId
    && focusedKey
  )
    ? focusedKey
    : selection.key;
  const selected = items.find((item) => item.key === selectedKey) ?? items[0];

  const pending = selected
    ? Boolean(
      pendingMutations[`upsert:${agentId}:${selected.manifest.capabilityId}`]
      || (
        selected.binding
        && pendingMutations[`delete:${agentId}:${selected.binding.bindingId}`]
      ),
    )
    : false;

  const refresh = useCallback(async () => {
    try {
      await loadAgent(agentId);
    } catch (error) {
      antMessage.error(
        error instanceof Error
          ? error.message
          : t('agent.profile.capabilityInventory.actionFailed'),
      );
    }
  }, [agentId, loadAgent, t]);

  const updateBinding = useCallback(async (enabled: boolean) => {
    if (!selected) return;
    try {
      if (!enabled) {
        if (!selected.binding) return;
        await deleteBinding({
          agentId,
          bindingId: selected.binding.bindingId,
          expectedBindingRevision: selected.binding.revision,
          idempotencyKey: crypto.randomUUID(),
          reason: 'agent_profile_capability_unbound',
        });
        antMessage.success(t('agent.profile.capabilityInventory.unbound'));
        return;
      }
      await upsertBinding({
        bindingId: selected.binding?.bindingId,
        agentId,
        capabilityId: selected.manifest.capabilityId,
        capabilityVersion: selected.manifest.version,
        enabled: true,
        approvalPolicy:
          selected.binding?.approvalPolicy
          ?? selected.manifest.defaultApprovalPolicy,
        expectedAgentVersion: agentVersion,
        expectedBindingRevision: selected.binding?.revision ?? 0n,
        idempotencyKey: crypto.randomUUID(),
      });
      antMessage.success(t('agent.profile.capabilityInventory.bound'));
    } catch (error) {
      antMessage.error(
        error instanceof Error
          ? error.message
          : t('agent.profile.capabilityInventory.actionFailed'),
      );
    }
  }, [agentId, agentVersion, deleteBinding, selected, t, upsertBinding]);

  const updateApprovalPolicy = useCallback(async (
    approvalPolicy: CapabilityApprovalPolicy,
  ) => {
    if (!selected?.binding) return;
    try {
      await upsertBinding({
        bindingId: selected.binding.bindingId,
        agentId,
        capabilityId: selected.manifest.capabilityId,
        capabilityVersion: selected.manifest.version,
        enabled: selected.binding.enabled,
        approvalPolicy,
        expectedAgentVersion: agentVersion,
        expectedBindingRevision: selected.binding.revision,
        idempotencyKey: crypto.randomUUID(),
      });
      antMessage.success(t('agent.profile.capabilityInventory.policyUpdated'));
    } catch (error) {
      antMessage.error(
        error instanceof Error
          ? error.message
          : t('agent.profile.capabilityInventory.actionFailed'),
      );
    }
  }, [agentId, agentVersion, selected, t, upsertBinding]);

  const errorNotice = visibleError ? (
    <Alert
      data-pt-agent-capability-error={visibleError.type}
      type="error"
      showIcon
      style={{ gridColumn: '1 / -1' }}
      message={(
        <span data-pt-agent-capability-error-text={visibleError.localeKey}>
          {t(visibleError.localeKey, { defaultValue: visibleError.localeKey })}
        </span>
      )}
      action={(
        <Button
          icon={<RefreshCw size={14} />}
          onClick={() => void refresh()}
          title={t('agent.profile.capabilityInventory.refresh')}
          aria-label={t('agent.profile.capabilityInventory.refresh')}
          size="small"
        />
      )}
    />
  ) : null;

  if (!selected) {
    return (
      <Flexbox gap={10} data-pt-agent-capability-inventory>
        {errorNotice}
        <Empty
          description={t('agent.profile.capabilityInventory.empty')}
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        />
      </Flexbox>
    );
  }

  const readinessState =
    selected.readiness?.state ?? CapabilityReadinessState.UNKNOWN;
  const bindingState = selected.binding
    ? selected.binding.enabled
      ? 'bound'
      : 'disabled'
    : 'unbound';
  const approvalPolicy =
    selected.binding?.approvalPolicy
    ?? selected.manifest.defaultApprovalPolicy;
  const reasonCode = selected.readiness?.reasonCode.trim() ?? '';
  const reasonLabel = reasonCode
    ? t(`agent.profile.capabilityInventory.reason.${reasonCode}`, {
      defaultValue: t('agent.profile.capabilityInventory.reason.other', {
        reasonCode,
      }),
    })
    : t('agent.profile.capabilityInventory.reason.notProjected');
  const riskKey = riskLocaleKey(selected.manifest.riskClass);
  const compatibility = projectCapabilityCompatibility(selected.readiness);

  return (
    <div
      data-pt-agent-capability-inventory
      style={{
        display: 'grid',
        gap: 18,
        gridTemplateColumns: 'repeat(auto-fit, minmax(min(280px, 100%), 1fr))',
        minWidth: 0,
      }}
    >
      {errorNotice}
      <Flexbox gap={8} style={{ minWidth: 0 }}>
        <Flexbox horizontal align="center" justify="space-between" gap={12}>
          <span style={{ color: token.colorText, fontSize: 12, fontWeight: 600 }}>
            {t('agent.profile.capabilityInventory.inventory')}
          </span>
          <Tag style={{ margin: 0 }}>
            {t('agent.profile.capabilityInventory.count', { count: items.length })}
          </Tag>
        </Flexbox>
        <Flexbox
          gap={4}
          style={{ maxHeight: 360, minHeight: 0, overflow: 'auto', paddingRight: 2 }}
        >
          {items.map((item) => {
            const itemReadiness =
              item.readiness?.state ?? CapabilityReadinessState.UNKNOWN;
            const active = item.key === selected.key;
            return (
              <button
                data-pt-agent-capability={item.key}
                key={item.key}
                type="button"
                aria-pressed={active}
                onClick={() => setSelection({
                  handledFocusRequestId: focusRequestId,
                  key: item.key,
                })}
                style={{
                  alignItems: 'center',
                  background: active ? token.colorPrimaryBg : 'transparent',
                  border: 0,
                  borderRadius: 7,
                  color: token.colorText,
                  cursor: 'pointer',
                  display: 'flex',
                  gap: 10,
                  minHeight: 48,
                  padding: '6px 8px',
                  textAlign: 'left',
                  width: '100%',
                }}
              >
                <CapabilitySourceIcon sourceKind={item.manifest.sourceKind} />
                <Flexbox flex={1} gap={1} style={{ minWidth: 0 }}>
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {item.label}
                  </span>
                  <span
                    style={{
                      color: token.colorTextTertiary,
                      fontSize: 11,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {item.manifest.sourceInstanceId || item.manifest.capabilityId}
                    {' @ '}
                    {capabilityVersionLabel(item.manifest.version)}
                  </span>
                </Flexbox>
                <Tag style={{ margin: 0 }}>
                  {t(
                    `agent.profile.capabilityInventory.source.${
                      capabilitySourcePresentation(item.manifest.sourceKind).localeKey
                    }`,
                  )}
                </Tag>
                {item.binding?.enabled ? (
                  <Tag
                    color={readinessTagColor(itemReadiness)}
                    style={{ margin: 0 }}
                  >
                    {t(
                      `agent.profile.capabilityInventory.readiness.${readinessLocaleKey(
                        itemReadiness,
                      )}`,
                    )}
                  </Tag>
                ) : null}
              </button>
            );
          })}
        </Flexbox>
      </Flexbox>

      <Flexbox
        data-pt-agent-capability-detail={selected.key}
        data-pt-agent-capability-permission-kind={
          selected.manifest.capabilityId === focusCapabilityId
            ? focusPermissionKind
            : undefined
        }
        data-pt-agent-capability-source={
          capabilitySourcePresentation(selected.manifest.sourceKind).iconKey
        }
        data-pt-agent-capability-version={selected.manifest.version}
        data-pt-agent-capability-risk={selected.manifest.riskClass || 'unknown'}
        data-pt-agent-capability-binding-state={bindingState}
        gap={14}
        style={{ minWidth: 0 }}
      >
        <Flexbox horizontal align="center" gap={10}>
          <span
            style={{
              alignItems: 'center',
              background: token.colorPrimaryBg,
              borderRadius: 7,
              color: token.colorPrimary,
              display: 'inline-flex',
              height: 30,
              justifyContent: 'center',
              width: 30,
            }}
          >
            <CapabilitySourceIcon sourceKind={selected.manifest.sourceKind} />
          </span>
          <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
            <span
              style={{
                color: token.colorText,
                fontSize: 14,
                fontWeight: 700,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {selected.label}
            </span>
            {selected.manifest.displayMetadata?.description ? (
              <span
                title={selected.manifest.displayMetadata.description}
                style={{
                  color: token.colorTextSecondary,
                  display: '-webkit-box',
                  fontSize: 12,
                  overflow: 'hidden',
                  WebkitBoxOrient: 'vertical',
                  WebkitLineClamp: 3,
                }}
              >
                {selected.manifest.displayMetadata.description}
              </span>
            ) : null}
          </Flexbox>
          <Button
            data-pt-agent-capability-refresh
            aria-label={t('agent.profile.capabilityInventory.refresh')}
            title={t('agent.profile.capabilityInventory.refresh')}
            icon={<RefreshCw size={14} />}
            loading={loading}
            onClick={refresh}
            size="small"
            style={{ height: 30, padding: 0, width: 30 }}
          />
        </Flexbox>

        <Flexbox gap={7}>
          <CapabilityInfoRow
            label={t('agent.profile.capabilityInventory.field.source')}
            value={(
              <span>
                {selected.manifest.sourceInstanceId || selected.manifest.capabilityId}
                {' @ '}
                {selected.manifest.version}
              </span>
            )}
          />
          <CapabilityInfoRow
            label={t('agent.profile.capabilityInventory.field.kind')}
            value={t(
              `agent.profile.capabilityInventory.source.${
                capabilitySourcePresentation(selected.manifest.sourceKind).localeKey
              }`,
            )}
          />
          <CapabilityInfoRow
            label={t('agent.profile.capabilityInventory.field.availability')}
            value={t(
              `agent.profile.capabilityInventory.availability.${availabilityLocaleKey(
                selected.manifest.availability,
              )}`,
            )}
          />
          <CapabilityInfoRow
            label={t('agent.profile.capabilityInventory.field.risk')}
            value={
              riskKey
                ? t(`agent.profile.capabilityInventory.risk.${riskKey}`)
                : selected.manifest.riskClass || t('agent.profile.unknown')
            }
          />
          <CapabilityInfoRow
            label={t('agent.profile.capabilityInventory.field.runtimeRequirements')}
            value={
              selected.manifest.requiredRuntimeCapabilities.length > 0
                ? selected.manifest.requiredRuntimeCapabilities.join(', ')
                : t('agent.profile.capabilityInventory.none')
            }
          />
        </Flexbox>

        <Flexbox
          gap={10}
          style={{
            borderTop: `1px solid ${token.colorBorderSecondary}`,
            paddingTop: 12,
          }}
        >
          <Flexbox horizontal align="center" justify="space-between" gap={16}>
            <Flexbox gap={2}>
              <span style={{ color: token.colorText, fontSize: 12, fontWeight: 600 }}>
                {t('agent.profile.capabilityInventory.binding.title')}
              </span>
              <span style={{ color: token.colorTextSecondary, fontSize: 12 }}>
                {t(`agent.profile.capabilityInventory.binding.${bindingState}`)}
              </span>
            </Flexbox>
            <Switch
              data-pt-agent-capability-binding={selected.key}
              checked={Boolean(selected.binding?.enabled)}
              disabled={isCapabilityBindingToggleDisabled(selected, pending)}
              loading={pending}
              onChange={updateBinding}
            />
          </Flexbox>
          <Flexbox horizontal align="center" justify="space-between" gap={16}>
            <span style={{ color: token.colorTextSecondary, fontSize: 12 }}>
              {t('agent.profile.capabilityInventory.field.approvalPolicy')}
            </span>
            <Select
              data-pt-agent-capability-policy={selected.key}
              data-pt-agent-capability-policy-value={approvalPolicy}
              aria-label={t('agent.profile.capabilityInventory.field.approvalPolicy')}
              disabled={!selected.binding || pending}
              onChange={updateApprovalPolicy}
              options={APPROVAL_POLICY_OPTIONS.map((policy) => ({
                label: t(
                  `agent.profile.capabilityInventory.approval.${approvalPolicyLocaleKey(
                    policy,
                  )}`,
                ),
                value: policy,
              }))}
              size="small"
              style={{ minWidth: 150 }}
              value={approvalPolicy}
            />
          </Flexbox>
        </Flexbox>

        <Flexbox
          data-pt-agent-capability-readiness={readinessLocaleKey(readinessState)}
          gap={7}
          style={{
            borderTop: `1px solid ${token.colorBorderSecondary}`,
            paddingTop: 12,
          }}
        >
          <Flexbox horizontal align="center" justify="space-between" gap={12}>
            <span style={{ color: token.colorText, fontSize: 12, fontWeight: 600 }}>
              {t('agent.profile.capabilityInventory.readiness.title')}
            </span>
            <Tag color={readinessTagColor(readinessState)} style={{ margin: 0 }}>
              {t(
                `agent.profile.capabilityInventory.readiness.${readinessLocaleKey(
                  readinessState,
                )}`,
              )}
            </Tag>
          </Flexbox>
          <CapabilityInfoRow
            label={t('agent.profile.capabilityInventory.field.compatibility')}
            value={(
              <Tag
                data-pt-agent-capability-compatibility={compatibility}
                color={
                  compatibility === 'compatible'
                    ? 'success'
                    : compatibility === 'degraded'
                      ? 'warning'
                      : compatibility === 'incompatible'
                        ? 'error'
                        : undefined
                }
                style={{ margin: 0 }}
              >
                {t(
                  `agent.profile.capabilityInventory.compatibility.${compatibility}`,
                )}
              </Tag>
            )}
          />
          <CapabilityInfoRow
            label={t('agent.profile.capabilityInventory.field.authority')}
            value={
              selected.readiness?.authority
              || t('agent.profile.capabilityInventory.notProjected')
            }
          />
          <CapabilityInfoRow
            label={t('agent.profile.capabilityInventory.field.reason')}
            value={(
              <Flexbox
                data-pt-agent-capability-reason-code={reasonCode || 'not_projected'}
                align="flex-end"
                gap={2}
              >
                <span>{reasonLabel}</span>
                {reasonCode ? (
                  <code style={{ color: token.colorTextTertiary, fontSize: 11 }}>
                    {reasonCode}
                  </code>
                ) : null}
              </Flexbox>
            )}
          />
        </Flexbox>
      </Flexbox>
    </div>
  );
}
