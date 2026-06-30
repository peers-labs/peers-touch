#!/usr/bin/env node
import fs from 'fs/promises'
import { constants as fsConstants } from 'fs'
import { createHash } from 'crypto'
import path from 'path'
import { fileURLToPath } from 'url'
import { spawnSync } from 'child_process'
import { formatDiagnostics, validateManifestV2 } from './schema.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.join(__dirname, '../..')
let validateCanonicalManifest
const buildLockPath = path.join(rootDir, 'apps/desktop/applets-dist/.build.lock')

// 配置
const config = {
  appletsDir: __dirname,
  canonicalLynxAppletDirs: [
    path.join(rootDir, 'apps/desktop/applets-dev/hello-lynx'),
  ],
  officialAppletRoot: path.join(rootDir, 'apps/applets'),
  externalLynxAppletRoots: [
    path.resolve(rootDir, '../my-peers-applets/applets'),
    ...((process.env.PEERS_TOUCH_EXTERNAL_LYNX_APPLETS ?? '')
      .split(path.delimiter)
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => path.resolve(rootDir, item))),
  ],
  outputDirs: [
    path.join(__dirname, '../../apps/desktop/applets-dist'),
    // 后续添加移动端目录
    // path.join(__dirname, '../../apps/mobile/android/app/src/main/assets/applets'),
    // path.join(__dirname, '../../apps/mobile/ios/App/Assets/applets'),
  ],
}

const legacyPermissionGroups = {
  network: ['network.request'],
  storage: ['storage.get', 'storage.set'],
  system: ['system.getInfo'],
  config: ['config.get'],
}

function writeStdout(message = '') {
  process.stdout.write(`${message}\n`)
}

function writeStderr(message = '') {
  process.stderr.write(`${message}\n`)
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    stdio: options.stdio ?? 'inherit',
    encoding: 'utf8',
  })
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status ?? 'unknown'}`)
  }
  return result
}

function jsString(value) {
  return JSON.stringify(value)
}

async function writeLynxWebBuildConfig(appletDir, appletName) {
  const configDir = path.join(appletDir, '.peers-touch-build')
  await fs.mkdir(configDir, { recursive: true })
  const configPath = path.join(configDir, 'rspeedy.web.config.ts')
  const content = `import { defineConfig } from '@lynx-js/rspeedy'
import { pluginReactLynx } from '@lynx-js/react-rsbuild-plugin'

