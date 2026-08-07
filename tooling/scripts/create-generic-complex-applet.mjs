#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

function parseArgs(argv) {
  const options = {};
  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      throw new Error(`Missing value for ${arg}`);
    }
    options[arg.slice(2)] = next;
    index += 1;
  }
  return { options, positional };
}

function requireNonEmptyOption(value, fallback, label) {
  const resolved = value ?? fallback;
  if (!resolved || !resolved.trim()) {
    throw new Error(`${label} must be non-empty`);
  }
  return resolved.trim();
}

const { options, positional } = parseArgs(process.argv.slice(2));
const appletId = requireNonEmptyOption(options.id, 'generic-complex-applet', 'Applet id');
if (!/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(appletId)) {
  throw new Error(`Applet id must be DNS-like lowercase text: ${appletId}`);
}

const appletName = requireNonEmptyOption(options.name, 'Generic Complex Applet', 'Applet name');
const packageName = requireNonEmptyOption(
  options['package-name'],
  '@peers-touch/generic-complex-applet',
  'Package name',
);
const appletDescription = requireNonEmptyOption(
  options.description,
  'Producer-independent complex applet fixture for Desktop runtime readiness evidence.',
  'Applet description',
);
const appletAuthor = requireNonEmptyOption(options.author, 'Peers Touch', 'Applet author');
const appletTargets = (options.targets ?? 'desktop')
  .split(',')
  .map((target) => target.trim())
  .filter(Boolean);
const supportedTargets = new Set(['desktop', 'android', 'ios', 'harmony', 'web']);
const loadTypeByTarget = {
  desktop: 'lynx-web',
  android: 'lynx-native',
  ios: 'lynx-native',
  harmony: 'lynx-native',
  web: 'lynx-web',
};
for (const target of appletTargets) {
  if (!supportedTargets.has(target)) {
    throw new Error(`Unsupported generated fixture target: ${target}`);
  }
}
const outputDir = path.resolve(positional[0] ?? `.artifacts/applet-readiness/packages/${appletId}`);
const lynxToolchainDir = path.resolve('apps/desktop/applets-dev/hello-lynx/node_modules');
mkdirSync(path.join(outputDir, 'schemas'), { recursive: true });
mkdirSync(path.join(outputDir, 'src'), { recursive: true });

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', stdio: 'pipe' });
  if (result.status !== 0) {
    throw new Error([
      `Command failed: ${command} ${args.join(' ')}`,
      result.stdout,
      result.stderr,
    ].join('\n'));
  }
}

