import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

import { machineResourcesPath } from '../lib/machine-dev-paths.mjs';
import { canonicalize, fail } from './machine-dev-primitives.mjs';

export const RESOURCE_KIND = 'simulator.ios';
export const RESOURCE_STATES = new Set([
  'preparing', 'present', 'removing', 'removed', 'cleanup-failed', 'ownership-unknown',
]);
export const RESOURCE_ACTIONS = new Set(['use', 'boot', 'install', 'reset', 'delete']);

export function readResourceState(options = {}) {
  const file = machineResourcesPath(options.home);
  if (!existsSync(file)) return { kind: 'peers-touch-machine-resources', version: 1, instances: [], assignments: [], operations: [] };
  try {
    return validateResourceState(JSON.parse(readFileSync(file, 'utf8')));
  } catch (error) {
    if (error.code) throw error;
    fail('RESOURCE_STORE_INVALID', 'cannot read machine resource document');
  }
}

export function resourceDigest(value) {
  return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

export function resourceDigestEndpoint(target) {
  return `sha256:${resourceDigest({
    bundleId: target.bundleId, devUrl: target.devUrl, stationUrl: target.stationUrl,
  })}`;
}

export function resourceText(value, field) {
  if (typeof value !== 'string' || !value.trim() || /[\0\r\n]/.test(value) || value.length > 2048) {
    fail('INVALID_ARGUMENT', `${field} must be a non-empty, single-line string`);
  }
  return value.trim();
}

export function canonicalProviderId(value) {
  const id = resourceText(value, 'providerId').toUpperCase();
  if (!/^[0-9A-F]{8}(?:-[0-9A-F]{4}){3}-[0-9A-F]{12}$/.test(id)) {
    fail('RESOURCE_ID_INVALID', 'iOS provider identity must be a UUID');
  }
  return id;
}

// Called only by the original Profile parser; consumers receive its projection.
export function profileResourceRequirements(values) {
  const runtime = values.PT_MOBILE_IOS_RUNTIME?.trim();
  const deviceType = values.PT_MOBILE_IOS_DEVICE_TYPE?.trim();
  if (!runtime && !deviceType) return [];
  if (!runtime || !deviceType) {
    fail('PROFILE_UNAVAILABLE', 'iOS requirements need both PT_MOBILE_IOS_RUNTIME and PT_MOBILE_IOS_DEVICE_TYPE');
  }
  const data = values.PT_MOBILE_IOS_DATA?.trim() || 'preserve';
  if (!['preserve', 'fresh'].includes(data)) {
    fail('PROFILE_UNAVAILABLE', 'PT_MOBILE_IOS_DATA must be preserve or fresh');
  }
  return [{
    kind: RESOURCE_KIND,
    runtime: resourceText(runtime, 'PT_MOBILE_IOS_RUNTIME'),
    deviceType: resourceText(deviceType, 'PT_MOBILE_IOS_DEVICE_TYPE'),
    data,
    operations: ['inspect', 'use', 'provision', 'reset', 'delete'],
  }];
}

export function iosRequirement(definition) {
  const requirement = definition.resourceRequirements?.find((item) => item.kind === RESOURCE_KIND);
  if (!requirement) {
    fail('PROFILE_RESOURCE_REQUIREMENT_MISSING', `Profile ${definition.profile} has no reviewed iOS requirement`, {
      profile: definition.profile,
      hint: 'Declare runtime/device compatibility in the original Profile; machine UUIDs remain machine state.',
    });
  }
  return requirement;
}

export function requireCompatible(requirement, observation) {
  if (!observation?.available ||
      requirement.runtime !== observation.runtime ||
      requirement.deviceType !== observation.deviceType) {
    fail('RESOURCE_INCOMPATIBLE', 'selected device does not match the Profile requirement', {
      expected: requirement, actual: observation,
    });
  }
}

export function validateResourceTarget(target) {
  if (target === null) return null;
  if (typeof target !== 'object' || Array.isArray(target) ||
      Object.keys(target).some((key) => !['bundleId', 'source', 'artifactDigest', 'devUrl', 'stationUrl', 'purpose'].includes(key))) {
    fail('RESOURCE_TARGET_INVALID', 'resource content may contain only source, app and endpoint identity');
  }
  if (target.bundleId && !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,254}$/.test(target.bundleId)) {
    fail('RESOURCE_TARGET_INVALID', 'invalid app bundle identity');
  }
  if (target.source !== undefined && (
      !target.source || typeof target.source !== 'object' || Array.isArray(target.source) ||
      Object.keys(target.source).some((key) => !['branch', 'head', 'workspaceDigest', 'workspaceId'].includes(key)) ||
      !/^[a-f0-9]{40}$/.test(target.source.head ?? '') ||
      typeof target.source.branch !== 'string' || !target.source.branch ||
      !/^(?:clean|sha256:[a-f0-9]{64})$/.test(target.source.workspaceDigest ?? ''))) {
    fail('RESOURCE_TARGET_INVALID', 'source must identify the branch, commit and workspace bytes');
  }
  for (const field of ['devUrl', 'stationUrl']) {
    if (!target[field]) continue;
    let url;
    try { url = new URL(target[field]); } catch { fail('RESOURCE_TARGET_INVALID', `${field} is not a URL`); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      fail('RESOURCE_TARGET_INVALID', `${field} must be an HTTP endpoint without credentials or tokens`);
    }
  }
  return target;
}

