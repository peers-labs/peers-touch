/**
 * Task Workbench prototype — pure state model.
 *
 * Expresses the contracts proven by TW-20261102:
 *  - governed multi-iteration turns park at tool_approval_required; a human
 *    decision resumes the SAME turn (revisioned approval, terminal receipt).
 *  - tools are schema-first, many-to-one onto two browser capabilities plus
 *    filesystem/shell; readiness is fail-closed per capability, not per call.
 *  - browser resources are device-owned, conversation-bound, with an explicit
 *    human/agent lease; held actions return BOUNDED tool results.
 *  - agent outputs are immutable versions; check and accept are separate.
 *  - memory candidates await human review and never consume a turn otherwise.
 *
 * Mock data only — every transition is deterministic; no network, no runtime.
 */

export type RiskClass = 'client-device' | 'client-browser';
export type ApprovalPolicy = 'MANUAL' | 'AUTO';
export type Readiness = 'ready' | 'blocked';

export interface Capability {
  id: string;
  label: string;
  family: 'filesystem' | 'shell' | 'browser';
  policy: ApprovalPolicy;
  readiness: Readiness;
  reasonCode?: string;
  granted: boolean;
}

export interface ApprovalReceipt {
  revision: number;
  decision: 'approved' | 'denied';
  decidedAt: string;
}

export interface ToolCallSpec {
  id: string;
  tool: string;
  capabilityId: string;
  risk: RiskClass;
  summary: string;
  /** Human-readable bounded evidence shown before the decision. */
  evidence: { label: string; value: string }[];
  status: 'pending' | 'approved' | 'denied';
  receipt?: ApprovalReceipt;
  result?: {
    exitCode?: number;
    output: string;
    durationMs: number;
    bounded: boolean;
  };
}

export interface ArtifactVersion {
  version: number;
  title: string;
  origin: 'agent_output' | 'feedback_revision';
  parent: number | null;
  createdAt: string;
  structuralCheck: 'none' | 'pass' | 'fail';
  accepted: boolean;
  current: boolean;
  sha: string;
}

export interface BrowserTab {
  id: string;
  title: string;
  url: string;
  lease: 'agent' | 'human';
  conversationBound: boolean;
}

export interface MemoryCandidate {
  id: string;
  summary: string;
  sourceTurn: string;
  status: 'candidate' | 'confirmed' | 'rejected';
}

export interface TerminalSession {
  id: string;
  label: string;
  status: 'running' | 'exited';
  workerOwned: boolean;
}

export interface TaskLine {
  id: string;
  title: string;
  kind: 'research' | 'build';
  updatedAt: string;
  active: boolean;
  pinned?: boolean;
}

export type EventKind =
  | 'user'
  | 'agent-note'
  | 'tool-call'
  | 'tool-result'
  | 'lease-held'
  | 'artifact';

export interface TurnEvent {
  id: string;
  kind: EventKind;
  text?: string;
  callId?: string;
  artifactVersion?: number;
}

export interface GovernedTurn {
  id: string;
  status: 'awaiting_decision' | 'running' | 'completed' | 'denied';
  iterations: number;
  events: TurnEvent[];
  calls: ToolCallSpec[];
  pendingCallId: string | null;
}

export interface Scenario {
  taskTitle: string;
  runtime: { provider: string; model: string; deviceConnected: boolean };
  tasks: TaskLine[];
  turn: GovernedTurn;
  artifacts: ArtifactVersion[];
  browserTabs: BrowserTab[];
  terminals: TerminalSession[];
  memories: MemoryCandidate[];
  capabilities: Capability[];
}

export type DockTab = 'artifacts' | 'browser' | 'terminal' | 'memory' | 'capabilities';

export interface WorkbenchState {
  scenario: Scenario;
  dockTab: DockTab;
  dockOpen: boolean;
  selectedArtifactVersion: number | null;
}

type Action =
  | { type: 'decide'; approved: boolean }
  | { type: 'select-dock'; tab: DockTab }
  | { type: 'toggle-dock' }
  | { type: 'review-memory'; id: string; decision: 'confirmed' | 'rejected' }
  | { type: 'check-artifact'; version: number; pass: boolean }
  | { type: 'accept-artifact'; version: number }
  | { type: 'select-task'; id: string }
  | { type: 'reset' };

const T0 = '09:41';