const developerSource = `import { sdk } from '@peers-touch/applet-sdk';

const appletDisplayName = ${JSON.stringify(appletName)};

export async function runAppletReadinessFlow() {
  const context = await sdk.app.getContext();
  const launchOptions = await sdk.app.getLaunchOptions();
  let observedShow = false;
  const unsubscribeShow = sdk.lifecycle.onShow(() => {
    observedShow = true;
  });
  const unsubscribeHide = sdk.lifecycle.onHide(() => undefined);
  let observedCompletedTaskEvent = false;
  let expectedCompletedTaskId = '';
  const unsubscribeTaskEvent = sdk.events.on('task.event', (event: unknown) => {
    if (
      event &&
      typeof event === 'object' &&
      'state' in event &&
      event.state === 'completed' &&
      'taskId' in event &&
      event.taskId === expectedCompletedTaskId
    ) {
      observedCompletedTaskEvent = true;
    }
  });
  await sdk.events.subscribe('task.event');
  sdk.lifecycle.onPause(() => undefined);
  sdk.lifecycle.onResume(() => undefined);
  await sdk.lifecycle.reportReady();
  await sdk.ui.setNavigationBar({ title: appletDisplayName });
  await sdk.ui.showToast({ message: \`\${appletDisplayName} ready\`, type: 'success' });
  const safeArea = await sdk.device.getSafeArea();
  const windowInfo = await sdk.device.getWindowInfo();
  await sdk.device.vibrate({ durationMs: 10 });
  await sdk.clipboard.setText({ text: 'readiness', userActivated: true });
  const clipboardText = await sdk.clipboard.getText();
  await sdk.file.write({ path: 'readiness/state.json', content: JSON.stringify({ safeArea, windowInfo }) });
  const fileState = await sdk.file.read({ path: 'readiness/state.json' });
  const fileEntries = await sdk.file.list({ path: 'readiness' });
  const fileInfo = await sdk.file.getInfo();
  await sdk.storage.set('lastContext', context);
  const storageKeys = await sdk.storage.keys('last');
  const storageInfo = await sdk.storage.getInfo();

  const station = await sdk.network.request({
    service: 'primary-api',
    path: '/api/v1/e2e',
    method: 'GET',
  });
  const upload = await sdk.network.upload({
    service: 'primary-api',
    path: '/api/v1/e2e/echo',
    body: { fileState },
  });
  const download = await sdk.network.download({
    service: 'primary-api',
    path: '/api/v1/e2e',
    filePath: 'downloads/e2e.json',
  });

  await sdk.skills.register({
    id: 'runtime-summary',
    inputSchema: { type: 'object', properties: { input: { type: 'string' } } },
    streaming: true,
    executor: {
      type: 'network',
      request: {
        service: 'primary-api',
        path: '/api/v1/e2e/echo',
        method: 'POST',
      },
    },
  });
  const skills = await sdk.skills.list();
  const skillResult = await sdk.skills.invoke(
    'runtime-summary',
    { message: 'skill-network', storageInfo },
    { stream: true },
  );
  await sdk.skills.register({
    id: 'agent-summary',
    inputSchema: { type: 'object', properties: { message: { type: 'string' } } },
    streaming: true,
    executor: { type: 'agent' },
  });
  const agentSkillResult = await sdk.skills.invoke(
    'agent-summary',
    { message: 'skill-agent', metadata: { storageKeys } },
    { stream: true },
  );
  const task = await sdk.tasks.start({
    taskType: 'network',
    input: {
      request: {
        service: 'primary-api',
        path: '/api/v1/e2e/echo',
        method: 'POST',
        body: { message: 'task-network', storageInfo },
      },
    },
  });
  const agentTask = await sdk.tasks.start({
    taskType: 'agent',
    input: {
      message: 'task-agent',
      metadata: { storageKeys },
    },
  });
  const backgroundTask = await sdk.tasks.start({
    taskType: 'readiness',
    input: { storageInfo, networkTaskId: task.taskId, agentTaskId: agentTask.taskId },
    completeAfterMs: 100,
  });
  expectedCompletedTaskId = backgroundTask.taskId;
  const taskEventDeadline = Date.now() + 2500;
  while (!observedCompletedTaskEvent && Date.now() < taskEventDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  await sdk.events.unsubscribe('task.event');
  unsubscribeShow();
  unsubscribeHide();
  unsubscribeTaskEvent();
  if (!observedShow) {
    throw new Error('lifecycle.show was not delivered through the Host event bridge');
  }
  if (!observedCompletedTaskEvent) {
    throw new Error('completed task.event was not delivered through the Host event bridge');
  }
  const agent = await sdk.agent.stream({ message: 'Summarize readiness evidence.' }, () => undefined);
  const ai = await sdk.ai.chat({ messages: [{ role: 'user', content: 'Summarize readiness evidence.' }] });
  await sdk.telemetry.track({ name: 'applet.readiness.flow.completed', properties: { taskId: task.taskId, agentTaskId: agentTask.taskId } });

  return { context, launchOptions, safeArea, windowInfo, clipboardText, fileEntries, fileInfo, storageKeys, station, upload, download, skills, skillResult, agentSkillResult, task, backgroundTask, agent, ai };
}

`;

writeFileSync(path.join(outputDir, 'src/main.ts'), developerSource);
writeFileSync(path.join(outputDir, 'src/index.tsx'), `import { root } from '@lynx-js/react';
import { App } from './App';

root.render(<App />);

if (import.meta.webpackHot) {
  import.meta.webpackHot.accept();
}
`);
writeFileSync(path.join(outputDir, 'src/App.tsx'), `import { useEffect, useState } from '@lynx-js/react';
import { runAppletReadinessFlow } from './main';

type ReadinessState = 'pending' | 'pass' | 'fail';

export function App() {
  const [state, setState] = useState<ReadinessState>('pending');
  const [error, setError] = useState<string>('');

  useEffect(() => {
    let mounted = true;
    void runAppletReadinessFlow()
      .then(() => {
        if (mounted) setState('pass');
      })
      .catch((err: unknown) => {
        if (!mounted) return;
        setError(err instanceof Error ? err.message : String(err));
        setState('fail');
      });
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <view style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 16 }}>
      <text style={{ fontSize: 16, color: state === 'fail' ? '#cf1322' : '#262626' }}>
        {state}
      </text>
      {error ? (
        <text style={{ fontSize: 11, color: '#cf1322', marginTop: 8 }}>
          {error}
        </text>
      ) : null}
    </view>
  );
}
`);
writeFileSync(path.join(outputDir, 'lynx.config.ts'), `import path from 'node:path';
import { defineConfig } from '@lynx-js/rspeedy';
import { pluginReactLynx } from '@lynx-js/react-rsbuild-plugin';

const repoRoot = process.env.PT_REPO_ROOT;
if (!repoRoot) throw new Error('PT_REPO_ROOT is required for Applet fixture builds');

export default defineConfig({
  resolve: { alias: { '@peers-touch/applet-sdk': path.join(repoRoot, 'packages/applet-sdk/dist/index.js') } },
  plugins: [pluginReactLynx()],
  environments: {
    web: {},
  },
  source: {
    entry: './src/index.tsx',
  },
  output: {
    distPath: {
      root: './dist',
    },
    filename: 'main.lynx.bundle',
    filenameHash: false,
  },
});
`);
writeFileSync(path.join(outputDir, 'schemas/skill.input.json'), JSON.stringify({ type: 'object', properties: { input: { type: 'string' } }, required: ['input'] }, null, 2));
writeFileSync(path.join(outputDir, 'build.mjs'), `import { copyFileSync, existsSync, rmSync, symlinkSync } from 'node:fs';
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
  throw new Error(['rspeedy build failed', result.stdout, result.stderr].join('\\n'));
}
copyFileSync(path.join(packageDir, 'dist/main.lynx.bundle'), path.join(packageDir, 'main.lynx.bundle'));
`);
writeFileSync(path.join(outputDir, 'package.json'), JSON.stringify({
  name: packageName,
  version: '1.0.0',
  private: true,
  type: 'module',
  scripts: {
    build: 'node build.mjs'
  },
  dependencies: {
    '@lynx-js/react': '^0.121.0',
    '@peers-touch/applet-sdk': 'workspace:*'
  },
  devDependencies: {
    '@lynx-js/rspeedy': '^0.14.4',
    '@lynx-js/react-rsbuild-plugin': '^0.16.2'
  }
}, null, 2));

