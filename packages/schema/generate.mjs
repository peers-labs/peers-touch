import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

// Generate the dependency closure from the canonical contracts. Never import
// another application's generated product into a shared package.
const here = dirname(fileURLToPath(import.meta.url));
const model = resolve(here, '../../model');
const seen = new Set();
function visit(path) {
  if (seen.has(path) || path.startsWith('google/protobuf/')) return;
  seen.add(path);
  const source = readFileSync(join(model, path), 'utf8');
  for (const match of source.matchAll(/^import\s+"([^"]+)";/gm)) visit(match[1]);
}
visit('domain/schema/schema.proto');
const stage = mkdtempSync(join(tmpdir(), 'peers-schema-proto-'));
try {
  execFileSync('protoc', [
    `--plugin=protoc-gen-es=${join(here, 'node_modules/.bin/protoc-gen-es')}`,
    `--es_out=${stage}`, '--es_opt=target=ts', `-I${model}`, ...[...seen].sort(),
  ], { stdio: 'inherit' });
  const destination = join(here, 'src/gen');
  function publish(path = '') {
    for (const entry of readdirSync(join(stage, path), { withFileTypes: true })) {
      const relative = join(path, entry.name);
      if (entry.isDirectory()) publish(relative);
      else {
        const target = join(destination, relative);
        mkdirSync(dirname(target), { recursive: true });
        const generated = readFileSync(join(stage, relative), 'utf8').replace(/\n+$/, '\n');
        writeFileSync(target, generated);
      }
    }
  }
  publish();
  function removeOrphans(path = '') {
    mkdirSync(join(destination, path), { recursive: true });
    for (const entry of readdirSync(join(destination, path), { withFileTypes: true })) {
      const relative = join(path, entry.name);
      if (entry.isDirectory()) removeOrphans(relative);
      else if (entry.name.endsWith('_pb.ts') && !seen.has(relative.replace(/_pb\.ts$/, '.proto'))) {
        rmSync(join(destination, relative));
      }
    }
  }
  removeOrphans();
} finally {
  rmSync(stage, { recursive: true, force: true });
}
