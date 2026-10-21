import type { ConfigEnv, UserConfig } from 'vite'

const reactPluginPackage = '@vitejs/plugin-react'

export default async function config({ command }: ConfigEnv): Promise<UserConfig> {
  const plugins =
    command === 'serve'
      ? [(await import(reactPluginPackage)).default()]
      : []

  return {
    plugins,
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      rollupOptions: {
        input: {
          main: './index.html',
        },
      },
    },
    server: {
      port: 3101,
    },
  }
}
