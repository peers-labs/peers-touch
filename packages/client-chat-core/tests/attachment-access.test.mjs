import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ChatAttachmentAccessController, chatFilePreviewKind } from '../dist/attachmentAccess.js';
import { AttachmentByteReader } from '../dist/attachmentByteReader.js';

const flush = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}
function fixture(t) {
  const reads = [], releases = [], actions = [], cancels = [];
  const port = {
    read(scope, id, start, retry) {
      const result = deferred();
      reads.push({ scope, id, start, retry, result });
      return result.promise;
    },
    release: async (scope, handle) => { releases.push({ scope, handle }); },
    cancel: async (_scope, id) => { cancels.push(id); },
    action: async (...args) => { actions.push(args); return 'completed'; },
    handle: (projection) => projection.handle ?? '',
    pending: (projection) => projection.state === 'pending',
  };
  const controller = new ChatAttachmentAccessController(port);
  controller.setScope('alice', 'alice');
  t.after(() => controller.setScope(null));
  return { controller, port, reads, releases, actions, cancels };
}

test('deduplicates selection, observations and pending refresh without dispatching an OS action', async (t) => {
  const f = fixture(t);
  const stop = f.controller.observe('a', () => {});
  f.controller.open('a', { filename: 'original.pdf', size: 20 });
  f.controller.refreshPending();
  await flush();
  assert.equal(f.reads.length, 1);
  assert.equal(f.controller.selectedMetadata().filename, 'original.pdf');
  f.reads[0].result.resolve({ state: 'pending' });
  await flush();
  assert.equal(f.reads.length, 2);
  assert.equal(f.reads[1].start, true);
  f.reads[1].result.resolve({ state: 'pending' });
  await flush();
  f.controller.refreshPending();
  f.controller.refreshPending();
  await flush();
  assert.equal(f.reads.length, 3);
  f.reads[2].result.resolve({ state: 'ready', handle: 'verified' });
  await flush();
  assert.equal(f.controller.snapshot('a').projection.handle, 'verified');
  assert.equal(f.actions.length, 0);
  stop();
});

test('close during download keeps reconciliation and releases the unobserved ready grant', async (t) => {
  const f = fixture(t);
  f.controller.open('a');
  await flush();
  f.reads[0].result.resolve({ state: 'pending' });
  await flush();
  f.controller.close();
  f.controller.refreshPending();
  await flush();
  f.reads[1].result.resolve({ state: 'ready', handle: 'background' });
  await flush();
  assert.equal(f.controller.selectedId(), null);
  assert.equal(f.controller.snapshot('a').projection, null);
  assert.deepEqual(f.releases.map((value) => value.handle), ['background']);
  assert.equal(f.actions.length, 0);
});

test('the selected slow download stays observable after background retention expires', async (t) => {
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  const f = fixture(t);
  f.controller.open('slow');
  await flush();
  f.reads[0].result.resolve({ state: 'pending' });
  await flush();
  now += 6 * 60_000;
  f.controller.refreshPending();
  await flush();
  assert.equal(f.reads.length, 2);
  f.reads[1].result.resolve({ state: 'ready', handle: 'finished' });
  await flush();
  assert.equal(f.controller.snapshot('slow').projection.state, 'ready');
  assert.equal(await f.controller.perform('slow', 'save'), 'completed');
  assert.equal(f.actions.length, 1);
});

test('closing a ready preview waits for revocation before a visible card reacquires access', async (t) => {
  const f = fixture(t);
  f.controller.open('a');
  const stop = f.controller.observe('a', () => {});
  await flush();
  f.reads[0].result.resolve({ state: 'ready', handle: 'first' });
  await flush();
  const release = deferred();
  f.port.release = async (_scope, handle) => { f.releases.push({ handle }); await release.promise; };
  f.controller.close();
  await flush();
  assert.equal(f.reads.length, 1);
  release.resolve();
  await flush();
  assert.equal(f.reads.length, 2);
  assert.equal(f.reads[1].start, false);
  f.reads[1].result.resolve({ state: 'ready', handle: 'second' });
  await flush();
  assert.equal(f.controller.snapshot('a').projection.handle, 'second');
  stop();
});

test('cancel fences an in-flight read and never restarts download during reconciliation', async (t) => {
  const f = fixture(t);
  f.controller.open('a');
  await flush();
  const cancellation = deferred();
  f.port.cancel = () => cancellation.promise;
  const cancelling = f.controller.cancel('a');
  f.reads[0].result.resolve({ state: 'pending' });
  await flush();
  assert.equal(f.reads.length, 1);
  cancellation.resolve();
  await flush();
  assert.equal(f.reads.length, 2);
  assert.equal(f.reads[1].start, false);
  f.reads[1].result.resolve({ state: 'cancelled' });
  await cancelling;
  await flush();
  assert.equal(f.controller.snapshot('a').projection.state, 'cancelled');
  assert.equal(f.reads.filter((value) => value.start).length, 1);
});

