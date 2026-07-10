#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const evidenceDir = path.resolve('applet-readiness-evidence/official-applet');
const evidencePath = path.join(evidenceDir, 'atelier-host-storage-attachment-controlled-gate.json');
const storageRoot = path.resolve('.local/atelier-host-storage-attachment-controlled-gate', `run-${process.pid}-${Date.now()}`);
const taskId = 'atelier-controlled-host-storage-task';
const attachmentId = 'atelier-controlled-attachment';
const mime = 'text/plain';
const payload = Buffer.from('Atelier controlled Host Storage attachment payload\n', 'utf8');

const claimBoundary = {
  readiness: 'NOT_READY',
  proves: [
    'controlled Host-owned attachment byte staging behind host-storage opaque refs',
    'host-storage attachment metadata normalization with mime/size/sha256',
    'controlled host-storage ref readback without exposing raw path/url/body/base64 fields to applet evidence',
  ],
  doesNotProve: [
    'real Desktop Host Storage runtime',
    'real user attachment picker or upload flow',
    'applet attachment upload capability',
    'Run input_snapshot write capability from applet',
    'real provider/executor consumption of Host Storage attachments',
    'complete Host + Station + applet E2E',
  ],
};

mkdirSync(evidenceDir, { recursive: true });

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function hostStorageRefFor(input) {
  return `host-storage://atelier/${encodeURIComponent(input.taskId)}/${encodeURIComponent(input.attachmentId)}/${input.sha256}`;
}

function assertNoRawAttachmentFields(value) {
  const serialized = JSON.stringify(value);
  for (const forbidden of [
    'path',
    'url',
    'body',
    'base64',
    'bytes',
    'write',
    'HostStorage.write',
    'input_snapshot.write',
    'inputSnapshot.write',
  ]) {
    assert.equal(
      serialized.includes(forbidden),
      false,
      `controlled Host Storage evidence must not expose raw/write field ${forbidden}`,
    );
  }
}

function stageHostStorageAttachment(input) {
  const digest = sha256(input.bytes);
  const ref = hostStorageRefFor({ taskId: input.taskId, attachmentId: input.attachmentId, sha256: digest });
  const objectDir = path.join(storageRoot, 'objects', digest.slice(0, 2));
  mkdirSync(objectDir, { recursive: true });
  const objectPath = path.join(objectDir, digest);
  writeFileSync(objectPath, input.bytes);
  const metadata = {
    hostStorageRef: ref,
    mime: input.mime,
    size: input.bytes.length,
    sha256: digest,
  };
  const manifestPath = path.join(storageRoot, 'manifest.json');
  writeFileSync(manifestPath, `${JSON.stringify({ [ref]: { objectPath, metadata } }, null, 2)}\n`);
  return metadata;
}

function readHostStorageAttachment(metadata) {
  assert.ok(metadata.hostStorageRef.startsWith('host-storage://'), 'Host Storage ref must be opaque host-storage scheme');
  const manifest = JSON.parse(readFileSync(path.join(storageRoot, 'manifest.json'), 'utf8'));
  const record = manifest[metadata.hostStorageRef];
  assert.ok(record, 'Host Storage manifest record must exist');
  const bytes = readFileSync(record.objectPath);
  assert.equal(sha256(bytes), metadata.sha256, 'Host Storage readback sha256 mismatch');
  assert.equal(bytes.length, metadata.size, 'Host Storage readback size mismatch');
  return bytes;
}

function rejectRawAttachmentInput(input) {
  assert.throws(
    () => {
      if ('path' in input || 'url' in input || 'body' in input || 'base64' in input || 'bytes' in input) {
        throw new Error('raw attachment input rejected');
      }
    },
    /raw attachment input rejected/,
  );
}

function runGate() {
  mkdirSync(storageRoot, { recursive: true });
  const metadata = stageHostStorageAttachment({
    taskId,
    attachmentId,
    mime,
    bytes: payload,
  });
  assert.match(metadata.hostStorageRef, /^host-storage:\/\/atelier\//);
  assert.equal(metadata.mime, mime);
  assert.equal(metadata.size, payload.length);
  assert.equal(metadata.sha256, sha256(payload));
  assert.deepEqual(readHostStorageAttachment(metadata), payload);
  rejectRawAttachmentInput({ path: '/tmp/raw.txt' });
  rejectRawAttachmentInput({ url: 'file:///tmp/raw.txt' });
  rejectRawAttachmentInput({ body: 'raw body' });
  rejectRawAttachmentInput({ base64: payload.toString('base64') });
  rejectRawAttachmentInput({ bytes: [...payload] });

  const evidence = {
    ok: true,
    evidenceClass: 'CONTROLLED_LOCAL_UPSTREAM',
    gate: 'atelier-host-storage-attachment-controlled-gate',
    source: 'host_storage_controlled_harness',
    attachment: metadata,
    rawInputRejectionCases: ['path', 'url', 'body', 'base64', 'bytes'],
    claimBoundary,
    notCovered: claimBoundary.doesNotProve,
  };
  assertNoRawAttachmentFields(evidence.attachment);
  return evidence;
}

try {
  const evidence = runGate();
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`PASS Atelier Host Storage attachment controlled gate: ${evidencePath}`);
} catch (error) {
  const evidence = {
    ok: false,
    evidenceClass: 'CONTROLLED_LOCAL_UPSTREAM',
    gate: 'atelier-host-storage-attachment-controlled-gate',
    claimBoundary,
    error: error instanceof Error ? error.message : String(error),
  };
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  console.error(`FAIL Atelier Host Storage attachment controlled gate: ${evidence.error}`);
  process.exitCode = 1;
} finally {
  if (existsSync(storageRoot)) {
    rmSync(storageRoot, { recursive: true, force: true });
  }
}
