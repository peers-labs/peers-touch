export const APPLET_INDEX_VERSION = 1
export const APPLET_BRIDGE_PROTOCOL = 'peers-touch.applet.bridge'

const TARGET_PLATFORMS = new Set(['desktop', 'android', 'ios', 'harmony', 'web', 'standalone'])
const LOAD_TYPES_BY_PLATFORM = {
  desktop: 'lynx-web',
  android: 'lynx-native',
  ios: 'lynx-native',
  harmony: 'lynx-native',
  web: 'lynx-web',
  standalone: 'web-spa',
}
const SERVICE_BINDINGS = new Set(['host-resolved', 'station-resolved', 'dev-override'])
const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD'])
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-.]+)?(?:\+[0-9A-Za-z-.]+)?$/
const APPLET_ID_PATTERN = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/
const CAPABILITY_METHOD_PATTERN = /^[a-z][A-Za-z0-9]*(?:\.[a-z][A-Za-z0-9]*)+$/

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertNonEmptyString(value, fieldPath, diagnostics) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    diagnostics.push(`${fieldPath} must be a non-empty string`)
    return false
  }
  return true
}

function assertStringArray(value, fieldPath, diagnostics, { required = true } = {}) {
  if (value === undefined && !required) return []
  if (!Array.isArray(value)) {
    diagnostics.push(`${fieldPath} must be an array of strings`)
    return []
  }
  const result = []
  value.forEach((item, index) => {
    if (typeof item !== 'string' || item.trim().length === 0) {
      diagnostics.push(`${fieldPath}[${index}] must be a non-empty string`)
      return
    }
    result.push(item.trim())
  })
  return result
}

function validateSemver(value, fieldPath, diagnostics) {
  if (typeof value !== 'string' || !SEMVER_PATTERN.test(value)) {
    diagnostics.push(`${fieldPath} must be a valid semver string (for example 1.2.3)`)
    return false
  }
  return true
}

function validateTargets(rawManifest, source, diagnostics) {
  const targets = assertStringArray(rawManifest.targets, `${source}.targets`, diagnostics)
  if (targets.length === 0) {
    diagnostics.push(`${source}.targets must contain at least one target`)
  }
  targets.forEach((target, index) => {
    if (!TARGET_PLATFORMS.has(target)) {
      diagnostics.push(`${source}.targets[${index}] must be one of: ${Array.from(TARGET_PLATFORMS).join(', ')}`)
    }
  })
  return targets
}

function validateEntries(rawManifest, source, diagnostics) {
  if (!isPlainObject(rawManifest.entries)) {
    diagnostics.push(`${source}.entries must be an object`)
    return
  }
  assertNonEmptyString(rawManifest.entries.lynx, `${source}.entries.lynx`, diagnostics)
  if (rawManifest.entries.standalone !== undefined) {
    assertNonEmptyString(rawManifest.entries.standalone, `${source}.entries.standalone`, diagnostics)
  }
}

function validateLoad(rawManifest, targets, source, diagnostics) {
  if (!isPlainObject(rawManifest.load)) {
    diagnostics.push(`${source}.load must be an object`)
    return
  }

  for (const target of targets) {
    const load = rawManifest.load[target]
    if (!isPlainObject(load)) {
      diagnostics.push(`${source}.load.${target} must be an object for every target`)
      continue
    }
    const expectedType = LOAD_TYPES_BY_PLATFORM[target]
    if (load.type !== expectedType) {
      diagnostics.push(`${source}.load.${target}.type must be ${expectedType}`)
    }
    assertNonEmptyString(load.entry, `${source}.load.${target}.entry`, diagnostics)
  }
}

function validateBridge(rawManifest, source, diagnostics) {
  if (!isPlainObject(rawManifest.bridge)) {
    diagnostics.push(`${source}.bridge must be an object`)
    return
  }
  if (rawManifest.bridge.protocol !== APPLET_BRIDGE_PROTOCOL) {
    diagnostics.push(`${source}.bridge.protocol must be ${APPLET_BRIDGE_PROTOCOL}`)
  }
  if (rawManifest.bridge.version !== undefined) {
    validateSemver(rawManifest.bridge.version, `${source}.bridge.version`, diagnostics)
  }
}

function validatePermissions(rawManifest, source, diagnostics) {
  const permissions = assertStringArray(rawManifest.permissions, `${source}.permissions`, diagnostics)
  if (permissions.length === 0) {
    diagnostics.push(`${source}.permissions must contain at least one capability method`)
  }
  permissions.forEach((permission, index) => {
    if (!CAPABILITY_METHOD_PATTERN.test(permission)) {
      diagnostics.push(`${source}.permissions[${index}] must be a full capability method`)
    }
  })
  return permissions
}

