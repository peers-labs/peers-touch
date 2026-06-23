/**
 * Atelier — Artifacts tray + right-side preview panel (SOLO-style).
 *
 * SOLO's core loop is "Agent produces an artifact -> open it on the right":
 *   - markdown : a rendered document
 *   - web      : a REAL embedded browser (<iframe>) pointing at the running
 *                URL, plus the captured console logs. This is a web prototype,
 *                so the DOM/iframe is available directly.
 *   - image    : an image preview
 *   - diff     : a touched-file list
 *
 * Web prototype surface: plain React DOM (<div>/<span>/<iframe>/<img>).
 */
import { useState } from 'react';
import { C } from './theme';
import type { Artifact, ConsoleLog } from './types';

const KIND_GLYPH: Record<Artifact['kind'], string> = {
  markdown: '📄',
  web: '🌐',
  image: '🖼',
  diff: '⊟',
};

/* ── Artifacts tray (above the composer) ── */
export function ArtifactsTray({
  artifacts,
  openId,
  onOpen,
}: {
  artifacts: Artifact[];
  openId?: string;
  onOpen: (a: Artifact) => void;
}) {
  if (artifacts.length === 0) return null;
  return (
    <div style={{ maxWidth: 760, marginBottom: 10 }}>
      <div style={{ fontSize: 12, fontWeight: 'bold', color: C.textTertiary, marginBottom: 8 }}>Artifacts</div>
      <div style={{ display: 'flex', flexWrap: 'wrap' }}>
        {artifacts.map((a) => {
          const active = a.id === openId;
          return (
            <div
              key={a.id}
              onClick={() => onOpen(a)}
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: '10px 12px',
                minWidth: 200,
                marginRight: 10,
                marginBottom: 10,
                border: `1px solid ${active ? C.primary : C.border}`,
                backgroundColor: active ? C.primaryWash : C.bg,
                borderRadius: 10,
                cursor: 'pointer',
              }}
            >
              <span style={{ fontSize: 18, color: C.primary, marginRight: 10 }}>{KIND_GLYPH[a.kind]}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{a.name}</div>
                <div style={{ fontSize: 11, color: C.textTertiary }}>{a.meta}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── very light markdown renderer (headings, lists, inline code/bold) ── */
function inlineParts(text: string) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
  return parts.map((p, i) => {
    if (p.startsWith('`') && p.endsWith('`'))
      return <span key={i} style={{ color: C.primary }}>{p.slice(1, -1)}</span>;
    if (p.startsWith('**') && p.endsWith('**'))
      return <span key={i} style={{ fontWeight: 'bold' }}>{p.slice(2, -2)}</span>;
    return <span key={i}>{p}</span>;
  });
}

function Markdown({ src }: { src: string }) {
  const lines = src.split('\n');
  return (
    <div style={{ padding: '8px 4px' }}>
      {lines.map((ln, i) => {
        if (ln.startsWith('# '))
          return <div key={i} style={{ fontSize: 22, fontWeight: 'bold', marginTop: 14, marginBottom: 8 }}>{inlineParts(ln.slice(2))}</div>;
        if (ln.startsWith('## '))
          return <div key={i} style={{ fontSize: 17, fontWeight: 'bold', marginTop: 14, marginBottom: 6 }}>{inlineParts(ln.slice(3))}</div>;
        if (ln.startsWith('- '))
          return (
            <div key={i} style={{ display: 'flex', marginLeft: 8, marginTop: 2 }}>
              <span style={{ fontSize: 14, color: C.textTertiary, marginRight: 6 }}>•</span>
              <span style={{ flex: 1, fontSize: 14, lineHeight: '24px' }}>{inlineParts(ln.slice(2))}</span>
            </div>
          );
        if (/^\d+\.\s/.test(ln))
          return (
            <div key={i} style={{ display: 'flex', marginLeft: 8, marginTop: 2 }}>
              <span style={{ fontSize: 14, color: C.textTertiary, marginRight: 6 }}>{ln.match(/^\d+/)?.[0]}.</span>
              <span style={{ flex: 1, fontSize: 14, lineHeight: '24px' }}>{inlineParts(ln.replace(/^\d+\.\s/, ''))}</span>
            </div>
          );
        if (ln.trim() === '') return <div key={i} style={{ height: 8 }} />;
        return <div key={i} style={{ fontSize: 14, lineHeight: '24px', margin: '4px 0' }}>{inlineParts(ln)}</div>;
      })}
    </div>
  );
}

/**
 * web preview — REAL embedded browser (<iframe>).
 *
 * This is a web prototype, so a running web artifact is embedded directly as
 * an iframe pointing at its URL, alongside the captured console logs.
 */
function WebPreview({ a }: { a: Artifact }) {
  const [showConsole, setShowConsole] = useState(true);
  const logColor = (l: ConsoleLog['level']) =>
    l === 'error' ? C.error : l === 'warn' ? C.warning : l === 'info' ? C.textTertiary : C.text;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 16, minHeight: 0 }}>
      {/* address bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          border: `1px solid ${C.border}`,
          borderTopLeftRadius: 10,
          borderTopRightRadius: 10,
          padding: '8px 12px',
          backgroundColor: C.fillQuaternary,
        }}
      >
        <span style={{ fontSize: 14, color: C.primary, marginRight: 8 }}>🌐</span>
        <span style={{ flex: 1, fontSize: 12, color: C.textSecondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.url}</span>
      </div>
      {/* embedded browser */}
      <iframe
        src={a.url}
        title={a.name}
        style={{
          width: '100%',
          height: 320,
          border: `1px solid ${C.border}`,
          borderTop: 'none',
          borderBottomLeftRadius: 10,
          borderBottomRightRadius: 10,
        }}
      />

      {/* console logs */}
      <div style={{ marginTop: 16, borderTop: `1px solid ${C.border}` }}>
        <div
          onClick={() => setShowConsole((v) => !v)}
          style={{ display: 'flex', alignItems: 'center', padding: '8px 0', cursor: 'pointer' }}
        >
          <span style={{ fontSize: 12, fontWeight: 'bold', color: C.textSecondary, marginRight: 8 }}>Console Logs</span>
          <span style={{ backgroundColor: C.fillSecondary, borderRadius: 10, padding: '0 7px', fontSize: 11, color: C.textSecondary }}>
            {a.logs?.length ?? 0}
          </span>
          <span style={{ flex: 1, textAlign: 'right', fontSize: 12, color: C.textTertiary }}>{showConsole ? '▾' : '▸'}</span>
        </div>
        {showConsole ? (
          <div style={{ paddingBottom: 10 }}>
            {(a.logs ?? []).map((l, i) => (
              <div key={i} style={{ display: 'flex', padding: '2px 0' }}>
                <span style={{ fontSize: 12, color: C.textQuaternary, marginRight: 8 }}>{l.level}</span>
                <span style={{ flex: 1, fontSize: 12, color: logColor(l.level) }}>{l.text}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* ── right-side preview panel ── */
export function PreviewPanel({ artifact, onClose }: { artifact: Artifact; onClose: () => void }) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '12px 16px',
          borderBottom: `1px solid ${C.border}`,
        }}
      >
        <span style={{ fontSize: 14, color: C.primary, marginRight: 8 }}>{KIND_GLYPH[artifact.kind]}</span>
        <span style={{ flex: 1, fontWeight: 'bold', fontSize: 14 }}>{artifact.name}</span>
        <span onClick={onClose} style={{ fontSize: 16, color: C.textTertiary, cursor: 'pointer' }}>✕</span>
      </div>
      {/* body */}
      <div style={{ flex: 1, overflow: 'auto', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {artifact.kind === 'markdown' ? (
          <div style={{ padding: '0 18px' }}>
            <Markdown src={artifact.markdown ?? ''} />
          </div>
        ) : null}
        {artifact.kind === 'web' ? <WebPreview a={artifact} /> : null}
        {artifact.kind === 'image' ? (
          <div style={{ padding: 18 }}>
            <img src={artifact.src} alt={artifact.name} style={{ width: '100%', height: 200, objectFit: 'cover', borderRadius: 10 }} />
            <div style={{ fontSize: 12, color: C.textTertiary, marginTop: 8 }}>{artifact.size}</div>
          </div>
        ) : null}
        {artifact.kind === 'diff' ? (
          <div style={{ padding: 18 }}>
            {(artifact.paths ?? []).map((p) => (
              <div key={p} style={{ display: 'flex', alignItems: 'center', padding: '5px 0' }}>
                <span style={{ fontSize: 13, color: C.textTertiary, marginRight: 8 }}>📄</span>
                <span style={{ fontSize: 13, color: C.textSecondary }}>{p}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
