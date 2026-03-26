import {
  APPLET_BRIDGE_PROTOCOL_V2,
  APPLET_MANIFEST_VERSION_V2,
  type AppletInfo,
  type AppletLoadType,
} from './types'

export const APPLET_INDEX_VERSION_V2 = 2 as const

interface AppletIndexV2 {
  indexVersion: typeof APPLET_INDEX_VERSION_V2
  generatedAt?: string
  applets: unknown[]
}

export interface AppletDiagnostic {
  source: string
  issues: string[]
}

type ParseSuccess<T> = {
  ok: true
  value: T
}

type ParseFailure = {
  ok: false
  issues: string[]
}

type ParseResult<T> = ParseSuccess<T> | ParseFailure

const TARGET_PLATFORMS = new Set(['desktop', 'mobile', 'web'])
const LOAD_TYPES = new Set<AppletLoadType>(['lynx'])
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-.]+)?(?:\+[0-9A-Za-z-.]+)?$/
const APPLET_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseNonEmptyString(value: unknown, field: string): ParseResult<string> {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return { ok: false, issues: [`${field} 必须是非空字符串`] }
  }
  return { ok: true, value: value.trim() }
}

function parseSemver(value: unknown, field: string): ParseResult<string> {
  if (typeof value !== 'string' || !SEMVER_PATTERN.test(value)) {
    return { ok: false, issues: [`${field} 必须是合法 semver（例如 1.2.3）`] }
  }
  return { ok: true, value }
}

function parseStringArray(value: unknown, field: string): ParseResult<string[]> {
  if (!Array.isArray(value)) {
    return { ok: false, issues: [`${field} 必须是字符串数组`] }
  }
  const invalidIndex = value.findIndex((item) => typeof item !== 'string' || item.trim().length === 0)
  if (invalidIndex >= 0) {
    return { ok: false, issues: [`${field}[${invalidIndex}] 必须是非空字符串`] }
  }
  return { ok: true, value: value.map((item) => item.trim()) as string[] }
}

