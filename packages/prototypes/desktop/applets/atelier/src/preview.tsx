/**
 * Atelier — Artifacts tray + right-side preview panel (SOLO-style).
 *
 * The prototype mirrors the official projection boundary: artifact projection
 * is metadata-only, safe body text is fetched through Host capability, and rich
 * visual rendering remains a Host-owned sandbox preview intent.
 */
import { useEffect, useState } from 'react';
import { C } from './theme';
import type { Artifact } from './types';
import type { FetchArtifactBodyResponse, OpenArtifactPreviewResponse } from './runtime';

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
  maxWidth = 760,
}: {
  artifacts: Artifact[];
  openId?: string;
  onOpen: (a: Artifact) => void;
  maxWidth?: number | string;
}) {
  if (artifacts.length === 0) return null;
  return (
    <div style={{ width: typeof maxWidth === 'number' ? `min(${maxWidth}px, 100%)` : maxWidth, margin: '0 auto 10px' }}>
      <div style={{ fontSize: 13, fontWeight: 'bold', color: C.text, marginBottom: 8 }}>Artifacts</div>
      <div style={{ display: 'grid', gap: 8 }}>
        {artifacts.map((a) => {
          const active = a.id === openId;
          return (
            <div
              key={a.id}
              onClick={() => onOpen(a)}
              style={{
                display: 'flex',
                alignItems: 'center',
                minHeight: 38,
                padding: '8px 12px',
                border: `1px solid ${active ? C.primary : C.border}`,
                backgroundColor: active ? C.primaryWash : C.bg,
                borderRadius: 10,
                cursor: 'pointer',
              }}
            >
              <span style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: C.fillSecondary, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, color: C.primary, marginRight: 10 }}>{KIND_GLYPH[a.kind]}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{a.name}</div>
                <div style={{ fontSize: 11, color: C.textTertiary }}>{a.meta}</div>
              </div>
              {a.kind === 'diff' ? <span style={{ fontSize: 12, color: C.success, marginRight: 10 }}>+73</span> : null}
              {a.kind === 'diff' ? <span style={{ fontSize: 12, color: C.error, marginRight: 12 }}>-11</span> : null}
              <span style={{ fontSize: 15, color: C.textTertiary }}>↗</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ArtifactMetadataPreview({ artifact }: { artifact: Artifact }) {
  const logColor = (level: string) =>
    level === 'error' ? C.error : level === 'warn' ? C.warning : level === 'info' ? C.textTertiary : C.text;

  return (
    <div style={{ padding: 18 }}>
      <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, backgroundColor: C.fillQuaternary, padding: 12 }}>
        <div style={{ color: C.textSecondary, fontSize: 12, fontWeight: 800, marginBottom: 6 }}>
          Metadata-only artifact preview
        </div>
        <div style={{ color: C.textTertiary, fontSize: 11, lineHeight: '18px' }}>
          Browser prototype no longer renders raw markdown, iframe, image, diff, URL, or source fields from projection. Use Host safe text fetch or sandbox manifest preview intent above.
        </div>
        {artifact.size ? (
          <div style={{ color: C.textQuaternary, fontSize: 11, marginTop: 8 }}>{artifact.size}</div>
        ) : null}
      </div>
      {artifact.paths?.length ? (
        <div style={{ borderTop: `1px solid ${C.border}`, marginTop: 14, paddingTop: 10 }}>
          <div style={{ color: C.textSecondary, fontSize: 12, fontWeight: 700, marginBottom: 6 }}>Projected changed paths</div>
          {artifact.paths.map((p) => (
            <div key={p} style={{ display: 'flex', alignItems: 'center', padding: '5px 0' }}>
              <span style={{ fontSize: 13, color: C.textTertiary, marginRight: 8 }}>📄</span>
              <span style={{ fontSize: 13, color: C.textSecondary }}>{p}</span>
            </div>
          ))}
        </div>
      ) : null}
      {artifact.logs?.length ? (
        <div style={{ borderTop: `1px solid ${C.border}`, marginTop: 14, paddingTop: 10 }}>
          <div style={{ color: C.textSecondary, fontSize: 12, fontWeight: 700, marginBottom: 6 }}>Console Logs</div>
          <div style={{ color: C.warning, fontSize: 11, fontWeight: 700, marginBottom: 6 }}>
            Prototype-only mock logs: real Run runtime stream is not wired.
          </div>
          {artifact.logs.map((log, index) => (
            <div key={`${log.level}-${index}`} style={{ display: 'flex', padding: '2px 0' }}>
              <span style={{ fontSize: 12, color: C.textQuaternary, marginRight: 8 }}>{log.level}</span>
              <span style={{ flex: 1, fontSize: 12, color: logColor(log.level) }}>{log.text}</span>
            </div>
          ))}
        </div>
      ) : null}
      <div style={{ color: C.warning, fontSize: 11, lineHeight: '18px', marginTop: 12 }}>
        Rich visual rendering remains Host-owned and is not implemented by reading raw projection fields in the browser prototype.
      </div>
    </div>
  );
}

/* ── right-side preview panel ── */
export function PreviewPanel({
  artifact,
  taskId,
  onClose,
  onFetchBody,
  onOpenPreview,
}: {
  artifact: Artifact;
  taskId: string;
  onClose: () => void;
  onFetchBody: (input: {
    taskId: string;
    artifactId: string;
    bodyRef: string;
    expectedHash?: string;
    maxBytes?: number;
  }) => Promise<FetchArtifactBodyResponse>;
  onOpenPreview: (input: {
    taskId: string;
    artifactId: string;
    sandboxRef: string;
    bodyRef: string;
    kind?: string;
    mode?: string;
  }) => Promise<OpenArtifactPreviewResponse>;
}) {
  const [safeBody, setSafeBody] = useState<FetchArtifactBodyResponse | null>(null);
  const [safeBodyLoading, setSafeBodyLoading] = useState(false);
  const [safeBodyError, setSafeBodyError] = useState('');
  const [previewOpen, setPreviewOpen] = useState<OpenArtifactPreviewResponse | null>(null);
  const [previewOpenLoading, setPreviewOpenLoading] = useState(false);
  const [previewOpenError, setPreviewOpenError] = useState('');
  const bodyRef = artifact.bodyRef ?? '';
  const previewTarget = artifact.previewTarget;
  const previewSandboxRef = previewTarget?.sandboxRef ?? '';
  const previewBodyRef = previewTarget?.bodyRef ?? '';
  const canFetchSafeBody = Boolean(bodyRef);
  const canOpenSandboxPreview = Boolean(previewSandboxRef && previewBodyRef);

  useEffect(() => {
    setSafeBody(null);
    setSafeBodyLoading(false);
    setSafeBodyError('');
    setPreviewOpen(null);
    setPreviewOpenLoading(false);
    setPreviewOpenError('');
  }, [artifact.bodyHash, artifact.id, bodyRef, previewBodyRef, previewSandboxRef, previewTarget?.kind, previewTarget?.mode, taskId]);

  const fetchSafeBody = () => {
    if (!taskId || !canFetchSafeBody || safeBodyLoading) return;
    setSafeBodyLoading(true);
    setSafeBodyError('');
    void onFetchBody({
      taskId,
      artifactId: artifact.id,
      bodyRef,
      expectedHash: artifact.bodyHash,
    })
      .then((response) => setSafeBody(response))
      .catch((error) => {
        setSafeBody(null);
        setSafeBodyError(error instanceof Error ? error.message : 'Artifact body fetch unavailable');
      })
      .finally(() => setSafeBodyLoading(false));
  };

  const openSandboxPreview = () => {
    if (!taskId || !previewTarget || !canOpenSandboxPreview || previewOpenLoading) return;
    setPreviewOpenLoading(true);
    setPreviewOpenError('');
    void onOpenPreview({
      taskId,
      artifactId: artifact.id,
      sandboxRef: previewSandboxRef,
      bodyRef: previewBodyRef,
      kind: previewTarget.kind,
      mode: previewTarget.mode ?? 'sandbox_manifest',
    })
      .then((response) => setPreviewOpen(response))
      .catch((error) => {
        setPreviewOpen(null);
        setPreviewOpenError(error instanceof Error ? error.message : 'Artifact sandbox preview unavailable');
      })
      .finally(() => setPreviewOpenLoading(false));
  };

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
        <div style={{ borderBottom: `1px solid ${C.border}`, padding: '12px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ flex: 1, color: C.textSecondary, fontSize: 12, fontWeight: 700 }}>
              Host safe text capability
            </span>
            <button
              onClick={fetchSafeBody}
              disabled={!canFetchSafeBody || safeBodyLoading}
              style={{
                backgroundColor: C.primaryWash,
                border: `1px solid ${C.border}`,
                borderRadius: 999,
                color: C.primary,
                cursor: !canFetchSafeBody || safeBodyLoading ? 'default' : 'pointer',
                fontSize: 12,
                fontWeight: 700,
                opacity: !canFetchSafeBody || safeBodyLoading ? 0.55 : 1,
                padding: '5px 10px',
              }}
            >
              {safeBodyLoading ? 'Fetching…' : 'Fetch safe text'}
            </button>
          </div>
          <div style={{ color: C.textTertiary, fontSize: 11, lineHeight: '18px', marginTop: 6 }}>
            Official applet uses <code>atelier.artifact.body.fetch</code> and receives text only; iframe, image, html, raw URL, and execute remain out of the official path.
          </div>
          {!canFetchSafeBody ? (
            <div style={{ color: C.warning, fontSize: 11, lineHeight: '18px', marginTop: 4 }}>
              Station-projected bodyRef missing; prototype will not synthesize an artifact body ref.
            </div>
          ) : null}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
            <span style={{ flex: 1, color: C.textSecondary, fontSize: 12, fontWeight: 700 }}>
              Host sandbox preview capability
            </span>
            <button
              onClick={openSandboxPreview}
              disabled={!canOpenSandboxPreview || previewOpenLoading}
              style={{
                backgroundColor: C.primaryWash,
                border: `1px solid ${C.border}`,
                borderRadius: 999,
                color: C.primary,
                cursor: !canOpenSandboxPreview || previewOpenLoading ? 'default' : 'pointer',
                fontSize: 12,
                fontWeight: 700,
                opacity: !canOpenSandboxPreview || previewOpenLoading ? 0.55 : 1,
                padding: '5px 10px',
              }}
            >
              {previewOpenLoading ? 'Opening…' : 'Open sandbox manifest'}
            </button>
          </div>
          <div style={{ color: C.textTertiary, fontSize: 11, lineHeight: '18px', marginTop: 6 }}>
              Official path calls <code>atelier.artifact.preview.open</code> with <code>atelier-sandbox://</code> metadata. The browser prototype does not render raw iframe/image/html fields from projection.
          </div>
          {!canOpenSandboxPreview ? (
            <div style={{ color: C.warning, fontSize: 11, lineHeight: '18px', marginTop: 4 }}>
              Station-projected previewTarget missing; prototype will not synthesize a sandbox manifest ref.
            </div>
          ) : null}
          {previewSandboxRef ? (
            <div style={{ color: C.textQuaternary, fontSize: 11, marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {previewSandboxRef}
            </div>
          ) : null}
          {previewOpenError ? (
            <div style={{ color: C.error, fontSize: 11, marginTop: 6 }}>{previewOpenError}</div>
          ) : null}
          {previewOpen ? (
            <div style={{ color: C.textTertiary, fontSize: 11, lineHeight: '18px', marginTop: 6 }}>
              {previewOpen.rendererMode}:{previewOpen.rendererStatus} · {previewOpen.rendererSessionId} · {previewOpen.reason}
            </div>
          ) : null}
          {bodyRef ? (
            <div style={{ color: C.textQuaternary, fontSize: 11, marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {bodyRef}
            </div>
          ) : null}
          {safeBodyError ? (
            <div style={{ color: C.error, fontSize: 11, marginTop: 6 }}>{safeBodyError}</div>
          ) : null}
          {safeBody ? (
            <div style={{ backgroundColor: C.fillQuaternary, border: `1px solid ${C.border}`, borderRadius: 10, marginTop: 8, padding: 10 }}>
              <div style={{ color: C.textTertiary, fontSize: 11, fontWeight: 700, marginBottom: 6 }}>
                {safeBody.bodyKind} · {safeBody.bodySize} bytes{safeBody.truncated ? ' · truncated' : ''}
              </div>
              <pre style={{ color: C.text, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12, lineHeight: '18px', margin: 0, maxHeight: 180, overflow: 'auto', whiteSpace: 'pre-wrap' }}>
                {safeBody.text}
              </pre>
            </div>
          ) : null}
        </div>
          <ArtifactMetadataPreview artifact={artifact} />
      </div>
    </div>
  );
}
