#!/usr/bin/env node
import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import { execa } from 'execa'
import { createIndexV2, formatDiagnostics, validateIndexV2, validateManifestV2 } from './schema.js'

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
    let buildSucceeded = true
    try {
      await execa('pnpm', ['run', 'build'], { cwd: appletDir, stdio: 'inherit' })
    } catch {
      buildSucceeded = false
      console.warn(`⚠️ Build failed for ${appletName}, manifest will still be synced`)
    }

    // 同步到各个输出目录
    for (const outputDir of config.outputDirs) {
      const targetDir = path.join(outputDir, appletId)
      await fs.rm(targetDir, { recursive: true, force: true })
      await fs.mkdir(targetDir, { recursive: true })
      if (buildSucceeded) {
        await fs.cp(distDir, targetDir, { recursive: true })
      }
      
      // 复制applet.json
      await fs.writeFile(path.join(targetDir, 'applet.json'), JSON.stringify(appletJson, null, 2))
      
      console.log(`Synced ${appletName} to ${targetDir}`)
    }

    console.log(buildSucceeded ? `✅ Built ${appletName} successfully` : `🟡 Synced manifest for ${appletName}`)
    return buildSucceeded
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
 * 主函数
 */
async function main() {
  try {
    console.log('🚀 Starting Applet build process...')

    // 先构建 SDK，确保 workspace 包具备可解析的 dist 产物
    await execa('pnpm', ['--filter', '@peers-touch/applet-sdk', 'run', 'build'], {
      cwd: path.join(__dirname, '../..'),
      stdio: 'inherit',
    })
    
    // 初始化输出目录
    await initOutputDirs()
    
    // 获取所有Applet
    const appletDirs = await getAppletDirs()
    console.log(`Found ${appletDirs.length} applets: ${appletDirs.map(d => path.basename(d)).join(', ')}`)

    // 顺序构建，避免并发构建时对 workspace 依赖链接造成竞争
    const failed = []
    for (const dir of appletDirs) {
      try {
        const ok = await buildApplet(dir)
        if (!ok) {
          failed.push({
            applet: path.basename(dir),
            reason: 'build failed, synced manifest only',
          })
        }
      } catch (error) {
        failed.push({
          applet: path.basename(dir),
          reason: error instanceof Error ? error.message : String(error),
        })
      }
    }
    await writeIndexFiles()

    if (failed.length > 0) {
      console.warn('\n⚠️ Some applets failed to build:')
      failed.forEach((item) => {
        console.warn(`- ${item.applet}: ${item.reason}`)
      })
    }

    console.log('\n✅ Applet build process completed')
  } catch (error) {
    console.error('💥 Build process failed:', error.message)
    process.exit(1)
  }
}

main()
