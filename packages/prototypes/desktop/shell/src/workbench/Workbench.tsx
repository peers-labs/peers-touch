/**
 * Task Workbench prototype — peers-ui refactor reference.
 *
 * Single continuous split-workspace (Agent UI Identity): task rail ·
 * governed conversation · resource dock. Everything composes peers-ui
 * primitives and UI Identity tokens; there is no second visual language.
 *
 * Run inside the only Desktop Shell prototype:
 *   ?site=desktop&state=task-workbench
 */
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  Button,
  IconButton,
  Segmented,
  Tag,
  UIProvider,
} from '@peers-touch/ui';
import {
  Bot,
  RotateCcw,
  ShieldCheck,
  Square,
} from 'lucide-react';
import {
  initialState,
  reduce,
  type DockTab,
  type GovernedTurn,
  type Scenario,
  type ToolCallSpec,
} from './model';
import {
  ApprovalCard,
  ArtifactCardView,
  LeaseHeldCard,
  ToolResultCard,
} from './cards';
import {
  ArtifactsPanel,
  BrowserPanel,
  CapabilitiesPanel,
  MemoryPanel,
  TerminalPanel,
} from './panels';

const fontStack: React.CSSProperties = { fontFamily: 'var(--pt-font)' };

function shellLine(height: number | string): React.CSSProperties {
  return { height, display: 'flex', flexDirection: 'column', minHeight: 0 };
}

function hairlineRight(): React.CSSProperties {
  return { borderRight: '1px solid var(--pt-border)' };
}

function TaskRail({ scenario, onSelect }: { scenario: Scenario; onSelect: (id: string) => void }) {
  return (
    <aside
      data-workbench-rail="tasks"
      style={{
        width: 230,
        minWidth: 0,
        flexShrink: 0,
        background: 'var(--pt-surface)',
        ...hairlineRight(),
        ...shellLine('100%'),
      }}
    >
      <div
        style={{
          height: 48,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '0 var(--pt-space-md)',
          borderBottom: '1px solid var(--pt-border)',
        }}
      >
        <Bot size={15} aria-hidden />
        <strong style={{ fontSize: 13, color: 'var(--pt-text)' }}>持续任务</strong>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: 'var(--pt-space-xs)' }}>
        {scenario.tasks.map((task) => (
          <button
            key={task.id}
            type="button"
            data-task-row={task.id}
            aria-pressed={task.active}
            onClick={() => onSelect(task.id)}
            style={{
              width: '100%',
              textAlign: 'left',
              display: 'block',
              padding: '10px 12px',
              borderRadius: 'var(--pt-radius-md)',
              border: 0,
              cursor: 'pointer',
              background: task.active ? 'var(--pt-primary-subtle)' : 'transparent',
              color: task.active ? 'var(--pt-text)' : 'var(--pt-secondary)',
            }}
          >
            <span style={{ display: 'block', fontSize: 13, fontWeight: 600 }}>{task.title}</span>
            <span style={{ display: 'block', marginTop: 2, fontSize: 11, color: 'var(--pt-muted)' }}>
              {task.kind === 'research' ? '研究/文档' : '代码/服务'} · {task.updatedAt}
            </span>
          </button>
        ))}
      </div>
    </aside>
  );
}

function RuntimeHeader({ scenario, onStop }: { scenario: Scenario; onStop: () => void }) {
  const running = scenario.turn.status === 'awaiting_decision' || scenario.turn.status === 'running';
  return (
    <div
      style={{
        height: 48,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '0 var(--pt-space-md)',
        borderBottom: '1px solid var(--pt-border)',
        background: 'var(--pt-surface)',
      }}
    >
      <strong
        style={{
          fontSize: 14,
          color: 'var(--pt-text)',
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {scenario.taskTitle}
      </strong>
      <Tag tone="neutral" title={`${scenario.runtime.provider} · ${scenario.runtime.model}`}>
        {scenario.runtime.provider}
      </Tag>
      <span
        title={`${scenario.runtime.provider} · ${scenario.runtime.model}；设备会话已连接`}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 12,
          color: 'var(--pt-success)',
          minWidth: 0,
          overflow: 'hidden',
          whiteSpace: 'nowrap',
        }}
      >
        <span
          aria-label="设备会话已连接"
          aria-hidden
          style={{ width: 6, height: 6, flexShrink: 0, borderRadius: 99, background: 'var(--pt-success)' }}
        />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>设备会话已连接</span>
      </span>
      <span style={{ flex: 1 }} />
      {running ? (
        <Button
          actionId="workbench.turn.stop"
          emphasis="quiet"
          tone="danger"
          density="compact"
          leading={<Square size={13} aria-hidden />}
          onActivate={onStop}
        >
          停止
        </Button>
      ) : (
        <Tag tone={scenario.turn.status === 'denied' ? 'danger' : 'success'}>
          turn {scenario.turn.status}
        </Tag>
      )}
    </div>
  );
}

