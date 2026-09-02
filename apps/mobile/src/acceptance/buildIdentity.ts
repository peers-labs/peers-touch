import { invoke } from '@tauri-apps/api/core';

declare const __PEERS_MOBILE_BUILD_IDENTITY__: string | null;

export interface MobileBuildIdentity {
  schema: 'peers-mobile-build-identity';
  buildId: string;
  platform: 'ios' | 'android';
  configuration: string;
  sourceCommit: string;
  workspaceState: 'clean' | 'dirty';
  workspaceDigest: string;
  buildInputsDigest: string;
  allowlistedEnvironmentDigest: string;
  applicationId: string;
  harnessEnabled: true;
}

export interface EmbeddedMobileBuildIdentity {
  identity: MobileBuildIdentity;
  embeddedIdentitySha256: string;
}

type Invoke = <T>(command: string) => Promise<T>;

const IDENTITY_FIELDS = [
  'allowlistedEnvironmentDigest',
  'applicationId',
  'buildId',
  'buildInputsDigest',
  'configuration',
  'harnessEnabled',
  'platform',
  'schema',
  'sourceCommit',
  'workspaceDigest',
  'workspaceState',
] as const;

export function parseMobileBuildIdentity(raw: string): MobileBuildIdentity {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('acceptance.mobile.buildIdentityInvalid');
  }
  if (!isRecord(value) || Object.keys(value).sort().join(',') !== IDENTITY_FIELDS.join(',')) {
    throw new Error('acceptance.mobile.buildIdentityInvalid');
  }
  if (JSON.stringify(value, [...IDENTITY_FIELDS]) !== raw) {
    throw new Error('acceptance.mobile.buildIdentityInvalid');
  }
  if (
    value.schema !== 'peers-mobile-build-identity'
    || (value.platform !== 'ios' && value.platform !== 'android')
    || (value.workspaceState !== 'clean' && value.workspaceState !== 'dirty')
    || value.harnessEnabled !== true
    || !isNonEmpty(value.buildId)
    || /\s/.test(value.buildId)
    || value.configuration !== 'acceptance-debug'
    || !/^[0-9a-f]{40}$/.test(String(value.sourceCommit))
    || !isSha256(value.buildInputsDigest)
    || !isSha256(value.allowlistedEnvironmentDigest)
    || value.applicationId !== 'com.peers.touch.mobile'
  ) {
    throw new Error('acceptance.mobile.buildIdentityInvalid');
  }
  if (
    (value.workspaceState === 'clean' && value.workspaceDigest !== 'clean')
    || (value.workspaceState === 'dirty' && !isSha256(value.workspaceDigest))
  ) {
    throw new Error('acceptance.mobile.buildIdentityInvalid');
  }
  return value as unknown as MobileBuildIdentity;
}

export async function readSharedBuildIdentity(
  invokeCommand: Invoke = invoke,
  embeddedIdentity: string | null = __PEERS_MOBILE_BUILD_IDENTITY__,
): Promise<EmbeddedMobileBuildIdentity> {
  if (embeddedIdentity === null) {
    throw new Error('acceptance.mobile.buildIdentityMissing');
  }
  const webIdentity = parseMobileBuildIdentity(embeddedIdentity);
  const webDigest = await sha256(embeddedIdentity);
  const rustIdentity = await invokeCommand<EmbeddedMobileBuildIdentity>(
    'mobile_build_identity',
  );
  if (
    !isRecord(rustIdentity)
    || !isNonEmpty(rustIdentity.embeddedIdentitySha256)
    || !isRecord(rustIdentity.identity)
  ) {
    throw new Error('acceptance.mobile.buildIdentityMismatch');
  }
  const rustCanonical = JSON.stringify(rustIdentity.identity, [...IDENTITY_FIELDS]);
  const validatedRustIdentity = parseMobileBuildIdentity(rustCanonical);
  const webCanonical = JSON.stringify(webIdentity, [...IDENTITY_FIELDS]);
  if (
    rustCanonical !== webCanonical
    || JSON.stringify(validatedRustIdentity, [...IDENTITY_FIELDS]) !== webCanonical
    || rustIdentity.embeddedIdentitySha256 !== webDigest
  ) {
    throw new Error('acceptance.mobile.buildIdentityMismatch');
  }
  return {
    identity: webIdentity,
    embeddedIdentitySha256: webDigest,
  };
}

async function sha256(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => (
    byte.toString(16).padStart(2, '0')
  )).join('')}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^sha256:[0-9a-f]{64}$/.test(value);
}
