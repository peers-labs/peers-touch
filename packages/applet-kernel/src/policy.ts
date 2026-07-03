// Default resource policies (architecture §5.1/§5.2).
//
// Source: docs/architecture/applet-runtime/applet-lifecycle-architecture.md
//   §5.1 LRU: Desktop 4 / Mobile 3 instances; maxSuspended 8.
//   §5.2 TTL: hidden-warm 30min → suspended; suspended 120min → destroyed;
//             paused 15min → suspended.
//
// TTLs are expressed in milliseconds. Presets can be overridden per device tier
// (§5.2: 低端设备缩短，高端设备延长) by passing a custom ResourcePolicy.

import type { AppletPlatform } from '@peers-touch/applet-contract';

import type { ResourcePolicy } from './ports.js';

const MINUTE_MS = 60_000;

export const DESKTOP_RESOURCE_POLICY: ResourcePolicy = Object.freeze({
  lruSize: 4,
  maxSuspended: 8,
  hiddenWarmTtlMs: 30 * MINUTE_MS,
  suspendedTtlMs: 120 * MINUTE_MS,
  pausedTtlMs: 15 * MINUTE_MS,
});

export const MOBILE_RESOURCE_POLICY: ResourcePolicy = Object.freeze({
  lruSize: 3,
  maxSuspended: 8,
  hiddenWarmTtlMs: 30 * MINUTE_MS,
  suspendedTtlMs: 120 * MINUTE_MS,
  pausedTtlMs: 15 * MINUTE_MS,
});

export function defaultPolicyForPlatform(platform: AppletPlatform): ResourcePolicy {
  return platform === 'desktop' ? DESKTOP_RESOURCE_POLICY : MOBILE_RESOURCE_POLICY;
}
