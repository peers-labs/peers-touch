import qrcode from 'qrcode-generator';
import { SchemaError } from '../errors';

export type QrEcc = 'M' | 'Q' | 'H';
export interface QrSegment {
  data: string;
  mode: 'Byte' | 'Alphanumeric';
}

export function encodeQr(segments: QrSegment[], ecc: QrEcc): boolean[][] {
  if (segments.length === 0) throw new SchemaError('PAYLOAD_TOO_LARGE');
  const code = qrcode(0, ecc);
  try {
    for (const segment of segments) code.addData(segment.data, segment.mode);
    code.make();
  } catch {
    throw new SchemaError('PAYLOAD_TOO_DENSE');
  }
  const modules = code.getModuleCount();
  if (modules < 21 || modules > 177 || (modules - 17) % 4 !== 0) throw new SchemaError('RENDER_FAILED');
  return Array.from({ length: modules }, (_, row) =>
    Array.from({ length: modules }, (_, col) => code.isDark(row, col)));
}
