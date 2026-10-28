import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import { SchemaActionSchema, type SchemaAction } from './gen/domain/schema/schema_pb';
import { StationConnectionEnvelopeSchema, PublicEndpointConnectionMaterialSchema } from './gen/domain/peer/access_endpoint_pb';
import { SchemaError } from './errors';
import { base32, unbase32 } from './base32';
import { DeviceLinkLocatorSchema } from './gen/domain/auth/device_link_pb';

export const MAX_LINK_BYTES = 32_768;
const DEVICE_PREFIX = 'peers-touch://device/link#';
export const DEVICE_REFERENCE_PREFIX = `${DEVICE_PREFIX}B32:`;
const ACTION_PREFIX = 'peers-touch://action/v1#';
const encoder = new TextEncoder();

export interface NavigationLink {
  resource: 'cron' | 'sessions' | 'settings' | 'channels' | 'marketplace' | 'evaluation' | 'documents' | 'chat';
  id?: string;
  subResource?: 'runs';
  subId?: string;
}
export type LinkInput =
  | { kind: 'url'; value: string }
  | { kind: 'navigation'; value: NavigationLink }
  | { kind: 'action'; value: SchemaAction };
export type ParsedLink =
  | { kind: 'url'; value: string }
  | { kind: 'navigation'; value: NavigationLink }
  | { kind: 'action'; value: SchemaAction }
  | { kind: 'oauth-callback'; value: string };
export type ParseResult =
  | { status: 'recognized'; link: ParsedLink }
  | { status: 'malformed' | 'unsupported'; code: 'INVALID_LINK' | 'UNREGISTERED_ACTION' | 'PAYLOAD_TOO_LARGE' };

export function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).split('+').join('-').split('/').join('_').replace(/=+$/, '');
}

export function unbase64url(value: string): Uint8Array {
  if (!value || !/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) throw new SchemaError('INVALID_LINK');
  const binary = atob(value.split('-').join('+').split('_').join('/'));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  if (base64url(bytes) !== value) throw new SchemaError('INVALID_LINK');
  return bytes;
}

function bounded(value: string) {
  if (encoder.encode(value).length > MAX_LINK_BYTES) throw new SchemaError('PAYLOAD_TOO_LARGE');
  if (!value || /[\u0000-\u0020\u007f\\]/u.test(value)) throw new SchemaError('INVALID_LINK');
}

function validateAction(value: SchemaAction) {
  if (value.protocolVersion !== 1 || !value.action.case) throw new SchemaError('UNREGISTERED_ACTION');
  if (['conversationId', 'actorPtid', 'inviteCode'].includes(value.action.case)) {
    const text = value.action.value as string;
    if (!text || encoder.encode(text).length > 512 || /[\u0000-\u0020\u007f]/u.test(text)) {
      throw new SchemaError('INVALID_LINK');
    }
  }
}

function isDeviceAction(value: SchemaAction) {
  return value.action.case === 'deviceLinkOffer' || value.action.case === 'deviceLinkLocator';
}

function canonicalAction(bytes: Uint8Array): SchemaAction {
  const action = fromBinary(SchemaActionSchema, bytes, { readUnknownFields: false });
  validateAction(action);
  const canonical = toBinary(SchemaActionSchema, action);
  if (canonical.length !== bytes.length || canonical.some((byte, i) => byte !== bytes[i])) {
    throw new SchemaError('INVALID_LINK');
  }
  return action;
}

const segment = /^[A-Za-z0-9_.~-]{1,256}$/;
export function parseNavigation(value: string): NavigationLink | null {
  if (!value.startsWith('pt://')) return null;
  const parts = value.slice(5).split('/');
  if (parts.some((part) => !segment.test(part) || part === '.' || part === '..')) return null;
  const [resource, ...path] = parts;
  if (resource === 'cron') {
    if (path.length === 0) return { resource };
    if ((path.length === 2 || path.length === 4) && path[0] === 'jobs' && (path.length === 2 || path[2] === 'runs')) {
      return { resource, id: path[1], ...(path.length === 4 ? { subResource: 'runs' as const, subId: path[3] } : {}) };
    }
  } else if (resource === 'sessions' || resource === 'settings' || resource === 'channels') {
    if (path.length <= 1) return { resource, ...(path[0] ? { id: path[0] } : {}) };
  } else if (resource === 'marketplace' || resource === 'evaluation' || resource === 'documents' || resource === 'chat') {
    if (path.length === 0) return { resource };
  }
  return null;
}

