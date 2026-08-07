import { copyFileSync, existsSync, rmSync, symlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = process.env.PT_REPO_ROOT ? path.resolve(process.env.PT_REPO_ROOT) : path.resolve(packageDir, '../../../..');
const lynxToolchainDir = path.join(workspaceRoot, 'apps/desktop/applets-dev/hello-lynx/node_modules');
const nodeModulesPath = path.join(packageDir, 'node_modules');

if (!existsSync(nodeModulesPath)) {
  symlinkSync(lynxToolchainDir, nodeModulesPath, 'dir');
}

rmSync(path.join(packageDir, 'dist'), { recursive: true, force: true });
const result = spawnSync(path.join(nodeModulesPath, '.bin/rspeedy'), ['build'], {
  cwd: packageDir,
  encoding: 'utf8',
  stdio: 'pipe',
  env: { ...process.env, PT_REPO_ROOT: workspaceRoot },
});
if (result.status !== 0) {
  throw new Error(['rspeedy build failed', result.stdout, result.stderr].join('\n'));
}
copyFileSync(path.join(packageDir, 'dist/main.lynx.bundle'), path.join(packageDir, 'main.lynx.bundle'));
