import {
  APPLET_BRIDGE_PROTOCOL,
  type AppletInfo,
  type AppletLoadMap,
  type TargetPlatform,
} from './types'
import { validateManifest } from '@peers-touch/applet-contract'

// ── Index format ──

export interface AppletIndex {
  version: number
  generatedAt?: string
  applets: unknown[]
}

export interface AppletDiagnostic {
  source: string
  issues: string[]
}

type ParseSuccess<T> = { ok: true; value: T }
type ParseFailure = { ok: false; issues: string[] }
type ParseResult<T> = ParseSuccess<T> | ParseFailure

// ── Validation helpers ──

const TARGET_PLATFORMS = new Set<TargetPlatform>(['desktop', 'android', 'ios', 'harmony', 'web', 'standalone'])
const DESKTOP_LOAD_TYPES = new Set(['lynx-web'])
const MOBILE_LOAD_TYPES = new Set(['lynx-native'])
const STANDALONE_LOAD_TYPES = new Set(['web-spa'])
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-.]+)?(?:\+[0-9A-Za-z-.]+)?$/
const APPLET_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseNonEmptyString(value: unknown, field: string): ParseResult<string> {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return { ok: false, issues: [`${field} must be a non-empty string`] }
  }
  return { ok: true, value: value.trim() }
}

function parseSemver(value: unknown, field: string): ParseResult<string> {
  if (typeof value !== 'string' || !SEMVER_PATTERN.test(value)) {
    return { ok: false, issues: [`${field} must be valid semver (e.g. 1.2.3)`] }
  }
  return { ok: true, value }
}

function parseStringArray(value: unknown, field: string): ParseResult<string[]> {
  if (!Array.isArray(value)) {
    return { ok: false, issues: [`${field} must be a string array`] }
  }
  const invalidIndex = value.findIndex((item) => typeof item !== 'string' || item.trim().length === 0)
  if (invalidIndex >= 0) {
    return { ok: false, issues: [`${field}[${invalidIndex}] must be a non-empty string`] }
  }
  return { ok: true, value: value.map((item) => item.trim()) as string[] }
}

// ── Platform load config validation ──

