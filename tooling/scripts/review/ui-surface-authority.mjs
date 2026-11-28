import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { verifySurfaceAdapters } from './ui-surface-adapters.mjs';
import { containedFile, reject, surfaceSourceFiles } from './ui-surface-source.mjs';
import { verifySurfaceStyles } from './ui-surface-styles.mjs';

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

export function readSurfaceLedger(root = sourceRoot, { optional = false, text } = {}) {
  const full = path.join(root, SURFACE_LEDGER);
  if (!fs.existsSync(full) && optional) return [];
  const blocks = [...(text ?? fs.readFileSync(containedFile(root, SURFACE_LEDGER), 'utf8')).matchAll(marker)];
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
      'feedback',
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
      exactKeys(surface.confirmation, ['by', 'request', 'sourceDigest', 'evidence', 'feedbackId', 'prototypeId'], 'confirmation');
      if (!/^user:[a-zA-Z0-9_-]+$/.test(surface.confirmation.by)
        || !surface.confirmation.request?.trim()
        || !/^[a-f0-9]{64}$/.test(surface.confirmation.sourceDigest)
        || !surface.confirmation.evidence?.trim()) {
        reject('UI_SURFACE_CONFIRMATION_INVALID', surface.id);
      }
    }
    if (surface.feedback !== null) {
      const feedback = surface.feedback;
      exactKeys(feedback, ['id', 'revision', 'request', 'requestRef', 'review'], 'feedback');
      if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(feedback.id)
        || !Number.isSafeInteger(feedback.revision) || feedback.revision < 1
        || typeof feedback.request !== 'string' || !feedback.request.trim()
        || typeof feedback.requestRef !== 'string' || !feedback.requestRef.trim()) {
        reject('UI_SURFACE_FEEDBACK_INVALID', surface.id);
      }
      if (feedback.review !== null) {
        exactKeys(feedback.review, ['sourceDigest', 'evidence', 'target'], 'review');
        if (!/^[a-f0-9]{64}$/.test(feedback.review.sourceDigest)
          || typeof feedback.review.evidence !== 'string' || !feedback.review.evidence.trim()
          || typeof feedback.review.target !== 'string' || !feedback.review.target.trim()) {
          reject('UI_SURFACE_REVIEW_INVALID', surface.id);
        }
      }
    }
    if (surface.confirmation && (surface.confirmation.feedbackId !== surface.feedback?.id
      || surface.confirmation.prototypeId !== surface.prototypeId
      || surface.confirmation.sourceDigest !== surface.feedback?.review?.sourceDigest)) {
      reject('UI_SURFACE_CONFIRMATION_INVALID', `${surface.id}: confirmation is not bound to the reviewed feedback`);
    }
  }
  return ledger.surfaces;
}

export function surfaceSourceDigest(root, surface) {
  const files = surfaceSourceFiles(root, surface);
  const { status, confirmation, feedback, ...contract } = surface;
  return digest({
    contract,
    sources: files.map(relative => [relative, createHash('sha256')
      .update(fs.readFileSync(containedFile(root, relative))).digest('hex')]),
  });
}

export function surfaceContext(root, targets, { optional = false } = {}) {
  return readSurfaceLedger(root, { optional }).flatMap(surface => {
    const roles = [
      ['shared-presentation', surfaceSourceFiles(root, surface)],
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
      feedback: surface.feedback,
      confirmedDigest: surface.confirmation?.sourceDigest ?? null,
      productionAdmitted: ['confirmed', 'landed'].includes(surface.status)
        && surface.confirmation?.sourceDigest === currentDigest,
      nextAction: 'UI feedback or visible adjustment: review/show the prototype, adjust shared presentation if needed, obtain user confirmation of this repair target, then edit production and run the original Journey. Implementation defects and small fixes cannot bypass confirmation; a correct prototype may remain unchanged.',
    }];
  });
}