function parseRecognized(value: string): ParsedLink {
  bounded(value);
  if (value.startsWith(DEVICE_REFERENCE_PREFIX)) {
    const bytes = unbase32(value.slice(DEVICE_REFERENCE_PREFIX.length));
    const reference = fromBinary(DeviceLinkLocatorSchema, bytes, { readUnknownFields: false });
    const canonical = toBinary(DeviceLinkLocatorSchema, reference);
    if (reference.protocolVersion !== 1 || reference.bootstrapSecret.length !== 32
      || reference.stationRootEd25519.length !== 32 || reference.offerDigest.length !== 32
      || !reference.canonicalDiscoveryOrigin || reference.expiresAtUnixMs <= 0n
      || (reference.endpointRole !== 1 && reference.endpointRole !== 2)
      || reference.relayEd25519.length !== (reference.endpointRole === 2 ? 32 : 0)
      || (reference.endpointRole === 2 && reference.relayEd25519.every((byte, i) => byte === reference.stationRootEd25519[i]))
      || canonical.length !== bytes.length || canonical.some((byte, i) => byte !== bytes[i])) {
      throw new SchemaError('INVALID_LINK');
    }
    return { kind: 'action', value: create(SchemaActionSchema, {
      protocolVersion: 1, action: { case: 'deviceLinkLocator', value: reference },
    }) };
  }
  if (value.startsWith('pt://')) {
    const navigation = parseNavigation(value);
    if (!navigation) throw new SchemaError('INVALID_LINK');
    return { kind: 'navigation', value: navigation };
  }
  for (const prefix of [DEVICE_PREFIX, ACTION_PREFIX]) {
    if (!value.startsWith(prefix)) continue;
    const action = canonicalAction(unbase64url(value.slice(prefix.length)));
    if (action.action.case === 'deviceLinkLocator') throw new SchemaError('INVALID_LINK');
    if (isDeviceAction(action) !== (prefix === DEVICE_PREFIX)) throw new SchemaError('INVALID_LINK');
    return { kind: 'action', value: action };
  }
  if (value.startsWith('ptm1:')) {
    const raw = unbase64url(value.slice(5));
    const material = fromBinary(PublicEndpointConnectionMaterialSchema, raw, { readUnknownFields: false });
    const canonical = toBinary(PublicEndpointConnectionMaterialSchema, material);
    if (material.schemaVersion !== 1 || !material.canonicalDiscoveryOrigin
      || canonical.length !== raw.length || canonical.some((byte, i) => byte !== raw[i])) throw new SchemaError('INVALID_LINK');
    return { kind: 'action', value: create(SchemaActionSchema, {
      protocolVersion: 1, action: { case: 'publicConnection', value: material },
    }) };
  }
  const connection = value.startsWith('ptc1:') ? value.slice(5)
    : value.startsWith('peers-touch://connect#') ? value.slice(22) : null;
  if (connection !== null) {
    const raw = unbase64url(connection);
    const circuit = fromBinary(StationConnectionEnvelopeSchema, raw, { readUnknownFields: false });
    const canonical = toBinary(StationConnectionEnvelopeSchema, circuit);
    if (circuit.protocolVersion !== 1 || !circuit.connectionGrant || !circuit.routeAttestation
      || !circuit.relayOrigin || canonical.length !== raw.length || canonical.some((byte, i) => byte !== raw[i])) {
      throw new SchemaError('INVALID_LINK');
    }
    return { kind: 'action', value: create(SchemaActionSchema, {
      protocolVersion: 1, action: { case: 'circuitConnection', value: circuit },
    }) };
  }
  let url: URL;
  try { url = new URL(value); } catch { throw new SchemaError('UNREGISTERED_ACTION'); }
  if (url.username || url.password) throw new SchemaError('INVALID_LINK');
  if (url.protocol === 'http:' || url.protocol === 'https:') return { kind: 'url', value };
  if (value.startsWith('peers-touch://oauth/callback?') && url.hostname === 'oauth'
    && url.pathname === '/callback' && !url.port && !value.includes('#')) {
    const keys = [...url.searchParams.keys()];
    if (keys.length !== new Set(keys).size || !url.searchParams.get('state')
      || (Boolean(url.searchParams.get('code')) === Boolean(url.searchParams.get('error')))) {
      throw new SchemaError('INVALID_LINK');
    }
    if (keys.some((key) => !['code', 'state', 'error', 'error_description'].includes(key))) {
      throw new SchemaError('INVALID_LINK');
    }
    return { kind: 'oauth-callback', value };
  }
  throw new SchemaError('UNREGISTERED_ACTION');
}

export function parse(value: string): ParseResult {
  try { return { status: 'recognized', link: parseRecognized(value) }; }
  catch (error) {
    const code = error instanceof SchemaError ? error.code : 'INVALID_LINK';
    return {
      status: code === 'UNREGISTERED_ACTION' ? 'unsupported' : 'malformed',
      code: code === 'PAYLOAD_TOO_LARGE' ? code : code === 'UNREGISTERED_ACTION' ? code : 'INVALID_LINK',
    };
  }
}

export function encode(input: LinkInput): string {
  let value: string;
  if (input.kind === 'action') {
    validateAction(input.value);
    value = input.value.action.case === 'deviceLinkLocator'
      ? DEVICE_REFERENCE_PREFIX + base32(toBinary(DeviceLinkLocatorSchema, input.value.action.value))
      : (isDeviceAction(input.value) ? DEVICE_PREFIX : ACTION_PREFIX) + base64url(toBinary(SchemaActionSchema, input.value));
  } else if (input.kind === 'navigation') {
    const navigation = input.value;
    value = `pt://${navigation.resource}`;
    if (navigation.id) value += navigation.resource === 'cron' ? `/jobs/${navigation.id}` : `/${navigation.id}`;
    if (navigation.subResource || navigation.subId) value += `/runs/${navigation.subId ?? ''}`;
  } else value = input.value;
  const parsed = parse(value);
  if (parsed.status !== 'recognized' || parsed.link.kind !== input.kind) {
    throw new SchemaError(parsed.status === 'recognized' ? 'INVALID_LINK' : parsed.code);
  }
  return value;
}
