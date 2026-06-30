/**
 * Atelier — multi-engine negotiation trace renderer.
 *
 * Renders the output of `runSession` (engine.ts). The whole point is that the
 * SAME position pool, run through three different `EnginePolicy`s, produces
 * visibly different structures here:
 *   - Expert Hierarchy : a serial vertical chain + a terminal sign-off gate
 *   - Roundtable       : a parallel grid of simultaneous proposals + a merge
 *   - Debate Judge     : pro/con columns across multiple rounds + a verdict
 *
 * Collapsed by default (folded into the chat stream like the rest of Atelier);
 * expands to the full round-by-round trace.
 */
import { useState } from 'react';
import { C, ROLE_COLOR, STANCE } from './theme';
import { runSession, getPolicy, type CollaborationInput, type Round, type Turn } from './engine';

function Tag({ text, color }: { text: string; color: string }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        backgroundColor: color,
        borderRadius: 4,
        padding: '1px 7px',
        fontSize: 11,
        color: C.white,
      }}
    >
      {text}
    </span>
  );
}

/** One speaker act card. */
function TurnCard({ t }: { t: Turn }) {
  const noEvidenceObjection = t.stance === 'objection' && !t.evidenceRef;
  return (
    <div
      style={{
        border: `1px solid ${C.border}`,
        borderRadius: 8,
        backgroundColor: C.bg,
        padding: '8px 10px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, flexWrap: 'wrap' }}>
        <Tag text={t.role} color={ROLE_COLOR[t.role]} />
        <Tag text={STANCE[t.stance].t} color={STANCE[t.stance].c} />
        {t.badge ? (
          <span style={{ fontSize: 11, color: C.textTertiary, border: `1px solid ${C.border}`, borderRadius: 4, padding: '0 6px' }}>
            {t.badge}
          </span>
        ) : null}
      </div>
      <div style={{ fontSize: 13, lineHeight: '20px' }}>{t.text}</div>
      {t.evidenceRef ? (
        <div style={{ fontSize: 12, color: C.textSecondary, marginTop: 2 }}>证据：{t.evidenceRef}</div>
      ) : noEvidenceObjection ? (
        <div style={{ fontSize: 12, color: C.warning, marginTop: 2 }}>无证据 → 降级为「疑虑」（反附和）</div>
      ) : null}
    </div>
  );
}

/** A round — serial renders as a vertical chain, parallel as a grid. */
function RoundView({ r }: { r: Round }) {
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span
          style={{
            fontSize: 11,
            fontWeight: 'bold',
            color: C.primary,
            backgroundColor: C.primaryWash,
            borderRadius: 4,
            padding: '1px 7px',
          }}
        >
          第 {r.index} 轮
        </span>
        <span style={{ fontSize: 12, color: C.textSecondary }}>{r.label}</span>
        <span style={{ fontSize: 11, color: C.textTertiary }}>
          {r.mode === 'parallel' ? '⇉ 并行' : '↓ 串行'}
        </span>
      </div>
      {r.mode === 'parallel' ? (
        <div style={{ display: 'grid', gridTemplateColumns: r.turns.length >= 2 ? '1fr 1fr' : '1fr', gap: 8 }}>
          {r.turns.map((t, i) => (
            <TurnCard key={i} t={t} />
          ))}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingLeft: 10, borderLeft: `2px solid ${C.primaryWash2}` }}>
          {r.turns.map((t, i) => (
            <TurnCard key={i} t={t} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The live, engine-driven negotiation block. Re-runs `runSession` on every
 * render with the current `engineId`, so switching engines in the composer
 * instantly re-shapes this trace.
 */
export function EngineTrace({ input, engineId }: { input: CollaborationInput; engineId: string }) {
  const [open, setOpen] = useState(false);
  const policy = getPolicy(engineId);
  if (!policy) return null;

  const trace = runSession(policy, input);
  const reached = trace.result.phase === 'reached';
  const roundCount = trace.rounds.length;
  const speakerCount = trace.rounds.reduce((n, r) => n + r.turns.length, 0);

  return (
    <div
      style={{
        margin: '14px 0',
        border: `1px solid ${C.border}`,
        borderRadius: 10,
        backgroundColor: C.fillQuaternary,
        overflow: 'hidden',
      }}
    >
      {/* collapsed summary row */}
      <div
        onClick={() => setOpen((v) => !v)}
        style={{ display: 'flex', alignItems: 'center', padding: '10px 14px', cursor: 'pointer', gap: 8 }}
      >
        <span style={{ fontSize: 14, color: C.primary }}>👥</span>
        <span style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>
          {trace.engineName} · {roundCount} 轮 / {speakerCount} 次发言 · {trace.convergenceMechanism}
        </span>
        <Tag
          text={reached ? '已收敛' : '升级给人'}
          color={reached ? C.success : C.warning}
        />
        <span style={{ fontSize: 13, color: C.textTertiary }}>{open ? '▾' : '▸'}</span>
      </div>

      {open ? (
        <div style={{ padding: '0 14px 14px' }}>
          {/* engine identity strip — makes the swap explicit */}
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 8,
              alignItems: 'center',
              padding: '8px 0',
              borderTop: `1px solid ${C.border}`,
              fontSize: 12,
              color: C.textSecondary,
            }}
          >
            <span>引擎：<b style={{ color: C.primary }}>{trace.engineName}</b></span>
            <span>·</span>
            <span>收敛机制：{trace.convergenceMechanism}</span>
            <span>·</span>
            <span>终裁权：{trace.authority}</span>
          </div>

          {trace.rounds.map((r) => (
            <RoundView key={r.index} r={r} />
          ))}

          {/* convergence verdict banner */}
          <div
            style={{
              marginTop: 12,
              padding: '10px 12px',
              backgroundColor: reached ? '#f6ffed' : C.warningBg,
              border: `1px solid ${reached ? '#b7eb8f' : C.warningBorder}`,
              borderRadius: 8,
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 'bold', color: reached ? C.success : C.warning, marginBottom: 4 }}>
              {reached ? '✓ 共识达成（authority_signoff ∧ 未决反对=0）' : '↑ 升级给人裁决（共识闸未满足）'}
            </div>
            <div style={{ fontSize: 13, lineHeight: '20px', color: C.text }}>{trace.result.verdict}</div>
            <div style={{ fontSize: 12, color: C.textTertiary, marginTop: 6 }}>
              终裁签字：{trace.result.authoritySignoff ? '是' : '否（升级）'} · 带证据的未决反对：{trace.result.pendingObjections}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
