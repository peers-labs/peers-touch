// Applet lifecycle contract — cross-platform state machine.
//
// Authoritative source: docs/architecture/platform/applet-runtime/applet-lifecycle-architecture.md
//   §3 状态机 + 状态转换事件表, §10 Applet Instance Registry 数据模型.
//
// The lifecycle (keep-alive / reclaim) is owned by the Applet Kernel and is
// identical across Desktop (Tauri WebView + Lynx for Web) and Mobile (native
// LynxView). Only the surface-carrying technology differs; the state machine
// frozen here does not.

/**
 * Applet lifecycle states (architecture §3 / §10).
 *
 * - `cold`          未加载，无资源占用
 * - `materializing` 解析 manifest、准备 surface、加载 bundle
 * - `visible`       前台可交互
 * - `hidden-warm`   切走但保留全部资源，切回 instant
 * - `paused`        App 后台或系统 idle，timer/rAF 冻结
 * - `suspended`     长期不用，保留最小状态，可快速恢复
 * - `destroyed`     完全回收，再次打开是 cold start
 */
export type AppletLifecycleState =
  | 'cold'
  | 'materializing'
  | 'visible'
  | 'hidden-warm'
  | 'paused'
  | 'suspended'
  | 'destroyed';

export const APPLET_LIFECYCLE_STATES = Object.freeze([
  'cold',
  'materializing',
  'visible',
  'hidden-warm',
  'paused',
  'suspended',
  'destroyed',
] as const satisfies readonly AppletLifecycleState[]);

/**
 * Lifecycle event types (architecture §3 状态转换事件 + §10).
 *
 * `memory-pressure` and `error` are signals fed to the Kernel that may resolve
 * into a `destroy`/`suspend` transition; they are not standalone target states.
 */
export type AppletLifecycleEventType =
  | 'launch'
  | 'ready'
  | 'show'
  | 'hide'
  | 'pause'
  | 'resume'
  | 'suspend'
  | 'restore'
  | 'destroy'
  | 'memory-pressure'
  | 'error';

export const APPLET_LIFECYCLE_EVENT_TYPES = Object.freeze([
  'launch',
  'ready',
  'show',
  'hide',
  'pause',
  'resume',
  'suspend',
  'restore',
  'destroy',
  'memory-pressure',
  'error',
] as const satisfies readonly AppletLifecycleEventType[]);

/** Lifecycle event envelope (architecture §10). */
export interface AppletLifecycleEvent {
  type: AppletLifecycleEventType;
  appletId: string;
  instanceId: string;
  timestamp: number;
  reason?: string;
}

/** Applet Instance Registry record (architecture §10). */
export interface AppletInstance {
  appletId: string;
  instanceId: string;
  sessionId: string;
  state: AppletLifecycleState;
  createdAt: number;
  lastVisibleAt: number;
  lastHiddenAt: number;
  /** Last invoke/event touch time. */
  lastTouchedAt: number;
  /** Best-effort memory estimate in bytes. */
  memoryEstimate: number;
  crashCount: number;
  manifestVersion: string;
  platform: 'desktop' | 'android' | 'ios';
}

/**
 * Legal transition table (architecture §3 状态转换事件表).
 *
 * Each entry maps an event type to the source states it accepts and the target
 * state it produces. `resume` and `destroy` need context-sensitive handling and
 * are validated separately in {@link isValidTransition}.
 */
interface TransitionRule {
  from: readonly AppletLifecycleState[];
  to: AppletLifecycleState;
}

const TRANSITION_RULES: Readonly<Record<
  Exclude<AppletLifecycleEventType, 'resume' | 'destroy' | 'memory-pressure' | 'error'>,
  TransitionRule
>> = Object.freeze({
  launch: { from: ['cold'], to: 'materializing' },
  ready: { from: ['materializing'], to: 'visible' },
  show: { from: ['hidden-warm', 'paused', 'suspended'], to: 'visible' },
  hide: { from: ['visible'], to: 'hidden-warm' },
  pause: { from: ['visible', 'hidden-warm'], to: 'paused' },
  suspend: { from: ['hidden-warm', 'paused'], to: 'suspended' },
  restore: { from: ['suspended'], to: 'visible' },
});

/**
 * `resume` returns from `paused` to whichever visibility the instance held
 * before pausing (architecture §3: "visible (如果之前是 visible) 或 hidden-warm").
 * Both are legal targets; the Kernel selects based on the pre-pause state.
 */
const RESUME_SOURCES: readonly AppletLifecycleState[] = ['paused'];
const RESUME_TARGETS: readonly AppletLifecycleState[] = ['visible', 'hidden-warm'];

/** `destroy` is legal from any non-cold, non-destroyed state (architecture §3). */
function isDestroyable(from: AppletLifecycleState): boolean {
  return from !== 'cold' && from !== 'destroyed';
}

/**
 * Validate a single lifecycle transition against the frozen state machine.
 *
 * @param from   current state
 * @param event  lifecycle event type driving the transition
 * @param to     proposed target state
 * @returns whether the transition is legal
 */
export function isValidTransition(
  from: AppletLifecycleState,
  event: AppletLifecycleEventType,
  to: AppletLifecycleState,
): boolean {
  if (event === 'destroy') {
    return to === 'destroyed' && isDestroyable(from);
  }
  if (event === 'resume') {
    return RESUME_SOURCES.includes(from) && RESUME_TARGETS.includes(to);
  }
  if (event === 'memory-pressure' || event === 'error') {
    // Signals resolve into suspend/destroy by the Kernel; only destroy/suspend
    // outcomes are legal state changes here.
    return (to === 'destroyed' && isDestroyable(from))
      || (to === 'suspended' && (from === 'hidden-warm' || from === 'paused'));
  }
  const rule = TRANSITION_RULES[event];
  return rule.from.includes(from) && rule.to === to;
}

/**
 * Resolve the target state for a deterministic event (all events except
 * `resume`, which is context-sensitive, and the `memory-pressure`/`error`
 * signals). Returns `undefined` when the event is not legal from `from`.
 */
export function nextState(
  from: AppletLifecycleState,
  event: Exclude<AppletLifecycleEventType, 'resume' | 'memory-pressure' | 'error'>,
): AppletLifecycleState | undefined {
  if (event === 'destroy') {
    return isDestroyable(from) ? 'destroyed' : undefined;
  }
  const rule = TRANSITION_RULES[event];
  return rule.from.includes(from) ? rule.to : undefined;
}
