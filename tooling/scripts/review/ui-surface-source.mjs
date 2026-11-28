import fs from 'node:fs';
import path from 'node:path';

const ignored = new Set(['node_modules', 'dist', 'build', '.local', 'coverage']);

export function reject(code, message) {
  throw Object.assign(new Error(`${code}: ${message}`), { code });
}

export function containedFile(root, relative) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative)
    || relative.split('/').some(part => part === '..' || part === '.')) {
    reject('UI_SURFACE_PATH_INVALID', String(relative));
  }
  const full = path.resolve(root, relative);
  if (!full.startsWith(`${root}${path.sep}`)) reject('UI_SURFACE_PATH_INVALID', relative);
  if (!fs.existsSync(full)) reject('UI_SURFACE_SOURCE_MISSING', relative);
  if (!fs.realpathSync(full).startsWith(`${fs.realpathSync(root)}${path.sep}`)) {
    reject('UI_SURFACE_PATH_INVALID', relative);
  }
  return full;
}

export function filesUnder(root, relative) {
  const full = containedFile(root, relative);
  if (fs.statSync(full).isFile()) return [relative];
  return fs.readdirSync(full, { withFileTypes: true }).flatMap(entry => {
    if (ignored.has(entry.name)) return [];
    if (entry.isSymbolicLink()) reject('UI_SURFACE_PATH_INVALID', `${relative}/${entry.name}: source symlink`);
    return filesUnder(root, `${relative.replace(/\/$/, '')}/${entry.name}`);
  }).sort();
}
