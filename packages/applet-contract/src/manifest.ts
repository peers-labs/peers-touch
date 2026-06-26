import { APPLET_BRIDGE_PROTOCOL } from './bridge.js';
import { isCapabilityMethod, type AppletPermission } from './capability.js';

export type TargetPlatform = 'desktop' | 'android' | 'ios' | 'harmony' | 'web' | 'standalone';

export interface AppletEntry {
  type: 'lynx-web' | 'lynx-native' | 'web-spa';
  entry: string;
}

export interface AppletEntryMap {
  lynx: string;
  standalone?: string;
}

export interface AppletLoadMap {
  desktop?: AppletEntry;
  android?: AppletEntry;
  ios?: AppletEntry;
  harmony?: AppletEntry;
  web?: AppletEntry;
  standalone?: AppletEntry;
}

export interface AppletBridge {
  protocol: typeof APPLET_BRIDGE_PROTOCOL;
  version?: string;
}

export type AppletServiceBinding = 'host-resolved' | 'station-resolved' | 'dev-override';

export interface AppletServiceDeclaration {
  id: string;
  kind: 'http';
  binding: AppletServiceBinding;
  allowedMethods: Array<'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD'>;
  allowedPaths: string[];
  publicPathPrefix?: string;
  stationPathPrefix?: string;
  streaming?: boolean;
}

export interface AppletNetworkExecutorRequest {
  service: string;
  path: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD';
  headers?: Record<string, string>;
  body?: unknown;
}

export interface AppletAgentExecutorRequest {
  message?: string;
  agentSessionId?: string;
  metadata?: Record<string, unknown>;
}

export type AppletSkillExecutor = {
  type: 'network';
  request: AppletNetworkExecutorRequest;
} | {
  type: 'agent';
  request?: AppletAgentExecutorRequest;
};

export interface AppletSkillDeclaration {
  id: string;
  inputSchema: string;
  streaming?: boolean;
  title?: string;
  description?: string;
  display?: Record<string, unknown>;
  executor?: AppletSkillExecutor;
}

export interface PackageIntegrity {
  algorithm: 'sha256';
  files: Record<string, string>;
}

export interface AppletManifest {
  id: string;
  name?: string;
  version: string;
  description?: string;
  author?: string;
  icon?: string;
  minPlatformVersion?: string;
  targets: TargetPlatform[];
  targetPlatforms?: TargetPlatform[];
  entries: AppletEntryMap;
  load: AppletLoadMap;
  bridge: AppletBridge;
  permissions: AppletPermission[];
  capabilities?: string[];
  services: AppletServiceDeclaration[];
  skills: AppletSkillDeclaration[];
  integrity: PackageIntegrity;
}

export interface ManifestValidationResult {
  valid: boolean;
  errors: string[];
  manifest?: AppletManifest;
}

const platformEntryTypes: Record<TargetPlatform, AppletEntry['type']> = {
  desktop: 'lynx-web',
  android: 'lynx-native',
  ios: 'lynx-native',
  harmony: 'lynx-native',
  web: 'lynx-web',
  standalone: 'web-spa',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function validateStringArray(value: unknown, path: string, errors: string[]): string[] {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return [];
  }
  const result: string[] = [];
  for (const item of value) {
    if (!nonEmptyString(item)) {
      errors.push(`${path} must contain only non-empty strings`);
      continue;
    }
    result.push(item);
  }
  return result;
}

function normalizeTargets(obj: Record<string, unknown>, errors: string[]): TargetPlatform[] {
  const rawTargets = obj.targets ?? obj.targetPlatforms;
  const validPlatforms = Object.keys(platformEntryTypes) as TargetPlatform[];
  if (!Array.isArray(rawTargets) || rawTargets.length === 0) {
    errors.push('targets must be a non-empty array');
    return [];
  }
  const targets: TargetPlatform[] = [];
  for (const target of rawTargets) {
    if (!validPlatforms.includes(target as TargetPlatform)) {
      errors.push(`targets contains invalid value: ${String(target)}`);
      continue;
    }
    targets.push(target as TargetPlatform);
  }
  return targets;
}

function validateEntries(obj: Record<string, unknown>, errors: string[]): AppletEntryMap {
  const rawEntries = obj.entries;
  if (!isRecord(rawEntries)) {
    errors.push('entries must be a non-null object');
    return { lynx: '' };
  }
  if (!nonEmptyString(rawEntries.lynx)) {
    errors.push('entries.lynx must be a non-empty string');
  }
  return {
    lynx: nonEmptyString(rawEntries.lynx) ? rawEntries.lynx : '',
    standalone: nonEmptyString(rawEntries.standalone) ? rawEntries.standalone : undefined,
  };
}

