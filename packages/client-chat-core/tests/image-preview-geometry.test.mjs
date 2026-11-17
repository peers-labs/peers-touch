import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  clearChatImageGeometryForTests,
  fitChatImageBox,
  hasChatImageGeometry,
  readChatImageGeometry,
  recordChatImageGeometry,
  reserveChatImageBox,
} from '../dist/imagePreviewGeometry.js';

const CONSTRAINTS = { maxWidth: 240, maxHeight: 260 };
const FALLBACK = { width: 160, height: 96 };

test('records and reads intrinsic geometry keyed by the stable attachment id', () => {
  clearChatImageGeometryForTests();
  recordChatImageGeometry('att-1', 1920.4, 1080.6);
  assert.deepEqual(readChatImageGeometry('att-1'), { width: 1920, height: 1081 });
  assert.equal(hasChatImageGeometry('att-1'), true);
  assert.equal(hasChatImageGeometry('unknown'), false);
});

test('ignores empty ids and non-positive dimensions', () => {
  clearChatImageGeometryForTests();
  recordChatImageGeometry('', 100, 100);
  recordChatImageGeometry('bad', 0, 100);
  recordChatImageGeometry('bad', 100, Number.NaN);
  assert.equal(hasChatImageGeometry(''), false);
  assert.equal(hasChatImageGeometry('bad'), false);
});

test('fits wide images by the width cap while preserving aspect ratio', () => {
  const box = fitChatImageBox({ width: 1920, height: 1080 }, CONSTRAINTS);
  assert.deepEqual(box, { width: 240, height: 135 });
});

test('fits tall images by the height cap while preserving aspect ratio', () => {
  const box = fitChatImageBox({ width: 1080, height: 1920 }, CONSTRAINTS);
  assert.deepEqual(box, { width: 146, height: 260 });
});

test('never upscales images smaller than the caps', () => {
  const box = fitChatImageBox({ width: 120, height: 80 }, CONSTRAINTS);
  assert.deepEqual(box, { width: 120, height: 80 });
});

test('reserveChatImageBox returns the exact fitted box once geometry is known', () => {
  clearChatImageGeometryForTests();
  recordChatImageGeometry('att-known', 1920, 1080);
  const box = reserveChatImageBox('att-known', CONSTRAINTS, FALLBACK);
  assert.deepEqual(box, { width: 240, height: 135, exact: true });
});

test('reserveChatImageBox falls back to a stable placeholder before first decode', () => {
  clearChatImageGeometryForTests();
  const box = reserveChatImageBox('att-unknown', CONSTRAINTS, FALLBACK);
  assert.deepEqual(box, { width: 160, height: 96, exact: false });
});

test('evicts the oldest entry once the LRU capacity is exceeded', () => {
  clearChatImageGeometryForTests();
  for (let i = 0; i < 257; i += 1) {
    recordChatImageGeometry(`att-${i}`, 100, 100);
  }
  assert.equal(hasChatImageGeometry('att-0'), false);
  assert.equal(hasChatImageGeometry('att-256'), true);
});

test('re-recording an id refreshes its recency instead of evicting it first', () => {
  clearChatImageGeometryForTests();
  recordChatImageGeometry('att-first', 100, 100);
  for (let i = 0; i < 255; i += 1) {
    recordChatImageGeometry(`att-${i}`, 100, 100);
  }
  recordChatImageGeometry('att-first', 200, 200);
  for (let i = 255; i < 256; i += 1) {
    recordChatImageGeometry(`att-${i}`, 100, 100);
  }
  assert.equal(hasChatImageGeometry('att-first'), true);
  assert.deepEqual(readChatImageGeometry('att-first'), { width: 200, height: 200 });
});
