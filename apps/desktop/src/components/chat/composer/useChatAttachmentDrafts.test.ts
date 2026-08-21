import { afterEach, describe, expect, it, vi } from 'vitest';
import { convertFileSrc } from '@tauri-apps/api/core';

import {
  createChatAttachmentPreview,
  revokeChatAttachmentPreview,
} from './useChatAttachmentDrafts';

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: vi.fn((path: string) => `asset://converted/${encodeURIComponent(path)}`),
  invoke: vi.fn(),
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(convertFileSrc).mockClear();
});

describe('chat attachment preview substrate', () => {
  it('converts native image and video paths through Tauri without claiming ownership', () => {
    expect(createChatAttachmentPreview('image/png', 'photo.png', '/tmp/chat photo.png')).toEqual({
      previewUrl: 'asset://converted/%2Ftmp%2Fchat%20photo.png',
      ownsPreviewUrl: false,
    });
    expect(createChatAttachmentPreview('video/mp4', 'clip.mp4', '/tmp/clip.mp4')).toEqual({
      previewUrl: 'asset://converted/%2Ftmp%2Fclip.mp4',
      ownsPreviewUrl: false,
    });
    expect(convertFileSrc).toHaveBeenNthCalledWith(1, '/tmp/chat photo.png');
    expect(convertFileSrc).toHaveBeenNthCalledWith(2, '/tmp/clip.mp4');
  });

  it('creates owned blob URLs only for previewable browser files', () => {
    const image = { name: 'photo.png', type: 'image/png' } as File;
    const archive = { name: 'archive.zip', type: 'application/zip' } as File;
    const createObjectUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:chat-photo');

    expect(createChatAttachmentPreview(image.type, image.name, image)).toEqual({
      previewUrl: 'blob:chat-photo',
      ownsPreviewUrl: true,
    });
    expect(createChatAttachmentPreview(archive.type, archive.name, archive)).toEqual({
      previewUrl: null,
      ownsPreviewUrl: false,
    });
    expect(createObjectUrl).toHaveBeenCalledOnce();
  });

  it('does not convert native paths for non-previewable attachments', () => {
    expect(createChatAttachmentPreview(
      'application/pdf',
      'document.pdf',
      '/tmp/document.pdf',
    )).toEqual({
      previewUrl: null,
      ownsPreviewUrl: false,
    });
    expect(convertFileSrc).not.toHaveBeenCalled();
  });

  it('revokes only blob URLs owned by the draft substrate', () => {
    const revokeObjectUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

    revokeChatAttachmentPreview({ previewUrl: 'blob:owned', ownsPreviewUrl: true });
    revokeChatAttachmentPreview({ previewUrl: 'blob:external', ownsPreviewUrl: false });
    revokeChatAttachmentPreview({ previewUrl: 'asset://converted/native', ownsPreviewUrl: true });
    revokeChatAttachmentPreview({ previewUrl: null, ownsPreviewUrl: true });

    expect(revokeObjectUrl).toHaveBeenCalledOnce();
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:owned');
  });
});
