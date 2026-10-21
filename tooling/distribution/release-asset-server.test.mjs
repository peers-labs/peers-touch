import assert from 'node:assert/strict';
import fs from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { resolveAsset, startAssetServer } from './release-asset-server.mjs';

test('asset routes are version-scoped and reject traversal', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rd-asset-server-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'install.sh'), 'immutable');
  const versions = { 'v1.2.3': root };
  assert.equal(resolveAsset(versions, '/v1.2.3/install.sh'), path.join(root, 'install.sh'));
  assert.throws(() => resolveAsset(versions, '/v1.2.4/install.sh'), /VERSION_UNKNOWN/u);
  assert.throws(() => resolveAsset(versions, '/v1.2.3/%2e%2e%2fsecret'), /NAME_INVALID/u);
  assert.throws(() => resolveAsset(versions, '/v1.2.3/missing'), /NOT_FOUND/u);
  assert.throws(() => resolveAsset(versions, '/v1.2.3/install.sh/extra'), /ROUTE_INVALID/u);
});

test('asset server requires its private CA and serves only exact release paths', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rd-asset-server-tls-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const certificate = path.join(root, 'server.crt');
  const privateKey = path.join(root, 'server.key');
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
    '-subj', '/CN=localhost', '-addext', 'subjectAltName=IP:127.0.0.1',
    '-keyout', privateKey, '-out', certificate,
  ], { stdio: 'ignore' });
  fs.writeFileSync(path.join(root, 'install.sh'), 'immutable');
  const server = await startAssetServer({
    host: '127.0.0.1',
    port: 0,
    versions: { 'v1.2.3': root },
    certificate,
    privateKey,
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const port = server.address().port;
  const request = (assetPath, ca) => new Promise((resolve, reject) => {
    https.get({
      hostname: '127.0.0.1', port, path: assetPath, ca,
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString() }));
    }).on('error', reject);
  });
  await assert.rejects(request('/v1.2.3/install.sh'));
  assert.deepEqual(await request('/v1.2.3/install.sh', fs.readFileSync(certificate)),
    { status: 200, body: 'immutable' });
  assert.equal((await request('/v1.2.3/%2e%2e%2fsecret', fs.readFileSync(certificate))).status, 404);
});
