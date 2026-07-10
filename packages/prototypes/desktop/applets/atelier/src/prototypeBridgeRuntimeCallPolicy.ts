import type { AtelierRuntimeSnapshot, AtelierRuntimeStatus } from './runtime';

export interface PrototypeBridgeCallStatusStartInput {
  currentStatus: AtelierRuntimeStatus | undefined;
  activeRestorableStatus: AtelierRuntimeStatus | undefined;
  readyStatus: AtelierRuntimeStatus;
}

export interface PrototypeBridgeCallStatusStart {
  previousStatus: AtelierRuntimeStatus;
  nextActiveRestorableStatus: AtelierRuntimeStatus;
}

export function derivePrototypeBridgeCallStatusStart(
  input: PrototypeBridgeCallStatusStartInput,
): PrototypeBridgeCallStatusStart {
  const currentStatus = input.currentStatus ?? input.readyStatus;
  const previousStatus = currentStatus.kind === 'loading'
    ? input.activeRestorableStatus ?? input.readyStatus
    : currentStatus;
  return {
    previousStatus,
    nextActiveRestorableStatus: previousStatus,
  };
}

export function shouldApplyPrototypeBridgeCallStatus(input: {
  callStatusToken: number;
  latestCallStatusToken: number;
  projectionRevisionAtCall: number;
  projectionRevision: number;
}): boolean {
  return (
    input.callStatusToken === input.latestCallStatusToken &&
    input.projectionRevisionAtCall === input.projectionRevision
  );
}

export function shouldApplyPrototypeBridgeSnapshotResponse(input: {
  snapshotCallToken: number;
  latestSnapshotCallToken: number;
  projectionRevisionAtCall: number;
  projectionRevision: number;
}): boolean {
  return (
    input.snapshotCallToken === input.latestSnapshotCallToken &&
    input.projectionRevisionAtCall === input.projectionRevision
  );
}

export function clonePrototypeBridgeRuntimeSnapshot(snapshot: AtelierRuntimeSnapshot): AtelierRuntimeSnapshot {
  assertPrototypeBridgeRuntimeSnapshotCloneable(snapshot);
  return JSON.parse(JSON.stringify(snapshot)) as AtelierRuntimeSnapshot;
}

const forbiddenCapabilityKeyPatterns = [
  /^provider\.invoke$/,
  /^runtime\.execute$/,
  /^cli\.execute$/,
  /^shell\.execute$/,
  /^file\.(open|read|write|delete)$/,
  /^gate\.run$/,
  /^memory\.write$/,
  /^input_snapshot(\.write)?$/,
  /^(providerInvoke|runtimeExecute|cliExecute|shellExecute|fileOpen|fileRead|fileWrite|fileDelete|gateRun|memoryWrite|inputSnapshotWrite)$/,
];

const forbiddenCapabilityPathPatterns = [
  /\.provider\.invoke$/,
  /\.runtime\.execute$/,
  /\.cli\.execute$/,
  /\.shell\.execute$/,
  /\.file\.(open|read|write|delete)$/,
  /\.gate\.run$/,
  /\.memory\.write$/,
  /\.input_snapshot(\.write)?$/,
  /\.inputSnapshot\.write$/,
];

const forbiddenPrototypePollutionKeys = new Set([
  '__proto__',
  'constructor',
  'prototype',
]);