export function verifySurfaceAuthority(root = sourceRoot, { surfaceIds } = {}) {
  const surfaces = readSurfaceLedger(root).filter(surface => !surfaceIds || surfaceIds.includes(surface.id));
  if (surfaceIds && surfaces.length !== new Set(surfaceIds).size) reject('UI_SURFACE_UNKNOWN', surfaceIds.join(','));
  verifySurfaceAdapters(root, surfaces);
  verifySurfaceStyles(root, surfaces);
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

/**
 * Dev's UI subflow mutates only the prototype owner's existing Markdown ledger.
 * The short file lock protects that write, not worktree occupancy or task authority.
 */
export function updateSurfaceFeedback(root, action, input) {
  root = fs.realpathSync(root);
  const file = containedFile(root, SURFACE_LEDGER);
  const lock = `${file}.lock`;
  let descriptor;
  try { descriptor = fs.openSync(lock, 'wx', 0o600); }
  catch (error) {
    if (error.code === 'EEXIST') reject('UI_SURFACE_LEDGER_BUSY', 'retry this ledger write after its owner finishes');
    throw error;
  }
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    const original = fs.readFileSync(file, 'utf8');
    const surfaces = readSurfaceLedger(root, { text: original });
    const surface = surfaces.find(value => value.id === input.surfaceId);
    if (!surface) reject('UI_SURFACE_UNKNOWN', input.surfaceId);
    const revision = surface.feedback?.revision ?? 0;
    const required = (value, field) => {
      if (typeof value !== 'string' || !value.trim()) reject('UI_SURFACE_ARGUMENT_INVALID', field);
      return value;
    };
    if (action === 'feedback' && surface.feedback?.id === input.feedbackId) {
      if (surface.feedback.request !== input.request || surface.feedback.requestRef !== input.requestRef) {
        reject('UI_SURFACE_FEEDBACK_CONFLICT', input.feedbackId);
      }
      return surface; // Retry never reopens an already reviewed/confirmed round.
    }
    if (Number(input.expectedRevision) !== revision) reject('UI_SURFACE_REVISION_CONFLICT', surface.id);
    if (action === 'feedback') {
      surface.feedback = {
        id: required(input.feedbackId, 'feedbackId'), revision: revision + 1,
        request: required(input.request, 'request'), requestRef: required(input.requestRef, 'requestRef'), review: null,
      };
      surface.status = 'drafting';
      surface.confirmation = null;
    } else {
      if (!surface.feedback || surface.feedback.id !== input.feedbackId) reject('UI_SURFACE_FEEDBACK_CONFLICT', surface.id);
      const currentDigest = surfaceSourceDigest(root, surface);
      if (action === 'review') {
        surface.feedback.review = {
          sourceDigest: currentDigest, evidence: required(input.evidence, 'evidence'),
          target: required(input.target, 'target'),
        };
        surface.status = 'pending-review';
        surface.confirmation = null;
      } else if (action === 'confirm') {
        if (surface.status !== 'pending-review' || !surface.feedback.review) reject('UI_SURFACE_REVIEW_REQUIRED', surface.id);
        if (input.sourceDigest !== surface.feedback.review.sourceDigest || input.sourceDigest !== currentDigest) {
          reject('UI_SURFACE_CONFIRMATION_STALE', surface.id);
        }
        surface.confirmation = {
          by: required(input.by, 'by'), request: required(input.request, 'request'),
          evidence: required(input.evidence, 'evidence'), sourceDigest: currentDigest,
          feedbackId: surface.feedback.id, prototypeId: surface.prototypeId,
        };
        surface.status = 'confirmed';
      } else reject('UI_SURFACE_ARGUMENT_INVALID', action);
      surface.feedback.revision++;
    }
    const next = original.replace(marker, `\`\`\`json ui-surface-authority\n${JSON.stringify({ schemaVersion: 1, surfaces }, null, 2)}\n\`\`\``);
    readSurfaceLedger(root, { text: next }); // Validate before publishing any change.
    fs.writeFileSync(temporary, next, { flag: 'wx', mode: fs.statSync(file).mode });
    const fd = fs.openSync(temporary, 'r');
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    if (fs.readFileSync(file, 'utf8') !== original) reject('UI_SURFACE_REVISION_CONFLICT', 'ledger changed outside this writer');
    fs.renameSync(temporary, file);
    return surface;
  } finally {
    fs.rmSync(temporary, { force: true });
    fs.closeSync(descriptor);
    fs.unlinkSync(lock);
  }
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
