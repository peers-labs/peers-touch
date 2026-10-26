import type QRCodeStyling from 'qr-code-styling';
import { SchemaError } from '../errors';
import { protectedModules, type AvatarPlacement } from './protectedModules';

const NS = 'http://www.w3.org/2000/svg';
// qr-code-styling 1.9.2 exposes _qr in its published TypeScript contract.
// This adapter is the only consumer of SDK internals. A dependency upgrade
// must pass the independent decoder and function-region assertions.
export function readMatrix(sdk: QRCodeStyling): boolean[][] {
  const qr = sdk._qr;
  if (!qr) throw new SchemaError('RENDER_FAILED');
  const n = qr.getModuleCount();
  if (n < 21 || n > 177 || (n - 17) % 4 !== 0) throw new SchemaError('RENDER_FAILED');
  return Array.from({ length: n }, (_, row) => Array.from({ length: n }, (_, col) => qr.isDark(row, col)));
}

export function protectSvg(
  sdk: QRCodeStyling, matrix: boolean[][], margin: number, moduleSize: number,
  foreground: string, background: string, avatar?: { data: string; placement: AvatarPlacement; shape: 'circle' | 'rounded' },
) {
  const mask = protectedModules((matrix.length - 17) / 4);
  sdk.applyExtension((svg) => {
    const doc = svg.ownerDocument;
    const group = doc.createElementNS(NS, 'g');
    group.setAttribute('data-schema-functions', 'protected');
    const rectangle = (x: number, y: number, width: number, height: number, color: string) => {
      const node = doc.createElementNS(NS, 'rect');
      node.setAttribute('x', String(x)); node.setAttribute('y', String(y));
      node.setAttribute('width', String(width)); node.setAttribute('height', String(height));
      node.setAttribute('fill', color); group.appendChild(node);
      return node;
    };
    for (let row = 0; row < matrix.length; row++) for (let col = 0; col < matrix.length; col++) {
      if (mask[row][col]) rectangle(margin + col * moduleSize, margin + row * moduleSize,
        moduleSize, moduleSize, matrix[row][col] ? foreground : background);
    }
    if (avatar) {
      const { x, y, side, padding } = avatar.placement;
      rectangle(margin + (x - padding) * moduleSize, margin + (y - padding) * moduleSize,
        (side + 2 * padding) * moduleSize, (side + 2 * padding) * moduleSize, background);
      const clip = doc.createElementNS(NS, 'clipPath');
      const clipId = `schema-avatar-${crypto.randomUUID()}`;
      clip.setAttribute('id', clipId);
      const frame = rectangle(margin + x * moduleSize, margin + y * moduleSize, side * moduleSize, side * moduleSize, background);
      frame.setAttribute('rx', String(side * moduleSize * (avatar.shape === 'circle' ? 0.5 : 0.2)));
      clip.appendChild(frame);
      group.appendChild(clip);
      const image = doc.createElementNS(NS, 'image');
      image.setAttribute('x', String(margin + x * moduleSize)); image.setAttribute('y', String(margin + y * moduleSize));
      image.setAttribute('width', String(side * moduleSize)); image.setAttribute('height', String(side * moduleSize));
      image.setAttribute('href', avatar.data); image.setAttribute('clip-path', `url(#${clipId})`);
      group.appendChild(image);
    }
    svg.appendChild(group);
  });
}

export function clearSdk(sdk: QRCodeStyling) {
  sdk._svg?.remove();
  sdk._svg?.replaceChildren();
  sdk._options.data = '';
  sdk._qr = undefined; sdk._svg = undefined; sdk._container = undefined;
  sdk._extension = undefined; sdk._domCanvas = undefined;
}
