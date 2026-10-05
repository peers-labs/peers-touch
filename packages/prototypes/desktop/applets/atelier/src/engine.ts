/**
 * Atelier — multi-engine collaboration core (EnginePolicy abstraction).
 *
 * This is the prototype's *proof of the multi-engine claim*. The six
 * orchestration engines in the design are NOT six separate implementations.
 * They share ONE substrate and differ only in a pluggable `EnginePolicy`
 * that answers three questions:
 *
 *   ① who speaks each round            (schedule)
 *   ② how the session converges        (convergence mechanism wording)
 *   ③ who holds terminal sign-off      (input.authority + the final round)
 *
 * The shared substrate — the `runSession` state machine and the consensus
 * gate inside it — is identical for every engine. Switching engines swaps the
 * policy and re-runs the SAME machine over the SAME position pool, which is
 * why the same input produces visibly different negotiation traces.
 *
 * ── Landing anchor (this is a faithful TS mirror of real Station Go code) ──
 *   - The per-agent execution each "turn" maps to is already real:
 *     apps/station/app/subserver/agent/service/turn_service.go (ExecuteTurn:
 *     prompt → provider call → model→tool→model loop → persistence).
 *   - The "fan out N speakers in one round" primitive is already real:
 *     apps/station/app/subserver/agent/service/delegation_service.go
 *     (bounded-concurrency Execute with a semaphore + result collection).
 *   - What does NOT yet exist in Go (the gap this abstraction defines):
 *     EnginePolicy, CollaborationSession state machine, the consensus gate,
 *     and the AgentRole/EngineType enums. See the feasibility note in
 *     docs/architecture/domains/applets/atelier/.
 */
import type { Role } from './types';

/** First-batch engines covering three structurally distinct convergence forms. */
export type EngineId = 'expert-hierarchy' | 'roundtable' | 'debate-judge';

/**
 * One stance a role brings to the table. This is the engine-independent raw
 * material; every engine arranges the same positions differently.
 */
export interface Position {
  role: Role;
  stance: 'proposal' | 'objection' | 'counter' | 'signoff';
  text: string;
  /** anti-echo (design.md §4.1): objections/approvals must carry evidence */
  evidenceRef?: string;
}

/** The shared, engine-independent inputs to a collaboration. */
export interface CollaborationInput {
  goal: string;
  /** the candidate positions different roles bring to the table */
  positions: Position[];
  /** which role holds terminal sign-off authority (design.md §3.2) */
  authority: Role;
}

/** A single speaker act inside a round. */
export interface Turn {
  role: Role;
  stance: 'proposal' | 'objection' | 'counter' | 'signoff';
  text: string;
  evidenceRef?: string;
  /** a sign-off that escalates to a human instead of closing the session */
  escalates?: boolean;
  /** optional procedural label, e.g. "正方" / "反方" / "Judge" */
  badge?: string;
}

/** One round of the negotiation. `mode` is the visible structural tell. */
export interface Round {
  index: number;
  /** engine-specific phase label shown in the UI */
  label: string;
  /** serial = ordered chain; parallel = everyone speaks at once */
  mode: 'serial' | 'parallel';
  turns: Turn[];
}

/** The shared session lifecycle. */
export type SessionPhase = 'gathering' | 'converging' | 'reached' | 'awaiting_human';

/** Outcome of the shared consensus gate. */
export interface ConvergenceResult {
  phase: 'reached' | 'awaiting_human';
  /** engine-specific one-liner describing how it converged */
  mechanism: string;
  /** the terminal verdict / merge / sign-off text */
  verdict: string;
  authoritySignoff: boolean;
  /** evidence-backed objections still unresolved (blocks `reached`) */
  pendingObjections: number;
}

/** The full trace a UI renders. */
export interface SessionTrace {
  engineId: EngineId;
  engineName: string;
  convergenceMechanism: string;
  authority: Role;
  rounds: Round[];
  result: ConvergenceResult;
}

