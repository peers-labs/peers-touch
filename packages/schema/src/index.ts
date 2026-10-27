import { encode, parse } from './link';
import { prepareQr } from './qr/prepare';
import { QRCode } from './QRCode';

export const Schema = Object.freeze({ encode, parse, prepareQr, QRCode });
export { encode, parse, prepareQr, QRCode };
export { SchemaError } from './errors';
export type { SchemaErrorCode } from './errors';
export type { LinkInput, ParsedLink, ParseResult, NavigationLink } from './link';
export type { QrArtifact, QrConstraints, QrContent, QrDiagnostics, ExternalQrOwner } from './qr/types';
export { SchemaActionSchema } from './gen/domain/schema/schema_pb';
export type { SchemaAction } from './gen/domain/schema/schema_pb';
export * as DeviceLinkModel from './gen/domain/auth/device_link_pb';
