// @ts-nocheck -- Vitest is supplied by the repository test runner, not the Mobile production bundle.

import { describe, expect, it } from 'vitest';

import {
  parseMobileBuildIdentity,
  readSharedBuildIdentity,
  type EmbeddedMobileBuildIdentity,
  type MobileBuildIdentity,
} from './buildIdentity';

const identity: MobileBuildIdentity = {
  allowlistedEnvironmentDigest: `sha256:${'a'.repeat(64)}`,
  applicationId: 'com.peers.touch.mobile',
  buildId: 'build-ios',
  buildInputsDigest: `sha256:${'b'.repeat(64)}`,
  configuration: 'acceptance-debug',
  harnessEnabled: true,
  platform: 'ios',
  schema: 'peers-mobile-build-identity',
  sourceCommit: '1'.repeat(40),
  workspaceDigest: `sha256:${'c'.repeat(64)}`,
  workspaceState: 'dirty',
};
const canonicalIdentity = JSON.stringify(identity);

describe('Mobile build identity', () => {
  it('parses the complete public identity', () => {
    expect(parseMobileBuildIdentity(canonicalIdentity)).toEqual(identity);
  });

  it('rejects missing and additional identity fields', () => {
    const missing = { ...identity } as Partial<MobileBuildIdentity>;
    delete missing.buildId;
    expect(() => parseMobileBuildIdentity(JSON.stringify(missing)))
      .toThrow('acceptance.mobile.buildIdentityInvalid');
    expect(() => parseMobileBuildIdentity(JSON.stringify({ ...identity, secret: 'value' })))
      .toThrow('acceptance.mobile.buildIdentityInvalid');
  });

  it.each([
    ['non-canonical bytes', JSON.stringify(identity, null, 2)],
    ['whitespace build ID', JSON.stringify({ ...identity, buildId: 'build ios' })],
    ['wrong configuration', JSON.stringify({ ...identity, configuration: 'release' })],
    ['wrong application', JSON.stringify({ ...identity, applicationId: 'com.example.other' })],
    ['dirty non-digest workspace', JSON.stringify({ ...identity, workspaceDigest: 'dirty' })],
    ['clean digest workspace', JSON.stringify({
      ...identity,
      workspaceState: 'clean',
      workspaceDigest: `sha256:${'c'.repeat(64)}`,
    })],
  ])('rejects %s', (_name, raw) => {
    expect(() => parseMobileBuildIdentity(raw))
      .toThrow('acceptance.mobile.buildIdentityInvalid');
  });

  it('returns one shared Web and Rust identity', async () => {
    const digest = await digestIdentity(canonicalIdentity);
    const invokeCommand = async <T>(command: string): Promise<T> => {
      expect(command).toBe('mobile_build_identity');
      return {
        identity,
        embeddedIdentitySha256: digest,
      } as T;
    };

    await expect(readSharedBuildIdentity(invokeCommand, canonicalIdentity)).resolves.toEqual({
      identity,
      embeddedIdentitySha256: digest,
    });
  });

  it('fails closed when the Rust identity differs', async () => {
    const invokeCommand = async <T>(): Promise<T> => ({
      identity: { ...identity, buildId: 'stale-build' },
      embeddedIdentitySha256: await digestIdentity(canonicalIdentity),
    } as EmbeddedMobileBuildIdentity as T);

    await expect(readSharedBuildIdentity(invokeCommand, canonicalIdentity))
      .rejects.toThrow('acceptance.mobile.buildIdentityMismatch');
  });

  it('fails closed when Rust returns a semantically invalid identity', async () => {
    const invokeCommand = async <T>(): Promise<T> => ({
      identity: { ...identity, workspaceDigest: 'dirty' },
      embeddedIdentitySha256: await digestIdentity(canonicalIdentity),
    } as EmbeddedMobileBuildIdentity as T);

    await expect(readSharedBuildIdentity(invokeCommand, canonicalIdentity))
      .rejects.toThrow('acceptance.mobile.buildIdentityInvalid');
  });

  it('fails closed when no identity was embedded', async () => {
    await expect(readSharedBuildIdentity(async <T>() => ({} as T), null))
      .rejects.toThrow('acceptance.mobile.buildIdentityMissing');
  });
});

async function digestIdentity(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return `sha256:${Buffer.from(digest).toString('hex')}`;
}