export function validateResourceState(state) {
  if (!state || state.kind !== 'peers-touch-machine-resources' ||
      state.version !== 1 || !Array.isArray(state.instances) ||
      !Array.isArray(state.assignments) || !Array.isArray(state.operations) ||
      Object.keys(state).some((key) => !['kind', 'version', 'instances', 'assignments', 'operations'].includes(key))) {
    fail('RESOURCE_STORE_INVALID', 'machine resource document is invalid');
  }
  const ids = new Set();
  const providers = new Set();
  for (const instance of state.instances) {
    if (!/^ios-[a-f0-9]{24}$/.test(instance.id) || ids.has(instance.id) ||
        instance.kind !== RESOURCE_KIND || !RESOURCE_STATES.has(instance.progress) ||
        !Number.isInteger(instance.revision) || instance.revision < 0) {
      fail('RESOURCE_STORE_INVALID', 'invalid or duplicate resource instance');
    }
    ids.add(instance.id);
    if (instance.providerId) {
      const provider = canonicalProviderId(instance.providerId);
      if (provider !== instance.providerId || providers.has(provider)) {
        fail('RESOURCE_PROVIDER_COLLISION', 'multiple resource IDs resolve the same physical device');
      }
      providers.add(provider);
    }
  }
  const profiles = new Set();
  for (const assignment of state.assignments) {
    if (typeof assignment.profile !== 'string' || profiles.has(assignment.profile) ||
        !Array.isArray(assignment.resources) ||
        new Set(assignment.resources.map((item) => item.id)).size !== assignment.resources.length ||
        assignment.resources.some((item) => !ids.has(item.id))) {
      fail('RESOURCE_STORE_INVALID', 'invalid Profile resource assignments');
    }
    profiles.add(assignment.profile);
  }
  const operations = new Set();
  for (const operation of state.operations) {
    if (!/^[a-f0-9]{32}$/.test(operation.id) || operations.has(operation.id) ||
        !ids.has(operation.resourceId) || !RESOURCE_ACTIONS.has(operation.action) ||
        !['pending', 'declined', 'ready', 'running', 'succeeded', 'failed', 'cancelled'].includes(operation.status)) {
      fail('RESOURCE_STORE_INVALID', 'invalid resource operation');
    }
    operations.add(operation.id);
  }
  return state;
}
