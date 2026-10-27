import type { AvatarPlacement } from './protectedModules';

const NS = 'http://www.w3.org/2000/svg';
export interface RenderedAvatar {
  data: string;
  placement: AvatarPlacement;
  shape: 'circle' | 'rounded';
}
export interface SvgQrInput {
  matrix: boolean[][];
  size: number;
  ratio: number;
  margin: number;
  module: number;
  foreground: string;
  background: string;
  rounded: boolean;
  avatar?: RenderedAvatar;
}

function rectangle(x: number, y: number, size: number, radius: number) {
  if (radius <= 0) return `M${x},${y}h${size}v${size}h${-size}Z`;
  const r = Math.min(radius, size / 2);
  return `M${x + r},${y}h${size - 2 * r}a${r},${r} 0 0 1 ${r},${r}v${size - 2 * r}`
    + `a${r},${r} 0 0 1 ${-r},${r}h${-(size - 2 * r)}a${r},${r} 0 0 1 ${-r},${-r}`
    + `v${-(size - 2 * r)}a${r},${r} 0 0 1 ${r},${-r}Z`;
}

export function renderSvg(input: SvgQrInput): SVGSVGElement {
  const doc = document;
  const svg = doc.createElementNS(NS, 'svg');
  const display = input.size * input.ratio;
  svg.setAttribute('xmlns', NS);
  svg.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
  svg.setAttribute('width', String(display));
  svg.setAttribute('height', String(display));
  svg.setAttribute('viewBox', `0 0 ${display} ${display}`);

  const backdrop = doc.createElementNS(NS, 'rect');
  backdrop.setAttribute('width', String(display));
  backdrop.setAttribute('height', String(display));
  backdrop.setAttribute('fill', input.background);
  svg.appendChild(backdrop);

  const modules = input.matrix.length;
  const radius = input.rounded ? input.module * 0.12 : 0;
  let data = '';
  for (let row = 0; row < modules; row++) for (let col = 0; col < modules; col++) {
    if (input.matrix[row][col]) {
      data += rectangle(input.margin + col * input.module, input.margin + row * input.module,
        input.module, radius);
    }
  }
  const dataPath = doc.createElementNS(NS, 'path');
  dataPath.setAttribute('d', data);
  dataPath.setAttribute('fill', input.foreground);
  svg.appendChild(dataPath);

  if (input.avatar) {
    const { placement, data: href, shape } = input.avatar;
    const x = input.margin + (placement.x - placement.padding) * input.module;
    const y = input.margin + (placement.y - placement.padding) * input.module;
    const side = (placement.side + 2 * placement.padding) * input.module;
    const frame = doc.createElementNS(NS, 'rect');
    frame.setAttribute('x', String(x)); frame.setAttribute('y', String(y));
    frame.setAttribute('width', String(side)); frame.setAttribute('height', String(side));
    frame.setAttribute('rx', String(side * (shape === 'circle' ? 0.5 : 0.2)));
    frame.setAttribute('fill', input.background);
    svg.appendChild(frame);
    const imageSide = placement.side * input.module;
    const image = doc.createElementNS(NS, 'image');
    image.setAttribute('x', String(input.margin + placement.x * input.module));
    image.setAttribute('y', String(input.margin + placement.y * input.module));
    image.setAttribute('width', String(imageSide));
    image.setAttribute('height', String(imageSide));
    image.setAttribute('href', href);
    image.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', href);
    image.setAttribute('preserveAspectRatio', 'xMidYMid slice');
    svg.appendChild(image);
  }
  return svg;
}

export function protectSvg(svg: SVGSVGElement, matrix: boolean[][], protectedModules: boolean[][],
  margin: number, module: number, foreground: string, background: string) {
  const group = svg.ownerDocument.createElementNS(NS, 'g');
  group.setAttribute('data-schema-functions', 'protected');
  const rect = (x: number, y: number, color: string) => {
    const node = svg.ownerDocument.createElementNS(NS, 'rect');
    node.setAttribute('x', String(x)); node.setAttribute('y', String(y));
    node.setAttribute('width', String(module)); node.setAttribute('height', String(module));
    node.setAttribute('fill', color);
    group.appendChild(node);
  };
  for (let row = 0; row < matrix.length; row++) for (let col = 0; col < matrix.length; col++) {
    if (protectedModules[row][col]) {
      rect(margin + col * module, margin + row * module, matrix[row][col] ? foreground : background);
    }
  }
  svg.appendChild(group);
}
