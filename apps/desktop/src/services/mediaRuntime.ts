import { useEffect } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { create } from 'zustand';

import { api } from './desktop_api';
import { useSocialChatStore } from '../store/socialChat';
import type { FriendChatMessage, FriendMessageAttachment } from '../gen/proto/domain/chat/friend_chat_pb';
import type { GroupMessage, GroupMessageAttachment } from '../gen/proto/domain/chat/group_chat_pb';
import { log } from '../utils/logger';

type ChatAttachment = FriendMessageAttachment | GroupMessageAttachment;
type ChatMessage = FriendChatMessage | GroupMessage;

export type MediaProjectionState = 'resolving' | 'ready' | 'failed';

export interface MediaProjection {
  cid: string;
  thumbnailCid?: string;
  localThumbnailSrc?: string;
  localOriginalSrc?: string;
  externalOriginalSrc?: string;
  mimeType: string;
  state: MediaProjectionState;
  error?: string;
}

interface ResolveMediaInput {
  cid: string;
  thumbnailCid?: string;
  mimeType?: string;
}

interface SeedLocalMediaInput extends ResolveMediaInput {
  filePath: string;
}

interface MediaRuntimeStore {
  items: Record<string, MediaProjection>;
  resolveMedia: (input: ResolveMediaInput) => Promise<MediaProjection | null>;
  seedLocalMedia: (input: SeedLocalMediaInput) => void;
  prewarmMessages: (messages: Record<string, ChatMessage[]>) => void;
  clear: () => void;
}

const IMAGE_FILENAME_PATTERN = /\.(apng|avif|bmp|gif|heic|heif|ico|jpe?g|png|svg|tiff?|webp)$/i;
const inflight = new Map<string, Promise<MediaProjection | null>>();
let teardownRuntime: (() => void) | null = null;

function isImageAttachment(attachment: ChatAttachment): boolean {
  const mimeType = attachment.mimeType?.toLowerCase() ?? '';
  const filename = attachment.filename ?? '';
  return mimeType.startsWith('image/') || IMAGE_FILENAME_PATTERN.test(filename);
}

function projectionKey(cid: string): string {
  return cid.trim();
}

interface ResolvedMediaSource {
  localSrc?: string;
  externalSrc?: string;
}

function resolvedSrc(localPath: string | null | undefined, url: string | null | undefined): ResolvedMediaSource {
  if (localPath && localPath.trim()) {
    return {
      localSrc: convertFileSrc(localPath),
      externalSrc: localPath,
    };
  }
  const remoteUrl = url && url.trim() ? url : undefined;
  return {
    localSrc: remoteUrl,
    externalSrc: remoteUrl,
  };
}

