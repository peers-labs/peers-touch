import {
  clientMediaEncryptionDescriptorFromAttachment,
  decryptClientMediaBlob,
} from '@peers-touch/client-media-security';

import type { MobileAuthSession } from '../../features/auth/authSession';
import type { ImageAttachment } from '../../gen/proto/domain/social/post_pb';
import {
  executeStationOperation,
  responseArrayBuffer,
} from '../stationTransport';

type MomentMediaFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface ResolvedMomentMediaSource {
  readonly url: string;
  readonly authenticated: boolean;
}

export interface MomentMediaGateway {
  loadImage(
    attachment: ImageAttachment,
    signal?: AbortSignal,
  ): Promise<Blob>;
}

export function resolveMomentMediaSource(
  reference: string,
  stationUrl: string,
): ResolvedMomentMediaSource {
  const normalizedReference = reference.trim();
  const activeStation = new URL(stationUrl);
  let url: URL;

  if (normalizedReference.startsWith('oss://self/')) {
    url = objectUrl(activeStation.origin, normalizedReference.slice('oss://self/'.length));
  } else if (normalizedReference.startsWith('oss://')) {
    const remote = new URL(normalizedReference.slice('oss://'.length));
    url = objectUrl(remote.origin, decodeURIComponent(remote.pathname.replace(/^\/+/, '')));
  } else if (
    normalizedReference.startsWith('http://')
    || normalizedReference.startsWith('https://')
    || normalizedReference.startsWith('/')
  ) {
    url = new URL(normalizedReference, activeStation);
  } else if (normalizedReference) {
    url = objectUrl(activeStation.origin, normalizedReference);
  } else {
    throw new Error('mobile.moments.media.missingReference');
  }

  return {
    url: url.toString(),
    authenticated: url.origin === activeStation.origin,
  };
}

export function createMomentMediaGateway(
  session: MobileAuthSession,
  fetcher: MomentMediaFetch = globalThis.fetch,
): MomentMediaGateway {
  return {
    async loadImage(attachment, signal): Promise<Blob> {
      const reference = attachment.url || attachment.id;
      const source = resolveMomentMediaSource(reference, session.stationUrl);
      const descriptor = clientMediaEncryptionDescriptorFromAttachment(attachment);
      if (attachment.mediaEncryption && !descriptor) {
        throw new Error('mobile.moments.media.invalidDescriptor');
      }
      const headers: Record<string, string> = {
        Accept: 'application/octet-stream',
      };
      const ciphertext = source.authenticated
        ? await loadAuthenticatedObject(session, source.url, signal)
        : await loadPublicObject(fetcher, source.url, headers, signal);

      return decryptClientMediaBlob({
        ciphertext,
        descriptor,
        mimeType: 'image/*',
      });
    },
  };
}

async function loadAuthenticatedObject(
  session: MobileAuthSession,
  sourceUrl: string,
  signal?: AbortSignal,
): Promise<Blob> {
  const url = new URL(sourceUrl);
  if (url.pathname !== '/sub-oss/file') {
    throw new Error('mobile.moments.media.unsupportedAuthenticatedSource');
  }
  const key = url.searchParams.get('key')?.trim();
  if (!key) throw new Error('mobile.moments.media.missingObjectKey');
  const response = await executeStationOperation(
    session,
    { operationId: 'oss_download', key },
    signal,
  );
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`mobile.moments.media.fetchFailed.${response.status}`);
  }
  return new Blob([responseArrayBuffer(response)], {
    type: response.contentType || 'application/octet-stream',
  });
}

async function loadPublicObject(
  fetcher: MomentMediaFetch,
  sourceUrl: string,
  headers: Record<string, string>,
  signal?: AbortSignal,
): Promise<Blob> {
  const response = await fetcher(sourceUrl, {
    cache: 'no-store',
    headers,
    signal,
  });
  if (!response.ok) {
    throw new Error(`mobile.moments.media.fetchFailed.${response.status}`);
  }
  return response.blob();
}

function objectUrl(origin: string, key: string): URL {
  const normalizedKey = key.trim().replace(/^\/+/, '');
  if (!normalizedKey) {
    throw new Error('mobile.moments.media.missingObjectKey');
  }
  const url = new URL('/sub-oss/file', `${origin.replace(/\/+$/, '')}/`);
  url.searchParams.set('key', normalizedKey);
  return url;
}
