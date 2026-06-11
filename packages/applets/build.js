#!/usr/bin/env node
import fs from 'fs/promises'
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
  outputDirs: [
    path.join(__dirname, '../../apps/desktop/applets-dist'),
    // 后续添加移动端目录
    // path.join(__dirname, '../../apps/mobile/android/app/src/main/assets/applets'),
    // path.join(__dirname, '../../apps/mobile/ios/App/Assets/applets'),
  ],
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

    run('pnpm', ['run', 'build'], { cwd: appletDir, stdio: 'inherit' })

    for (const outputDir of config.outputDirs) {
      const targetDir = path.join(outputDir, appletId)
      await fs.rm(targetDir, { recursive: true, force: true })
      await fs.mkdir(targetDir, { recursive: true })
      await fs.cp(distDir, targetDir, { recursive: true })

      const manifest = {
        id: appletJson.id,
        name: appletJson.name,
        version: appletJson.version,
        description: appletJson.description,
        author: appletJson.author,
        icon: appletJson.icon,
        minPlatformVersion: appletJson.minPlatformVersion,
        targets: ['desktop'],
        entries: { lynx: entry },
        load: { desktop: { type: 'lynx-web', entry } },
        bridge: { protocol: 'peers-touch.applet.bridge', version: '1.0.0' },
        permissions: appletJson.permissions ?? [],
        capabilities: appletJson.capabilities ?? [],
        services: appletJson.services ?? [],
        skills: appletJson.skills ?? [],
        integrity: { algorithm: 'sha256', files: await integrityForFiles(targetDir) },
      }
      assertCanonicalManifest(manifest, `${appletName}/applet.json`)
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

/**
 * 初始化输出目录
 */
async function initOutputDirs() {
  for (const outputDir of config.outputDirs) {
    await fs.mkdir(outputDir, { recursive: true })
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

    // 顺序构建，避免并发构建时对 workspace 依赖链接造成竞争
    for (const dir of appletDirs) {
      await buildApplet(dir)
    }
    for (const dir of config.canonicalLynxAppletDirs) {
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
