/**
 * Atelier — chat stream blocks (SOLO-style, conversation-first).
 *
 * Each block renders inline in the single conversation stream. The
 * multi-agent negotiation is folded into a collapsible row so the surface
 * stays as simple as a chat, while the soul (negotiation + evidence +
 * human decision) is one click away.
 *
 * Web prototype surface: plain React DOM (<div>/<span>) + inline styles,
 * onClick handlers. Colors come from theme.ts.
 */
import { useState, type CSSProperties } from 'react';
import { C, ROLE_COLOR, STANCE } from './theme';
import type {
  AgentMsg,
  UserMsg,
  NegoBlock,
  DecisionBlock,
  ArtifactBlock,
  DiffBlock,
} from './types';

/** small pill tag (was antd Tag). */
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

/**
 * Very light inline markdown: `code` spans + **bold**, rendered as nested
 * <span> children.
 */
function inline(text: string) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
  return parts.map((p, i) => {
    if (p.startsWith('`') && p.endsWith('`')) {
      return (
        <span key={i} style={{ color: C.primary }}>
          {p.slice(1, -1)}
        </span>
      );
    }
    if (p.startsWith('**') && p.endsWith('**')) {
      return (
        <span key={i} style={{ fontWeight: 'bold' }}>
          {p.slice(2, -2)}
        </span>
      );
    }
    return <span key={i}>{p}</span>;
  });
}

/* ── user bubble ── */
export function UserBubble({ m }: { m: UserMsg }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', margin: '18px 0' }}>
      <div
        style={{
          maxWidth: 560,
          backgroundColor: C.fillSecondary,
          borderRadius: 12,
          padding: '10px 14px',
        }}
      >
        {m.image ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              backgroundColor: C.bg,
              borderRadius: 8,
              padding: '6px 10px',
              marginBottom: 8,
            }}
          >
            <span style={{ fontSize: 12 }}>🖼 {m.image.name}</span>
            <span style={{ fontSize: 11, color: C.textTertiary, marginLeft: 8 }}>{m.image.size}</span>
          </div>
        ) : null}
        <div style={{ fontSize: 14, lineHeight: '22px' }}>{inline(m.text)}</div>
        <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 4, textAlign: 'right' }}>{m.at}</div>
      </div>
    </div>
  );
}

/* ── feedback bar (up / down / copy / regenerate), like SOLO ── */
function FeedbackBar() {
  const item: CSSProperties = { marginRight: 10, fontSize: 13, color: C.textTertiary, cursor: 'pointer' };
  return (
    <div style={{ display: 'flex', marginTop: 6 }}>
      <span style={item}>👍</span>
      <span style={item}>👎</span>
      <span style={item}>复制</span>
      <span style={{ fontSize: 13, color: C.textTertiary, cursor: 'pointer' }}>重新生成</span>
    </div>
  );
}

