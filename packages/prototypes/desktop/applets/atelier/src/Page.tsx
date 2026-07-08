/**
 * Atelier — main shell (SOLO-style, conversation-first).
 *
 * Shell parity with TRAE Work / SOLO, for a *personal* workbench:
 *   - left rail  : New task + Skills + Automation entries, then a pluggable
 *                  task organizer (default = group by project folder)
 *   - top bar    : task title + repo chip + branch + Open in IDE + budget meter
 *   - centre     : a single conversation stream (rich markdown, Completed +
 *                  feedback bar, diff cards, artifacts) + a rich composer
 *   - right panel: TaskGraph projection first, then Todo + Context fallback
 *
 * Atelier's soul — multi-agent negotiation — is NOT a separate team board.
 * It is folded into the stream as a collapsible "agents negotiated X" row,
 * and the only thing pushed to the human is an inline decision card.
 *
 * Prototype: mock-data driven, runs as a standalone web page (React + LobeUI/
   * antd + CSS) you open in the browser. It only shows what the end product
   * looks like; artifact preview remains metadata-only plus Host sandbox intent.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { C, ROLE_COLOR } from './theme';
import { COLLAB_INPUTS } from './mock';
import type { AtelierProjectProjection, AtelierTaskNodeProjection, Block, BudgetProjection, TodoItem, TaskHost, TaskStatus, TaskContext, Artifact } from './types';
import type {
  AtelierFeedbackSignal,
  AtelierProviderCapability,
  AtelierRuntime,
  AtelierRuntimeSnapshot,
  AtelierRuntimeStatus,
  AgentFlowId,
  RunTargetKind,
} from './runtime';
import { createMockAtelierRuntime } from './runtime';
import { UserBubble, AgentBubble, NegoRow, DecisionCard, ArtifactCard, DiffCard } from './blocks';
import { EngineTrace } from './engineTrace';
import { ArtifactsTray, PreviewPanel } from './preview';
import { PLUGINS, DEFAULT_PLUGIN_ID, resolveTaskPlugin } from './plugins';
import { derivePrototypePageSurface, derivePrototypeRecoveryView, prototypeStatusForScenario, resolvePrototypeStatusScenario } from './prototypeRecoveryView';
import {
  ATELIER_AGENT_FLOW_DESCRIPTORS,
  ATELIER_CONTEXT_FILE_GROUPS,
  ATELIER_DEFAULT_CONTEXT_FILE_GROUP,
  ATELIER_DIRECT_RUN_MODELS,
  ATELIER_DEFAULT_AGENT_FLOW_ID,
  ATELIER_DEFAULT_RUN_TARGET_KIND,
  ATELIER_MEMORY_CONFIRMATION_MODE,
  ATELIER_PROJECTION_DISPLAY_LIMITS,
  ATELIER_RERUN_CONFIRMATION_MODE,
  ATELIER_RUN_TARGET_KINDS,
  ATELIER_TASK_INTENT_PRESETS,
} from './projection.contract.generated';
import { PanelToggleButton } from '../../../shared/PanelToggleButton';
import { PromptComposer } from '../../../shared/PromptComposer';

/**
 * Station run-intent presets shown in the prototype composer:
 *   model  : declare a direct-run provider preference for Station
 *   agents : declare a Station orchestration preset
 */
type RunKind = RunTargetKind;
type TaskIntentPreset = (typeof ATELIER_TASK_INTENT_PRESETS)[number];
type ContextFileGroup = (typeof ATELIER_CONTEXT_FILE_GROUPS)[number];
const RUN_KIND_LABELS: Record<RunKind, string> = {
  model: '⚡ 直接模型',
  agents: '👥 Agents',
};
const CONTEXT_FILE_GROUP_LABELS: Record<ContextFileGroup, string> = {
  files: 'Files',
  other: 'Other',
};

const DEFAULT_RUNTIME = createMockAtelierRuntime();

/** The nine Agent peers collaborating in the workspace (footer cluster). */
const PEERS: { role: string; label: string }[] = [
  { role: 'GoalOwner', label: 'G' },
  { role: 'Architect', label: 'A' },
  { role: 'Planner', label: 'P' },
  { role: 'Risk', label: 'R' },
  { role: 'Supervisor', label: 'S' },
  { role: 'Executor', label: 'E' },
  { role: 'Verifier', label: 'V' },
  { role: 'Integrator', label: 'I' },
  { role: 'Historian', label: 'H' },
];

/** simple horizontal progress bar (was antd Progress). */
function Bar({ pct, danger, width }: { pct: number; danger?: boolean; width?: number }) {
  return (
    <div style={{ width: width ?? undefined, flex: width ? undefined : 1, height: 6, backgroundColor: C.border, borderRadius: 3, overflow: 'hidden' }}>
      <div style={{ width: `${Math.min(100, pct)}%`, height: 6, backgroundColor: danger ? C.error : C.primary, borderRadius: 3 }} />
    </div>
  );
}

function TodoRow({ t }: { t: TodoItem }) {
  const glyph = t.status === 'done' ? '✓' : t.status === 'running' ? '◐' : '○';
  const color = t.status === 'done' ? C.success : t.status === 'running' ? C.primary : C.textQuaternary;
  return (
    <div style={{ display: 'flex', alignItems: 'center', padding: '6px 0' }}>
      <span style={{ fontSize: 14, color, marginRight: 8 }}>{glyph}</span>
      <span style={{ flex: 1, fontSize: 13, color: t.status === 'done' ? C.textTertiary : C.text }}>{t.text}</span>
    </div>
  );
}

