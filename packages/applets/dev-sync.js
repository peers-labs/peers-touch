#!/usr/bin/env node
import chokidar from 'chokidar'
import path from 'path'
import { fileURLToPath } from 'url'
import { execa } from 'execa'
import fs from 'fs/promises'
import { createIndexV2, formatDiagnostics, validateIndexV2, validateManifestV2 } from './schema.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// 配置
const config = {
  appletsDir: __dirname,
  outputDirs: [
    path.join(__dirname, '../../apps/desktop/applets-dist'),
  ],
  ignore: ['node_modules', 'dist', '.git'],
}

async function writeIndexFiles() {
  for (const outputDir of config.outputDirs) {
    const entries = await fs.readdir(outputDir, { withFileTypes: true })
    const applets = []
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const appletJsonPath = path.join(outputDir, entry.name, 'applet.json')
      try {
        const appletJson = JSON.parse(await fs.readFile(appletJsonPath, 'utf-8'))
        const manifestCheck = validateManifestV2(appletJson, {
          source: `${entry.name}/applet.json`,
        })
        if (!manifestCheck.valid) {
          throw new Error(`Invalid manifest schema:\n${formatDiagnostics(manifestCheck.diagnostics)}`)
        }
        applets.push(appletJson)
      } catch (error) {
        console.error(`❌ Skip invalid applet in ${entry.name}:`, error.message)
      }
    }
    const indexV2 = createIndexV2(applets)
    const indexCheck = validateIndexV2(indexV2, { source: path.join(outputDir, 'index.json') })
    if (!indexCheck.valid) {
      throw new Error(`Invalid index schema:\n${formatDiagnostics(indexCheck.diagnostics)}`)
    }
    await fs.writeFile(path.join(outputDir, 'index.json'), JSON.stringify(indexV2, null, 2))
    console.log(`🧾 Generated index.json in ${outputDir}`)
  }
}

/**
 * 同步单个Applet到输出目录
 */
async function syncApplet(appletId) {
  try {
    const appletDir = path.join(config.appletsDir, appletId)
    const appletJsonPath = path.join(appletDir, 'applet.json')
    
    // 读取并校验 applet.json（manifest v2）
    const appletJson = JSON.parse(await fs.readFile(appletJsonPath, 'utf-8'))
    const manifestCheck = validateManifestV2(appletJson, {
      source: `${appletId}/applet.json`,
    })
    if (!manifestCheck.valid) {
      throw new Error(`Invalid manifest schema:\n${formatDiagnostics(manifestCheck.diagnostics)}`)
    }
    const id = appletJson.id

    console.log(`\n🔄 Syncing applet: ${id}`)

    // 构建Applet
    await execa('pnpm', ['run', 'build'], { cwd: appletDir, stdio: 'inherit' })

    // 复制到各个输出目录
    const distDir = path.join(appletDir, 'dist')
    
    for (const outputDir of config.outputDirs) {
      const targetDir = path.join(outputDir, id)
      await fs.rm(targetDir, { recursive: true, force: true })
      await fs.cp(distDir, targetDir, { recursive: true })
      await fs.writeFile(path.join(targetDir, 'applet.json'), JSON.stringify(appletJson, null, 2))
      console.log(`✅ Synced to ${targetDir}`)
    }
    await writeIndexFiles()
  } catch (error) {
    console.error(`❌ Failed to sync ${appletId}:`, error.message)
  }
}

/**
 * 初始化监听器
 */
async function initWatcher() {
  console.log('🚀 Starting Applet development sync mode...')
  console.log('Watching for changes in Applet directories...\n')

  // 获取所有Applet目录
  const entries = await fs.readdir(config.appletsDir, { withFileTypes: true })
  const appletDirs = entries
    .filter(entry => entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'shared' && entry.name !== 'node_modules')
    .map(entry => path.join(config.appletsDir, entry.name, 'src/**/*'))

  // 监听文件变化
  const watcher = chokidar.watch(appletDirs, {
    ignored: config.ignore,
    ignoreInitial: true,
  })

  watcher.on('all', (event, filePath) => {
    const relativePath = path.relative(config.appletsDir, filePath)
    const appletId = relativePath.split(path.sep)[0]
    
    console.log(`\n📝 File changed: ${relativePath}`)
    syncApplet(appletId)
  })

  console.log('Watching for changes... Press Ctrl+C to exit.')
}

initWatcher().catch(console.error)
