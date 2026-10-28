import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function parseVersion(tag) {
  const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/u.exec(tag);
  if (!match || match[4]?.split('.').some((part) => /^\d+$/u.test(part) && part.length > 1 && part[0] === '0')) {
    throw new Error('RD_VERSION_INVALID');
  }
  return { version: tag.replace(/^v/u, ''), core: match.slice(1, 4).map(BigInt), pre: match[4]?.split('.') ?? [] };
}

export function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  for (let i = 0; i < 3; i += 1) {
    if (a.core[i] !== b.core[i]) return a.core[i] > b.core[i] ? 1 : -1;
  }
  if (!a.pre.length || !b.pre.length) return Number(!a.pre.length) - Number(!b.pre.length);
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i += 1) {
    if (a.pre[i] === undefined) return -1;
    if (b.pre[i] === undefined) return 1;
    if (a.pre[i] === b.pre[i]) continue;
    const numericA = /^\d+$/u.test(a.pre[i]);
    const numericB = /^\d+$/u.test(b.pre[i]);
    if (numericA !== numericB) return numericA ? -1 : 1;
    return numericA ? (BigInt(a.pre[i]) > BigInt(b.pre[i]) ? 1 : -1) : (a.pre[i] > b.pre[i] ? 1 : -1);
  }
  return 0;
}

export function checkVersion(root, tag, fromTag) {
  if (!tag.startsWith('v')) throw new Error('RD_TAG_REQUIRED');
  const { version } = parseVersion(tag);
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'apps/desktop/package.json'), 'utf8'));
  const config = JSON.parse(fs.readFileSync(path.join(root, 'apps/desktop/src-tauri/tauri.conf.json'), 'utf8'));
  const cargo = fs.readFileSync(path.join(root, 'apps/desktop/src-tauri/Cargo.toml'), 'utf8');
  const rustVersion = /^\[package\]\s*\n(?:(?!\[)[\s\S])*?^version\s*=\s*"([^"]+)"/mu.exec(cargo)?.[1];
  if ([pkg.version, config.version, rustVersion].some((value) => value !== version)) throw new Error('RD_VERSION_MISMATCH');
  const lock = fs.readFileSync(path.join(root, 'apps/desktop/src-tauri/Cargo.lock'), 'utf8');
  const entry = lock.split('[[package]]').find((part) => /^name = "peers-touch-desktop"$/mu.test(part));
  if (!entry || !entry.includes(`version = "${version}"`)) throw new Error('RD_CARGO_LOCK_MISMATCH');
  const pnpmLock = fs.readFileSync(path.join(root, 'pnpm-lock.yaml'), 'utf8');
  const importer = pnpmLock.split('\n  apps/desktop:\n')[1]?.split(/\n  \S/u)[0];
  if (!importer) throw new Error('RD_PNPM_LOCK_MISSING');
  for (const name of ['@tauri-apps/plugin-updater', '@tauri-apps/api']) {
    const spec = pkg.dependencies[name];
    if (!spec || !importer.includes(`'${name}':\n        specifier: ${spec}\n`)) throw new Error('RD_PNPM_LOCK_MISMATCH');
  }
  if (fromTag && compareVersions(tag, fromTag) <= 0) throw new Error('RD_UPDATE_VERSION_NOT_INCREASING');
  return { tag, version, prerelease: parseVersion(tag).pre.length > 0 };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    const result = checkVersion(process.cwd(), process.argv[2] ?? '', process.env.PT_RD_FROM_TAG);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
