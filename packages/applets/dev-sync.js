#!/usr/bin/env node
import chokidar from 'chokidar'
import path from 'path'
import { fileURLToPath } from 'url'
import { execa } from 'execa'
import fs from 'fs/promises'

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

/**
 * 同步单个Applet到输出目录
 */
async function syncApplet(appletId) {
  try {
    const appletDir = path.join(config.appletsDir, appletId)
    const appletJsonPath = path.join(appletDir, 'applet.json')
    
    // 读取applet.json
    const appletJson = JSON.parse(await fs.readFile(appletJsonPath, 'utf-8'))
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
      await fs.copyFile(appletJsonPath, path.join(targetDir, 'applet.json'))
      console.log(`✅ Synced to ${targetDir}`)
    }
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