const optionalUndefinedObjectPathPatterns = [
  /^\$\.status$/,
  /^\$\.status\.retryable$/,
  /^\$\.status\.lastEventSeq$/,
  /^\$\.state\.budget$/,
  /^\$\.state\.budget\.decisionHint$/,
  /^\$\.state\.projects$/,
  /^\$\.state\.tasks\[\]\.projectId$/,
  /^\$\.state\.tasks\[\]\.running$/,
  /^\$\.state\.tasks\[\]\.branch$/,
  /^\$\.state\.tasks\[\]\.intentPreset$/,
  /^\$\.state\.tasks\[\]\.providerStrategyPreset$/,
  /^\$\.state\.tasks\[\]\.gatePlanPreset$/,
  /^\$\.state\.tasks\[\]\.workspaceOpenTarget$/,
  /^\$\.state\.tasks\[\]\.workspaceOpenTarget\.ideHint$/,
  /^\$\.state\.stream\.[^.]+\[\]\.image$/,
  /^\$\.state\.stream\.[^.]+\[\]\.bullets$/,
  /^\$\.state\.stream\.[^.]+\[\]\.at$/,
  /^\$\.state\.stream\.[^.]+\[\]\.done$/,
  /^\$\.state\.stream\.[^.]+\[\]\.voices\[\]\.evidenceRef$/,
  /^\$\.state\.stream\.[^.]+\[\]\.voices\[\]\.sessionId$/,
  /^\$\.state\.stream\.[^.]+\[\]\.voices\[\]\.roundId$/,
  /^\$\.state\.stream\.[^.]+\[\]\.voices\[\]\.voiceId$/,
  /^\$\.state\.stream\.[^.]+\[\]\.voices\[\]\.objectionId$/,
  /^\$\.state\.stream\.[^.]+\[\]\.options\[\]\.recommended$/,
  /^\$\.state\.stream\.[^.]+\[\]\.chosen$/,
  /^\$\.state\.artifacts\.[^.]+\[\]\.previewHint$/,
  /^\$\.state\.artifacts\.[^.]+\[\]\.bodyRef$/,
  /^\$\.state\.artifacts\.[^.]+\[\]\.bodyHash$/,
  /^\$\.state\.artifacts\.[^.]+\[\]\.bodySize$/,
  /^\$\.state\.artifacts\.[^.]+\[\]\.bodyKind$/,
  /^\$\.state\.artifacts\.[^.]+\[\]\.previewTarget$/,
  /^\$\.state\.artifacts\.[^.]+\[\]\.previewTarget\.kind$/,
  /^\$\.state\.artifacts\.[^.]+\[\]\.previewTarget\.label$/,
  /^\$\.state\.artifacts\.[^.]+\[\]\.logs$/,
  /^\$\.state\.artifacts\.[^.]+\[\]\.paths$/,
  /^\$\.state\.artifacts\.[^.]+\[\]\.size$/,
  /^\$\.state\.gates\.[^.]+\[\]\.checks\[\]\.detail$/,
  /^\$\.state\.gates\.[^.]+\[\]\.artifactIds$/,
  /^\$\.state\.gates\.[^.]+\[\]\.at$/,
  /^\$\.state\.projects\[\]\.traceRoot$/,
  /^\$\.state\.projects\[\]\.policy$/,
];

export function assertPrototypeBridgeRuntimeValueHasNoForbiddenCapabilities(
  value: unknown,
  context: string,
): void {
  const seen = new WeakSet<object>();
  const visit = (node: unknown, path: string) => {
    if (node === null || typeof node !== 'object') return;
    if (seen.has(node)) {
      throw new Error(`Atelier bridge runtime ${context} contains a circular projection reference at ${path}`);
    }
    seen.add(node);
    assertProjectionObjectOwnPropertiesVisible(node, path, context);
    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      const childPath = Array.isArray(node) ? `${path}[]` : `${path}.${key}`;
      if (forbiddenPrototypePollutionKeys.has(key)) {
        throw new Error(`Atelier bridge runtime ${context} contains forbidden prototype pollution key ${key} at ${path}`);
      }
      if (forbiddenCapabilityKeyPatterns.some((pattern) => pattern.test(key))) {
        throw new Error(`Atelier bridge runtime ${context} contains forbidden capability key ${key} at ${path}`);
      }
      if (forbiddenCapabilityPathPatterns.some((pattern) => pattern.test(childPath))) {
        throw new Error(`Atelier bridge runtime ${context} contains forbidden capability path ${childPath}`);
      }
      visit(child, childPath);
    }
    seen.delete(node);
  };
  visit(value, '$');
}