function validateLoad(load: unknown, targets: TargetPlatform[], errors: string[]): AppletLoadMap {
  if (!isRecord(load)) {
    errors.push('load must be a non-null object');
    return {};
  }
  const result: AppletLoadMap = {};
  for (const target of targets) {
    const rawEntry = load[target];
    if (!isRecord(rawEntry)) {
      errors.push(`load.${target} must be an object for every target`);
      continue;
    }
    const expectedType = platformEntryTypes[target];
    if (rawEntry.type !== expectedType) {
      errors.push(`load.${target}.type must be '${expectedType}'`);
    }
    if (!nonEmptyString(rawEntry.entry)) {
      errors.push(`load.${target}.entry must be a non-empty string`);
      continue;
    }
    result[target] = { type: expectedType, entry: rawEntry.entry } as AppletEntry;
  }
  return result;
}

function validatePermissions(raw: unknown, errors: string[]): AppletPermission[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    errors.push('permissions must be a non-empty array');
    return [];
  }
  const permissions: AppletPermission[] = [];
  for (const permission of raw) {
    if (!isCapabilityMethod(permission)) {
      errors.push(`permissions contains unknown capability method: ${String(permission)}`);
      continue;
    }
    permissions.push(permission);
  }
  return permissions;
}

function validateServices(raw: unknown, errors: string[]): AppletServiceDeclaration[] {
  if (!Array.isArray(raw)) {
    errors.push('services must be an array');
    return [];
  }
  return raw.flatMap((item, index) => {
    if (!isRecord(item)) {
      errors.push(`services[${index}] must be an object`);
      return [];
    }
    const allowedMethods = validateStringArray(item.allowedMethods, `services[${index}].allowedMethods`, errors);
    const allowedPaths = validateStringArray(item.allowedPaths, `services[${index}].allowedPaths`, errors);
    if (!nonEmptyString(item.id)) errors.push(`services[${index}].id must be a non-empty string`);
    if (item.kind !== 'http') errors.push(`services[${index}].kind must be 'http'`);
    if (!['host-resolved', 'station-resolved', 'dev-override'].includes(String(item.binding))) {
      errors.push(`services[${index}].binding must be host-resolved, station-resolved, or dev-override`);
    }
    return [{
      id: nonEmptyString(item.id) ? item.id : '',
      kind: 'http' as const,
      binding: item.binding as AppletServiceBinding,
      allowedMethods: allowedMethods as AppletServiceDeclaration['allowedMethods'],
      allowedPaths,
      publicPathPrefix: nonEmptyString(item.publicPathPrefix) ? item.publicPathPrefix : undefined,
      stationPathPrefix: nonEmptyString(item.stationPathPrefix) ? item.stationPathPrefix : undefined,
      streaming: item.streaming === true,
    }];
  });
}

function validateSkills(raw: unknown, errors: string[]): AppletSkillDeclaration[] {
  if (!Array.isArray(raw)) {
    errors.push('skills must be an array');
    return [];
  }
  return raw.flatMap((item, index) => {
    if (!isRecord(item)) {
      errors.push(`skills[${index}] must be an object`);
      return [];
    }
    if (!nonEmptyString(item.id)) errors.push(`skills[${index}].id must be a non-empty string`);
    if (!nonEmptyString(item.inputSchema)) errors.push(`skills[${index}].inputSchema must be a non-empty string`);
    return [{
      id: nonEmptyString(item.id) ? item.id : '',
      inputSchema: nonEmptyString(item.inputSchema) ? item.inputSchema : '',
      streaming: item.streaming === true,
      title: nonEmptyString(item.title) ? item.title : undefined,
      description: nonEmptyString(item.description) ? item.description : undefined,
      display: isRecord(item.display) ? item.display : undefined,
      executor: validateSkillExecutor(item.executor, `skills[${index}].executor`, errors),
    }];
  });
}

