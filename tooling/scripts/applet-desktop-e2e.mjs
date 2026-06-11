#!/usr/bin/env node
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';

const packageDir = process.argv[2];
if (!packageDir) {
  process.stderr.write('usage: pnpm applet:desktop-e2e <package-dir> [--service service-id=http://127.0.0.1:port]\n');
  process.exit(1);
}

const evidenceRoot = path.resolve('applet-readiness-evidence');
mkdirSync(path.join(evidenceRoot, 'desktop'), { recursive: true });

function write(relative, content) {
  writeFileSync(path.join(evidenceRoot, relative), `${content.trim()}\n`);
}

function parseServiceOverride() {
  const flag = process.argv.find((arg) => arg.startsWith('--service='));
  if (!flag) return undefined;
  const [serviceId, baseUrl] = flag.slice('--service='.length).split('=');
  if (!serviceId || !baseUrl) throw new Error('--service must use service-id=http://127.0.0.1:port');
  return { serviceId, baseUrl };
}

function envNameForService(serviceId) {
  return `PEERS_APPLET_SERVICE_${serviceId.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase()}`;
}

function readJson(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        resolve({});
      }
    });
  });
}

function startControlledUpstream() {
  const requests = [];
  const server = createServer(async (req, res) => {
    const requestRecord = { method: req.method, url: req.url };
    requests.push(requestRecord);
    if (req.url === '/api/v1/e2e') {
      res.writeHead(200, { 'content-type': 'application/json', 'x-applet-e2e': 'network' });
      res.end(JSON.stringify({ message: 'e2e-network-ok' }));
      return;
    }

    if (req.url === '/api/v1/e2e/echo') {
      const body = await readJson(req);
      requestRecord.body = body;
      res.writeHead(201, { 'content-type': 'application/json', 'x-applet-e2e': 'network-post' });
      res.end(JSON.stringify({ message: 'e2e-network-post-ok', echo: body }));
      return;
    }

    if (req.url === '/agent/turn/execute') {
      const body = await readJson(req);
      requestRecord.body = body;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ messageId: 'agent-e2e-message', content: 'agent-e2e-ok' }));
      return;
    }

    if (req.url === '/chat/completions') {
      await readJson(req);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ model: 'e2e-model', choices: [{ message: { content: 'provider-e2e-ok' } }] }));
      return;
    }

    if (req.url === '/v1/messages') {
      await readJson(req);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ model: 'e2e-model-anthropic', content: [{ type: 'text', text: 'provider-anthropic-e2e-ok' }] }));
      return;
    }

    if (req.url?.startsWith('/models/e2e-model-gemini:generateContent')) {
      await readJson(req);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'provider-gemini-e2e-ok' }] } }] }));
      return;
    }

    if (req.url === '/api/chat') {
      await readJson(req);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ model: 'e2e-model-ollama', message: { content: 'provider-ollama-e2e-ok' } }));
      return;
    }

    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not_found', path: req.url }));
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('failed to allocate local upstream port'));
        return;
      }
      resolve({ server, baseUrl: `http://127.0.0.1:${address.port}`, requests });
    });
  });
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

const manifest = JSON.parse(readFileSync(path.join(packageDir, 'manifest.json'), 'utf8'));
const bundlePath = path.join(packageDir, manifest.entries?.lynx ?? '');
const bundleSource = manifest.entries?.lynx ? readFileSync(bundlePath, 'utf8') : '';
if (!manifest.entries?.lynx || !bundleSource) {
  process.stderr.write('FAIL fixture applet bundle is required for desktop e2e\n');
  process.exit(1);
}
if (/from ['"]@peers-touch\/applet-sdk['"]/.test(bundleSource) || /export\s+async\s+function\s+runAppletReadinessFlow/.test(bundleSource)) {
  process.stderr.write('FAIL desktop e2e requires a built Lynx JavaScript bundle, not raw applet SDK TypeScript source\n');
  process.exit(1);
}

const serviceOverride = parseServiceOverride();
const controlled = await startControlledUpstream();
const baseUrl = serviceOverride?.baseUrl ?? controlled.baseUrl;
const serviceId = serviceOverride?.serviceId ?? manifest.services?.[0]?.id ?? 'station-api';

try {
  const validation = spawnSync('pnpm', ['applet:validate', packageDir], { encoding: 'utf8' });
  const contract = spawnSync('pnpm', ['applet:contract-test'], { encoding: 'utf8' });
  const sdk = spawnSync('pnpm', ['--filter', '@peers-touch/applet-sdk', 'run', 'build'], { encoding: 'utf8' });
  const rust = await runCommand(
    'cargo',
    ['test', '--manifest-path', 'apps/desktop/src-tauri/Cargo.toml', 'application::applets::tests::live_', '--', '--nocapture'],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        PEERS_APPLET_E2E_BASE_URL: baseUrl,
        PEERS_STATION_URL: baseUrl,
        [envNameForService(serviceId)]: baseUrl,
        [envNameForService('station-api')]: baseUrl,
      },
    },
  );

  const output = [
    `Package: ${packageDir}`,
    `Bundle: ${manifest.entries.lynx}`,
    `Service override: ${serviceId} -> host-controlled local upstream`,
    `Fixture endpoints: station GET /api/v1/e2e, station POST /api/v1/e2e/echo, agent /agent/turn/execute, providers openai/anthropic/gemini/ollama`,
    `Validation: ${validation.status === 0 ? 'PASS' : 'FAIL'}`,
    validation.stdout,
    validation.stderr,
    `Contract: ${contract.status === 0 ? 'PASS' : 'FAIL'}`,
    contract.stdout,
    contract.stderr,
    `SDK build: ${sdk.status === 0 ? 'PASS' : 'FAIL'}`,
    sdk.stdout,
    sdk.stderr,
    `Gateway live chain: ${rust.status === 0 ? 'PASS' : 'FAIL'}`,
    rust.stdout,
    rust.stderr,
    `Controlled upstream requests: ${JSON.stringify(controlled.requests)}`,
  ].join('\n');
  write('desktop/live-e2e-output.txt', output);

  if (validation.status !== 0) process.exit(validation.status ?? 1);
  if (contract.status !== 0) process.exit(contract.status ?? 1);
  if (sdk.status !== 0) process.exit(sdk.status ?? 1);
  if (rust.status !== 0) process.exit(rust.status ?? 1);
  process.stdout.write(`PASS desktop live e2e evidence written to ${path.join(evidenceRoot, 'desktop/live-e2e-output.txt')}\n`);
} finally {
  await new Promise((resolve) => controlled.server.close(resolve));
}