function validateServices(rawManifest, source, diagnostics) {
  if (!Array.isArray(rawManifest.services)) {
    diagnostics.push(`${source}.services must be an array`)
    return []
  }
  rawManifest.services.forEach((service, index) => {
    const path = `${source}.services[${index}]`
    if (!isPlainObject(service)) {
      diagnostics.push(`${path} must be an object`)
      return
    }
    assertNonEmptyString(service.id, `${path}.id`, diagnostics)
    if (service.kind !== 'http') diagnostics.push(`${path}.kind must be http`)
    if (!SERVICE_BINDINGS.has(service.binding)) {
      diagnostics.push(`${path}.binding must be one of: ${Array.from(SERVICE_BINDINGS).join(', ')}`)
    }
    const methods = assertStringArray(service.allowedMethods, `${path}.allowedMethods`, diagnostics)
    methods.forEach((method, methodIndex) => {
      if (!HTTP_METHODS.has(method)) diagnostics.push(`${path}.allowedMethods[${methodIndex}] must be a supported HTTP method`)
    })
    const allowedPaths = assertStringArray(service.allowedPaths, `${path}.allowedPaths`, diagnostics)
    if (allowedPaths.length === 0) diagnostics.push(`${path}.allowedPaths must contain at least one path`)
    if (service.publicPathPrefix !== undefined) assertNonEmptyString(service.publicPathPrefix, `${path}.publicPathPrefix`, diagnostics)
    if (service.stationPathPrefix !== undefined) assertNonEmptyString(service.stationPathPrefix, `${path}.stationPathPrefix`, diagnostics)
  })
  return rawManifest.services
}

function validateSkills(rawManifest, source, diagnostics) {
  if (!Array.isArray(rawManifest.skills)) {
    diagnostics.push(`${source}.skills must be an array`)
    return
  }
  rawManifest.skills.forEach((skill, index) => {
    const path = `${source}.skills[${index}]`
    if (!isPlainObject(skill)) {
      diagnostics.push(`${path} must be an object`)
      return
    }
    assertNonEmptyString(skill.id, `${path}.id`, diagnostics)
    assertNonEmptyString(skill.inputSchema, `${path}.inputSchema`, diagnostics)
  })
}

function validateOptionalIntegrity(rawManifest, source, diagnostics) {
  if (rawManifest.integrity === undefined) return
  if (!isPlainObject(rawManifest.integrity)) {
    diagnostics.push(`${source}.integrity must be an object when provided`)
    return
  }
  if (rawManifest.integrity.algorithm !== 'sha256') {
    diagnostics.push(`${source}.integrity.algorithm must be sha256`)
  }
  if (!isPlainObject(rawManifest.integrity.files)) {
    diagnostics.push(`${source}.integrity.files must be an object when integrity is provided`)
  }
}

export function validateAppletSourceManifest(rawManifest, { source = 'manifest' } = {}) {
  const diagnostics = []
  if (!isPlainObject(rawManifest)) {
    diagnostics.push(`${source} must be a JSON object`)
    return { valid: false, diagnostics }
  }

  if ('manifestVersion' in rawManifest) diagnostics.push(`${source}.manifestVersion is legacy and must be removed`)
  if ('main' in rawManifest) diagnostics.push(`${source}.main is legacy and must be replaced by entries/load`)
  if ('targetPlatforms' in rawManifest) diagnostics.push(`${source}.targetPlatforms is legacy compatibility output; source manifests must use targets`)

  if (assertNonEmptyString(rawManifest.id, `${source}.id`, diagnostics) && !APPLET_ID_PATTERN.test(rawManifest.id)) {
    diagnostics.push(`${source}.id must match ${APPLET_ID_PATTERN}`)
  }
  assertNonEmptyString(rawManifest.name, `${source}.name`, diagnostics)
  validateSemver(rawManifest.version, `${source}.version`, diagnostics)
  assertNonEmptyString(rawManifest.description, `${source}.description`, diagnostics)
  assertNonEmptyString(rawManifest.author, `${source}.author`, diagnostics)
  assertNonEmptyString(rawManifest.icon, `${source}.icon`, diagnostics)
  if (rawManifest.minPlatformVersion !== undefined) {
    validateSemver(rawManifest.minPlatformVersion, `${source}.minPlatformVersion`, diagnostics)
  }

  const targets = validateTargets(rawManifest, source, diagnostics)
  validateEntries(rawManifest, source, diagnostics)
  validateLoad(rawManifest, targets, source, diagnostics)
  validateBridge(rawManifest, source, diagnostics)
  const permissions = validatePermissions(rawManifest, source, diagnostics)
  const services = validateServices(rawManifest, source, diagnostics)
  validateSkills(rawManifest, source, diagnostics)
  validateOptionalIntegrity(rawManifest, source, diagnostics)
  assertStringArray(rawManifest.capabilities, `${source}.capabilities`, diagnostics, { required: false })

  if (permissions.includes('network.request') && services.length === 0) {
    diagnostics.push(`${source}.network.request permission requires at least one service declaration`)
  }

  return {
    valid: diagnostics.length === 0,
    diagnostics,
  }
}

export function validateIndex(rawIndex, { source = 'index' } = {}) {
  const diagnostics = []

  if (!isPlainObject(rawIndex)) {
    diagnostics.push(`${source} must be a JSON object`)
    return { valid: false, diagnostics }
  }

  if (rawIndex.version !== APPLET_INDEX_VERSION) {
    diagnostics.push(`${source}.version must be ${APPLET_INDEX_VERSION}`)
  }

  if (!Array.isArray(rawIndex.applets)) {
    diagnostics.push(`${source}.applets must be an array`)
    return { valid: false, diagnostics }
  }

  return {
    valid: diagnostics.length === 0,
    diagnostics,
  }
}

export function createIndex(applets) {
  return {
    version: APPLET_INDEX_VERSION,
    generatedAt: new Date().toISOString(),
    applets,
  }
}

export function formatDiagnostics(diagnostics) {
  return diagnostics.map((item) => `- ${item}`).join('\n')
}

export const validateManifestV2 = validateAppletSourceManifest
export const validateIndexV2 = validateIndex
export const createIndexV2 = createIndex
