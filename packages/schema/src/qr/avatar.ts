import { SchemaError } from '../errors';

// Decode and re-rasterize only a caller-owned bitmap. No arbitrary URL, SVG,
// metadata, embedded script or external resource survives into the QR export.
export async function sanitizeAvatar(asset: Blob, signal?: AbortSignal): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(asset.type) || asset.size > 1_048_576) {
    throw new SchemaError('AVATAR_UNAVAILABLE');
  }
  const url = URL.createObjectURL(asset);
  const image = new Image();
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => fail(), 2_000);
      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', fail);
        image.onload = null; image.onerror = null;
      };
      const fail = () => { cleanup(); reject(new SchemaError('AVATAR_UNAVAILABLE')); };
      image.onload = () => { cleanup(); resolve(); };
      image.onerror = fail;
      signal?.addEventListener('abort', fail, { once: true });
      if (signal?.aborted) fail();
      else image.src = url;
    });
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth > 4096 || image.naturalHeight > 4096) {
      throw new SchemaError('AVATAR_UNAVAILABLE');
    }
    const canvas = document.createElement('canvas');
    canvas.width = 128; canvas.height = 128;
    const context = canvas.getContext('2d');
    if (!context) throw new SchemaError('AVATAR_UNAVAILABLE');
    const side = Math.min(image.naturalWidth, image.naturalHeight);
    context.drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, 0, 0, 128, 128);
    const data = canvas.toDataURL('image/png');
    canvas.width = 0; canvas.height = 0;
    return data;
  } finally {
    image.src = '';
    URL.revokeObjectURL(url);
  }
}