function TaskGraphNodeRow({ node }: { node: AtelierTaskNodeProjection }) {
  const state = node.state.toLowerCase();
  const glyph = state === 'done' || state === 'accepted' ? '✓' : state === 'running' ? '◐' : state === 'blocked' ? '!' : '○';
  const color = state === 'done' || state === 'accepted' ? C.success : state === 'running' ? C.primary : state === 'blocked' ? C.warning : C.textQuaternary;
  const evidenceCount = node.artifactIds.length + node.gateIds.length;
  const visibleNodeArtifactIds = node.artifactIds.slice(0, ATELIER_PROJECTION_DISPLAY_LIMITS.taskGraphNodeRefs);
  const hiddenNodeArtifactCount = Math.max(0, node.artifactIds.length - visibleNodeArtifactIds.length);
  const visibleNodeGateIds = node.gateIds.slice(0, ATELIER_PROJECTION_DISPLAY_LIMITS.taskGraphNodeRefs);
  const hiddenNodeGateCount = Math.max(0, node.gateIds.length - visibleNodeGateIds.length);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', padding: '6px 0', gap: 8 }}>
      <span style={{ fontSize: 14, color }}>{glyph}</span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 13, color: C.text, lineHeight: '18px' }}>{node.title}</div>
        <div style={{ fontSize: 11, color: C.textTertiary, lineHeight: '16px' }}>
          {node.agentRole} · {node.state}
          {evidenceCount > 0 ? ` · ${evidenceCount} evidence refs` : ''}
        </div>
        {visibleNodeArtifactIds.length > 0 ? (
          <div style={{ fontSize: 11, color: C.textTertiary, lineHeight: '16px' }}>
            Artifact refs: {visibleNodeArtifactIds.join(', ')}
            {hiddenNodeArtifactCount > 0 ? ` +${hiddenNodeArtifactCount} more artifact refs` : ''}
          </div>
        ) : null}
        {visibleNodeGateIds.length > 0 ? (
          <div style={{ fontSize: 11, color: C.textTertiary, lineHeight: '16px' }}>
            Gate refs: {visibleNodeGateIds.join(', ')}
            {hiddenNodeGateCount > 0 ? ` +${hiddenNodeGateCount} more gate refs` : ''}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function TaskGraphProjectionPanel({ project }: { project: AtelierProjectProjection }) {
  const visibleRootTaskIds = project.taskGraph.rootTaskIds.slice(0, ATELIER_PROJECTION_DISPLAY_LIMITS.taskGraphRootIds);
  const hiddenRootTaskIdCount = Math.max(0, project.taskGraph.rootTaskIds.length - visibleRootTaskIds.length);
  const visibleEdges = project.taskGraph.edges.slice(0, ATELIER_PROJECTION_DISPLAY_LIMITS.taskGraphEdges);
  const hiddenEdgeCount = Math.max(0, project.taskGraph.edges.length - visibleEdges.length);
  const visibleNodes = project.taskGraph.tasks.slice(0, ATELIER_PROJECTION_DISPLAY_LIMITS.taskGraphNodes);
  const hiddenNodeCount = Math.max(0, project.taskGraph.tasks.length - visibleNodes.length);
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontWeight: 'bold', fontSize: 13, flex: 1 }}>TaskGraph</span>
        <span style={{ border: `1px solid ${C.border}`, borderRadius: 6, padding: '1px 7px', fontSize: 11, color: C.textTertiary }}>projection</span>
      </div>
      <div style={{ fontSize: 11, color: C.textTertiary, lineHeight: '16px', marginBottom: 8 }}>
        Read-only Station TaskGraph projection. The applet does not schedule, execute, or replan nodes.
      </div>
      <div style={{ fontSize: 11, color: C.textTertiary, lineHeight: '16px', marginBottom: 4 }}>
        Parallel policy: {project.taskGraph.parallelPolicy}
      </div>
      {project.taskGraph.parallelPolicy === 'integrator_required' ? (
        <div style={{ fontSize: 11, color: C.textTertiary, lineHeight: '16px', marginBottom: 8 }}>
          Integrator identity and merge execution remain Station-owned; this panel only projects the policy.
        </div>
      ) : null}
      <ProjectionList
        title="Root task ids"
        empty="No root task ids projected."
        hiddenCount={hiddenRootTaskIdCount}
        moreLabel="more Station TaskGraph root ids hidden."
        items={visibleRootTaskIds.map((rootTaskId) => ({
          id: `root:${rootTaskId}`,
          title: rootTaskId,
          detail: 'Station-projected TaskGraph root id.',
        }))}
      />
      <ProjectionList
        title="Dependency edges"
        empty="No dependency edges projected."
        hiddenCount={hiddenEdgeCount}
        moreLabel="more Station TaskGraph dependency edges hidden."
        items={visibleEdges.map((edge, index) => ({
          id: `edge:${edge.from}:${edge.to}:${edge.type}:${index}`,
          title: `${edge.from} -> ${edge.to}`,
          detail: edge.type,
        }))}
      />
      {visibleNodes.length > 0 ? (
        <>
          {visibleNodes.map((node) => <TaskGraphNodeRow key={node.id} node={node} />)}
          {hiddenNodeCount > 0 ? <div style={{ fontSize: 11, color: C.textTertiary }}>+{hiddenNodeCount} more Station TaskGraph nodes hidden.</div> : null}
        </>
      ) : (
        <div style={{ fontSize: 12, color: C.textTertiary }}>No TaskGraph nodes projected yet.</div>
      )}
    </div>
  );
}

function ProjectHealthProjectionPanel({ project }: { project: AtelierProjectProjection }) {
  const completionEntries = [
    ['No open blockers', project.completion.noOpenBlockers],
    ['L0/L1 acceptance passed', project.completion.l0L1AcceptancePassed],
    ['L2 human signoff complete', project.completion.l2HumanSignoffComplete],
    ['Residual risks logged', project.completion.residualRisksLogged],
    ['Memory candidates generated', project.completion.memoryCandidatesGenerated],
  ] as const;
  const visibleBlockers = project.openBlockers.slice(0, ATELIER_PROJECTION_DISPLAY_LIMITS.projectHealthItems);
  const hiddenBlockerCount = Math.max(0, project.openBlockers.length - visibleBlockers.length);
  const visibleRisks = project.residualRisks.slice(0, ATELIER_PROJECTION_DISPLAY_LIMITS.projectHealthItems);
  const hiddenRiskCount = Math.max(0, project.residualRisks.length - visibleRisks.length);
  const visibleMilestones = project.milestoneTree.milestones.slice(0, ATELIER_PROJECTION_DISPLAY_LIMITS.projectHealthMilestones);
  const hiddenMilestoneCount = Math.max(0, project.milestoneTree.milestones.length - visibleMilestones.length);
  const visibleMemoryCandidates = project.memoryCandidates.slice(0, ATELIER_PROJECTION_DISPLAY_LIMITS.projectHealthItems);
  const hiddenMemoryCandidateCount = Math.max(0, project.memoryCandidates.length - visibleMemoryCandidates.length);
  const policyRules = project.policy?.rules ?? [];
  const visiblePolicyRules = policyRules.slice(0, ATELIER_PROJECTION_DISPLAY_LIMITS.projectHealthItems);
  const hiddenPolicyRuleCount = Math.max(0, policyRules.length - visiblePolicyRules.length);
  const visibleDefects = project.defects.slice(0, ATELIER_PROJECTION_DISPLAY_LIMITS.projectHealthItems);
  const hiddenDefectCount = Math.max(0, project.defects.length - visibleDefects.length);
  const formatMilestoneDetail = (milestone: AtelierProjectProjection['milestoneTree']['milestones'][number]) => {
    const visiblePredicateIds = milestone.acceptancePredicateIds.slice(0, ATELIER_PROJECTION_DISPLAY_LIMITS.milestoneRefs);
    const hiddenPredicateCount = Math.max(0, milestone.acceptancePredicateIds.length - visiblePredicateIds.length);
    const visibleMilestoneBlockerRefs = milestone.openBlockers.slice(0, ATELIER_PROJECTION_DISPLAY_LIMITS.milestoneRefs).map((blocker) => blocker.id);
    const hiddenMilestoneBlockerCount = Math.max(0, milestone.openBlockers.length - visibleMilestoneBlockerRefs.length);
    const refs = [
      visiblePredicateIds.length > 0
        ? `Predicate refs: ${visiblePredicateIds.join(', ')}${hiddenPredicateCount > 0 ? ` +${hiddenPredicateCount} more predicate refs` : ''}`
        : '',
      visibleMilestoneBlockerRefs.length > 0
        ? `Blocker refs: ${visibleMilestoneBlockerRefs.join(', ')}${hiddenMilestoneBlockerCount > 0 ? ` +${hiddenMilestoneBlockerCount} more blocker refs` : ''}`
        : '',
    ].filter(Boolean);
    return [
      `${milestone.state} · ${milestone.taskIds.length} tasks · ${milestone.acceptancePredicateIds.length} predicates · ${milestone.openBlockers.length} blockers`,
      ...refs,
    ].join(' · ');
  };
  return (
    <div style={{ borderBottom: `1px solid ${C.border}`, marginBottom: 14, paddingBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontWeight: 'bold', fontSize: 13, flex: 1 }}>Project Health</span>
        <span style={{ border: `1px solid ${C.border}`, borderRadius: 6, padding: '1px 7px', fontSize: 11, color: C.textTertiary }}>projection</span>
      </div>
      <div style={{ fontSize: 11, color: C.textTertiary, lineHeight: '16px', marginBottom: 8 }}>
        Read-only Station project health projection. The applet does not accept, waive, or mutate project state.
      </div>
      <div style={{ fontSize: 13, fontWeight: 'bold', color: C.text, lineHeight: '18px' }}>{project.title}</div>
      <div style={{ fontSize: 11, color: C.textTertiary, lineHeight: '16px', marginBottom: 8 }}>
        {project.state} · {project.workspaceRef} · signoff: {project.goalOwnerSignoff ? 'yes' : 'no'}
      </div>
      {completionEntries.map(([label, passed]) => (
        <div key={label} style={{ fontSize: 11, color: passed ? C.success : C.warning, lineHeight: '17px' }}>
          {passed ? '✓' : '!'} {label}
        </div>
      ))}
      <ProjectionList
        title="Blockers"
        empty="No blockers projected."
        hiddenCount={hiddenBlockerCount}
        moreLabel="more Station blocker projections hidden."
        items={visibleBlockers.map((blocker) => ({
          id: blocker.id,
          title: blocker.reason,
          detail: `${blocker.severity} · ${blocker.state} · ${blocker.evidenceRef}`,
        }))}
      />
      <ProjectionList
        title="Residual risks"
        empty="No residual risks projected."
        hiddenCount={hiddenRiskCount}
        moreLabel="more Station residual risk projections hidden."
        items={visibleRisks.map((risk) => ({
          id: risk.id,
          title: risk.desc,
          detail: `${risk.state} · ${risk.owner} · ${risk.evidenceRef}`,
        }))}
      />
      <ProjectionList
        title="Milestones"
        empty="No milestones projected."
        hiddenCount={hiddenMilestoneCount}
        moreLabel="more Station milestone projections hidden."
        items={visibleMilestones.map((milestone) => ({
          id: milestone.id,
          title: milestone.title,
          detail: formatMilestoneDetail(milestone),
        }))}
      />
      <ProjectionList
        title="Memory candidates"
        empty="No memory candidates projected."
        hiddenCount={hiddenMemoryCandidateCount}
        moreLabel="more Station memory candidate projections hidden."
        items={visibleMemoryCandidates.map((candidate) => ({
          id: candidate.id,
          title: candidate.content,
          detail: `${candidate.type} · ${candidate.scope} · ${candidate.confirmed ? 'confirmed' : 'pending'} · ${candidate.feeds.join('/')}`,
        }))}
      />
      <div style={{ fontSize: 11, color: C.textTertiary, lineHeight: '16px', marginTop: 8 }}>
        Policy: {project.policy ? `${project.policy.id} · ${project.policy.hardDeny ? 'hard-deny' : 'advisory'} · ${project.policy.rules.length} rules` : 'none projected'}
      </div>
      <ProjectionList
        title="Policy rules"
        empty="No policy rules projected."
        hiddenCount={hiddenPolicyRuleCount}
        moreLabel="more Station policy rule projections hidden."
        items={visiblePolicyRules.map((rule) => ({
          id: rule.id,
          title: rule.expr,
          detail: `${rule.scope} · ${rule.severity}`,
        }))}
      />
      <ProjectionList
        title="Defects"
        empty="No defects projected."
        hiddenCount={hiddenDefectCount}
        moreLabel="more Station defect projections hidden."
        items={visibleDefects.map((defect) => ({
          id: defect.id,
          title: defect.proposal.summary,
          detail: `${defect.source} · ${defect.state} · ${defect.taskId} · ${defect.evidenceRef}`,
        }))}
      />
    </div>
  );
}

