export const APPLET_MANIFEST_VERSION_V2 = 2
export const APPLET_INDEX_VERSION_V2 = 2
export const APPLET_BRIDGE_PROTOCOL_V2 = 'peers-touch.applet.bridge.v2'

const TARGET_PLATFORMS = new Set(['desktop', 'mobile', 'web'])
const LOAD_TYPES = new Set(['lynx'])
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-.]+)?(?:\+[0-9A-Za-z-.]+)?$/
const APPLET_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/

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

function assertStringArray(value, fieldPath, diagnostics) {
  if (!Array.isArray(value)) {
    diagnostics.push(`${fieldPath} must be an array of strings`)
    return false
  }
  const invalidIndex = value.findIndex((item) => typeof item !== 'string' || item.trim().length === 0)
  if (invalidIndex >= 0) {
    diagnostics.push(`${fieldPath}[${invalidIndex}] must be a non-empty string`)
    return false
  }
  return true
}

function validateSemver(value, fieldPath, diagnostics) {
  if (typeof value !== 'string' || !SEMVER_PATTERN.test(value)) {
    diagnostics.push(`${fieldPath} must be a valid semver string (for example 1.2.3)`)
    return false
  }
  return true
}

export function validateManifestV2(rawManifest, { source = 'manifest' } = {}) {
  const diagnostics = []
  if (!isPlainObject(rawManifest)) {
    diagnostics.push(`${source} must be a JSON object`)
    return { valid: false, diagnostics }
  }

  if (rawManifest.manifestVersion !== APPLET_MANIFEST_VERSION_V2) {
    diagnostics.push(`${source}.manifestVersion must be ${APPLET_MANIFEST_VERSION_V2}`)
  }

  if (assertNonEmptyString(rawManifest.id, `${source}.id`, diagnostics)) {
    if (!APPLET_ID_PATTERN.test(rawManifest.id)) {
      diagnostics.push(`${source}.id must match ${APPLET_ID_PATTERN}`)
    }
  }

  assertNonEmptyString(rawManifest.name, `${source}.name`, diagnostics)
  validateSemver(rawManifest.version, `${source}.version`, diagnostics)
  assertNonEmptyString(rawManifest.description, `${source}.description`, diagnostics)
  assertNonEmptyString(rawManifest.author, `${source}.author`, diagnostics)
  assertNonEmptyString(rawManifest.icon, `${source}.icon`, diagnostics)
  assertStringArray(rawManifest.permissions, `${source}.permissions`, diagnostics)

  if (rawManifest.capabilities !== undefined) {
    assertStringArray(rawManifest.capabilities, `${source}.capabilities`, diagnostics)
  }

  if (rawManifest.minPlatformVersion !== undefined) {
    validateSemver(rawManifest.minPlatformVersion, `${source}.minPlatformVersion`, diagnostics)
  }

  if (rawManifest.targetPlatforms !== undefined) {
    if (!Array.isArray(rawManifest.targetPlatforms)) {
      diagnostics.push(`${source}.targetPlatforms must be an array`)
    } else {
      const invalidIndex = rawManifest.targetPlatforms.findIndex((platform) => !TARGET_PLATFORMS.has(platform))
      if (invalidIndex >= 0) {
        diagnostics.push(`${source}.targetPlatforms[${invalidIndex}] must be one of: desktop, mobile, web`)
      }
    }
  }

  if (!isPlainObject(rawManifest.load)) {
    diagnostics.push(`${source}.load must be an object`)
  } else {
    if (!LOAD_TYPES.has(rawManifest.load.type)) {
      diagnostics.push(`${source}.load.type must be lynx (iframe is not supported)`)
    }
    assertNonEmptyString(rawManifest.load.entry, `${source}.load.entry`, diagnostics)
  }

  if (!isPlainObject(rawManifest.bridge)) {
    diagnostics.push(`${source}.bridge must be an object`)
  } else {
    if (rawManifest.bridge.version !== APPLET_MANIFEST_VERSION_V2) {
      diagnostics.push(`${source}.bridge.version must be ${APPLET_MANIFEST_VERSION_V2}`)
    }
    if (rawManifest.bridge.protocol !== APPLET_BRIDGE_PROTOCOL_V2) {
      diagnostics.push(`${source}.bridge.protocol must be ${APPLET_BRIDGE_PROTOCOL_V2}`)
    }
  }

  if (rawManifest.main !== undefined) {
    assertNonEmptyString(rawManifest.main, `${source}.main`, diagnostics)
  }

  return {
    valid: diagnostics.length === 0,
    diagnostics,
  }
}

export function validateIndexV2(rawIndex, { source = 'index' } = {}) {
  const diagnostics = []

  if (!isPlainObject(rawIndex)) {
    diagnostics.push(`${source} must be a JSON object`)
    return { valid: false, diagnostics }
  }

  if (rawIndex.indexVersion !== APPLET_INDEX_VERSION_V2) {
    diagnostics.push(`${source}.indexVersion must be ${APPLET_INDEX_VERSION_V2}`)
  }

  if (!Array.isArray(rawIndex.applets)) {
    diagnostics.push(`${source}.applets must be an array`)
    return { valid: false, diagnostics }
  }

  rawIndex.applets.forEach((manifest, index) => {
    const manifestCheck = validateManifestV2(manifest, {
      source: `${source}.applets[${index}]`,
    })
    diagnostics.push(...manifestCheck.diagnostics)
  })

  return {
    valid: diagnostics.length === 0,
    diagnostics,
  }
}

export function createIndexV2(applets) {
  return {
    indexVersion: APPLET_INDEX_VERSION_V2,
    generatedAt: new Date().toISOString(),
    applets,
  }
}

export function formatDiagnostics(diagnostics) {
  return diagnostics.map((item) => `- ${item}`).join('\n')
}