run('pnpm', ['--filter', '@peers-touch/applet-contract', 'run', 'build']);
run('pnpm', ['--filter', '@peers-touch/applet-sdk', 'run', 'build']);

const nodeModulesPath = path.join(outputDir, 'node_modules');
if (!existsSync(nodeModulesPath)) {
  symlinkSync(lynxToolchainDir, nodeModulesPath, 'dir');
}
rmSync(path.join(outputDir, 'dist'), { recursive: true, force: true });
const lynxBuild = spawnSync(path.join(nodeModulesPath, '.bin/rspeedy'), ['build'], {
  cwd: outputDir,
  encoding: 'utf8',
  stdio: 'pipe',
  env: { ...process.env, PT_REPO_ROOT: path.resolve('.') },
});
if (lynxBuild.status !== 0) {
  throw new Error([
    'rspeedy build failed',
    lynxBuild.stdout,
    lynxBuild.stderr,
  ].join('\n'));
}
copyFileSync(path.join(outputDir, 'dist/main.lynx.bundle'), path.join(outputDir, 'main.lynx.bundle'));

function digest(relativePath) {
  return `sha256:${createHash('sha256').update(readFileSync(path.join(outputDir, relativePath))).digest('hex')}`;
}

const manifest = {
  id: appletId,
  name: appletName,
  version: '1.0.0',
  description: appletDescription,
  author: appletAuthor,
  targets: appletTargets,
  entries: { lynx: 'main.lynx.bundle' },
  load: Object.fromEntries(appletTargets.map((target) => [target, { type: loadTypeByTarget[target], entry: 'main.lynx.bundle' }])),
  bridge: { protocol: 'peers-touch.applet.bridge', version: '1.0.0' },
  permissions: [
    'app.getContext',
    'app.getLaunchOptions',
    'lifecycle.onShow',
    'lifecycle.onHide',
    'lifecycle.onPause',
    'lifecycle.onResume',
    'lifecycle.reportReady',
    'lifecycle.destroy',
    'network.request',
    'network.upload',
    'network.download',
    'storage.get',
    'storage.set',
    'storage.remove',
    'storage.clear',
    'storage.keys',
    'storage.getInfo',
    'config.get',
    'system.getInfo',
    'device.getSafeArea',
    'device.getWindowInfo',
    'device.vibrate',
    'ui.showToast',
    'ui.setNavigationBar',
    'clipboard.getText',
    'clipboard.setText',
    'file.read',
    'file.write',
    'file.delete',
    'file.list',
    'file.getInfo',
    'events.subscribe',
    'events.unsubscribe',
    'events.poll',
    'skills.register',
    'skills.list',
    'skills.invoke',
    'tasks.start',
    'tasks.get',
    'tasks.cancel',
    'agent.startSession',
    'agent.send',
    'agent.stream',
    'ai.generate',
    'ai.chat',
    'telemetry.track',
    'telemetry.reportError'
  ],
  services: [{ id: 'primary-api', kind: 'http', binding: 'station-resolved', allowedMethods: ['GET', 'POST'], allowedPaths: ['/api/v1/*'], streaming: true }],
  skills: [{ id: 'generic-skill', inputSchema: 'schemas/skill.input.json', streaming: true }],
  integrity: { algorithm: 'sha256', files: { 'main.lynx.bundle': digest('main.lynx.bundle'), 'schemas/skill.input.json': digest('schemas/skill.input.json') } }
};

writeFileSync(path.join(outputDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
process.stdout.write(`${outputDir}\n`);
