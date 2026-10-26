import { encode } from '../link';
import { SchemaError } from '../errors';
import { sanitizeAvatar } from './avatar';
import { avatarPlacement, protectedModules } from './protectedModules';
import { clearSdk, protectSvg, readMatrix } from './sdk';
import { svgToPng } from './png';
import type { QrArtifact, QrConstraints, QrContent, QrDiagnostics } from './types';

function luminance(value: string) {
  if (!/^#[0-9a-f]{6}$/i.test(value)) throw new SchemaError('UNSAFE_STYLE');
  const components = [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16) / 255)
    .map((c) => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return components[0] * 0.2126 + components[1] * 0.7152 + components[2] * 0.0722;
}

function inputPayload(content: QrContent) {
  if (content.kind !== 'external-protocol') return encode(content);
  if (!['identity.safety-number.v1', 'channels.provider-provisioning', 'channels.requester-authorization'].includes(content.owner)
    || !content.value || content.value.includes('\0')) throw new SchemaError('INVALID_LINK');
  if (content.owner === 'identity.safety-number.v1' && !content.value.startsWith('peers-touch:safety/v1?')) {
    throw new SchemaError('INVALID_LINK');
  }
  return content.value;
}

export async function prepareQr(content: QrContent, constraints: QrConstraints = {}, signal?: AbortSignal): Promise<QrArtifact> {
  const check = () => { if (signal?.aborted) throw new SchemaError('ABORTED'); };
  check();
  const payload = inputPayload(content);
  const bytes = new TextEncoder().encode(payload);
  const size = constraints.size ?? 320;
  const ratio = constraints.pixelRatio ?? 1;
  const quiet = constraints.quietZoneModules ?? 4;
  const minModule = Math.max(3, constraints.minModulePixels ?? 3);
  const maxVersion = constraints.maxVersion ?? 40;
  const maxBytes = constraints.maxPayloadBytes ?? 2_048;
  const style = constraints.style ?? 'peers';
  const foreground = constraints.foreground ?? (style === 'peers' ? '#243b53' : '#000000');
  const background = constraints.background ?? '#ffffff';
  if (bytes.length > 32_768 || bytes.length > maxBytes) throw new SchemaError('PAYLOAD_TOO_LARGE');
  if (!Number.isInteger(size) || size < 64 || size > 2048 || !Number.isInteger(ratio) || ratio < 1 || ratio > 4
    || !Number.isInteger(quiet) || quiet < 4 || quiet > 16 || !Number.isInteger(maxVersion) || maxVersion < 1 || maxVersion > 40
    || !Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > 32_768 || !Number.isFinite(minModule)
    || !['classic', 'peers'].includes(style) || (constraints.errorCorrection && !['M', 'Q', 'H'].includes(constraints.errorCorrection))) {
    throw new SchemaError('UNSAFE_STYLE');
  }
  if (luminance(background) < 0.8 || (luminance(background) + 0.05) / (luminance(foreground) + 0.05) < 7) {
    throw new SchemaError('UNSAFE_STYLE');
  }
  const device = content.kind === 'action'
    && (content.value.action.case === 'deviceLinkOffer' || content.value.action.case === 'deviceLinkLocator');
  const ecc = constraints.avatar ? 'H' : constraints.errorCorrection ?? 'Q';
  if (device && ecc === 'M') throw new SchemaError('UNSAFE_STYLE');
  const { default: QRCodeStyling } = await import('qr-code-styling');
  check();
  // The pinned SDK's Byte encoder consumes octets, not JavaScript UTF-16.
  // Pass the original UTF-8 bytes as an octet string, so both ASCII and
  // non-ASCII owner payloads decode to exactly the same byte sequence.
  const octets = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');
  let sdk;
  try {
    sdk = new QRCodeStyling({
      type: 'svg', width: size * ratio, height: size * ratio, margin: 0, data: octets,
      qrOptions: { mode: 'Byte', errorCorrectionLevel: ecc },
      dotsOptions: { type: style === 'peers' ? 'rounded' : 'square', color: foreground, roundSize: false },
      cornersSquareOptions: { type: 'square', color: foreground },
      cornersDotOptions: { type: 'square', color: foreground },
      backgroundOptions: { color: background },
    });
  } catch { throw new SchemaError('PAYLOAD_TOO_DENSE'); }
  try {
    const matrix = readMatrix(sdk);
    const modules = matrix.length;
    const version = (modules - 17) / 4;
    const modulePixels = Math.floor(size / (modules + 2 * quiet));
    if (version > maxVersion || modulePixels < minModule) throw new SchemaError('PAYLOAD_TOO_DENSE');
    const margin = ((size - modules * modulePixels) / 2) * ratio;
    sdk.update({ margin });
    let avatar;
    let fallback: QrDiagnostics['fallback'];
    if (constraints.avatar) {
      const placement = avatarPlacement(protectedModules(version), constraints.avatar.fraction ?? 0.12);
      if (placement) {
        try {
          avatar = { placement, data: await sanitizeAvatar(constraints.avatar.asset, signal), shape: constraints.avatar.shape ?? 'rounded' as const };
        } catch { fallback = 'AVATAR_UNAVAILABLE'; }
      } else fallback = 'AVATAR_UNAVAILABLE';
    }
    check();
    if (style === 'peers' || avatar) protectSvg(sdk, matrix, margin, modulePixels * ratio, foreground, background, avatar);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    const diagnostics = Object.freeze({
      payloadDigest: [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join(''),
      bytes: bytes.length, version, modules, modulePixels, quietZoneModules: quiet,
      errorCorrection: ecc, style, avatar: Boolean(avatar), ...(fallback ? { fallback } : {}),
    });
    const raw = await sdk.getRawData('svg');
    check();
    if (!raw || !sdk._svg) throw new SchemaError('RENDER_FAILED');
    const svg = sdk._svg;
    let svgBlob: Blob | undefined = raw instanceof Blob ? raw : new Blob([new Uint8Array(raw)], { type: 'image/svg+xml' });
    let disposed = false;
    const exportController = new AbortController();
    const live = () => { if (disposed || signal?.aborted || !svgBlob) throw new SchemaError('ABORTED'); };
    return {
      size, diagnostics,
      async element() {
        live();
        const clone = svg.cloneNode(true) as SVGElement;
        clone.setAttribute('width', String(size)); clone.setAttribute('height', String(size));
        clone.setAttribute('viewBox', `0 0 ${size * ratio} ${size * ratio}`);
        return clone;
      },
      async export(format) {
        live();
        const data = format === 'svg' ? svgBlob! : await svgToPng(svgBlob!, size * ratio, exportController.signal);
        live();
        return data;
      },
      dispose() { if (!disposed) { disposed = true; exportController.abort(); svgBlob = undefined; clearSdk(sdk); } },
    };
  } catch (error) {
    clearSdk(sdk);
    throw error instanceof SchemaError ? error : new SchemaError('RENDER_FAILED');
  }
}