function call(partial: Partial<ToolCallSpec> & Pick<ToolCallSpec, 'id' | 'tool' | 'capabilityId' | 'risk' | 'summary'>): ToolCallSpec {
  return { status: 'pending', evidence: [], ...partial };
}

export function initialScenario(): Scenario {
  const calls: ToolCallSpec[] = [
    call({
      id: 'call-1',
      tool: 'local_shell_exec',
      capabilityId: 'shell.allowlist',
      risk: 'client-device',
      summary: 'Grep the served page for the build marker',
      evidence: [
        { label: 'command', value: "grep -R 'BUILD_STATUS' /workspace/site --include='*.html'" },
        { label: 'workdir', value: '/workspace/site' },
        { label: 'exit when done', value: 'process ends (no shell kept)' },
      ],
    }),
    call({
      id: 'call-2',
      tool: 'browser_navigate',
      capabilityId: 'browser.observe',
      risk: 'client-browser',
      summary: 'Open the local build page served by the device PTY',
      evidence: [
        { label: 'url', value: 'http://127.0.0.1:19464/brw-9f24.html' },
        { label: 'session', value: 'brows-01M6Q4V (this conversation)' },
        { label: 'lease', value: 'agent — a human takeover parks model actions' },
      ],
    }),
  ];

  const turn: GovernedTurn = {
    id: 'turn-governed-1',
    status: 'awaiting_decision',
    iterations: 1,
    pendingCallId: 'call-1',
    events: [
      { id: 'e1', kind: 'user', text: '启动本地服务并验证页面状态；失败就修好，再把核验报告作为成果交给我。' },
      { id: 'e2', kind: 'agent-note', text: '我先确认工作区里标记的当前值，需要你批准一次设备命令。' },
      { id: 'e3', kind: 'tool-call', callId: 'call-1' },
    ],
    calls,
  };

  return {
    taskTitle: '报名页 · 制作与验证',
    runtime: {
      provider: 'Volcengine ARK',
      model: 'doubao-seed (ep-20260623145021)',
      deviceConnected: true,
    },
    tasks: [
      { id: 'task-1', title: '场地研究 · 网页到方案', kind: 'research', updatedAt: '09:12', active: false },
      { id: 'task-2', title: '报名页 · 制作与验证', kind: 'build', updatedAt: T0, active: true, pinned: true },
      { id: 'task-3', title: '开放工作日 · 资料整理', kind: 'research', updatedAt: '昨天', active: false },
    ],
    turn,
    artifacts: [
      {
        version: 1,
        title: '报名页核验报告 v1',
        origin: 'agent_output',
        parent: null,
        createdAt: '09:36',
        structuralCheck: 'none',
        accepted: false,
        current: false,
        sha: '96ec516e5178774c',
      },
    ],
    browserTabs: [
      { id: 'brows-01M6Q4V', title: 'brw-9f24.html — build', url: 'http://127.0.0.1:19464/brw-9f24.html', lease: 'agent', conversationBound: true },
    ],
    terminals: [
      { id: 'terms-01', label: 'python3 -m http.server 19464', status: 'running', workerOwned: true },
    ],
    memories: [
      { id: 'mem-1', summary: '该项目构建标记只认 index.html 中的 BUILD_STATUS 文本节点。', sourceTurn: 'turn-7f2a', status: 'candidate' },
    ],
    capabilities: [
      { id: 'filesystem.read', label: '文件读取', family: 'filesystem', policy: 'MANUAL', readiness: 'ready', granted: true },
      { id: 'filesystem.write', label: '文件写入', family: 'filesystem', policy: 'MANUAL', readiness: 'ready', granted: true },
      { id: 'filesystem.edit', label: '文件编辑', family: 'filesystem', policy: 'MANUAL', readiness: 'ready', granted: true },
      { id: 'shell.allowlist', label: '命令执行（白名单）', family: 'shell', policy: 'MANUAL', readiness: 'ready', granted: true },
      { id: 'browser.observe', label: '浏览器观察', family: 'browser', policy: 'MANUAL', readiness: 'ready', granted: true },
      { id: 'browser.interact', label: '浏览器操作', family: 'browser', policy: 'MANUAL', readiness: 'blocked', reasonCode: 'human_takeover_held', granted: true },
    ],
  };
}

export function initialState(): WorkbenchState {
  return {
    scenario: initialScenario(),
    dockTab: 'artifacts',
    dockOpen: true,
    selectedArtifactVersion: null,
  };
}

const DECISION_TIME = '09:42';