function validateSkillExecutor(
  raw: unknown,
  path: string,
  errors: string[],
): AppletSkillExecutor | undefined {
  if (raw === undefined) return undefined;
  if (!isRecord(raw)) {
    errors.push(`${path} must be an object`);
    return undefined;
  }
  if (raw.type === 'agent') {
    const request = raw.request;
    if (request !== undefined && !isRecord(request)) {
      errors.push(`${path}.request must be an object`);
      return { type: 'agent' };
    }
    return {
      type: 'agent',
      request: request === undefined ? undefined : {
        message: nonEmptyString(request.message) ? request.message : undefined,
        agentSessionId: nonEmptyString(request.agentSessionId) ? request.agentSessionId : undefined,
        metadata: isRecord(request.metadata) ? request.metadata : undefined,
      },
    };
  }
  if (raw.type !== 'network') {
    errors.push(`${path}.type must be 'network' or 'agent'`);
    return undefined;
  }
  if (!isRecord(raw.request)) {
    errors.push(`${path}.request must be an object`);
    return undefined;
  }
  const request = raw.request;
  if (!nonEmptyString(request.service)) errors.push(`${path}.request.service must be a non-empty string`);
  if (!nonEmptyString(request.path)) errors.push(`${path}.request.path must be a non-empty string`);
  const method = request.method === undefined ? undefined : String(request.method).toUpperCase();
  if (method !== undefined && !['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD'].includes(method)) {
    errors.push(`${path}.request.method must be a supported HTTP method`);
  }
  return {
    type: 'network',
    request: {
      service: nonEmptyString(request.service) ? request.service : '',
      path: nonEmptyString(request.path) ? request.path : '',
      method: method as AppletNetworkExecutorRequest['method'],
      headers: isRecord(request.headers) ? Object.fromEntries(
        Object.entries(request.headers).flatMap(([key, value]) => (
          typeof value === 'string' ? [[key, value]] : []
        )),
      ) : undefined,
      body: request.body,
    },
  };
}

function validateIntegrity(raw: unknown, errors: string[]): PackageIntegrity {
  if (!isRecord(raw)) {
    errors.push('integrity must be a non-null object');
    return { algorithm: 'sha256', files: {} };
  }
  if (raw.algorithm !== 'sha256') {
    errors.push("integrity.algorithm must be 'sha256'");
  }
  if (!isRecord(raw.files) || Object.keys(raw.files).length === 0) {
    errors.push('integrity.files must be a non-empty object');
    return { algorithm: 'sha256', files: {} };
  }
  const files: Record<string, string> = {};
  for (const [file, hash] of Object.entries(raw.files)) {
    if (!nonEmptyString(hash)) {
      errors.push(`integrity.files.${file} must be a non-empty string`);
      continue;
    }
    files[file] = hash;
  }
  return { algorithm: 'sha256', files };
}

export function validateManifest(raw: unknown): ManifestValidationResult {
  const errors: string[] = [];
  if (!isRecord(raw)) {
    return { valid: false, errors: ['manifest must be a non-null object'] };
  }

  if (!nonEmptyString(raw.id)) errors.push('id must be a non-empty string');
  if (!nonEmptyString(raw.version)) errors.push('version must be a non-empty string');

  const targets = normalizeTargets(raw, errors);
  const entries = validateEntries(raw, errors);
  const load = validateLoad(raw.load, targets, errors);

  if (!isRecord(raw.bridge)) {
    errors.push('bridge must be a non-null object');
  } else if (raw.bridge.protocol !== APPLET_BRIDGE_PROTOCOL) {
    errors.push(`bridge.protocol must be '${APPLET_BRIDGE_PROTOCOL}'`);
  }

  const permissions = validatePermissions(raw.permissions, errors);
  const services = validateServices(raw.services, errors);
  const skills = validateSkills(raw.skills, errors);
  const integrity = validateIntegrity(raw.integrity, errors);

  if (entries.lynx && !Object.values(load).some((entry) => entry?.entry === entries.lynx)) {
    errors.push('entries.lynx must match at least one integrated load entry');
  }
  if (entries.lynx && !integrity.files[entries.lynx]) {
    errors.push('integrity.files must include entries.lynx');
  }
  if (permissions.includes('network.request') && services.length === 0) {
    errors.push('network.request permission requires at least one service declaration');
  }
  for (const skill of skills) {
    if (!integrity.files[skill.inputSchema]) {
      errors.push(`integrity.files must include skill input schema: ${skill.inputSchema}`);
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  const manifest: AppletManifest = {
    id: raw.id as string,
    name: nonEmptyString(raw.name) ? raw.name : undefined,
    version: raw.version as string,
    description: nonEmptyString(raw.description) ? raw.description : undefined,
    author: nonEmptyString(raw.author) ? raw.author : undefined,
    icon: nonEmptyString(raw.icon) ? raw.icon : undefined,
    minPlatformVersion: nonEmptyString(raw.minPlatformVersion) ? raw.minPlatformVersion : undefined,
    targets,
    targetPlatforms: Array.isArray(raw.targetPlatforms) ? targets : undefined,
    entries,
    load,
    bridge: { protocol: APPLET_BRIDGE_PROTOCOL, version: isRecord(raw.bridge) && nonEmptyString(raw.bridge.version) ? raw.bridge.version : undefined },
    permissions,
    capabilities: Array.isArray(raw.capabilities) ? validateStringArray(raw.capabilities, 'capabilities', []) : undefined,
    services,
    skills,
    integrity,
  };

  return { valid: true, errors: [], manifest };
}