export default defineConfig({
  plugins: [pluginReactLynx()],
  environments: {
    web: {},
  },
  source: {
    entry: ${jsString(path.join(appletDir, 'src/index.tsx'))},
  },
  output: {
    distPath: {
      root: ${jsString(path.join(appletDir, 'dist'))},
    },
    filename: 'main.lynx.bundle',
    filenameHash: false,
  },
})
`
  await fs.writeFile(configPath, content)
  return configPath
}

async function buildLynxWebApplet(appletDir, appletName) {
  const configPath = await writeLynxWebBuildConfig(appletDir, appletName)
  try {
    run('pnpm', ['exec', 'rspeedy', 'build', '--config', configPath], { cwd: appletDir, stdio: 'inherit' })
  } finally {
    await fs.rm(path.dirname(configPath), { recursive: true, force: true })
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function acquireBuildLock() {
  await fs.mkdir(path.dirname(buildLockPath), { recursive: true })
  const deadline = Date.now() + 120000
  while (Date.now() < deadline) {
    try {
      const handle = await fs.open(buildLockPath, 'wx')
      await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }))
      return async () => {
        await handle.close()
        await fs.rm(buildLockPath, { force: true })
      }
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
      await sleep(250)
    }
  }
  throw new Error(`Timed out waiting for applet build lock: ${buildLockPath}`)
}

async function collectFiles(dir, base = dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const absolute = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...await collectFiles(absolute, base))
      continue
    }
    if (!entry.isFile()) continue
    const relative = path.relative(base, absolute).split(path.sep).join('/')
    if (relative === 'applet.json' || relative === 'manifest.json') continue
    files.push(relative)
  }
  return files.sort()
}

async function integrityForFiles(dir) {
  const files = await collectFiles(dir)
  const hashes = {}
  for (const file of files) {
    const content = await fs.readFile(path.join(dir, file))
    hashes[file] = `sha256:${createHash('sha256').update(content).digest('hex')}`
  }
  return hashes
}

function toCanonicalManifest(source, integrityFiles) {
  return {
    id: source.id,
    name: source.name,
    version: source.version,
    description: source.description,
    author: source.author,
    icon: source.icon,
    minPlatformVersion: source.minPlatformVersion,
    targets: source.targets,
    entries: source.entries,
    load: source.load,
    bridge: source.bridge,
    permissions: source.permissions,
    capabilities: source.capabilities ?? [],
    services: source.services ?? [],
    skills: source.skills ?? [],
    integrity: { algorithm: 'sha256', files: integrityFiles },
  }
}

async function assertLynxWebBundleFormat(packageDir, manifest, sourceLabel) {
  const entry = manifest.load?.desktop?.entry ?? manifest.entries?.lynx
  if (manifest.load?.desktop?.type !== 'lynx-web' || !entry) {
    return
  }
  const bundle = await fs.readFile(path.join(packageDir, entry))
  const magic = bundle.subarray(0, 8).toString('utf8')
  if (magic !== 'SDRAWROF') {
    throw new Error(`${sourceLabel} produced an invalid lynx-web bundle: ${entry} must start with SDRAWROF`)
  }
}

function normalizePermissions(source) {
  const permissions = new Set()
  for (const permission of source.permissions ?? []) {
    if (typeof permission !== 'string') continue
    if (permission.includes('.')) {
      permissions.add(permission)
      continue
    }
    for (const expanded of legacyPermissionGroups[permission] ?? []) {
      permissions.add(expanded)
    }
  }
  for (const capability of source.capabilities ?? []) {
    if (typeof capability === 'string' && capability.includes('.')) {
      permissions.add(capability)
    }
  }
  return Array.from(permissions)
}

function toCanonicalLynxManifest(source, entry, integrityFiles) {
  const services = [...(source.services ?? [])]
  const permissions = normalizePermissions(source)
  if (permissions.includes('network.request') && services.length === 0) {
    services.push({
      id: 'big-a-api',
      kind: 'http',
      binding: 'station-resolved',
      allowedMethods: ['GET', 'POST'],
      allowedPaths: ['/api/v1/*'],
      streaming: true,
    })
  }
  return {
    id: source.id,
    name: source.name,
    version: source.version,
    description: source.description,
    author: source.author,
    icon: source.icon,
    minPlatformVersion: source.minPlatformVersion,
    targets: ['desktop'],
    entries: { lynx: entry },
    load: { desktop: { type: 'lynx-web', entry } },
    bridge: source.bridge ?? { protocol: 'peers-touch.applet.bridge', version: '1.0.0' },
    permissions,
    capabilities: source.capabilities ?? [],
    services,
    skills: source.skills ?? [],
    integrity: { algorithm: 'sha256', files: integrityFiles },
  }
}

function assertCanonicalManifest(manifest, source) {
  const check = validateCanonicalManifest(manifest)
  if (!check.valid) {
    throw new Error(`Invalid canonical manifest for ${source}:\n${check.errors.map((item) => `- ${item}`).join('\n')}`)
  }
}

/**
 * 获取所有Applet目录
 */
async function getAppletDirs() {
  const entries = await fs.readdir(config.appletsDir, { withFileTypes: true })
  return entries
    .filter(entry => entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'shared' && entry.name !== 'node_modules')
    .map(entry => path.join(config.appletsDir, entry.name))
}

async function getExternalLynxAppletDirs() {
  const dirs = []
  const seen = new Set()
  for (const root of config.externalLynxAppletRoots) {
    const normalizedRoot = path.resolve(root)
    if (seen.has(normalizedRoot)) continue
    seen.add(normalizedRoot)
    let entries = []
    try {
      entries = await fs.readdir(normalizedRoot, { withFileTypes: true })
    } catch (error) {
      if (error.code === 'ENOENT') continue
      throw error
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue
      const lynxDir = path.join(normalizedRoot, entry.name, 'lynx')
      try {
        await fs.access(path.join(lynxDir, 'applet.json'))
        await fs.access(lynxDir, fsConstants.W_OK)
        dirs.push(lynxDir)
      } catch (error) {
        if (error.code === 'ENOENT') continue
        if (error.code === 'EACCES' || error.code === 'EPERM') {
          writeStderr(`Skip external Lynx applet without write access: ${lynxDir}`)
          continue
        }
        throw error
      }
    }
  }
  return dirs
}

async function getOfficialAppletDirs() {
  let entries = []
  try {
    entries = await fs.readdir(config.officialAppletRoot, { withFileTypes: true })
  } catch (error) {
    if (error.code === 'ENOENT') return []
    throw error
  }
  const dirs = []
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const appletDir = path.join(config.officialAppletRoot, entry.name)
    try {
      await fs.access(path.join(appletDir, 'applet.manifest.json'))
      await fs.access(path.join(appletDir, 'frontend/package.json'))
      dirs.push(appletDir)
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }
  return dirs
}

/**
 * 构建单个Applet
 */
async function buildApplet(appletDir) {
  const appletName = path.basename(appletDir)
  writeStdout(`Building applet: ${appletName}`)
  const distDir = path.join(appletDir, 'dist')
  const appletJsonPath = path.join(appletDir, 'applet.json')

  try {
    // 读取并校验 applet.json（manifest v2）
    const appletJson = JSON.parse(await fs.readFile(appletJsonPath, 'utf-8'))
    const manifestCheck = validateManifestV2(appletJson, {
      source: `${appletName}/applet.json`,
    })
    if (!manifestCheck.valid) {
      throw new Error(`Invalid manifest schema:\n${formatDiagnostics(manifestCheck.diagnostics)}`)
    }
    const appletId = appletJson.id

    // 构建
    run('pnpm', ['run', 'build'], { cwd: appletDir, stdio: 'inherit' })

    // 同步到各个输出目录
    for (const outputDir of config.outputDirs) {
      const targetDir = path.join(outputDir, appletId)
      await fs.rm(targetDir, { recursive: true, force: true })
      await fs.mkdir(targetDir, { recursive: true })
      await fs.cp(distDir, targetDir, { recursive: true })

      const manifest = toCanonicalManifest(appletJson, await integrityForFiles(targetDir))
      assertCanonicalManifest(manifest, `${appletName}/applet.json`)
      await fs.writeFile(path.join(targetDir, 'manifest.json'), JSON.stringify(manifest, null, 2))
      await fs.writeFile(path.join(targetDir, 'applet.json'), JSON.stringify(manifest, null, 2))

      writeStdout(`Synced ${appletName} to ${targetDir}`)
    }

    writeStdout(`Built ${appletName} successfully`)
    return true
  } catch (error) {
    writeStderr(`Failed to build ${appletName}: ${error.message}`)
    throw error
  }
}

async function buildCanonicalLynxApplet(appletDir) {
  const appletName = path.basename(appletDir)
  writeStdout(`Building canonical Lynx applet: ${appletName}`)
  const distDir = path.join(appletDir, 'dist')
  const appletJsonPath = path.join(appletDir, 'applet.json')

  try {
    const appletJson = JSON.parse(await fs.readFile(appletJsonPath, 'utf-8'))
    const appletId = appletJson.id
    const entry = appletJson.load?.desktop?.entry
    if (!appletId || !entry) {
      throw new Error(`${appletName}/applet.json must declare id and load.desktop.entry`)
    }

    await buildLynxWebApplet(appletDir, appletName)

    for (const outputDir of config.outputDirs) {
      const targetDir = path.join(outputDir, appletId)
      await fs.rm(targetDir, { recursive: true, force: true })
      await fs.mkdir(targetDir, { recursive: true })
      await fs.cp(distDir, targetDir, { recursive: true })

      const manifest = toCanonicalLynxManifest(appletJson, entry, await integrityForFiles(targetDir))
      assertCanonicalManifest(manifest, `${appletName}/applet.json`)
      await assertLynxWebBundleFormat(targetDir, manifest, `${appletName}/applet.json`)
      await fs.writeFile(path.join(targetDir, 'manifest.json'), JSON.stringify(manifest, null, 2))
      await fs.writeFile(path.join(targetDir, 'applet.json'), JSON.stringify(manifest, null, 2))

      writeStdout(`Synced ${appletName} to ${targetDir}`)
    }

    writeStdout(`Built canonical Lynx applet ${appletName} successfully`)
    return true
  } catch (error) {
    writeStderr(`Failed to build canonical Lynx applet ${appletName}: ${error.message}`)
    throw error
  }
}

async function buildOfficialApplet(appletDir) {
  const appletName = path.basename(appletDir)
  writeStdout(`Building official applet: ${appletName}`)
  const manifestPath = path.join(appletDir, 'applet.manifest.json')
  const frontendDir = path.join(appletDir, 'frontend')
  const distDir = path.join(frontendDir, 'dist')

  try {
    const sourceManifest = JSON.parse(await fs.readFile(manifestPath, 'utf-8'))
    const appletId = sourceManifest.id
    if (!appletId || typeof appletId !== 'string') {
      throw new Error(`${appletName}/applet.manifest.json must declare string id`)
    }

    run('pnpm', ['run', 'build'], { cwd: frontendDir, stdio: 'inherit' })

    for (const outputDir of config.outputDirs) {
      const targetDir = path.join(outputDir, appletId)
      await fs.rm(targetDir, { recursive: true, force: true })
      await fs.mkdir(targetDir, { recursive: true })
      await fs.cp(distDir, targetDir, { recursive: true })

      const manifest = toCanonicalManifest(sourceManifest, await integrityForFiles(targetDir))
      assertCanonicalManifest(manifest, `${appletName}/applet.manifest.json`)
      await fs.writeFile(path.join(targetDir, 'manifest.json'), JSON.stringify(manifest, null, 2))
      await fs.writeFile(path.join(targetDir, 'applet.json'), JSON.stringify(manifest, null, 2))

      writeStdout(`Synced official applet ${appletName} to ${targetDir}`)
    }

    writeStdout(`Built official applet ${appletName} successfully`)
    return true
  } catch (error) {
    writeStderr(`Failed to build official applet ${appletName}: ${error.message}`)
    throw error
  }
}

/**
 * 初始化输出目录
 */
async function initOutputDirs() {
  for (const outputDir of config.outputDirs) {
    await fs.mkdir(outputDir, { recursive: true })
    const entries = await fs.readdir(outputDir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name === '.build.lock') continue
      await fs.rm(path.join(outputDir, entry.name), { recursive: true, force: true })
    }
    // 创建.gitkeep文件
    await fs.writeFile(path.join(outputDir, '.gitkeep'), '')
  }
}

async function writeIndexFiles() {
  for (const outputDir of config.outputDirs) {
    const entries = await fs.readdir(outputDir, { withFileTypes: true })
    const applets = []
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const manifestPath = path.join(outputDir, entry.name, 'manifest.json')
      try {
        const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf-8'))
        assertCanonicalManifest(manifest, `${entry.name}/manifest.json`)
        applets.push(manifest)
      } catch (error) {
        writeStderr(`Skip invalid applet in ${entry.name}: ${error.message}`)
      }
    }
    const index = { version: 1, generatedAt: new Date().toISOString(), applets }
    await fs.writeFile(path.join(outputDir, 'index.json'), JSON.stringify(index, null, 2))
    writeStdout(`Generated index.json in ${outputDir}`)
  }
}

/**
 * 主函数
 */
async function main() {
  const releaseLock = await acquireBuildLock()
  let exitCode = 0
  try {
    writeStdout('Starting Applet build process...')

    run('pnpm', ['--filter', '@peers-touch/applet-contract', 'run', 'build'], {
      cwd: rootDir,
      stdio: 'inherit',
    })
    ;({ validateManifest: validateCanonicalManifest } = await import('../applet-contract/dist/index.js'))
    run('pnpm', ['--filter', '@peers-touch/applet-sdk', 'run', 'build'], {
      cwd: rootDir,
      stdio: 'inherit',
    })
    
    // 初始化输出目录
    await initOutputDirs()
    
    // 获取所有Applet
    const appletDirs = await getAppletDirs()
    writeStdout(`Found ${appletDirs.length} applets: ${appletDirs.map(d => path.basename(d)).join(', ')}`)
    const officialAppletDirs = await getOfficialAppletDirs()
    if (officialAppletDirs.length > 0) {
      writeStdout(`Found ${officialAppletDirs.length} official applets: ${officialAppletDirs.map(d => path.basename(d)).join(', ')}`)
    }
    const externalLynxAppletDirs = await getExternalLynxAppletDirs()
    if (externalLynxAppletDirs.length > 0) {
      writeStdout(`Found ${externalLynxAppletDirs.length} external Lynx applets: ${externalLynxAppletDirs.map(d => path.basename(path.dirname(d))).join(', ')}`)
    }

    // 顺序构建，避免并发构建时对 workspace 依赖链接造成竞争
    for (const dir of appletDirs) {
      await buildApplet(dir)
    }
    for (const dir of officialAppletDirs) {
      await buildOfficialApplet(dir)
    }
    for (const dir of config.canonicalLynxAppletDirs) {
      await buildCanonicalLynxApplet(dir)
    }
    for (const dir of externalLynxAppletDirs) {
      await buildCanonicalLynxApplet(dir)
    }
    await writeIndexFiles()

    writeStdout()
    writeStdout('Applet build process completed')
  } catch (error) {
    writeStderr(`Build process failed: ${error.message}`)
    exitCode = 1
  } finally {
    await releaseLock()
  }
  if (exitCode !== 0) {
    process.exit(exitCode)
  }
}

main()