function validateLoadMap(load: unknown, source: string): ParseResult<AppletLoadMap> {
  if (!isRecord(load)) {
    return { ok: false, issues: [`${source}.load must be an object`] }
  }

  const issues: string[] = []
  const result: AppletLoadMap = {}

  if (load.desktop !== undefined) {
    if (!isRecord(load.desktop)) {
      issues.push(`${source}.load.desktop must be an object`)
    } else {
      if (!DESKTOP_LOAD_TYPES.has(load.desktop.type as string)) {
        issues.push(`${source}.load.desktop.type must be "lynx-web"`)
      }
      if (typeof load.desktop.entry !== 'string' || load.desktop.entry.trim().length === 0) {
        issues.push(`${source}.load.desktop.entry must be a non-empty string`)
      } else {
        result.desktop = { type: 'lynx-web', entry: (load.desktop.entry as string).trim() }
      }
    }
  }

  if (load.android !== undefined) {
    if (!isRecord(load.android)) {
      issues.push(`${source}.load.android must be an object`)
    } else {
      if (!MOBILE_LOAD_TYPES.has(load.android.type as string)) {
        issues.push(`${source}.load.android.type must be "lynx-native"`)
      }
      if (typeof load.android.entry !== 'string' || load.android.entry.trim().length === 0) {
        issues.push(`${source}.load.android.entry must be a non-empty string`)
      } else {
        result.android = { type: 'lynx-native', entry: (load.android.entry as string).trim() }
      }
    }
  }

  if (load.ios !== undefined) {
    if (!isRecord(load.ios)) {
      issues.push(`${source}.load.ios must be an object`)
    } else {
      if (!MOBILE_LOAD_TYPES.has(load.ios.type as string)) {
        issues.push(`${source}.load.ios.type must be "lynx-native"`)
      }
      if (typeof load.ios.entry !== 'string' || load.ios.entry.trim().length === 0) {
        issues.push(`${source}.load.ios.entry must be a non-empty string`)
      } else {
        result.ios = { type: 'lynx-native', entry: (load.ios.entry as string).trim() }
      }
    }
  }

  if (load.harmony !== undefined) {
    if (!isRecord(load.harmony)) {
      issues.push(`${source}.load.harmony must be an object`)
    } else {
      if (!MOBILE_LOAD_TYPES.has(load.harmony.type as string)) {
        issues.push(`${source}.load.harmony.type must be "lynx-native"`)
      }
      if (typeof load.harmony.entry !== 'string' || load.harmony.entry.trim().length === 0) {
        issues.push(`${source}.load.harmony.entry must be a non-empty string`)
      } else {
        result.harmony = { type: 'lynx-native', entry: (load.harmony.entry as string).trim() }
      }
    }
  }

  if (load.web !== undefined) {
    if (!isRecord(load.web)) {
      issues.push(`${source}.load.web must be an object`)
    } else {
      if (!DESKTOP_LOAD_TYPES.has(load.web.type as string)) {
        issues.push(`${source}.load.web.type must be "lynx-web"`)
      }
      if (typeof load.web.entry !== 'string' || load.web.entry.trim().length === 0) {
        issues.push(`${source}.load.web.entry must be a non-empty string`)
      } else {
        result.web = { type: 'lynx-web', entry: (load.web.entry as string).trim() }
      }
    }
  }

  if (load.standalone !== undefined) {
    if (!isRecord(load.standalone)) {
      issues.push(`${source}.load.standalone must be an object`)
    } else {
      if (!STANDALONE_LOAD_TYPES.has(load.standalone.type as string)) {
        issues.push(`${source}.load.standalone.type must be "web-spa"`)
      }
      if (typeof load.standalone.entry !== 'string' || load.standalone.entry.trim().length === 0) {
        issues.push(`${source}.load.standalone.entry must be a non-empty string`)
      } else {
        result.standalone = { type: 'web-spa', entry: (load.standalone.entry as string).trim() }
      }
    }
  }

  // At least one platform must be defined
  if (!result.desktop && !result.android && !result.ios && !result.harmony && !result.web && !result.standalone) {
    issues.push(`${source}.load must contain at least one platform entry`)
  }

  if (issues.length > 0) return { ok: false, issues }
  return { ok: true, value: result }
}

// ── Main manifest parser ──

