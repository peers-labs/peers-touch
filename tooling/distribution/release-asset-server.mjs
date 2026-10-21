import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const requireFact = (condition, code) => {
  if (!condition) throw new Error(code);
};

export function resolveAsset(versions, pathname) {
  const segments = pathname.split('/').filter(Boolean).map((value) => decodeURIComponent(value));
  requireFact(segments.length === 2, 'RD_ASSET_ROUTE_INVALID');
  const [tag, name] = segments;
  requireFact(/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/u.test(tag),
    'RD_ASSET_TAG_INVALID');
  requireFact(/^[A-Za-z0-9_.-]+$/u.test(name), 'RD_ASSET_NAME_INVALID');
  const root = versions[tag];
  requireFact(typeof root === 'string', 'RD_ASSET_VERSION_UNKNOWN');
  const file = path.resolve(root, name);
  requireFact(file.startsWith(`${path.resolve(root)}${path.sep}`), 'RD_ASSET_SCOPE_INVALID');
  requireFact(fs.statSync(file, { throwIfNoEntry: false })?.isFile(), 'RD_ASSET_NOT_FOUND');
  return file;
}

export function startAssetServer(config) {
  requireFact(config?.host === '127.0.0.1' && Number.isInteger(config.port), 'RD_ASSET_BIND_INVALID');
  requireFact(config.versions && Object.keys(config.versions).length > 0, 'RD_ASSET_VERSIONS_REQUIRED');
  const server = https.createServer({
    cert: fs.readFileSync(config.certificate),
    key: fs.readFileSync(config.privateKey),
    minVersion: 'TLSv1.2',
  }, (request, response) => {
    try {
      requireFact(['GET', 'HEAD'].includes(request.method), 'RD_ASSET_METHOD_INVALID');
      const file = resolveAsset(config.versions, new URL(request.url, 'https://127.0.0.1').pathname);
      const stat = fs.statSync(file);
      response.writeHead(200, {
        'Cache-Control': 'no-store',
        'Content-Length': stat.size,
        'Content-Type': 'application/octet-stream',
      });
      if (request.method === 'HEAD') response.end();
      else fs.createReadStream(file).pipe(response);
    } catch (error) {
      response.writeHead(404, { 'Content-Type': 'text/plain' });
      response.end(`${error.message}\n`);
    }
  });
  server.on('clientError', (error, socket) => {
    socket.end(`HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n${error.message}\n`);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.host, () => {
      server.removeListener('error', reject);
      resolve(server);
    });
  });
}

async function main() {
  const config = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const server = await startAssetServer(config);
  const address = server.address();
  process.stdout.write(`${JSON.stringify({ ready: true, origin: `https://${config.host}:${address.port}` })}\n`);
  const stop = () => server.close(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