function ProjectionList({
  empty,
  hiddenCount,
  items,
  moreLabel,
  title,
}: {
  empty: string;
  hiddenCount: number;
  items: Array<{ id: string; title: string; detail: string }>;
  moreLabel: string;
  title: string;
}) {
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ fontSize: 11, fontWeight: 'bold', color: C.textTertiary, marginBottom: 5 }}>{title}</div>
      {items.map((item) => (
        <div key={item.id} style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: 7, marginBottom: 6, backgroundColor: C.bg }}>
          <div style={{ fontSize: 12, color: C.text, lineHeight: '17px' }}>{item.title}</div>
          <div style={{ fontSize: 11, color: C.textTertiary, lineHeight: '16px' }}>{item.detail}</div>
        </div>
      ))}
      {hiddenCount > 0 ? <div style={{ fontSize: 11, color: C.textTertiary }}>+{hiddenCount} {moreLabel}</div> : null}
      {items.length === 0 ? <div style={{ fontSize: 11, color: C.textQuaternary }}>{empty}</div> : null}
    </div>
  );
}

function ContextPanel({ ctx }: { ctx: TaskContext }) {
  const [tab, setTab] = useState<ContextFileGroup>(ATELIER_DEFAULT_CONTEXT_FILE_GROUP);
  const items = ctx.files.filter((f) => f.group === tab);
  return (
    <div style={{ marginTop: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ flex: 1, fontWeight: 'bold' }}>Context</span>
        <span style={{ border: `1px solid ${C.border}`, borderRadius: 6, padding: '1px 7px', fontSize: 11, color: C.textTertiary }}>compact</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
        <Bar pct={ctx.usedPct} />
        <span style={{ fontSize: 12, color: C.textTertiary, marginLeft: 8 }}>{ctx.usedPct}%</span>
      </div>
      <div style={{ fontSize: 11, color: C.textTertiary, lineHeight: '16px', marginBottom: 10 }}>
        Read-only Station context projection: no Workspace file discovery, no Run input_snapshot write, and no
        Host+Station+applet E2E proof in this prototype gate.
      </div>
      <div style={{ display: 'flex', marginBottom: 8 }}>
        {ATELIER_CONTEXT_FILE_GROUPS.map((k) => (
          <span
            key={k}
            onClick={() => setTab(k)}
            style={{ fontSize: 13, fontWeight: 'bold', marginRight: 16, color: tab === k ? C.primary : C.textTertiary, cursor: 'pointer' }}
          >
            {CONTEXT_FILE_GROUP_LABELS[k]}
          </span>
        ))}
      </div>
      {items.map((f) => (
        <div key={f.name} style={{ display: 'flex', alignItems: 'center', padding: '5px 0' }}>
          <span style={{ fontSize: 13, color: C.textQuaternary, marginRight: 8 }}>📄</span>
          <span style={{ flex: 1, fontSize: 13, color: C.textSecondary }}>{f.name}</span>
        </div>
      ))}
      {items.length === 0 ? <span style={{ fontSize: 12, color: C.textQuaternary }}>暂无</span> : null}
    </div>
  );
}

