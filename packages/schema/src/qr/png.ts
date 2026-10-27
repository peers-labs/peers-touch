import { SchemaError } from '../errors';

export async function svgToPng(svg: Blob, pixels: number, signal?: AbortSignal): Promise<Blob> {
  const url = URL.createObjectURL(svg);
  const image = new Image();
  const canvas = document.createElement('canvas');
  canvas.width = pixels; canvas.height = pixels;
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => fail(), 2_000);
      const cleanup = () => {
        clearTimeout(timer); signal?.removeEventListener('abort', fail);
        image.onload = null; image.onerror = null;
      };
      const fail = () => { cleanup(); reject(new SchemaError(signal?.aborted ? 'ABORTED' : 'RENDER_FAILED')); };
      image.onload = () => { cleanup(); resolve(); };
      image.onerror = fail;
      signal?.addEventListener('abort', fail, { once: true });
      if (signal?.aborted) fail();
      else image.src = url;
    });
    const context = canvas.getContext('2d');
    if (!context) throw new SchemaError('RENDER_FAILED');
    context.drawImage(image, 0, 0, pixels, pixels);
    return await new Promise<Blob>((resolve, reject) => {
      const timer = setTimeout(() => reject(new SchemaError('RENDER_FAILED')), 2_000);
      canvas.toBlob((blob) => {
        clearTimeout(timer);
        if (signal?.aborted) reject(new SchemaError('ABORTED'));
        else if (blob) resolve(blob);
        else reject(new SchemaError('RENDER_FAILED'));
      }, 'image/png');
    });
  } finally {
    image.src = ''; canvas.width = 0; canvas.height = 0;
    URL.revokeObjectURL(url);
  }
}