/* ── agent reply ── */
export function AgentBubble({ m }: { m: AgentMsg }) {
  return (
    <div style={{ margin: '18px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
        <div
          style={{
            width: 20,
            height: 20,
            borderRadius: 6,
            backgroundColor: C.primary,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginRight: 8,
          }}
        >
          <span style={{ color: C.white, fontSize: 12 }}>A</span>
        </div>
        <span style={{ fontSize: 13, fontWeight: 'bold' }}>Atelier</span>
      </div>
      <div style={{ fontSize: 14, lineHeight: '24px' }}>{inline(m.text)}</div>
      {m.bullets ? (
        <div style={{ marginTop: 8 }}>
          {m.bullets.map((b) => (
            <div key={b} style={{ display: 'flex', marginTop: 2 }}>
              <span style={{ fontSize: 14, color: C.textTertiary, marginRight: 6 }}>•</span>
              <span style={{ flex: 1, fontSize: 14, lineHeight: '22px' }}>{inline(b)}</span>
            </div>
          ))}
        </div>
      ) : null}
      {m.done ? (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', marginTop: 8 }}>
            <span style={{ fontSize: 12, color: C.success }}>✓ Completed</span>
          </div>
          <FeedbackBar />
        </div>
      ) : null}
    </div>
  );
}

/* ── folded multi-agent negotiation ── */
export function NegoRow({ b }: { b: NegoBlock }) {
  const [open, setOpen] = useState(false);
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
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '10px 14px',
          cursor: 'pointer',
        }}
      >
        <span style={{ fontSize: 14, color: C.primary, marginRight: 8 }}>👥</span>
        <span style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>{b.summary}</span>
        <Tag text={b.converged ? '已收敛' : '未收敛'} color={b.converged ? C.success : C.warning} />
        <span style={{ fontSize: 13, color: C.textTertiary, marginLeft: 8 }}>{open ? '▾' : '▸'}</span>
      </div>

      {/* expanded: voices + consensus */}
      {open ? (
        <div style={{ padding: '0 14px 14px' }}>
          {b.voices.map((v, i) => {
            const noEvidenceObjection = v.stance === 'objection' && !v.evidenceRef;
            return (
              <div
                key={i}
                style={{ padding: '8px 0', borderTop: `1px solid ${C.border}` }}
              >
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: 2 }}>
                  <Tag text={v.role} color={ROLE_COLOR[v.role]} />
                  <span style={{ marginLeft: 6 }}>
                    <Tag text={STANCE[v.stance].t} color={STANCE[v.stance].c} />
                  </span>
                </div>
                <div style={{ fontSize: 13, lineHeight: '20px' }}>{v.text}</div>
                {v.evidenceRef ? (
                  <div style={{ fontSize: 12, color: C.textSecondary, marginTop: 2 }}>证据：{v.evidenceRef}</div>
                ) : noEvidenceObjection ? (
                  <div style={{ fontSize: 12, color: C.warning, marginTop: 2 }}>无证据 → 降级为「疑虑」（反附和）</div>
                ) : null}
              </div>
            );
          })}
          <div
            style={{
              marginTop: 10,
              padding: '8px 10px',
              backgroundColor: C.bg,
              borderRadius: 8,
            }}
          >
            <div style={{ fontSize: 13, color: C.text, lineHeight: '20px' }}>{b.consensus}</div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* ── inline decision card (the human is the only authority) ── */
export function DecisionCard({ b, onChoose }: { b: DecisionBlock; onChoose: (id: string, opt: string) => void }) {
  return (
    <div
      style={{
        margin: '14px 0',
        border: `1px solid ${C.warningBorder}`,
        backgroundColor: C.warningBg,
        borderRadius: 10,
        padding: 16,
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 'bold', color: C.warning, marginBottom: 8 }}>
        👍 待你拍板（升级给人，Agent 不替你决定）
      </div>
      <div style={{ fontSize: 15, fontWeight: 'bold', marginBottom: 6 }}>{b.question}</div>
      <div style={{ fontSize: 12, color: C.textSecondary, marginBottom: 12 }}>
        已花成本：{b.spentSoFar} · 回滚影响：{b.rollbackImpact}
      </div>
      {b.options.map((o) => {
        const picked = b.chosen === o.text;
        const isPrimary = picked || (o.recommended && !b.chosen);
        const disabled = !!b.chosen && !picked;
        return (
          <div
            key={o.text}
            onClick={() => {
              if (!disabled) onChoose(b.id, o.text);
            }}
            style={{
              marginBottom: 8,
              padding: '8px 12px',
              borderRadius: 8,
              border: `1px solid ${isPrimary ? C.primary : C.border}`,
              backgroundColor: isPrimary ? C.primary : C.bg,
              opacity: disabled ? 0.5 : 1,
              cursor: disabled ? 'default' : 'pointer',
            }}
          >
            <span style={{ fontSize: 13, color: isPrimary ? C.white : C.text }}>
              {picked ? '✓ ' : ''}
              {o.text}
            </span>
          </div>
        );
      })}
      {b.chosen ? (
        <div style={{ fontSize: 12, color: C.success, marginTop: 4 }}>
          已选择「{b.chosen}」，Agent 继续推进。
        </div>
      ) : null}
    </div>
  );
}

/* ── artifact card ── */
export function ArtifactCard({ b }: { b: ArtifactBlock }) {
  return (
    <div
      style={{
        margin: '14px 0',
        maxWidth: 360,
        display: 'flex',
        alignItems: 'center',
        padding: 12,
        border: `1px solid ${C.border}`,
        borderRadius: 10,
      }}
    >
      <span style={{ fontSize: 20, color: C.primary, marginRight: 12 }}>📄</span>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 14, fontWeight: 500 }}>{b.name}</div>
        <div style={{ fontSize: 12, color: C.textTertiary }}>
          {b.fileKind.toUpperCase()} · 来自 {b.producedBy}
        </div>
      </div>
    </div>
  );
}

/* ── "N files changed" diff summary card (SOLO-style) ── */
export function DiffCard({ b }: { b: DiffBlock }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      style={{
        margin: '14px 0',
        border: `1px solid ${C.border}`,
        borderRadius: 10,
        overflow: 'hidden',
      }}
    >
      <div
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '12px 14px',
          cursor: 'pointer',
        }}
      >
        <span style={{ fontSize: 18, color: C.primary, marginRight: 10 }}>⊟</span>
        <span style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>{b.files} files changed</span>
        <span style={{ fontSize: 13, color: C.success, marginRight: 10 }}>+{b.added}</span>
        <span style={{ fontSize: 13, color: C.error, marginRight: 10 }}>-{b.removed}</span>
        <span style={{ fontSize: 13, color: C.textTertiary }}>{open ? '▾' : '▸'}</span>
      </div>
      {open ? (
        <div style={{ borderTop: `1px solid ${C.border}`, padding: '8px 14px' }}>
          {b.paths.map((p) => (
            <div key={p} style={{ display: 'flex', alignItems: 'center', padding: '4px 0' }}>
              <span style={{ fontSize: 12, color: C.textTertiary, marginRight: 8 }}>📄</span>
              <span style={{ fontSize: 12, color: C.textSecondary }}>{p}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
