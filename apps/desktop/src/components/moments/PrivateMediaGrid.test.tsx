import { readFileSync } from 'node:fs';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';

import { PrivateMediaGrid } from './PrivateMediaGrid';
import { normalizePrivateMomentProjection } from '../../services/privateMomentsNative';

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: (path: string, protocol: string) => `${protocol}://localhost/${path}`,
  invoke: vi.fn(),
}));

vi.mock('@lobehub/ui', () => ({
  Button: ({ children }: { children?: ReactNode }) => <button>{children}</button>,
}));

vi.mock('antd', () => ({
  Image: ({ alt, src }: { alt?: string; src?: string }) => <img alt={alt} src={src} />,
  Spin: () => <span data-spin />,
  Typography: {
    Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  },
  theme: {
    useToken: () => ({
      token: {
        borderRadius: 8,
        colorError: '#f00',
        colorFillSecondary: '#eee',
        colorTextTertiary: '#888',
        colorWarning: '#fa0',
      },
    }),
  },
}));

vi.mock('lucide-react', () => ({
  ImageIcon: () => <span data-icon="image" />,
  LockKeyhole: () => <span data-icon="lock" />,
  RefreshCcw: () => <span data-icon="retry" />,
  ShieldAlert: () => <span data-icon="shield" />,
  WifiOff: () => <span data-icon="offline" />,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => ({
      'moments.private.action.retry': 'Try again',
      'moments.private.media.ready.alt': 'Private attachment',
      'moments.private.media.remoteRetryable': 'Source temporarily unavailable',
    })[key] ?? key,
  }),
}));

it('renders remote private image from home station', () => {
  const projection = normalizePrivateMomentProjection({
    post_id: 'post-image',
    content_id: 'post-image',
    generation: '7',
    author_ptid: 'ptid:author',
    audience_kind: 'FRIENDS',
    state: 'CONTENT_READY',
    content: {
      kind: 'IMAGE',
      text: 'remote private image',
      media: [{
        object_id: 'object-image',
        state: 'MEDIA_READY',
        access_path: 'HOME_STATION_REMOTE_PEER_STREAM',
        retryable: false,
        render_url: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
        plaintext_sha256: 'a'.repeat(64),
        plaintext_size: 128,
        mime_type: 'image/jpeg',
      }],
    },
  });
  expect(projection.content?.kind).toBe('IMAGE');
  if (projection.content?.kind !== 'IMAGE') return;
  const html = renderToStaticMarkup(
    <PrivateMediaGrid
      media={projection.content.media}
      onOpen={vi.fn()}
    />,
  );

  expect(html).toContain('data-private-media-access-path="HOME_STATION_REMOTE_PEER_STREAM"');
  expect(html).toContain(
    'src="private-media://localhost/01ARZ3NDEKTSV4RRFFQ69G5FAV"',
  );
  expect(html).not.toContain('station-source');
  expect(html).not.toContain('https://');
});

it('renders remote private video retry state without direct remote URL', () => {
  const projection = normalizePrivateMomentProjection({
    post_id: 'post-video',
    content_id: 'post-video',
    generation: '7',
    author_ptid: 'ptid:author',
    audience_kind: 'FRIENDS',
    state: 'CONTENT_READY',
    content: {
      kind: 'VIDEO',
      text: 'remote private video',
      media: [{
        object_id: 'object-video',
        state: 'MEDIA_OFFLINE_RETRYABLE',
        access_path: 'HOME_STATION_REMOTE_PEER_STREAM',
        retryable: true,
        mime_type: 'video/mp4',
        error_code: 'MEDIA_DEPENDENCY_UNAVAILABLE',
      }],
    },
  });
  expect(projection.content?.kind).toBe('VIDEO');
  if (projection.content?.kind !== 'VIDEO') return;
  const html = renderToStaticMarkup(
    <PrivateMediaGrid
      media={projection.content.media}
      onOpen={vi.fn()}
    />,
  );

  expect(html).toContain('data-private-media-state="MEDIA_OFFLINE_RETRYABLE"');
  expect(html).toContain('data-private-media-retryable="true"');
  expect(html).toContain('Source temporarily unavailable');
  expect(html).toContain('Try again');
  expect(html).not.toContain('<video');
  expect(html).not.toContain('station-source');
  expect(html).not.toContain('http://');
  expect(html).not.toContain('https://');
});

it('localizes the remote private media retry state', () => {
  const load = (relativePath: string) => JSON.parse(
    readFileSync(new URL(relativePath, import.meta.url), 'utf8'),
  ) as Record<string, string>;
  const en = load('../../../../../packages/locales/en/moments.json');
  const zh = load('../../../../../packages/locales/zh-CN/moments.json');

  expect(en['moments.private.media.remoteRetryable'])
    .toBe('Source temporarily unavailable');
  expect(zh['moments.private.media.remoteRetryable']).toBe('来源暂时不可用');
});