function finishCall(scenario: Scenario, callId: string, approved: boolean): Scenario {
  const calls: ToolCallSpec[] = scenario.turn.calls.map((c): ToolCallSpec => {
    if (c.id !== callId) return c;
    const receipt: ApprovalReceipt = {
      revision: 1,
      decision: approved ? 'approved' : 'denied',
      decidedAt: DECISION_TIME,
    };
    if (!approved) return { ...c, status: 'denied' as const, receipt };
    const result = c.tool.startsWith('browser_')
      ? { output: '观察快照：<div id="build">BUILD_STATUS:FAIL</div>（引用代际 g18-e3）', durationMs: 840, bounded: true }
      : { exitCode: 1, output: 'index.html: BUILD_STATUS:FAIL', durationMs: 310, bounded: true };
    return { ...c, status: 'approved', receipt, result };
  });
  return { ...scenario, turn: { ...scenario.turn, calls } };
}

export function reduce(state: WorkbenchState, action: Action): WorkbenchState {
  switch (action.type) {
    case 'select-dock':
      return { ...state, dockTab: action.tab, dockOpen: true };
    case 'toggle-dock':
      return { ...state, dockOpen: !state.dockOpen };
    case 'select-task':
      return {
        ...state,
        scenario: {
          ...state.scenario,
          tasks: state.scenario.tasks.map((t) => ({ ...t, active: t.id === action.id })),
        },
      };
    case 'review-memory':
      return {
        ...state,
        scenario: {
          ...state.scenario,
          memories: state.scenario.memories.map((m) =>
            m.id === action.id ? { ...m, status: action.decision } : m),
        },
      };
    case 'check-artifact':
      return {
        ...state,
        scenario: {
          ...state.scenario,
          artifacts: state.scenario.artifacts.map((a) =>
            a.version === action.version
              ? { ...a, structuralCheck: action.pass ? 'pass' : 'fail' }
              : a),
        },
      };
    case 'accept-artifact':
      return {
        ...state,
        scenario: {
          ...state.scenario,
          artifacts: state.scenario.artifacts.map((a) => ({
            ...a,
            accepted: a.version === action.version,
            current: a.version === action.version,
          })),
        },
      };
    case 'decide': {
      const { turn } = state.scenario;
      const pendingId = turn.pendingCallId;
      if (!pendingId) return state;
      let scenario = finishCall(state.scenario, pendingId, action.approved);
      const call = scenario.turn.calls.find((c) => c.id === pendingId)!;

      if (!action.approved) {
        // The existing tool-call event re-renders with its denial receipt;
        // do not append a duplicate card.
        return {
          ...state,
          scenario: {
            ...scenario,
            turn: {
              ...scenario.turn,
              status: 'denied',
              pendingCallId: null,
            },
          },
        };
      }

      const isLast = scenario.turn.calls.indexOf(call) === scenario.turn.calls.length - 1;
      const events = [
        ...scenario.turn.events,
        { id: `ev-${scenario.turn.events.length + 1}`, kind: 'tool-result' as const, callId: pendingId },
      ];
      if (!isLast) {
        const nextCall = scenario.turn.calls[scenario.turn.calls.indexOf(call) + 1];
        events.push({ id: `ev-${events.length + 1}`, kind: 'tool-call', callId: nextCall.id });
        scenario = {
          ...scenario,
          turn: { ...scenario.turn, iterations: scenario.turn.iterations + 1, pendingCallId: nextCall.id, events },
        };
        return { ...state, scenario };
      }

      // Last call completes the turn; a lease-held interaction lands as a
      // bounded result and the output becomes a versioned artifact.
      events.push({ id: `ev-${events.length + 1}`, kind: 'lease-held', callId: 'call-2' });
      events.push({ id: `ev-${events.length + 1}`, kind: 'artifact', artifactVersion: 1 });
      scenario = {
        ...scenario,
        browserTabs: scenario.browserTabs.map((t) =>
          t.id === 'brows-01M6Q4V' ? { ...t, lease: 'human' } : t),
        capabilities: scenario.capabilities.map((c) =>
          c.id === 'browser.interact'
            ? { ...c, readiness: 'blocked', reasonCode: 'human_takeover_held' }
            : c),
        turn: { ...scenario.turn, status: 'completed', iterations: scenario.turn.iterations + 1, pendingCallId: null, events },
      };
      return { ...state, scenario };
    }
    case 'reset':
      return initialState();
    default:
      return state;
  }
}