function SkillsPanel({
  capabilities,
  error,
  loading,
  source,
  onInsertCommand,
}: {
  capabilities: AtelierProviderCapability[];
  error: string;
  loading: boolean;
  source: string;
  onInsertCommand: (command: string) => void;
}) {
  const visibleCapabilities = capabilities.slice(0, ATELIER_PROJECTION_DISPLAY_LIMITS.providerCapabilities);
  const hiddenCapabilityCount = Math.max(0, capabilities.length - visibleCapabilities.length);
  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, backgroundColor: C.bg, padding: 8, margin: '2px 0 10px' }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 5 }}>
        <span style={{ flex: 1, fontSize: 12, fontWeight: 'bold', color: C.textSecondary }}>Skills</span>
        <span style={{ fontSize: 10, color: C.textQuaternary }}>{loading ? 'loading' : capabilities.length}</span>
      </div>
      <div style={{ fontSize: 10, lineHeight: '15px', color: C.textTertiary }}>
        Read-only Station provider capabilities. Click inserts a slash command; execution remains Station-owned.
      </div>
      {source ? <div style={{ marginTop: 4, fontSize: 10, color: C.textQuaternary }}>{source}</div> : null}
      {error ? <div style={{ marginTop: 5, fontSize: 10, color: C.error }}>{error}</div> : null}
      <div style={{ marginTop: 6 }}>
        {visibleCapabilities.map((capability) => (
          <button
            key={capability.id}
            type="button"
            onClick={() => onInsertCommand(capability.slashCommand)}
            style={{
              width: '100%',
              border: `1px solid ${C.border}`,
              borderRadius: 8,
              background: C.fillQuaternary,
              color: C.text,
              cursor: 'pointer',
              marginTop: 5,
              padding: '6px 7px',
              textAlign: 'left',
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ flex: 1, fontSize: 11, fontWeight: 'bold' }}>{capability.label}</span>
              <span style={{ fontSize: 10, color: C.primary, fontWeight: 'bold' }}>{capability.slashCommand}</span>
            </span>
            <span style={{ display: 'block', marginTop: 3, fontSize: 10, lineHeight: '14px', color: C.textTertiary }}>
              {capability.description}
            </span>
          </button>
        ))}
        {hiddenCapabilityCount > 0 ? (
          <div style={{ marginTop: 6, fontSize: 10, lineHeight: '15px', color: C.textTertiary }}>
            +{hiddenCapabilityCount} more Station provider capability descriptors hidden in the compact prototype panel.
          </div>
        ) : null}
      </div>
      {!loading && capabilities.length === 0 ? <div style={{ marginTop: 6, fontSize: 11, color: C.textQuaternary }}>No provider capabilities available.</div> : null}
    </div>
  );
}

function BudgetStrip({ budget, fallbackPercent, fallbackLabel }: { budget?: BudgetProjection; fallbackPercent: number; fallbackLabel: string }) {
  const dimensions = budget?.dimensions ?? [{
    id: 'money',
    label: 'Money',
    used: fallbackPercent,
    cap: 100,
    unit: '%',
    percent: fallbackPercent,
    status: fallbackPercent >= 90 ? 'danger' : fallbackPercent >= 75 ? 'warning' : 'ok',
  } as const];
  const tone = budget?.status ?? dimensions[0]?.status ?? 'ok';
  const color = tone === 'blocked' || tone === 'danger' ? C.error : tone === 'warning' ? C.warning : C.primary;
  return (
    <span
      title={`${budget?.decisionHint ?? 'Read-only Station budget projection; halt, cap increase, and resume stay in Station decision routing.'} ${dimensions.map((item) => `${item.label}: ${item.used}/${item.cap}${item.unit} (${item.percent}%)`).join(' · ')}`}
      style={{ height: 28, display: 'inline-flex', alignItems: 'center', gap: 6, border: `1px solid ${C.border}`, borderRadius: 8, padding: '0 10px', fontSize: 11, color: C.textSecondary, marginRight: 10, backgroundColor: C.fillSecondary }}
    >
      <span style={{ color: C.textTertiary }}>Budget</span>
      <span style={{ width: 46, height: 6, borderRadius: 99, backgroundColor: C.fillTertiary, overflow: 'hidden', display: 'inline-flex' }}>
        <span style={{ width: `${Math.min(100, Math.max(0, dimensions[0]?.percent ?? fallbackPercent))}%`, backgroundColor: color, borderRadius: 99 }} />
      </span>
      <span style={{ color }}>{budget?.summary ?? fallbackLabel}</span>
      {budget ? (
        <span style={{ color: C.textQuaternary }}>
          {dimensions.map((item) => `${item.label} ${item.percent}%`).join(' · ')}
        </span>
      ) : null}
    </span>
  );
}