test('scope changes discard old reads and release their grants under the original owner', async (t) => {
  const f = fixture(t);
  const stop = f.controller.observe('a', () => {});
  f.controller.open('a');
  await flush();
  f.controller.setScope('bob', 'bob');
  await flush();
  assert.equal(f.controller.selectedId(), null);
  f.reads[0].result.resolve({ state: 'ready', handle: 'alice-only' });
  f.reads[1].result.resolve({ state: 'remote' });
  await flush();
  assert.deepEqual(f.releases, [{ scope: 'alice', handle: 'alice-only' }]);
  assert.equal(f.controller.snapshot('a').projection.state, 'remote');
  stop();
});

test('external actions require current explicit selection and are single-flight with late results fenced', async (t) => {
  const f = fixture(t);
  assert.equal(await f.controller.perform('a', 'open'), null);
  f.controller.open('a');
  await flush();
  f.reads[0].result.resolve({ state: 'ready', handle: 'first' });
  await flush();
  const action = deferred();
  f.port.action = (...args) => { f.actions.push(args); return action.promise; };
  const result = f.controller.perform('a', 'save');
  assert.equal(await f.controller.perform('a', 'save'), null);
  f.controller.close();
  action.resolve('completed');
  assert.equal(await result, null);
  assert.equal(f.actions.length, 1);
  assert.equal(await f.controller.perform('a', 'open'), null);
});

test('active content is never classified for executable inline preview', () => {
  for (const filename of ['a.svg', 'a.html', 'a.exe', 'a.js']) {
    assert.equal(chatFilePreviewKind({ filename, mimeType: 'image/png', size: 1 }), 'file');
  }
  for (const size of [0, 512 * 1024 + 1, 10 * 1024 ** 3]) {
    assert.equal(chatFilePreviewKind({ filename: 'a.txt', size }), 'text');
  }
  for (const filename of ['a.docx', 'a.xlsx', 'a.xls', 'a.pptx', 'a.ppt']) {
    assert.equal(chatFilePreviewKind({ filename, size: 10 * 1024 ** 3 }), 'office');
  }
  assert.equal(chatFilePreviewKind({ filename: 'a.pdf', mimeType: 'application/octet-stream' }), 'pdf');
  for (const mimeType of ['audio/mp4', 'audio/m4a', 'audio/x-m4a']) {
    assert.equal(chatFilePreviewKind({ filename: 'sound.m4a', mimeType }), 'audio');
    assert.equal(chatFilePreviewKind({ filename: 'script.exe', mimeType }), 'file');
  }
  assert.equal(chatFilePreviewKind({ filename: 'sound.wav', mimeType: 'audio/x-wav' }), 'audio');
});

test('preview Range reads validate grant identity and consume only the selected bytes', async (t) => {
  const previous = globalThis.fetch;
  t.after(() => { globalThis.fetch = previous; });
  const requests = [];
  const size = 10 * 1024 ** 3;
  const url = 'http://chat-file.localhost/01ARZ3NDEKTSV4RRFFQ69G5FAV';
  globalThis.fetch = async (_url, request) => {
    requests.push(request.headers.Range);
    const [, start, end] = /bytes=(\d+)-(\d+)/.exec(request.headers.Range);
    return new Response(new Uint8Array(Number(end) - Number(start) + 1), {
      status: 206, headers: { 'content-range': `bytes ${start}-${end}/${size}` },
    });
  };
  const signal = new AbortController().signal;
  const reader = new AttachmentByteReader(url, size, signal);
  assert.equal((await reader.read(size - 7, 7)).length, 7);
  assert.equal((await reader.read(0, 0)).length, 0);
  assert.deepEqual(requests, [`bytes=${size - 7}-${size - 1}`]);
  for (const [start, length] of [[-1, 1], [0, -1], [size, 1], [0, 8 * 1024 ** 2 + 1], [0.5, 1]]) {
    await assert.rejects(reader.read(start, length), /RANGE_INVALID/);
  }
  for (const invalid of ['https://evil.example/01ARZ3NDEKTSV4RRFFQ69G5FAV', 'file:///private/report', `${url}?path=secret`]) {
    assert.throws(() => new AttachmentByteReader(invalid, size, signal), /ASSET_INVALID/);
  }
  assert.throws(() => new AttachmentByteReader(url, -1, signal), /ASSET_INVALID/);
  globalThis.fetch = async () => new Response(new Uint8Array(1));
  await assert.rejects(reader.read(0, 1), /IDENTITY_MISMATCH/);
  globalThis.fetch = async () => new Response(new Uint8Array(1), {
    status: 206, headers: { 'content-range': `bytes 0-9/${size}` },
  });
  await assert.rejects(reader.read(0, 10), /INCOMPLETE/);
  globalThis.fetch = async () => new Response(new Uint8Array(11), {
    status: 206, headers: { 'content-range': `bytes 0-9/${size}` },
  });
  await assert.rejects(reader.read(0, 10), /INCOMPLETE/);
  globalThis.fetch = async () => new Response(new Uint8Array(10), {
    status: 206, headers: { 'content-range': `bytes 0-9/${size - 1}` },
  });
  await assert.rejects(reader.read(0, 10), /IDENTITY_MISMATCH/);
  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(new AttachmentByteReader(url, size, aborted.signal).read(0, 1), /aborted/i);
});
