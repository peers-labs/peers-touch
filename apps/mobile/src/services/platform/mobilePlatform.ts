import { onBackButtonPress } from '@tauri-apps/api/app';
import { invoke } from '@tauri-apps/api/core';

import {
  getSecureStorageValue,
  removeSecureStorageValue,
  setSecureStorageValue,
} from '../mobileCommands';
import type {
  CapabilityFactPort,
  CapabilityFact,
  MobileReleaseIdentity,
  ReleaseTargetId,
  SystemActionOutcome,
  SystemActionPort,
} from './platformContracts';

export interface SecureStoragePort {
  set(key: string, value: string): Promise<void>;
  get(key: string): Promise<string | null>;
  remove(key: string): Promise<void>;
}

export interface MobilePlatform {
  readonly clientForm: 'mobile';
  readReleaseIdentity(): Promise<MobileReleaseIdentity>;
  readonly capabilityFacts: CapabilityFactPort;
  readonly systemActions: SystemActionPort;
  subscribeSystemBack(handler: () => void): Promise<() => Promise<void>>;
  readonly secureStorage: SecureStoragePort;
}

interface NativeMobileHealth {
  readonly clientForm: 'mobile';
  readonly releaseTarget: ReleaseTargetId;
  readonly processModel: 'tauri-mobile';
  readonly shell: 'tauri-mobile';
  readonly kernel: 'rust-capability-kernel';
}

type Invoke = (
  command: string,
  args?: Record<string, unknown>,
) => Promise<unknown>;

interface MobilePlatformDependencies {
  readonly invokeCommand?: Invoke;
  readonly subscribeBackButton?: typeof onBackButtonPress;
}

export function createTauriMobilePlatform(
  dependencies: MobilePlatformDependencies = {},
): MobilePlatform {
  const invokeCommand = dependencies.invokeCommand ?? invoke;
  const subscribeBackButton = dependencies.subscribeBackButton
    ?? onBackButtonPress;
  const readHealth = async (): Promise<NativeMobileHealth> => (
    parseMobileHealth(await invokeCommand('mobile_health'))
  );

  return {
    clientForm: 'mobile',
    readReleaseIdentity: async () => {
      const health = await readHealth();
      return {
        clientForm: health.clientForm,
        releaseTarget: health.releaseTarget,
        processModel: health.processModel,
      };
    },
    capabilityFacts: {
      observe: async (capability) => {
        return parseCapabilityFact(
          await invokeCommand('capability_observe', {
            input: { capability },
          }),
          capability,
        );
      },
    },
    systemActions: {
      execute: async (action) => {
        return parseSystemActionOutcome(
          await invokeCommand('system_action_execute', { action }),
        );
      },
    },
    subscribeSystemBack: async (handler) => {
      const health = await readHealth();
      if (health.releaseTarget !== 'android') {
        return async () => undefined;
      }
      const listener = await subscribeBackButton(() => handler());
      return () => listener.unregister();
    },
    secureStorage: {
      set: setSecureStorageValue,
      get: getSecureStorageValue,
      remove: removeSecureStorageValue,
    },
  };
}

function parseCapabilityFact(
  value: unknown,
  expectedCapability: string,
): CapabilityFact {
  if (
    !isRecord(value)
    || value.capability !== expectedCapability
    || (value.releaseTarget !== 'android' && value.releaseTarget !== 'ios')
    || ![
      'available',
      'unavailable',
      'denied',
      'restricted',
      'unsupported',
      'unknown',
    ].includes(String(value.state))
    || typeof value.observedAt !== 'string'
    || value.observedAt.length === 0
    || typeof value.source !== 'string'
    || value.source.length === 0
    || (
      value.detail !== undefined
      && typeof value.detail !== 'string'
    )
    || Object.keys(value).some((key) => ![
      'capability',
      'releaseTarget',
      'state',
      'observedAt',
      'source',
      'detail',
    ].includes(key))
  ) {
    throw new Error('mobile.platform.capabilityFactInvalid');
  }
  return value as unknown as CapabilityFact;
}

function parseSystemActionOutcome(value: unknown): SystemActionOutcome {
  if (
    !isRecord(value)
    || (value.releaseTarget !== 'android' && value.releaseTarget !== 'ios')
    || ![
      'completed',
      'cancelled',
      'unavailable',
      'failed',
    ].includes(String(value.state))
    || (
      value.reason !== undefined
      && typeof value.reason !== 'string'
    )
    || Object.keys(value).some((key) => ![
      'releaseTarget',
      'state',
      'reason',
    ].includes(key))
  ) {
    throw new Error('mobile.platform.systemActionOutcomeInvalid');
  }
  return value as unknown as SystemActionOutcome;
}

function parseMobileHealth(value: unknown): NativeMobileHealth {
  if (
    !isRecord(value)
    || value.clientForm !== 'mobile'
    || (value.releaseTarget !== 'android' && value.releaseTarget !== 'ios')
    || value.processModel !== 'tauri-mobile'
    || value.shell !== 'tauri-mobile'
    || value.kernel !== 'rust-capability-kernel'
    || Object.keys(value).sort().join(',') !== [
      'clientForm',
      'kernel',
      'processModel',
      'releaseTarget',
      'shell',
    ].join(',')
  ) {
    throw new Error('mobile.platform.identityInvalid');
  }
  return value as unknown as NativeMobileHealth;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