function assertPrototypeBridgeRuntimeSnapshotCloneable(value: unknown): void {
  const seen = new WeakSet<object>();
  const visit = (node: unknown, path: string, containerKind: 'array' | 'object' | 'root') => {
    if (
      typeof node === 'function' ||
      typeof node === 'symbol' ||
      typeof node === 'bigint'
    ) {
      throw new Error(`Atelier bridge runtime snapshot is not projection-cloneable at ${path}`);
    }
    if (typeof node === 'undefined') {
      if (containerKind === 'array') {
        throw new Error(`Atelier bridge runtime snapshot contains undefined projection array value at ${path}`);
      }
      if (!isAllowedOptionalUndefinedObjectPath(path)) {
        throw new Error(`Atelier bridge runtime snapshot contains unregistered undefined projection object field at ${path}`);
      }
      return;
    }
    if (typeof node === 'number' && !Number.isFinite(node)) {
      throw new Error(`Atelier bridge runtime snapshot contains non-finite projection number at ${path}`);
    }
    if (node === null || typeof node !== 'object') return;
    if (!Array.isArray(node) && !isPlainProjectionObject(node)) {
      throw new Error(`Atelier bridge runtime snapshot contains non-plain projection object at ${path}`);
    }
    if (seen.has(node)) {
      throw new Error(`Atelier bridge runtime snapshot contains a circular projection reference at ${path}`);
    }
    seen.add(node);
    assertProjectionObjectOwnPropertiesVisible(node, path, 'snapshot');
    if (Array.isArray(node)) {
      assertDenseProjectionArray(node, path);
    }
    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      const childPath = Array.isArray(node) ? `${path}[]` : `${path}.${key}`;
      if (forbiddenPrototypePollutionKeys.has(key)) {
        throw new Error(`Atelier bridge runtime snapshot contains forbidden prototype pollution key ${key} at ${path}`);
      }
      if (forbiddenCapabilityKeyPatterns.some((pattern) => pattern.test(key))) {
        throw new Error(`Atelier bridge runtime snapshot contains forbidden capability key ${key} at ${path}`);
      }
      if (forbiddenCapabilityPathPatterns.some((pattern) => pattern.test(childPath))) {
        throw new Error(`Atelier bridge runtime snapshot contains forbidden capability path ${childPath}`);
      }
      visit(child, childPath, Array.isArray(node) ? 'array' : 'object');
    }
    seen.delete(node);
  };
  visit(value, '$', 'root');
}

function assertProjectionObjectOwnPropertiesVisible(value: object, path: string, context: string): void {
  const symbolKeys = Object.getOwnPropertySymbols(value);
  if (symbolKeys.length > 0) {
    throw new Error(`Atelier bridge runtime ${context} contains symbol-keyed projection property at ${path}`);
  }

  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Object.getOwnPropertyNames(value)) {
    if (Array.isArray(value) && key === 'length') continue;
    const descriptor = descriptors[key];
    if (descriptor && (typeof descriptor.get === 'function' || typeof descriptor.set === 'function')) {
      throw new Error(`Atelier bridge runtime ${context} contains accessor projection property ${key} at ${path}`);
    }
    if (!Object.prototype.propertyIsEnumerable.call(value, key)) {
      throw new Error(`Atelier bridge runtime ${context} contains non-enumerable projection property ${key} at ${path}`);
    }
  }
}

function assertDenseProjectionArray(value: unknown[], path: string): void {
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, index)) {
      throw new Error(`Atelier bridge runtime snapshot contains sparse projection array hole at ${path}[${index}]`);
    }
  }
}

function isAllowedOptionalUndefinedObjectPath(path: string): boolean {
  return optionalUndefinedObjectPathPatterns.some((pattern) => pattern.test(path));
}

function isPlainProjectionObject(value: object): boolean {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
