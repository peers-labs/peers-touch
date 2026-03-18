import { getVersion } from '@tauri-apps/api/app'
import './style.css'

const app = document.querySelector<HTMLDivElement>('#app')

if (app) {
  app.innerHTML = `
    <main class="container">
      <h1>Peers Touch Desktop</h1>
      <p id="runtime">正在读取 Tauri 运行时信息...</p>
    </main>
  `
}

const runtime = document.querySelector<HTMLParagraphElement>('#runtime')

async function bootstrap() {
  if (!runtime) {
    return
  }
  const version = await getVersion()
  runtime.textContent = `Tauri Runtime v${version}`
}

void bootstrap()