function RecoveryPanel({
  status,
  onRetry,
}: {
  status: AtelierRuntimeStatus;
  onRetry: () => void;
}) {
  const recoveryView = derivePrototypeRecoveryView(status);
  const isBlocked = recoveryView.severity === 'danger';
  const isWarning = recoveryView.severity === 'warning';
  return (
    <div
      style={{
        minHeight: 260,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '48px 16px',
      }}
    >
      <div
        style={{
          width: 'min(420px, 100%)',
          border: `1px solid ${isBlocked ? C.error : isWarning ? C.warning : C.border}`,
          borderRadius: 16,
          backgroundColor: C.fillQuaternary,
          padding: 20,
          textAlign: 'left',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 10,
              border: `1px solid ${isBlocked ? C.error : isWarning ? C.warning : C.border}`,
              color: isBlocked ? C.error : isWarning ? C.warning : C.primary,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 'bold',
              flexShrink: 0,
            }}
          >
            {recoveryView.symbol}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 'bold', color: C.text }}>{status.title}</div>
            <div style={{ marginTop: 6, fontSize: 12, lineHeight: '18px', color: C.textTertiary }}>{status.detail}</div>
            {status.lastEventSeq !== undefined ? (
              <div style={{ marginTop: 8, fontSize: 11, color: C.textQuaternary }}>last event seq: {status.lastEventSeq}</div>
            ) : null}
            {recoveryView.retryVisible ? (
              <button
                type="button"
                title="Projection reload only; no execution, rerun, or provider invoke."
                onClick={onRetry}
                style={{
                  marginTop: 14,
                  height: 28,
                  border: `1px solid ${C.border}`,
                  borderRadius: 8,
                  background: C.bg,
                  color: C.textSecondary,
                  cursor: 'pointer',
                  padding: '0 12px',
                  fontSize: 12,
                }}
              >
                重试加载
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

/** inline menu picker (replaces antd Dropdown). */
function Picker({
  label,
  options,
  onPick,
}: {
  label: string;
  options: { key: string; title: string; sub?: string }[];
  onPick: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: 'relative' }}>
      <div onClick={() => setOpen((v) => !v)} style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
        {label ? <span style={{ fontSize: 12, color: C.textSecondary, marginRight: 3 }}>{label}</span> : null}
        <span style={{ fontSize: 11, color: C.textTertiary }}>▾</span>
      </div>
      {open ? (
        <div
          style={{
            position: 'absolute',
            zIndex: 10,
            marginTop: 4,
            minWidth: 160,
            border: `1px solid ${C.border}`,
            borderRadius: 8,
            backgroundColor: C.bg,
            padding: '4px 0',
            boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
          }}
        >
          {options.map((o) => (
            <div
              key={o.key}
              onClick={() => {
                setOpen(false);
                onPick(o.key);
              }}
              style={{ padding: '6px 10px', cursor: 'pointer' }}
            >
              <div style={{ fontSize: 13 }}>{o.title}</div>
              {o.sub ? <div style={{ fontSize: 11, color: C.textTertiary }}>{o.sub}</div> : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Merged run-target dropdown. It only writes declarative Station run intent into
 * create/message payloads; execution stays Station-owned.
 */
function RunPicker({
  runKind,
  model,
  flowId,
  onPickModel,
  onPickFlow,
}: {
  runKind: RunKind;
  model: string;
    flowId: AgentFlowId;
  onPickModel: (m: string) => void;
    onPickFlow: (id: AgentFlowId) => void;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<RunKind>(runKind);
  const activeFlow = ATELIER_AGENT_FLOW_DESCRIPTORS.find((flow) => flow.id === flowId);
  const activeLabel = runKind === 'agents' ? (activeFlow?.label ?? flowId) : model;
  return (
    <div style={{ position: 'relative' }}>
      <div
        onClick={() => { setTab(runKind); setOpen((v) => !v); }}
        style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}
      >
        <span style={{ fontSize: 12, marginRight: 4 }}>{runKind === 'agents' ? '👥' : '⚡'}</span>
        <span style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', fontSize: 13, color: C.textSecondary, marginRight: 4, whiteSpace: 'nowrap' }}>{activeLabel}</span>
        <span style={{ fontSize: 13, color: C.textTertiary }}>▾</span>
      </div>
      {open ? (
        <div
          style={{
            position: 'absolute',
            zIndex: 10,
            right: 0,
            bottom: 26,
            width: 264,
            border: `1px solid ${C.border}`,
            borderRadius: 10,
            backgroundColor: C.bg,
            boxShadow: '0 4px 16px rgba(0,0,0,0.1)',
            overflow: 'hidden',
          }}
        >
          {/* tab strip */}
          <div style={{ display: 'flex', padding: 4, gap: 4, borderBottom: `1px solid ${C.border}` }}>
            {ATELIER_RUN_TARGET_KINDS.map((k) => (
              <div
                key={k}
                onClick={() => setTab(k)}
                style={{
                  flex: 1,
                  textAlign: 'center',
                  padding: '5px 0',
                  borderRadius: 6,
                  fontSize: 12,
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  backgroundColor: tab === k ? C.primaryWash3 : 'transparent',
                  color: tab === k ? C.primary : C.textTertiary,
                }}
              >
                {RUN_KIND_LABELS[k]}
              </div>
            ))}
          </div>
          {/* tab body */}
          <div style={{ maxHeight: 280, overflow: 'auto', padding: '4px 0' }}>
            <div style={{ padding: '7px 12px', borderBottom: `1px solid ${C.border}`, color: C.textTertiary, fontSize: 11, lineHeight: '16px' }}>
              Prototype run target selector only writes Station-owned run intent; the applet does not invoke providers, run models, or execute CLI.
            </div>
            {tab === 'model'
              ? ATELIER_DIRECT_RUN_MODELS.map((m) => {
                  const picked = runKind === 'model' && m === model;
                  return (
                    <div
                      key={m}
                      onClick={() => { onPickModel(m); setOpen(false); }}
                      style={{ display: 'flex', alignItems: 'center', padding: '7px 12px', cursor: 'pointer' }}
                    >
                      <span style={{ flex: 1, fontSize: 13, color: picked ? C.primary : C.text }}>{m}</span>
                      {picked ? <span style={{ fontSize: 12, color: C.primary }}>✓</span> : null}
                    </div>
                  );
                })
                  : ATELIER_AGENT_FLOW_DESCRIPTORS.map((flow) => {
                      const picked = runKind === 'agents' && flow.id === flowId;
                  return (
                    <div
                          key={flow.id}
                          onClick={() => { onPickFlow(flow.id); setOpen(false); }}
                      style={{ display: 'flex', alignItems: 'flex-start', padding: '7px 12px', cursor: 'pointer' }}
                    >
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, color: picked ? C.primary : C.text }}>
                              {flow.label}
                              {flow.batch === 1 ? (
                            <span style={{ fontSize: 10, color: C.success, marginLeft: 6, border: `1px solid ${C.success}`, borderRadius: 4, padding: '0 4px' }}>可切换</span>
                          ) : (
                            <span style={{ fontSize: 10, color: C.textQuaternary, marginLeft: 6, border: `1px solid ${C.border}`, borderRadius: 4, padding: '0 4px' }}>第二批</span>
                          )}
                        </div>
                            <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 1 }}>{flow.description}</div>
                      </div>
                      {picked ? <span style={{ fontSize: 12, color: C.primary, marginLeft: 6 }}>✓</span> : null}
                    </div>
                  );
                })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function AtelierPage({ runtime = DEFAULT_RUNTIME }: { runtime?: AtelierRuntime } = {}) {
  const initialSnapshot = runtime.getSnapshot();
  const [state, setState] = useState(initialSnapshot.state);
  const [selected, setSelected] = useState(initialSnapshot.selectedTaskId);
  const [runtimeStatus, setRuntimeStatus] = useState<AtelierRuntimeStatus | undefined>(initialSnapshot.status);
  const [pluginId, setPluginId] = useState(DEFAULT_PLUGIN_ID);
  const [draft, setDraft] = useState('');
  const [mode, setMode] = useState<TaskIntentPreset>('work');
  const [runKind, setRunKind] = useState<RunKind>(ATELIER_DEFAULT_RUN_TARGET_KIND);
  const [flowId, setFlowId] = useState<AgentFlowId>(ATELIER_DEFAULT_AGENT_FLOW_ID);
  const [railOpen, setRailOpen] = useState(true);
  const [railRightOpen, setRailRightOpen] = useState(true);
  const [preview, setPreview] = useState<Artifact | null>(null);
  const [providerCapabilities, setProviderCapabilities] = useState<AtelierProviderCapability[]>([]);
  const [providerCapabilitiesSource, setProviderCapabilitiesSource] = useState('');
  const [providerCapabilitiesLoading, setProviderCapabilitiesLoading] = useState(false);
  const [providerCapabilitiesError, setProviderCapabilitiesError] = useState('');
  const [feedbackSubmittingId, setFeedbackSubmittingId] = useState('');
  const [feedbackStatus, setFeedbackStatus] = useState('');
  const [feedbackStatusBlockId, setFeedbackStatusBlockId] = useState('');
  const [memoryConfirmationFeedbackId, setMemoryConfirmationFeedbackId] = useState('');
  const [memoryConfirmationTaskId, setMemoryConfirmationTaskId] = useState('');
  const [memoryConfirmationBlockId, setMemoryConfirmationBlockId] = useState('');
  const [memoryConfirming, setMemoryConfirming] = useState(false);
  const [rerunConfirmationFeedbackId, setRerunConfirmationFeedbackId] = useState('');
  const [rerunConfirmationTaskId, setRerunConfirmationTaskId] = useState('');
  const [rerunConfirmationBlockId, setRerunConfirmationBlockId] = useState('');
  const [rerunConfirming, setRerunConfirming] = useState(false);
  const [workspaceOpenSubmitting, setWorkspaceOpenSubmitting] = useState(false);
  const [workspaceOpenStatus, setWorkspaceOpenStatus] = useState('');
  const [purgeConfirmId, setPurgeConfirmId] = useState('');
  const controlledStatusScenario = useMemo(
    () => (typeof window === 'undefined' ? undefined : resolvePrototypeStatusScenario(window.location.search)),
    [],
  );

  const applySnapshot = useCallback((snapshot: AtelierRuntimeSnapshot) => {
    setState(snapshot.state);
    setSelected(snapshot.selectedTaskId);
    setRuntimeStatus(snapshot.status);
  }, []);

  useEffect(() => {
    let mounted = true;
    const unsubscribe = runtime.subscribe?.((snapshot) => {
      if (mounted) applySnapshot(snapshot);
    });
    void runtime.loadWorkspace().then((snapshot) => {
      if (mounted) applySnapshot(snapshot);
    });
    return () => {
      mounted = false;
      unsubscribe?.();
    };
  }, [applySnapshot, runtime]);

  useEffect(() => {
    let mounted = true;
    setProviderCapabilitiesLoading(true);
    setProviderCapabilitiesError('');
    void runtime.listProviderCapabilities(selected ? { taskId: selected } : {})
      .then((response) => {
        if (!mounted) return;
        setProviderCapabilities(response.capabilities);
        setProviderCapabilitiesSource(response.source);
        setProviderCapabilitiesLoading(false);
      })
      .catch((error) => {
        if (!mounted) return;
        setProviderCapabilitiesLoading(false);
        setProviderCapabilitiesError(error instanceof Error ? error.message : 'provider capabilities unavailable');
      });
    return () => {
      mounted = false;
    };
  }, [runtime, selected]);

  const reloadWorkspace = useCallback(() => {
    void runtime.loadWorkspace().then(applySnapshot);
  }, [applySnapshot, runtime]);

  const stream = state.stream[selected] ?? [];
  const todos = state.todos[selected];
  const ctx = state.context[selected];
  const artifacts = state.artifacts[selected] ?? [];
  const selectedTask = state.tasks.find((t) => t.id === selected);
  const selectedProject = state.projects?.find((project) =>
    project.id === selectedTask?.projectId ||
    project.taskGraph.tasks.some((node) => node.id === selected),
  );
  const hasRightPanel = true;
  const scenarioStatus = controlledStatusScenario ? prototypeStatusForScenario(controlledStatusScenario) : undefined;
  const visibleRuntimeStatus = scenarioStatus ?? runtimeStatus;
  const pageSurface = derivePrototypePageSurface({ status: visibleRuntimeStatus, streamLength: stream.length });
  const recoveryStatus = pageSurface.recoveryStatus;

  // selecting a task drops any open preview from the previous task
  const selectTask = (id: string) => {
    setSelected(id);
    setPreview(null);
    setPurgeConfirmId('');
  };

  const plugin = resolveTaskPlugin(pluginId);

  // The shell owns the data; plugins only render + delegate lifecycle moves.
  const host: TaskHost = useMemo(
    () => ({
      tasks: state.tasks,
      selectedId: selected,
      purgeConfirmId,
      select: (id) => selectTask(id),
      setStatus: (id, status: TaskStatus) => {
        setPurgeConfirmId('');
        void runtime.setTaskStatus({ taskId: id, status }).then(applySnapshot);
      },
      requestPurge: (id) => setPurgeConfirmId(id),
      purge: (id) => {
        setPurgeConfirmId('');
        void runtime.purgeTask(id).then(applySnapshot);
      },
      newTask: () => {
        setPreview(null);
        setPurgeConfirmId('');
        const run = runKind === 'model'
          ? { kind: 'model' as const, model: state.model }
          : { kind: 'agents' as const, model: state.model, flowId };
        void runtime.createProjectFromGoal({
          goal: '新任务',
          intentPreset: mode,
          project: selectedTask?.project ?? 'peers-touch',
          run,
        }).then(applySnapshot);
      },
    }),
    [applySnapshot, flowId, mode, purgeConfirmId, runKind, runtime, selected, selectedTask, state.model, state.tasks],
  );

  const choose = (blockId: string, opt: string) => {
    void runtime.resolveDecision({ taskId: selected, blockId, choice: opt }).then(applySnapshot);
  };

  const sendDraft = () => {
    const text = draft.trim();
    if (!text || !selected) return;
    setDraft('');
    void runtime.sendMessage({
      taskId: selected,
      text,
    }).then(applySnapshot);
  };

  const insertProviderCapabilityCommand = (command: string) => {
    const slashCommand = command.trim();
    if (!slashCommand.startsWith('/')) return;
    setDraft((current) => {
      const existing = current.trim();
      return existing ? `${existing} ${slashCommand} ` : `${slashCommand} `;
    });
  };

  const submitFeedback = (blockId: string, signal: AtelierFeedbackSignal) => {
    const key = `${blockId}:${signal}`;
    setFeedbackSubmittingId(key);
    setFeedbackStatus('');
    setFeedbackStatusBlockId(blockId);
    void runtime.submitFeedback({ taskId: selected, blockId, signal })
      .then((response) => {
        const policy =
          signal === 'regenerate'
            ? response.rerunIntent.status
            : signal === 'positive' || signal === 'negative'
              ? response.memoryCandidate.status
              : 'acknowledged';
          const requiresMemoryConfirmation =
            response.memoryCandidate.requiresConfirmation && response.memoryCandidate.confirmationMode === ATELIER_MEMORY_CONFIRMATION_MODE;
          const requiresRerunConfirmation =
            response.rerunIntent.requiresConfirmation && response.rerunIntent.confirmationMode === ATELIER_RERUN_CONFIRMATION_MODE;
        const confirmation =
            requiresMemoryConfirmation
            ? ' · Station memory confirmation required'
              : requiresRerunConfirmation
              ? ' · Station rerun review required'
            : '';
          if (requiresMemoryConfirmation) {
          setMemoryConfirmationFeedbackId(response.feedbackId);
          setMemoryConfirmationTaskId(selected);
          setMemoryConfirmationBlockId(blockId);
        }
          if (requiresRerunConfirmation) {
          setRerunConfirmationFeedbackId(response.feedbackId);
          setRerunConfirmationTaskId(selected);
          setRerunConfirmationBlockId(blockId);
        }
        setFeedbackStatus(`${signal}:${policy}${confirmation}`);
        setFeedbackStatusBlockId(blockId);
      })
      .catch((error) => {
        setFeedbackStatus(error instanceof Error ? error.message : 'feedback unavailable');
        setFeedbackStatusBlockId(blockId);
      })
      .finally(() => setFeedbackSubmittingId(''));
  };

  const confirmMemoryCandidate = () => {
    if (!memoryConfirmationFeedbackId || !memoryConfirmationTaskId || memoryConfirming) return;
    setMemoryConfirming(true);
    void runtime.confirmMemoryCandidate({ taskId: memoryConfirmationTaskId, feedbackId: memoryConfirmationFeedbackId })
      .then((response) => {
        setMemoryConfirmationFeedbackId('');
        setMemoryConfirmationTaskId('');
        setMemoryConfirmationBlockId('');
        setFeedbackStatus(`memory-confirmed:${response.memoryId}`);
        setFeedbackStatusBlockId(memoryConfirmationBlockId);
      })
      .catch((error) => {
        setMemoryConfirmationFeedbackId((current) => current);
        setMemoryConfirmationTaskId((current) => current);
        setMemoryConfirmationBlockId((current) => current);
        setFeedbackStatus(error instanceof Error ? error.message : 'memory confirmation unavailable');
        setFeedbackStatusBlockId(memoryConfirmationBlockId);
      })
      .finally(() => setMemoryConfirming(false));
  };

  const confirmRerun = () => {
    if (!rerunConfirmationFeedbackId || !rerunConfirmationTaskId || rerunConfirming) return;
    setRerunConfirming(true);
    void runtime.confirmRerun({ taskId: rerunConfirmationTaskId, feedbackId: rerunConfirmationFeedbackId })
      .then((response) => {
        setRerunConfirmationFeedbackId('');
        setRerunConfirmationTaskId('');
        setRerunConfirmationBlockId('');
        setFeedbackStatus(`rerun-confirmed:${response.rerunTaskId}`);
        setFeedbackStatusBlockId(rerunConfirmationBlockId);
        reloadWorkspace();
      })
      .catch((error) => {
        setRerunConfirmationFeedbackId((current) => current);
        setRerunConfirmationTaskId((current) => current);
        setRerunConfirmationBlockId((current) => current);
        setFeedbackStatus(error instanceof Error ? error.message : 'rerun confirmation unavailable');
        setFeedbackStatusBlockId(rerunConfirmationBlockId);
      })
      .finally(() => setRerunConfirming(false));
  };

  const openWorkspace = () => {
    const target = selectedTask?.workspaceOpenTarget;
    if (!selectedTask || !target || workspaceOpenSubmitting) return;
    setWorkspaceOpenSubmitting(true);
    setWorkspaceOpenStatus('');
    void runtime.openWorkspace({
      taskId: selectedTask.id,
      workspaceUri: target.workspaceUri,
      ideHint: target.ideHint,
    })
      .then((response) => {
        setWorkspaceOpenStatus(`${response.mode}:${response.opened ? 'opened' : 'accepted'}`);
      })
      .catch((error) => {
        setWorkspaceOpenStatus(error instanceof Error ? error.message : 'workspace open unavailable');
      })
      .finally(() => setWorkspaceOpenSubmitting(false));
  };

  const renderBlock = (b: Block) => {
    switch (b.kind) {
      case 'user': return <UserBubble key={b.id} m={b} />;
      case 'agent': return <AgentBubble key={b.id} feedbackStatus={feedbackStatusBlockId === b.id ? feedbackStatus : ''} feedbackSubmittingId={feedbackSubmittingId} memoryConfirmationFeedbackId={memoryConfirmationBlockId === b.id ? memoryConfirmationFeedbackId : ''} memoryConfirming={memoryConfirmationBlockId === b.id && memoryConfirming} rerunConfirmationFeedbackId={rerunConfirmationBlockId === b.id ? rerunConfirmationFeedbackId : ''} rerunConfirming={rerunConfirmationBlockId === b.id && rerunConfirming} m={b} onConfirmMemoryCandidate={confirmMemoryCandidate} onConfirmRerun={confirmRerun} onFeedback={submitFeedback} />;
      case 'nego': {
        // If this task has an engine-independent position pool AND we are in
        // agents mode, render the prototype-only local trace: switching the
        // engine reshapes the demo without claiming applet orchestration
        // ownership. Otherwise fall back to the static folded nego row.
        const collab = COLLAB_INPUTS[selected];
        if (collab && runKind === 'agents') {
          return <EngineTrace key={b.id} input={collab} engineId={flowId} />;
        }
        return <NegoRow key={b.id} b={b} />;
      }
      case 'decision': return <DecisionCard key={b.id} b={b} onChoose={choose} />;
      case 'artifact': return <ArtifactCard key={b.id} b={b} />;
      case 'diff': return <DiffCard key={b.id} b={b} />;
    }
  };

  const budgetPct = Math.round((state.budgetSpent / state.budgetCap) * 100);
  const budgetProjection = state.budget;
  const contentMax = preview
    ? 760
    : !railOpen && !railRightOpen
      ? 1040
      : !railOpen || !railRightOpen
        ? 920
        : 760;

  return (
    <div style={{ height: '100%', minHeight: 0, display: 'flex', overflow: 'hidden', backgroundColor: C.bg, color: C.text, fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      {/* ── Left rail ── */}
      {railOpen ? (
        <div
          style={{
            width: 'min(212px, 28%)',
            display: 'flex',
            flexDirection: 'column',
            flexShrink: 0,
            minHeight: 0,
            boxSizing: 'border-box',
            backgroundColor: C.fillQuaternary,
            borderRight: `1px solid ${C.border}`,
            padding: '10px 8px 8px',
          }}
        >
          <div style={{ height: 28, display: 'flex', alignItems: 'center', marginBottom: 6 }}>
            <PanelToggleButton side="left" open={railOpen} title="折叠左栏" onClick={() => setRailOpen(false)} />
          </div>

          {/* Work / Code mode toggle */}
          <div style={{ display: 'flex', padding: 2, backgroundColor: C.fillSecondary, borderRadius: 8, marginBottom: 10 }}>
            {ATELIER_TASK_INTENT_PRESETS.map((m) => (
              <div
                key={m}
                onClick={() => setMode(m)}
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '5px 0',
                  borderRadius: 6,
                  backgroundColor: mode === m ? C.bg : 'transparent',
                  cursor: 'pointer',
                  boxShadow: mode === m ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
                }}
              >
                <span style={{ fontSize: 12, fontWeight: 'bold', color: mode === m ? C.primary : C.textTertiary }}>
                  {m === 'work' ? 'Work' : m === 'code' ? '</> Code' : 'Design'}
                </span>
              </div>
            ))}
          </div>

          {/* global nav */}
          <div onClick={host.newTask} style={{ display: 'flex', alignItems: 'center', padding: '7px 8px', borderRadius: 6, cursor: 'pointer' }}>
            <span style={{ fontSize: 14, color: C.primary, marginRight: 8 }}>＋</span>
            <span style={{ fontSize: 13, color: C.textSecondary }}>New task</span>
          </div>
          <SkillsPanel
            capabilities={providerCapabilities}
            error={providerCapabilitiesError}
            loading={providerCapabilitiesLoading}
            source={providerCapabilitiesSource}
            onInsertCommand={insertProviderCapabilityCommand}
          />
          <div style={{ display: 'flex', alignItems: 'center', padding: '7px 8px', borderRadius: 6, marginBottom: 14 }}>
            <span style={{ fontSize: 14, color: C.textTertiary, marginRight: 8 }}>⏱</span>
            <span style={{ fontSize: 13, color: C.textSecondary }}>Automation</span>
          </div>

          {/* task list header + plugin switcher */}
          <div style={{ display: 'flex', alignItems: 'center', padding: '10px 4px 6px' }}>
            <span style={{ flex: 1, fontSize: 12, fontWeight: 'bold', color: C.textTertiary }}>Your Task List</span>
            <span style={{ fontSize: 13, color: C.textTertiary, marginRight: 8, cursor: 'pointer' }}>⌁</span>
            <span style={{ fontSize: 13, color: C.textTertiary, marginRight: 8, cursor: 'pointer' }}>≡</span>
            <Picker
              label=""
              options={PLUGINS.map((p) => ({ key: p.id, title: p.ready ? p.name : `${p.name}（计划中）`, sub: p.tagline }))}
              onPick={(key) => setPluginId(key)}
            />
          </div>

          <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
            {plugin.render(host)}
          </div>

        </div>
      ) : null}

      {!railOpen ? (
        <div
          title="展开左栏"
          style={{
            width: 32,
            flexShrink: 0,
            minHeight: 0,
            backgroundColor: C.bg,
            borderRight: `1px solid ${C.border}`,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            padding: '12px 0',
            boxSizing: 'border-box',
          }}
        >
          <PanelToggleButton side="left" open={railOpen} title="展开左栏" onClick={() => setRailOpen(true)} />
        </div>
      ) : null}

      {/* ── Centre: conversation ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
        {/* top bar */}
        <div style={{ display: 'flex', alignItems: 'center', height: 40, flexShrink: 0, padding: '0 18px', borderBottom: `1px solid ${C.border}` }}>
          <span style={{ fontWeight: 'bold', fontSize: 13, marginRight: 8 }}>{selectedTask?.title ?? 'Atelier'}</span>
          <span style={{ fontSize: 12, color: C.textQuaternary, marginRight: 4 }}>▻</span>
          <span style={{ fontSize: 12, color: C.textTertiary, marginRight: 4 }}>{selectedTask?.project ?? 'workspace projection'}</span>
          <span style={{ fontSize: 12, color: C.textQuaternary }}>
            · {controlledStatusScenario ? `scenario ${controlledStatusScenario}` : runtimeStatus?.kind === 'ready' && runtimeStatus.lastEventSeq !== undefined ? `seq ${runtimeStatus.lastEventSeq}` : runtimeStatus?.kind ?? 'ready'}
          </span>
          <div style={{ flex: 1 }} />
          <BudgetStrip budget={budgetProjection} fallbackPercent={budgetPct} fallbackLabel={`$${state.budgetSpent}/$${state.budgetCap}`} />
          <span
            onClick={openWorkspace}
            title={selectedTask?.workspaceOpenTarget ? `${selectedTask.workspaceOpenTarget.label} · Host intent only; accepts pt-workspace://, no file URL, shell, or execute capability. ${workspaceOpenStatus || selectedTask.workspaceOpenTarget.workspaceUri}` : 'No workspace target'}
            style={{ height: 28, display: 'inline-flex', alignItems: 'center', border: `1px solid ${C.border}`, borderRadius: 8, padding: '0 10px', fontSize: 12, color: selectedTask?.workspaceOpenTarget ? C.textSecondary : C.textQuaternary, marginRight: 10, cursor: selectedTask?.workspaceOpenTarget ? 'pointer' : 'default', opacity: workspaceOpenSubmitting ? 0.6 : 1 }}
          >
            {workspaceOpenSubmitting ? 'Opening' : 'Open in'} <span style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: '#10b981', marginLeft: 6 }} />
            <span style={{ marginLeft: 8, color: C.textTertiary }}>⌄</span>
          </span>
          <span
            title="Open in IDE boundary: this prototype submits a Host workspace.open intent only; real IDE launch E2E is not proven by local gates."
            style={{ height: 24, display: 'inline-flex', alignItems: 'center', border: `1px solid ${C.border}`, borderRadius: 8, padding: '0 8px', fontSize: 11, color: C.textTertiary, marginRight: 8, backgroundColor: C.fillSecondary }}
          >
            Host intent · no file/shell/execute
          </span>
          <span
            title="Prototype-only topbar tool: terminal panel is not wired to shell or execute capability."
            style={{ height: 24, display: 'inline-flex', alignItems: 'center', gap: 5, border: `1px solid ${C.border}`, borderRadius: 8, padding: '0 8px', fontSize: 11, color: C.textTertiary, marginRight: 8, backgroundColor: C.fillSecondary }}
          >
            □ Terminal
          </span>
          <span
            title="Prototype-only topbar tool: outline panel is not wired to a real task graph panel."
            style={{ height: 24, display: 'inline-flex', alignItems: 'center', gap: 5, border: `1px solid ${C.border}`, borderRadius: 8, padding: '0 8px', fontSize: 11, color: C.textTertiary, backgroundColor: C.fillSecondary }}
          >
            ☰ Outline
          </span>
        </div>

        {/* stream */}
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '18px 24px 0' }}>
          <div style={{ width: `min(${contentMax}px, 100%)`, margin: '0 auto' }}>
            {recoveryStatus ? (
              <RecoveryPanel status={recoveryStatus} onRetry={reloadWorkspace} />
            ) : pageSurface.emptyVisible ? (
              <div style={{ color: C.textQuaternary, fontSize: 13, textAlign: 'center', marginTop: 80 }}>
                交给 Atelier 一个目标，它会拆解、协商、推进。
              </div>
            ) : null}
            {pageSurface.streamVisible ? stream.map(renderBlock) : null}
          </div>
        </div>

        {/* composer */}
        <div style={{ flexShrink: 0, padding: '12px 24px 12px' }}>
          <ArtifactsTray artifacts={artifacts} openId={preview?.id} maxWidth={contentMax} onOpen={(a) => setPreview(a)} />
          <div style={{ width: `min(${contentMax}px, 100%)`, margin: '0 auto 6px', color: C.textTertiary, fontSize: 11 }}>
            Attachment input is prototype-only: image/file upload is not wired to Host Storage or Run input_snapshot yet.
          </div>
          <PromptComposer
            value={draft}
            onChange={setDraft}
            maxWidth={contentMax}
            density="compact"
            placeholder="Help you write code, debugs, optimize performance and other development work, deliver production-ready code."
            modelNode={
              <>
                <RunPicker
                  runKind={runKind}
                  model={state.model}
                  flowId={flowId}
                  onPickModel={(m) => {
                    setRunKind('model');
                    void runtime.setModel(m).then(applySnapshot);
                  }}
                  onPickFlow={(id) => { setRunKind('agents'); setFlowId(id); }}
                />
              </>
            }
            onSend={sendDraft}
            sendDisabled={!draft.trim()}
          />
        </div>
      </div>

      {/* ── Right panel: preview (when an artifact is open) or TaskGraph / Todo + Context ── */}
      {preview ? (
        <div style={{ width: 460, flexShrink: 0, minHeight: 0, display: 'flex', backgroundColor: C.bg, borderLeft: `1px solid ${C.border}`, overflow: 'hidden' }}>
          <PreviewPanel
            artifact={preview}
            taskId={selected}
            onClose={() => setPreview(null)}
            onFetchBody={runtime.fetchArtifactBody}
            onOpenPreview={runtime.openArtifactPreview}
          />
        </div>
      ) : hasRightPanel ? (
        railRightOpen ? (
          <div
            style={{ width: 'min(226px, 30%)', flexShrink: 0, minHeight: 0, boxSizing: 'border-box', overflow: 'auto', backgroundColor: C.bg, borderLeft: `1px solid ${C.border}`, padding: '14px 16px' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', marginBottom: 4 }}>
              <PanelToggleButton side="right" open={railRightOpen} title="折叠右栏" onClick={() => setRailRightOpen(false)} />
            </div>
            <div>
              {selectedProject ? (
                <>
                  <ProjectHealthProjectionPanel project={selectedProject} />
                  <TaskGraphProjectionPanel project={selectedProject} />
                </>
              ) : todos && todos.length > 0 ? (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
                    <span style={{ fontWeight: 'bold', fontSize: 13 }}>Todo</span>
                  </div>
                  {todos.map((t) => <TodoRow key={t.id} t={t} />)}
                </>
              ) : (
                <div style={{ height: 126, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', borderBottom: `1px solid ${C.border}`, color: C.textQuaternary, textAlign: 'center' }}>
                  <div style={{ width: 30, height: 30, borderRadius: 8, border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 10 }}>☷</div>
                  <div style={{ fontSize: 13, fontWeight: 'bold', color: C.textTertiary }}>No todos yet</div>
                  <div style={{ fontSize: 12, lineHeight: '18px', maxWidth: 170 }}>Progress for complex tasks will appear here</div>
                </div>
              )}
            </div>
            {ctx ? <ContextPanel ctx={ctx} /> : null}
          </div>
        ) : (
          <div
            title="展开 TaskGraph / Todo + Context"
            style={{
              width: 32,
              flexShrink: 0,
              minHeight: 0,
              backgroundColor: C.bg,
              borderLeft: `1px solid ${C.border}`,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              padding: '12px 0',
            }}
          >
            <PanelToggleButton side="right" open={railRightOpen} title="展开右栏" onClick={() => setRailRightOpen(true)} />
          </div>
        )
      ) : null}
    </div>
  );
}