export function parseAppletInfoV2(rawManifest: unknown, source: string): ParseResult<AppletInfo> {
  if (!isRecord(rawManifest)) {
    return { ok: false, issues: [`${source} 不是合法 JSON 对象`] }
  }

  const issues: string[] = []
  const manifestVersion = rawManifest.manifestVersion
  if (manifestVersion !== APPLET_MANIFEST_VERSION_V2) {
    issues.push(`${source}.manifestVersion 必须等于 ${APPLET_MANIFEST_VERSION_V2}`)
  }

  const id = parseNonEmptyString(rawManifest.id, `${source}.id`)
  if (!id.ok) {
    issues.push(...id.issues)
  } else if (!APPLET_ID_PATTERN.test(id.value)) {
    issues.push(`${source}.id 格式非法，应匹配 ${APPLET_ID_PATTERN}`)
  }

  const name = parseNonEmptyString(rawManifest.name, `${source}.name`)
  if (!name.ok) issues.push(...name.issues)

  const version = parseSemver(rawManifest.version, `${source}.version`)
  if (!version.ok) issues.push(...version.issues)

  const description = parseNonEmptyString(rawManifest.description, `${source}.description`)
  if (!description.ok) issues.push(...description.issues)

  const author = parseNonEmptyString(rawManifest.author, `${source}.author`)
  if (!author.ok) issues.push(...author.issues)

  const icon = parseNonEmptyString(rawManifest.icon, `${source}.icon`)
  if (!icon.ok) issues.push(...icon.issues)

  const permissions = parseStringArray(rawManifest.permissions, `${source}.permissions`)
  if (!permissions.ok) issues.push(...permissions.issues)

  let capabilities: string[] = []
  if (rawManifest.capabilities !== undefined) {
    const capabilitiesResult = parseStringArray(rawManifest.capabilities, `${source}.capabilities`)
    if (!capabilitiesResult.ok) {
      issues.push(...capabilitiesResult.issues)
    } else {
      capabilities = capabilitiesResult.value
    }
  }

  let minPlatformVersion: string | undefined
  if (rawManifest.minPlatformVersion !== undefined) {
    const minVersion = parseSemver(rawManifest.minPlatformVersion, `${source}.minPlatformVersion`)
    if (!minVersion.ok) {
      issues.push(...minVersion.issues)
    } else {
      minPlatformVersion = minVersion.value
    }
  }

  let targetPlatforms: Array<'desktop' | 'mobile' | 'web'> | undefined
  if (rawManifest.targetPlatforms !== undefined) {
    if (!Array.isArray(rawManifest.targetPlatforms)) {
      issues.push(`${source}.targetPlatforms 必须是数组`)
    } else {
      const invalidIndex = rawManifest.targetPlatforms.findIndex((platform) => !TARGET_PLATFORMS.has(String(platform)))
      if (invalidIndex >= 0) {
        issues.push(`${source}.targetPlatforms[${invalidIndex}] 仅支持 desktop/mobile/web`)
      } else {
        targetPlatforms = rawManifest.targetPlatforms as Array<'desktop' | 'mobile' | 'web'>
      }
    }
  }

  if (!isRecord(rawManifest.load)) {
    issues.push(`${source}.load 必须是对象`)
  }
  const loadType = isRecord(rawManifest.load) ? rawManifest.load.type : undefined
  const loadEntry = isRecord(rawManifest.load) ? rawManifest.load.entry : undefined
  if (!LOAD_TYPES.has(loadType as AppletLoadType)) {
    issues.push(`${source}.load.type 仅支持 lynx（不支持 iframe）`)
  }
  const loadEntryResult = parseNonEmptyString(loadEntry, `${source}.load.entry`)
  if (!loadEntryResult.ok) issues.push(...loadEntryResult.issues)

  if (!isRecord(rawManifest.bridge)) {
    issues.push(`${source}.bridge 必须是对象`)
  } else {
    if (rawManifest.bridge.version !== APPLET_MANIFEST_VERSION_V2) {
      issues.push(`${source}.bridge.version 必须等于 ${APPLET_MANIFEST_VERSION_V2}`)
    }
    if (rawManifest.bridge.protocol !== APPLET_BRIDGE_PROTOCOL_V2) {
      issues.push(`${source}.bridge.protocol 必须等于 ${APPLET_BRIDGE_PROTOCOL_V2}`)
    }
  }

  if (issues.length > 0) {
    return { ok: false, issues }
  }

  const idValue = (id as ParseSuccess<string>).value
  const loadEntryValue = (loadEntryResult as ParseSuccess<string>).value
  return {
    ok: true,
    value: {
      manifestVersion: APPLET_MANIFEST_VERSION_V2,
      id: idValue,
      name: (name as ParseSuccess<string>).value,
      version: (version as ParseSuccess<string>).value,
      description: (description as ParseSuccess<string>).value,
      author: (author as ParseSuccess<string>).value,
      icon: (icon as ParseSuccess<string>).value,
      permissions: (permissions as ParseSuccess<string[]>).value,
      capabilities,
      minPlatformVersion,
      targetPlatforms,
      load: {
        type: loadType as AppletLoadType,
        entry: loadEntryValue,
      },
      bridge: {
        version: APPLET_MANIFEST_VERSION_V2,
        protocol: APPLET_BRIDGE_PROTOCOL_V2,
      },
      main: loadEntryValue,
      path: `/applets-dist/${idValue}`,
    },
  }
}

export function parseAppletIndexV2(rawIndex: unknown, source = '/applets-dist/index.json'): ParseResult<AppletIndexV2> {
  if (!isRecord(rawIndex)) {
    return { ok: false, issues: [`${source} 不是合法 JSON 对象`] }
  }
  if (rawIndex.indexVersion !== APPLET_INDEX_VERSION_V2) {
    return {
      ok: false,
      issues: [
        `${source}.indexVersion 必须等于 ${APPLET_INDEX_VERSION_V2}`,
      ],
    }
  }
  if (!Array.isArray(rawIndex.applets)) {
    return { ok: false, issues: [`${source}.applets 必须是数组`] }
  }
  return {
    ok: true,
    value: {
      indexVersion: APPLET_INDEX_VERSION_V2,
      generatedAt: typeof rawIndex.generatedAt === 'string' ? rawIndex.generatedAt : undefined,
      applets: rawIndex.applets,
    },
  }
}
