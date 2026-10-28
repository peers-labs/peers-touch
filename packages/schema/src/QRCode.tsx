import { useEffect, useRef, useState } from 'react';
import { SchemaError } from './errors';
import { prepareQr } from './qr/prepare';
import type { QrArtifact, QrConstraints, QrContent, QrDiagnostics } from './qr/types';

export interface QRCodeProps {
  content: QrContent;
  constraints?: QrConstraints;
  title: string;
  description?: string;
  errorLabel?: string;
  className?: string;
  onError?: (error: SchemaError) => void;
  onReady?: (diagnostics: Readonly<QrDiagnostics>) => void;
}

export function QRCode({ content, constraints, title, description, errorLabel, className, onError, onReady }: QRCodeProps) {
  const frame = useRef<HTMLDivElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onError, onReady });
  callbacks.current = { onError, onReady };
  const [status, setStatus] = useState<'preparing' | 'ready' | 'failed'>('preparing');
  const [displaySize, setDisplaySize] = useState<number>();
  const measuredSize = useRef<number | undefined>(undefined);
  const maximumSize = constraints?.size ?? 320;
  useEffect(() => {
    const host = frame.current;
    if (!host) return;
    const measure = () => {
      // Layout box only: an ancestor under CSS transform (e.g. the modal
      // zoom-in animation) shrinks getBoundingClientRect while the encoded
      // pixel budget must follow the untransformed layout size. ResizeObserver
      // reports content-box changes, so the two must agree on clientWidth.
      const available = host.clientWidth;
      const next = Math.min(maximumSize, available);
      if (available > 0 && measuredSize.current !== next) {
        measuredSize.current = next;
        // Invalidate a previously sized image before the next paint. Resizing
        // must never expose a clipped quiet zone while the new encode awaits.
        container.current?.replaceChildren();
        setStatus('preparing');
        setDisplaySize(next);
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    return () => observer.disconnect();
  }, [maximumSize]);
  // Structural inputs, never countdown or callbacks, invalidate the renderer.
  const fingerprint = JSON.stringify(content, (_, value) =>
    typeof value === 'bigint' ? { bigint: value.toString() }
      : value instanceof Uint8Array ? [...value] : value);
  const appearance = JSON.stringify(constraints, (key, value) => key === 'asset' ? undefined : value);
  const avatar = constraints?.avatar?.asset;
  useEffect(() => {
    if (displaySize === undefined) return;
    const controller = new AbortController();
    let artifact: QrArtifact | undefined;
    setStatus('preparing');
    const host = container.current;
    host?.replaceChildren();
    void prepareQr(content, { ...constraints, size: displaySize }, controller.signal).then(async (result) => {
      artifact = result;
      const svg = await result.element();
      if (controller.signal.aborted || measuredSize.current !== result.size) { result.dispose(); return; }
      svg.setAttribute('aria-hidden', 'true');
      host?.replaceChildren(svg);
      setStatus('ready');
      callbacks.current.onReady?.(result.diagnostics);
    }).catch((error) => {
      if (controller.signal.aborted) return;
      artifact?.dispose();
      host?.replaceChildren();
      setStatus('failed');
      callbacks.current.onError?.(error instanceof SchemaError ? error : new SchemaError('RENDER_FAILED'));
    });
    return () => { controller.abort(); host?.replaceChildren(); artifact?.dispose(); };
    // The byte fingerprint covers generated oneofs; callback identity does not
    // trigger another encode and sensitive inputs never enter shared caches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fingerprint, appearance, avatar, displaySize]);

  return (
    <div ref={frame} className={className} role="img" aria-label={title} aria-description={description}
      aria-busy={status === 'preparing'} data-schema-qr={status}
      style={{ display: 'inline-flex', width: maximumSize, maxWidth: '100%', minWidth: 0, flexDirection: 'column', alignItems: 'center' }}>
      <div ref={container} />
      {status === 'failed' && errorLabel ? <span role="status">{errorLabel}</span> : null}
    </div>
  );
}
