import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { verifySurfaceAdapters } from './ui-surface-adapters.mjs';
import { containedFile, filesUnder, reject } from './ui-surface-source.mjs';

export const SURFACE_LEDGER = 'docs/architecture/engineering/prototypes/README.md';
export const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const marker = /```json ui-surface-authority\n([\s\S]*?)\n```/g;
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function exactKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !keys.includes(key))
    || keys.some(key => !Object.hasOwn(value, key))) {
    reject('UI_SURFACE_LEDGER_INVALID', label);
  }
}

export function readSurfaceLedger(root = sourceRoot, { optional = false } = {}) {
  const full = path.join(root, SURFACE_LEDGER);
  if (!fs.existsSync(full) && optional) return [];
  const blocks = [...fs.readFileSync(full, 'utf8').matchAll(marker)];
  if (blocks.length !== 1) reject('UI_SURFACE_LEDGER_INVALID', 'expected one authority block');
  let ledger;
  try { ledger = JSON.parse(blocks[0][1]); }
  catch { reject('UI_SURFACE_LEDGER_INVALID', 'invalid authority JSON'); }
  exactKeys(ledger, ['schemaVersion', 'surfaces'], 'ledger keys');
  if (ledger.schemaVersion !== 1 || !Array.isArray(ledger.surfaces)) {
    reject('UI_SURFACE_LEDGER_INVALID', 'schemaVersion / surfaces');
  }
  const ids = new Set();
  for (const surface of ledger.surfaces) {
    exactKeys(surface, [
      'id', 'prototypeId', 'contract', 'component', 'package', 'exportFile',
      'presentationRoots', 'prototype', 'production', 'status', 'confirmation',
      'protectedClasses',
    ], 'surface keys');
    if (!/^[a-z][a-z0-9-]+$/.test(surface.id) || ids.has(surface.id)) {
      reject('UI_SURFACE_LEDGER_INVALID', 'duplicate / invalid surface id');
    }
    ids.add(surface.id);
    if (!['drafting', 'pending-review', 'confirmed', 'landed', 'superseded'].includes(surface.status)
      || !Array.isArray(surface.presentationRoots) || surface.presentationRoots.length === 0
      || !Array.isArray(surface.protectedClasses) || surface.protectedClasses.length === 0) {
      reject('UI_SURFACE_LEDGER_INVALID', surface.id);
    }
    containedFile(root, surface.contract);
    containedFile(root, surface.exportFile);
    for (const relative of surface.presentationRoots) {
      if (!relative.startsWith('packages/ui/')) reject('UI_SURFACE_OWNER_INVALID', relative);
      containedFile(root, relative);
    }
    for (const [role, host] of Object.entries({ prototype: surface.prototype, production: surface.production })) {
      exactKeys(host, ['adapter', 'symbol', 'entryChain', 'allowedSlotTags'], `${role} host`);
      if (!Array.isArray(host.entryChain) || host.entryChain.length < 2
        || host.entryChain.at(-1) !== host.adapter || !Array.isArray(host.allowedSlotTags)) {
        reject('UI_SURFACE_LEDGER_INVALID', `${surface.id} ${role} chain`);
      }
      for (const relative of host.entryChain) containedFile(root, relative);
    }
    if (!surface.prototype.adapter.startsWith('packages/prototypes/')
      || !surface.production.adapter.startsWith('apps/')) {
      reject('UI_SURFACE_OWNER_INVALID', surface.id);
    }
    if (surface.confirmation !== null) {
      exactKeys(surface.confirmation, ['by', 'request', 'sourceDigest', 'evidence'], 'confirmation');
      if (!/^user:[a-zA-Z0-9_-]+$/.test(surface.confirmation.by)
        || !surface.confirmation.request?.trim()
        || !/^[a-f0-9]{64}$/.test(surface.confirmation.sourceDigest)
        || !surface.confirmation.evidence?.trim()) {
        reject('UI_SURFACE_CONFIRMATION_INVALID', surface.id);
      }
    }
  }
  return ledger.surfaces;
}

export function surfaceSourceDigest(root, surface) {
  const files = [...new Set(surface.presentationRoots.flatMap(relative => filesUnder(root, relative))
    .filter(relative => !/\.(test|spec)\.[^.]+$/.test(relative))
    .concat(surface.prototype.adapter, surface.exportFile, surface.contract))].sort();
  const { status, confirmation, ...contract } = surface;
  return digest({
    contract,
    sources: files.map(relative => [relative, createHash('sha256')
      .update(fs.readFileSync(containedFile(root, relative))).digest('hex')]),
  });
}