async function resolveCid(cid: string): Promise<ResolvedMediaSource> {
  const data = await api.ossResolveUrl(cid);
  return resolvedSrc(data.local_path, data.url);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function localSeedProjection(input: SeedLocalMediaInput): MediaProjection | null {
  const cid = projectionKey(input.cid);
  const filePath = input.filePath.trim();
  if (!cid || !filePath) return null;

  const src = convertFileSrc(filePath);
  const thumbnailCid = input.thumbnailCid?.trim() || undefined;
  return {
    cid,
    thumbnailCid,
    localOriginalSrc: src,
    localThumbnailSrc: src,
    externalOriginalSrc: filePath,
    mimeType: input.mimeType?.trim() ?? '',
    state: 'ready',
  };
}

export const useMediaRuntimeStore = create<MediaRuntimeStore>((set, get) => ({
  items: {},

  resolveMedia: async (input) => {
    const cid = projectionKey(input.cid);
    if (!cid) return null;

    const current = get().items[cid];
    if (current?.state === 'ready') {
      return current;
    }
    if (inflight.has(cid)) {
      return inflight.get(cid) ?? null;
    }

    const thumbnailCid = input.thumbnailCid?.trim() || undefined;
    const mimeType = input.mimeType?.trim() || current?.mimeType || '';
    set((state) => ({
      items: {
        ...state.items,
        [cid]: {
          ...state.items[cid],
          cid,
          thumbnailCid,
          mimeType,
          state: 'resolving',
          error: undefined,
        },
      },
    }));

    const promise = (async (): Promise<MediaProjection | null> => {
      try {
        const [original, thumbnail] = await Promise.all([
          resolveCid(cid),
          thumbnailCid && thumbnailCid !== cid
            ? resolveCid(thumbnailCid)
            : Promise.resolve({} as ResolvedMediaSource),
        ]);
        const originalSrc = original.localSrc;
        const thumbnailSrc = thumbnail.localSrc ?? originalSrc;
        const next: MediaProjection = {
          cid,
          thumbnailCid,
          localOriginalSrc: originalSrc,
          localThumbnailSrc: thumbnailSrc,
          externalOriginalSrc: original.externalSrc,
          mimeType,
          state: originalSrc || thumbnailSrc ? 'ready' : 'failed',
          error: originalSrc || thumbnailSrc ? undefined : 'media source unavailable',
        };
        set((state) => ({
          items: {
            ...state.items,
            [cid]: next,
          },
        }));
        return next;
      } catch (error) {
        const next: MediaProjection = {
          cid,
          thumbnailCid,
          mimeType,
          state: 'failed',
          error: errorMessage(error),
        };
        set((state) => ({
          items: {
            ...state.items,
            [cid]: next,
          },
        }));
        log.warn('mediaRuntime', 'resolve media failed', { cid, error });
        return next;
      } finally {
        inflight.delete(cid);
      }
    })();

    inflight.set(cid, promise);
    return promise;
  },

  seedLocalMedia: (input) => {
    const projection = localSeedProjection(input);
    if (!projection) return;
    set((state) => ({
      items: {
        ...state.items,
        [projection.cid]: projection,
      },
    }));
  },

  prewarmMessages: (messages) => {
    const seen = new Set<string>();
    for (const conversationMessages of Object.values(messages)) {
      for (const message of conversationMessages) {
        for (const attachment of message.attachments ?? []) {
          if (!attachment.cid || !isImageAttachment(attachment)) continue;
          const cid = projectionKey(attachment.cid);
          if (!cid || seen.has(cid)) continue;
          seen.add(cid);
          void get().resolveMedia({
            cid,
            thumbnailCid: attachment.thumbnailCid || undefined,
            mimeType: attachment.mimeType,
          });
        }
      }
    }
  },

  clear: () => {
    inflight.clear();
    set({ items: {} });
  },
}));

export function installMediaRuntime(): void {
  if (teardownRuntime) return;

  useMediaRuntimeStore.getState().prewarmMessages(useSocialChatStore.getState().messages);
  const unsubscribe = useSocialChatStore.subscribe((state) => {
    useMediaRuntimeStore.getState().prewarmMessages(state.messages);
  });

  teardownRuntime = () => {
    unsubscribe();
    teardownRuntime = null;
  };
}

export function teardownMediaRuntime(): void {
  if (!teardownRuntime) return;
  teardownRuntime();
}

export function useMediaProjection(input: ResolveMediaInput | null): MediaProjection | null {
  const item = useMediaRuntimeStore((state) => (input?.cid ? state.items[projectionKey(input.cid)] : undefined));
  const resolveMedia = useMediaRuntimeStore((state) => state.resolveMedia);

  useEffect(() => {
    if (!input?.cid) return;
    void resolveMedia(input);
  }, [input?.cid, input?.thumbnailCid, input?.mimeType, resolveMedia]);

  return item ?? (input?.cid
    ? {
        cid: input.cid,
        thumbnailCid: input.thumbnailCid,
        mimeType: input.mimeType ?? '',
        state: 'resolving',
      }
    : null);
}

export function seedLocalMediaProjection(input: SeedLocalMediaInput): void {
  useMediaRuntimeStore.getState().seedLocalMedia(input);
}

export async function openMediaExternal(cid: string): Promise<void> {
  const media = await useMediaRuntimeStore.getState().resolveMedia({ cid });
  const url = media?.externalOriginalSrc ?? media?.localOriginalSrc;
  if (!url) return;
  await api.openExternalUrl(url);
}