/**
 * The pluggable part. An engine is just a name, a convergence-mechanism label,
 * and a `schedule` that arranges the shared positions into rounds (including
 * its own terminal round: authority sign-off / facilitator merge / judge
 * verdict). Everything else lives in the shared runner below.
 */
export interface EnginePolicy {
  id: EngineId;
  name: string;
  convergenceMechanism: string;
  schedule(input: CollaborationInput): Round[];
}

// ---------------------------------------------------------------------------
// runSession — the SHARED state machine (identical for every engine)
// ---------------------------------------------------------------------------

/**
 * Drives the engine-independent lifecycle and applies the shared consensus
 * gate. Policies never touch this; they only supply the round schedule. That
 * separation is the whole point: swap the policy, the substrate is unchanged.
 *
 * Consensus gate (design.md §4.1): a session is `reached` IFF
 *   authority_signoff == true  AND  evidence-backed pending objections == 0.
 * Otherwise it escalates to a human (`awaiting_human`).
 */
export function runSession(policy: EnginePolicy, input: CollaborationInput): SessionTrace {
  // phase: gathering → converging → reached | awaiting_human
  let phase: SessionPhase = 'gathering';

  // Step 1 — gather: the policy decides who speaks, in what rounds.
  const rounds = policy.schedule(input);

  // Step 2 — converge: apply the shared gate over all turns.
  phase = 'converging';
  const allTurns = rounds.flatMap((r) => r.turns);

  // Anti-echo: an objection only counts if it carries evidence; an
  // evidence-less objection is downgraded to a "doubt" and does not block.
  // A later counter resolves one matching evidence-backed objection.
  const evidenceObjections = allTurns.filter((t) => t.stance === 'objection' && !!t.evidenceRef).length;
  const counters = allTurns.filter((t) => t.stance === 'counter').length;
  const pendingObjections = Math.max(0, evidenceObjections - counters);

  // The terminal sign-off is whatever the policy's final round produced.
  // An escalating sign-off does NOT count as authority approval.
  const signoffTurn = allTurns.find((t) => t.stance === 'signoff');
  const authoritySignoff = !!signoffTurn && !signoffTurn.escalates;

  const reached = authoritySignoff && pendingObjections === 0;
  phase = reached ? 'reached' : 'awaiting_human';

  return {
    engineId: policy.id,
    engineName: policy.name,
    convergenceMechanism: policy.convergenceMechanism,
    authority: input.authority,
    rounds,
    result: {
      phase,
      mechanism: policy.convergenceMechanism,
      verdict: signoffTurn?.text ?? '未产生终裁意见',
      authoritySignoff,
      pendingObjections,
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers to pull positions out of the shared pool by role/stance
// ---------------------------------------------------------------------------

function pick(input: CollaborationInput, role: Role, stance: Position['stance']): Position | undefined {
  return input.positions.find((p) => p.role === role && p.stance === stance);
}

function toTurn(p: Position | undefined, extra?: Partial<Turn>): Turn {
  if (!p) return { role: 'Historian', stance: 'proposal', text: '（无对应立场）', ...extra };
  return { role: p.role, stance: p.stance, text: p.text, evidenceRef: p.evidenceRef, ...extra };
}

// ---------------------------------------------------------------------------
// Policy 1 — Expert Hierarchy (default): serial expert chain + terminal sign-off
// ---------------------------------------------------------------------------

const expertHierarchy: EnginePolicy = {
  id: 'expert-hierarchy',
  name: 'Expert Hierarchy（默认）',
  convergenceMechanism: '终裁签字 + 无未决反对（专家串行链）',
  schedule(input) {
    // Ordered chain: the senior experts speak in sequence, each building on
    // the last; then the authority gate reviews. No parallel divergence.
    const chain: Turn[] = [
      toTurn(pick(input, 'Planner', 'proposal')),
      toTurn(pick(input, 'Risk', 'objection')),
      toTurn(pick(input, 'Architect', 'counter')),
    ];
    return [
      { index: 1, label: '专家串行链 · 逐级建议', mode: 'serial', turns: chain },
      {
        index: 2,
        label: `终裁闸 · ${input.authority} 审签`,
        mode: 'serial',
        turns: [
          {
            role: input.authority,
            stance: 'signoff',
            escalates: true,
            text: '技术链路已收敛到 vendor-A + 缓存退避，无未决反对。但降级成本 / SLA 属授权边界外，按 Escalation Guard 升级给你拍板。',
          },
        ],
      },
    ];
  },
};

// ---------------------------------------------------------------------------
// Policy 2 — Roundtable: parallel divergence → facilitator merge
// ---------------------------------------------------------------------------

const roundtable: EnginePolicy = {
  id: 'roundtable',
  name: 'Roundtable 圆桌',
  convergenceMechanism: '发散并行 → 主持人归并',
  schedule(input) {
    // Everyone tables a position at once (brainstorm); a facilitator then
    // merges them into a shortlist. No terminal authority — the merge stands.
    const diverge: Turn[] = [
      toTurn(pick(input, 'Planner', 'proposal')),
      toTurn(pick(input, 'Executor', 'proposal')),
      toTurn(pick(input, 'Architect', 'counter')),
      toTurn(pick(input, 'Risk', 'objection')),
    ];
    return [
      { index: 1, label: '发散并行 · 全员同时提案', mode: 'parallel', turns: diverge },
      {
        index: 2,
        label: '主持人归并 · Supervisor',
        mode: 'serial',
        turns: [
          {
            role: 'Supervisor',
            stance: 'signoff',
            escalates: true,
            badge: '主持人',
            text: '归并出 2 个候选：① vendor-A + 缓存退避（稳，改造小）② vendor-C 先行（免费额度大）。无单一终裁，取舍升级给你拍板。',
          },
        ],
      },
    ];
  },
};

// ---------------------------------------------------------------------------
// Policy 3 — Debate Judge: adversarial rounds → judge verdict
// ---------------------------------------------------------------------------

const debateJudge: EnginePolicy = {
  id: 'debate-judge',
  name: 'Debate Judge 辩论裁决',
  convergenceMechanism: '对抗多轮 → 裁判裁决',
  schedule(input) {
    // Two camps argue across rounds (立论 → 反驳), then a Judge rules. More
    // rounds, explicit pro/con framing — structurally unlike the other two.
    const proOpen = toTurn(pick(input, 'Planner', 'proposal'), { badge: '正方' });
    const conOpen = toTurn(pick(input, 'Risk', 'objection'), { badge: '反方' });
    const proRebut = toTurn(pick(input, 'Architect', 'counter'), { badge: '正方·二辩' });
    return [
      { index: 1, label: '立论 · 正方 vs 反方', mode: 'parallel', turns: [proOpen, conOpen] },
      {
        index: 2,
        label: '交叉反驳 · 二辩',
        mode: 'parallel',
        turns: [
          proRebut,
          {
            role: 'Risk',
            stance: 'objection',
            badge: '反方·二辩',
            text: '追问：缓存退避引入数据新鲜度风险，行情场景能否接受？',
          },
        ],
      },
      {
        index: 3,
        label: '裁判裁决 · Judge（Verifier）',
        mode: 'serial',
        turns: [
          {
            role: 'Verifier',
            stance: 'signoff',
            escalates: true,
            badge: 'Judge',
            text: '裁定：vendor-A 附条件胜出 —— 缓存退避化解核心限频反对，新鲜度风险可用 TTL 约束。但成本条款为 L2 主观项，升级给你拍板。',
          },
        ],
      },
    ];
  },
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const ENGINE_POLICIES: Record<EngineId, EnginePolicy> = {
  'expert-hierarchy': expertHierarchy,
  roundtable,
  'debate-judge': debateJudge,
};

/** First-batch engine ids that have a real policy in this prototype. */
export const FIRST_BATCH_ENGINES: EngineId[] = ['expert-hierarchy', 'roundtable', 'debate-judge'];

export function getPolicy(id: string): EnginePolicy | undefined {
  return ENGINE_POLICIES[id as EngineId];
}
