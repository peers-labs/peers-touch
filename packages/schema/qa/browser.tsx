import { useState } from 'react';
import { create } from '@bufbuild/protobuf';
import { createRoot } from 'react-dom/client';
import jsQR from 'jsqr';
import { QRCode, prepareQr } from '../src';
import type { QrConstraints } from '../src';
import './browser.css';
import { SchemaActionSchema } from '../src/gen/domain/schema/schema_pb';

const locator = create(SchemaActionSchema, {
  protocolVersion: 1,
  action: { case: 'deviceLinkLocator', value: { expiresAtUnixMs: 9_007_199_254_740_993n } },
});

function sampleAsset(): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = 128; canvas.height = 128;
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#375a7f'; context.fillRect(0, 0, 128, 128);
  context.fillStyle = '#a4b9cc'; context.fillRect(24, 24, 80, 80);
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob!), 'image/png'));
}

async function decodePng(blob: Blob) {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width; canvas.height = bitmap.height;
  const context = canvas.getContext('2d')!;
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  const decoded = jsQR(image.data, image.width, image.height);
  canvas.width = 0; canvas.height = 0;
  return { width: image.width, bytes: decoded?.binaryData };
}

function Harness() {
  const [result, setResult] = useState('Ready');
  const [cases, setCases] = useState<Record<string, unknown>[]>([]);
  const [narrow, setNarrow] = useState(false);
  const [mounted, setMounted] = useState(true);
  const [count, setCount] = useState(0);
  const [error, setError] = useState('');
  const payload = 'https://example.org/你好?q=☀️';
  const verify = async () => {
    setResult('Running');
    try {
      const asset = await sampleAsset();
      const observations = [];
      for (const [name, constraints] of [
        ['classic', { style: 'classic' }],
        ['peers', { style: 'peers' }],
        ['peers-3x', { style: 'peers', pixelRatio: 3 }],
        ['avatar', { style: 'peers', avatar: { asset } }],
      ] as [string, QrConstraints][]) {
        const artifact = await prepareQr({ kind: 'url', value: payload }, constraints);
        try {
          const png = await artifact.export('png');
          const decoded = await decodePng(png);
          if (String(decoded.bytes) !== String([...new TextEncoder().encode(payload)])) throw new Error(`Decode failed: ${name}`);
          if (name === 'avatar' && !artifact.diagnostics.avatar) throw new Error('Avatar did not render');
          observations.push({ name, ...artifact.diagnostics, width: decoded.width, pngBytes: png.size });
        } finally { artifact.dispose(); }
      }
      setCases(observations);
      setResult('PASS');
    } catch (failure) { setResult(failure instanceof Error ? failure.message : 'FAIL'); }
  };
  return (
    <main>
      <h1>Schema component verification</h1>
      <p>This fixture checks the shared renderer. Native camera and login evidence are separate.</p>
      <div className="controls">
        <button onClick={() => void verify()}>Verify PNG, UTF-8 and avatar</button>
        <button onClick={() => setNarrow(!narrow)}>{narrow ? 'Wide layout' : 'Narrow layout'}</button>
        <button onClick={() => setMounted(!mounted)}>{mounted ? 'Unmount code' : 'Mount code'}</button>
      </div>
      <div className="preview" style={{ width: narrow ? 96 : 320 }}>
        {mounted ? <QRCode content={{ kind: 'url', value: payload }}
          title="UTF-8 sample QR" errorLabel="Space too small"
          onReady={() => { setCount((n) => n + 1); setError(''); }}
          onError={(failure) => setError(failure.code)} /> : null}
      </div>
      <section className="pt-channel-scan" data-protobuf>
        <div className="pt-channel-qr">
          <QRCode content={{ kind: 'action', value: locator }}
            title="Protobuf Device Link QR" errorLabel="Unable to render invitation" />
        </div>
      </section>
      <output aria-live="polite">{result}</output>
      <p>Successful renders: <span data-render-count>{count}</span></p>
      <p data-error>{error}</p>
      <pre data-cases>{JSON.stringify(cases, null, 2)}</pre>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<Harness />);