export function parseAppletInfo(rawManifest: unknown, source: string): ParseResult<AppletInfo> {
  if (!isRecord(rawManifest)) {
    return { ok: false, issues: [`${source} is not a valid JSON object`] }
  }

  const issues: string[] = []
  const contractCheck = validateManifest(rawManifest)
  if (!contractCheck.valid) {
    return { ok: false, issues: contractCheck.errors.map((issue) => `${source}: ${issue}`) }
  }

  const id = parseNonEmptyString(rawManifest.id, `${source}.id`)
  if (!id.ok) {
    issues.push(...id.issues)
  } else if (!APPLET_ID_PATTERN.test(id.value)) {
    issues.push(`${source}.id format invalid, must match ${APPLET_ID_PATTERN}`)
  }

  const name = parseNonEmptyString(rawManifest.name, `${source}.name`)
  if (!name.ok) issues.push(...name.issues)

  const version = parseSemver(rawManifest.version, `${source}.version`)
  if (!version.ok) issues.push(...version.issues)

  const description = parseNonEmptyString(rawManifest.description, `${source}.description`)
  if (!description.ok) issues.push(...description.issues)

  const author = parseNonEmptyString(rawManifest.author, `${source}.author`)
  if (!author.ok) issues.push(...author.issues)

  const icon = typeof rawManifest.icon === 'string' ? rawManifest.icon.trim() : undefined

  const permissions = parseStringArray(rawManifest.permissions, `${source}.permissions`)
  if (!permissions.ok) issues.push(...permissions.issues)

  let capabilities: string[] = []
  if (rawManifest.capabilities !== undefined) {
    const capResult = parseStringArray(rawManifest.capabilities, `${source}.capabilities`)
    if (!capResult.ok) issues.push(...capResult.issues)
    else capabilities = capResult.value
  }

  let minPlatformVersion: string | undefined
  if (rawManifest.minPlatformVersion !== undefined) {
    const minV = parseSemver(rawManifest.minPlatformVersion, `${source}.minPlatformVersion`)
    if (!minV.ok) issues.push(...minV.issues)
    else minPlatformVersion = minV.value
  }

  // targetPlatforms
  let targetPlatforms: TargetPlatform[] = []
  const rawTargets = Array.isArray(rawManifest.targets) ? rawManifest.targets : rawManifest.targetPlatforms
  if (!Array.isArray(rawTargets)) {
    issues.push(`${source}.targets must be an array`)
  } else {
    const invalidIdx = rawTargets.findIndex(
      (p: unknown) => !TARGET_PLATFORMS.has(p as TargetPlatform),
    )
    if (invalidIdx >= 0) {
      issues.push(`${source}.targets[${invalidIdx}] must be one of: desktop, android, ios, harmony, web, standalone`)
    } else {
      targetPlatforms = rawTargets as TargetPlatform[]
    }
  }

  // load (platform map)
  const loadResult = validateLoadMap(rawManifest.load, source)
  if (!loadResult.ok) issues.push(...loadResult.issues)

  // bridge
  if (!isRecord(rawManifest.bridge)) {
    issues.push(`${source}.bridge must be an object`)
  } else {
    if (rawManifest.bridge.protocol !== APPLET_BRIDGE_PROTOCOL) {
      issues.push(`${source}.bridge.protocol must be "${APPLET_BRIDGE_PROTOCOL}"`)
    }
    const bridgeVersion = parseSemver(rawManifest.bridge.version, `${source}.bridge.version`)
    if (!bridgeVersion.ok) issues.push(...bridgeVersion.issues)
  }

  if (issues.length > 0) {
    return { ok: false, issues }
  }

  const idValue = (id as ParseSuccess<string>).value
  return {
    ok: true,
    value: {
      id: idValue,
      name: (name as ParseSuccess<string>).value,
      version: (version as ParseSuccess<string>).value,
      description: (description as ParseSuccess<string>).value,
      author: (author as ParseSuccess<string>).value,
      icon,
      permissions: (permissions as ParseSuccess<string[]>).value,
      capabilities,
      minPlatformVersion,
      targetPlatforms,
      load: (loadResult as ParseSuccess<AppletLoadMap>).value,
      bridge: {
        protocol: APPLET_BRIDGE_PROTOCOL,
        version: (rawManifest.bridge as Record<string, unknown>).version as string,
      },
      path: `/applets-dist/${idValue}`,
      targets: targetPlatforms,
      entries: isRecord(rawManifest.entries) ? rawManifest.entries as { lynx: string; standalone?: string } : undefined,
      services: Array.isArray(rawManifest.services) ? rawManifest.services as AppletInfo['services'] : undefined,
      skills: Array.isArray(rawManifest.skills) ? rawManifest.skills as AppletInfo['skills'] : undefined,
      integrity: isRecord(rawManifest.integrity) ? rawManifest.integrity as unknown as AppletInfo['integrity'] : undefined,
    },
  }
}

// ── Index parser ──

export function parseAppletIndex(rawIndex: unknown, source = '/applets-dist/index.json'): ParseResult<AppletIndex> {
  if (!isRecord(rawIndex)) {
    return { ok: false, issues: [`${source} is not a valid JSON object`] }
  }
  if (typeof rawIndex.version !== 'number') {
    return { ok: false, issues: [`${source}.version must be a number`] }
  }
  if (!Array.isArray(rawIndex.applets)) {
    return { ok: false, issues: [`${source}.applets must be an array`] }
  }
  return {
    ok: true,
    value: {
      version: rawIndex.version as number,
      generatedAt: typeof rawIndex.generatedAt === 'string' ? rawIndex.generatedAt : undefined,
      applets: rawIndex.applets,
    },
  }
}

// ── Legacy aliases for backward compatibility during migration ──
export const parseAppletInfoV2 = parseAppletInfo
export const parseAppletIndexV2 = parseAppletIndex