function CallStream({
  scenario,
  dispatch,
}: {
  scenario: Scenario;
  dispatch: React.Dispatch<Parameters<typeof reduce>[1]>;
}) {
  const { turn } = scenario;
  const byId = useMemo(() => new Map(turn.calls.map((c) => [c.id, c])), [turn.calls]);
  return (
    <>
      {turn.events.map((event) => {
        if (event.kind === 'user') {
          return (
            <div key={event.id} data-turn-event="user" style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <div
                style={{
                  maxWidth: '82%',
                  background: 'var(--pt-primary)',
                  color: 'var(--pt-white, #fff)',
                  borderRadius: 'var(--pt-radius-lg)',
                  padding: '8px 12px',
                  fontSize: 13,
                }}
              >
                {event.text}
              </div>
            </div>
          );
        }
        if (event.kind === 'agent-note') {
          return (
            <div key={event.id} data-turn-event="agent-note" style={{ fontSize: 13, color: 'var(--pt-secondary)' }}>
              {event.text}
            </div>
          );
        }
        if (event.kind === 'tool-call') {
          const call: ToolCallSpec | undefined = event.callId ? byId.get(event.callId) : undefined;
          if (!call) return null;
          return <ApprovalCard key={event.id} call={call} onDecide={(approved) => dispatch({ type: 'decide', approved })} />;
        }
        if (event.kind === 'tool-result') {
          const call: ToolCallSpec | undefined = event.callId ? byId.get(event.callId) : undefined;
          return call ? <ToolResultCard key={event.id} call={call} /> : null;
        }
        if (event.kind === 'lease-held') return <LeaseHeldCard key={event.id} />;
        if (event.kind === 'artifact') {
          const artifact = scenario.artifacts.find((a) => a.version === event.artifactVersion);
          if (!artifact) return null;
          return (
            <ArtifactCardView
              key={event.id}
              version={artifact.version}
              title={artifact.title}
              status={artifact.structuralCheck}
              accepted={artifact.accepted}
              onCheck={(pass) => dispatch({ type: 'check-artifact', version: artifact.version, pass })}
              onAccept={() => dispatch({ type: 'accept-artifact', version: artifact.version })}
            />
          );
        }
        return null;
      })}
    </>
  );
}

const DOCK_TABS: { value: DockTab; label: string }[] = [
  { value: 'artifacts', label: '成果' },
  { value: 'browser', label: '浏览' },
  { value: 'terminal', label: '终端' },
  { value: 'memory', label: '记忆' },
  { value: 'capabilities', label: '能力' },
];

function ResourceDock({
  state,
  dispatch,
  overlay,
}: {
  state: ReturnType<typeof initialState>;
  dispatch: React.Dispatch<Parameters<typeof reduce>[1]>;
  overlay: boolean;
}) {
  const { scenario, dockTab } = state;
  const blockedCount = scenario.capabilities.filter((c) => c.readiness === 'blocked').length;
  const memoryCount = scenario.memories.filter((m) => m.status === 'candidate').length;
  const badgeFor = (tab: DockTab) => {
    if (tab === 'memory' && memoryCount > 0) return ` ${memoryCount}`;
    if (tab === 'capabilities' && blockedCount > 0) return ` ${blockedCount}`;
    return '';
  };
  const tabs = DOCK_TABS.map((t) => ({
    value: t.value,
    label: `${t.label}${badgeFor(t.value)}`,
  }));
  return (
    <aside
      data-workbench-rail="resources"
      data-overlay={overlay || undefined}
      style={{
        width: 296,
        maxWidth: '82%',
        minWidth: 0,
        flexShrink: 0,
        background: 'var(--pt-surface)',
        borderLeft: '1px solid var(--pt-border)',
        ...(overlay
          ? {
              position: 'absolute',
              top: 0,
              right: 0,
              bottom: 0,
              boxShadow: 'var(--pt-shadow-float)',
              zIndex: 5,
            }
          : {}),
        ...shellLine('100%'),
      }}
    >
      <div
        style={{
          height: 48,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '0 var(--pt-space-xs)',
          borderBottom: '1px solid var(--pt-border)',
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <Segmented
            options={tabs}
            value={dockTab}
            density="compact"
            scrollable
            onValueChange={(value) => dispatch({ type: 'select-dock', tab: value })}
            style={{ width: '100%' }}
          />
        </div>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: 'var(--pt-space-md)' }}>
        {dockTab === 'artifacts' ? (
          <ArtifactsPanel
            artifacts={scenario.artifacts}
            onCheck={(version, pass) => dispatch({ type: 'check-artifact', version, pass })}
            onAccept={(version) => dispatch({ type: 'accept-artifact', version })}
          />
        ) : null}
        {dockTab === 'browser' ? <BrowserPanel tabs={scenario.browserTabs} /> : null}
        {dockTab === 'terminal' ? <TerminalPanel terminals={scenario.terminals} /> : null}
        {dockTab === 'memory' ? (
          <MemoryPanel
            memories={scenario.memories}
            onReview={(id, decision) => dispatch({ type: 'review-memory', id, decision })}
          />
        ) : null}
        {dockTab === 'capabilities' ? <CapabilitiesPanel capabilities={scenario.capabilities} /> : null}
      </div>
    </aside>
  );
}