export function surfaceContext(root, targets, { optional = false } = {}) {
  return readSurfaceLedger(root, { optional }).flatMap(surface => {
    const roles = [
      ['shared-presentation', surface.presentationRoots],
      ['prototype-adapter', [surface.prototype.adapter]],
      ['production-adapter', [surface.production.adapter]],
      ['prototype-entry', surface.prototype.entryChain.slice(0, -1)],
      ['production-entry', surface.production.entryChain.slice(0, -1)],
    ].filter(([, paths]) => paths.some(relative => targets.some(target =>
      target === relative || target.startsWith(relative.endsWith('/') ? relative : `${relative}/`)
      || relative.startsWith(target.endsWith('/') ? target : `${target}/`))));
    if (roles.length === 0) return [];
    const currentDigest = surfaceSourceDigest(root, surface);
    return [{
      id: surface.id, ledger: SURFACE_LEDGER, prototypeId: surface.prototypeId,
      contract: surface.contract, roles: roles.map(([role]) => role),
      prototypeAdapter: surface.prototype.adapter, productionAdapter: surface.production.adapter,
      presentationRoots: surface.presentationRoots, status: surface.status, currentDigest,
      confirmedDigest: surface.confirmation?.sourceDigest ?? null,
      productionAdmitted: ['confirmed', 'landed'].includes(surface.status)
        && surface.confirmation?.sourceDigest === currentDigest,
      nextAction: 'UI feedback or visible adjustment: review/show the prototype, adjust shared presentation if needed, obtain user confirmation of this repair target, then edit production and run the original Journey. Implementation defects and small fixes cannot bypass confirmation; a correct prototype may remain unchanged.',
    }];
  });
}

function verifyOverrides(root, surfaces) {
  const prefixes = [...new Set(surfaces.flatMap(surface => surface.protectedClasses))];
  const roots = ['apps/desktop/src', 'apps/mobile/src', 'packages/prototypes'];
  for (const scanRoot of roots) {
    if (!fs.existsSync(path.join(root, scanRoot))) continue;
    for (const relative of filesUnder(root, scanRoot).filter(file => file.endsWith('.css'))) {
      const css = fs.readFileSync(containedFile(root, relative), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      for (const rule of css.split('{').slice(0, -1)) {
        const selector = rule.slice(rule.lastIndexOf('}') + 1);
        if (prefixes.some(prefix => selector.includes(`.${prefix}`))
          || /\[[^\]]*class[^\]]*ptc-/.test(selector)) {
          reject('UI_SURFACE_LOCAL_STYLE', `${relative}: ${selector.trim()}`);
        }
      }
    }
  }
}

export function verifySurfaceAuthority(root = sourceRoot) {
  const surfaces = readSurfaceLedger(root);
  verifySurfaceAdapters(root, surfaces);
  verifyOverrides(root, surfaces);
  const results = surfaces.map(surface => {
    const currentDigest = surfaceSourceDigest(root, surface);
    if (!['confirmed', 'landed'].includes(surface.status) || !surface.confirmation) {
      reject('UI_SURFACE_CONFIRMATION_REQUIRED', `${surface.id}: adjust and confirm the prototype first`);
    }
    if (surface.confirmation.sourceDigest !== currentDigest) {
      reject('UI_SURFACE_CONFIRMATION_STALE', `${surface.id}: current ${currentDigest}; confirm this prototype revision`);
    }
    return { id: surface.id, sourceDigest: currentDigest };
  });
  return results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [command = 'verify', ...args] = process.argv.slice(2);
    if (!['verify', 'context', 'digest'].includes(command)) reject('UI_SURFACE_ARGUMENT_INVALID', command);
    const rootIndex = args.indexOf('--repo-root');
    const root = rootIndex >= 0 ? fs.realpathSync(args.splice(rootIndex, 2)[1]) : sourceRoot;
    const result = command === 'verify' ? verifySurfaceAuthority(root)
      : command === 'context' ? surfaceContext(root, args)
        : readSurfaceLedger(root).map(surface => ({ id: surface.id, sourceDigest: surfaceSourceDigest(root, surface) }));
    console.log(JSON.stringify({ ok: true, result }));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, code: error.code, message: error.message }));
    process.exitCode = 1;
  }
}
