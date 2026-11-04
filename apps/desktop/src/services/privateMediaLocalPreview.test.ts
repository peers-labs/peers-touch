import { expect, it, beforeEach, afterEach, vi } from 'vitest';

import {
  clearPrivateMediaLocalPreviews,
  getPrivateMediaLocalPreviews,
  registerPrivateMediaLocalPreviews,
  releasePrivateMediaLocalPreviews,
  subscribePrivateMediaLocalPreviews,
} from './privateMediaLocalPreview';

const image = (name: string) => ({ src: `asset://local/${name}`, isVideo: false });

beforeEach(() => {
  clearPrivateMediaLocalPreviews();
});

afterEach(() => {
  clearPrivateMediaLocalPreviews();
});

it('returns a stable empty snapshot for posts without previews', () => {
  expect(getPrivateMediaLocalPreviews('missing')).toEqual([]);
  expect(getPrivateMediaLocalPreviews('missing')).toBe(getPrivateMediaLocalPreviews('other'));
});

it('keeps registered previews indexed and ordered to match projected media', () => {
  registerPrivateMediaLocalPreviews('post-1', [image('a.jpg'), image('b.jpg')]);

  const previews = getPrivateMediaLocalPreviews('post-1');
  expect(previews).toHaveLength(2);
  expect(previews[0]?.src).toBe('asset://local/a.jpg');
  expect(previews[1]?.src).toBe('asset://local/b.jpg');
});

it('trims the post id and isolates entries per post', () => {
  registerPrivateMediaLocalPreviews('  post-1  ', [image('a.jpg')]);

  expect(getPrivateMediaLocalPreviews('post-1')).toHaveLength(1);
  expect(getPrivateMediaLocalPreviews('post-2')).toEqual([]);
});

it('ignores blank ids and empty preview sets', () => {
  registerPrivateMediaLocalPreviews('   ', [image('a.jpg')]);
  registerPrivateMediaLocalPreviews('post-empty', []);

  expect(getPrivateMediaLocalPreviews('post-empty')).toEqual([]);
});

it('notifies subscribers on register and release', () => {
  const listener = vi.fn();
  const unsubscribe = subscribePrivateMediaLocalPreviews(listener);

  registerPrivateMediaLocalPreviews('post-1', [image('a.jpg')]);
  expect(listener).toHaveBeenCalledTimes(1);

  releasePrivateMediaLocalPreviews('post-1');
  expect(listener).toHaveBeenCalledTimes(2);
  expect(getPrivateMediaLocalPreviews('post-1')).toEqual([]);

  unsubscribe();
  registerPrivateMediaLocalPreviews('post-2', [image('b.jpg')]);
  expect(listener).toHaveBeenCalledTimes(2);
});

it('does not notify when releasing or clearing an empty registry', () => {
  const listener = vi.fn();
  const unsubscribe = subscribePrivateMediaLocalPreviews(listener);

  releasePrivateMediaLocalPreviews('never-registered');
  clearPrivateMediaLocalPreviews();

  expect(listener).not.toHaveBeenCalled();
  unsubscribe();
});

it('evicts the oldest post once the bounded LRU capacity is exceeded', () => {
  const maxPosts = 64;
  for (let index = 0; index < maxPosts; index += 1) {
    registerPrivateMediaLocalPreviews(`post-${index}`, [image(`${index}.jpg`)]);
  }
  // At exactly capacity nothing has been evicted yet.
  expect(getPrivateMediaLocalPreviews('post-0')).toHaveLength(1);
  expect(getPrivateMediaLocalPreviews(`post-${maxPosts - 1}`)).toHaveLength(1);

  // The next distinct post evicts the oldest insertion-order key only.
  registerPrivateMediaLocalPreviews('post-latest', [image('latest.jpg')]);
  expect(getPrivateMediaLocalPreviews('post-0')).toEqual([]);
  expect(getPrivateMediaLocalPreviews('post-1')).toHaveLength(1);
  expect(getPrivateMediaLocalPreviews('post-latest')[0]?.src).toBe(
    'asset://local/latest.jpg',
  );

  // Re-registering an existing key updates it in place without evicting peers.
  registerPrivateMediaLocalPreviews('post-1', [image('replacement.jpg')]);
  expect(getPrivateMediaLocalPreviews('post-2')).toHaveLength(1);
  expect(getPrivateMediaLocalPreviews('post-1')[0]?.src).toBe(
    'asset://local/replacement.jpg',
  );
});

it('clear drops every entry and notifies once', () => {
  registerPrivateMediaLocalPreviews('post-1', [image('a.jpg')]);
  registerPrivateMediaLocalPreviews('post-2', [image('b.jpg')]);
  const listener = vi.fn();
  const unsubscribe = subscribePrivateMediaLocalPreviews(listener);

  clearPrivateMediaLocalPreviews();

  expect(listener).toHaveBeenCalledTimes(1);
  expect(getPrivateMediaLocalPreviews('post-1')).toEqual([]);
  expect(getPrivateMediaLocalPreviews('post-2')).toEqual([]);
  unsubscribe();
});