function ComposerBlocked({ turn }: { turn: GovernedTurn }) {
  if (turn.status !== 'awaiting_decision') {
    return (
      <div style={{ fontSize: 12, color: 'var(--pt-muted)' }}>
        Turn 已终态（{turn.status}）。新一轮输入从这里继续。
      </div>
    );
  }
  return (
    <div
      role="status"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        fontSize: 12,
        color: 'var(--pt-warning)',
      }}
    >
      <ShieldCheck size={14} aria-hidden />
      有一次工具调用等待你的决策；处理前不能发送新消息。
    </div>
  );
}

const NARROW_BREAKPOINT = 920;

export function TaskWorkbench() {
  const [state, dispatch] = useReducer(reduce, undefined, initialState);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  const didInit = useRef(false);
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const apply = (w: number) => {
      setWidth(w);
      // Narrow hosts default to a closed dock; opening it overlays instead
      // of squeezing the conversation rail (narrow-container contract).
      if (!didInit.current) {
        didInit.current = true;
        if (w < NARROW_BREAKPOINT) dispatch({ type: 'toggle-dock' });
      }
    };
    apply(el.clientWidth);
    const observer = new ResizeObserver((entries) => {
      apply(entries[0]?.contentRect.width ?? el.clientWidth);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const overlayDock = width < NARROW_BREAKPOINT && state.dockOpen;
  const { scenario } = state;
  return (
    <UIProvider style={{ height: '100%' }}>
      <div
        ref={rootRef}
        data-workbench-prototype
        data-narrow={width < NARROW_BREAKPOINT || undefined}
        style={{
          ...fontStack,
          ...shellLine('100%'),
          position: 'relative',
          flexDirection: 'row',
          background: 'var(--pt-canvas)',
        }}
      >
        <TaskRail scenario={scenario} onSelect={(id) => dispatch({ type: 'select-task', id })} />
        <main style={{ flex: 1, minWidth: 0, ...shellLine('100%') }}>
          <RuntimeHeader scenario={scenario} onStop={() => undefined} />
          <div style={{ flex: 1, overflow: 'auto', padding: 'var(--pt-space-lg)', display: 'flex', flexDirection: 'column', gap: 'var(--pt-space-md)' }}>
            <CallStream scenario={scenario} dispatch={dispatch} />
          </div>
          <div
            style={{
              flexShrink: 0,
              borderTop: '1px solid var(--pt-border)',
              background: 'var(--pt-surface)',
              padding: 'var(--pt-space-sm) var(--pt-space-md)',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
            }}
          >
            <ComposerBlocked turn={scenario.turn} />
            <span style={{ flex: 1 }} />
            <Button actionId="workbench.scenario.reset" emphasis="quiet" density="compact"
              leading={<RotateCcw size={13} aria-hidden />}
              onActivate={() => dispatch({ type: 'reset' })}
            >
              重置场景
            </Button>
            <IconButton
              iconId={state.dockOpen ? 'panel-right-close' : 'panel-right-open'}
              label={state.dockOpen ? '收起工作台' : '展开工作台'}
              actionId="workbench.dock.toggle"
              onActivate={() => dispatch({ type: 'toggle-dock' })}
            />
          </div>
        </main>
        {overlayDock ? (
          <button
            type="button"
            aria-label="关闭工作台"
            data-workbench-scrim
            onClick={() => dispatch({ type: 'toggle-dock' })}
            style={{
              position: 'absolute',
              inset: 0,
              zIndex: 4,
              border: 0,
              background: 'var(--pt-scrim)',
              cursor: 'default',
            }}
          />
        ) : null}
        {state.dockOpen ? <ResourceDock state={state} dispatch={dispatch} overlay={overlayDock} /> : null}
      </div>
    </UIProvider>
  );
}
