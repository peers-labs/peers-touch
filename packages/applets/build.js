#!/usr/bin/env node
import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import { execa } from 'execa'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// 配置
const config = {
  appletsDir: __dirname,
  outputDirs: [
    path.join(__dirname, '../../apps/desktop/applets-dist'),
    // 后续添加移动端目录
    // path.join(__dirname, '../../apps/mobile/android/app/src/main/assets/applets'),
    // path.join(__dirname, '../../apps/mobile/ios/App/Assets/applets'),
  ],
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
  console.log(`Building applet: ${appletName}`)

  try {
    // 安装依赖
    await execa('pnpm', ['install'], { cwd: appletDir, stdio: 'inherit' })
    
    // 构建
    await execa('pnpm', ['run', 'build'], { cwd: appletDir, stdio: 'inherit' })

    // 复制构建产物
    const distDir = path.join(appletDir, 'dist')
    const appletJsonPath = path.join(appletDir, 'applet.json')
    
    // 读取applet.json
    const appletJson = JSON.parse(await fs.readFile(appletJsonPath, 'utf-8'))
    const appletId = appletJson.id

    // 同步到各个输出目录
    for (const outputDir of config.outputDirs) {
      const targetDir = path.join(outputDir, appletId)
      await fs.rm(targetDir, { recursive: true, force: true })
      await fs.cp(distDir, targetDir, { recursive: true })
      
      // 复制applet.json
      await fs.copyFile(appletJsonPath, path.join(targetDir, 'applet.json'))
      
      console.log(`Synced ${appletName} to ${targetDir}`)
    }

    console.log(`✅ Built ${appletName} successfully`)
  } catch (error) {
    console.error(`❌ Failed to build ${appletName}:`, error.message)
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

/**
 * 主函数
 */
async function main() {
  try {
    console.log('🚀 Starting Applet build process...')
    
    // 初始化输出目录
    await initOutputDirs()
    
    // 获取所有Applet
    const appletDirs = await getAppletDirs()
    console.log(`Found ${appletDirs.length} applets: ${appletDirs.map(d => path.basename(d)).join(', ')}`)

    // 并行构建所有Applet
    await Promise.all(appletDirs.map(buildApplet))

    console.log('\n🎉 All Applets built and synced successfully!')
  } catch (error) {
    console.error('💥 Build process failed:', error.message)
    process.exit(1)
  }
}

main()
