import { useEffect, useState, useSyncExternalStore } from 'react';
import { Button, Image, Lightbox, Spin, VideoPlayer, type ResourceView } from '@peers-touch/ui';
import {
  ImageIcon,
  LockKeyhole,
  RefreshCcw,
  ShieldAlert,
  WifiOff,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type {
  PrivateMediaState,
  PrivateMomentMediaProjection,
} from '../../services/privateMomentsNative';

import {
  getPrivateMediaLocalPreviews,
  releasePrivateMediaLocalPreviews,
  subscribePrivateMediaLocalPreviews,
} from '../../services/privateMediaLocalPreview';

interface PrivateMediaGridProps {
  media: PrivateMomentMediaProjection[];
  postId: string;
  onOpen: (objectId: string) => void;
}

function columnsFor(count: number): number {
  if (count <= 1) return 1;
  if (count === 2 || count === 4) return 2;
  return 3;
}

// Transient states in the publish -> grant exchange where the publisher's
// picked file can paint immediately.
const LOCAL_PREVIEW_GRANT_GAP_STATES: ReadonlySet<PrivateMediaState> = new Set([
  'MEDIA_PLACEHOLDER',
  'MEDIA_GRANT_PENDING',
  'MEDIA_DOWNLOADING',
  'MEDIA_DECRYPTING',
]);

// Terminal states after which waiting for a grant is pointless. A local file
// must never mask these: the owner still needs the error/retry tile.
const TERMINAL_MEDIA_FAILURE_STATES: ReadonlySet<PrivateMediaState> = new Set([
  'MEDIA_ACCESS_DENIED',
  'MEDIA_INTEGRITY_FAILURE',
  'MEDIA_OFFLINE_RETRYABLE',
]);

function isBusy(state: PrivateMediaState): boolean {
  return LOCAL_PREVIEW_GRANT_GAP_STATES.has(state) && state !== 'MEDIA_PLACEHOLDER';
}

function canShowLocalPreview(state: PrivateMediaState): boolean {
  return LOCAL_PREVIEW_GRANT_GAP_STATES.has(state);
}

function canOpen(item: PrivateMomentMediaProjection): boolean {
  return item.state === 'MEDIA_PLACEHOLDER' || item.retryable;
}

function mediaStateLabel(item: PrivateMomentMediaProjection): string {
  if (
    item.accessPath === 'HOME_STATION_REMOTE_PEER_STREAM'
    && item.state === 'MEDIA_OFFLINE_RETRYABLE'
  ) {
    return 'moments.private.media.remoteRetryable';
  }
  return `moments.private.media.${item.state}`;
}

function MediaStateIcon({ state }: { state: PrivateMediaState }) {
  if (isBusy(state)) return <Spin size="small" />;
  if (state === 'MEDIA_INTEGRITY_FAILURE') {
    return <ShieldAlert size={20} color="var(--pt-danger)" />;
  }
  if (state === 'MEDIA_ACCESS_DENIED') {
    return <LockKeyhole size={20} color="var(--pt-warning)" />;
  }
  if (state === 'MEDIA_OFFLINE_RETRYABLE') {
    return <WifiOff size={20} color="var(--pt-warning)" />;
  }
  return <ImageIcon size={20} color="var(--pt-muted)" />;
}

export function PrivateMediaGrid({ media, postId, onOpen }: PrivateMediaGridProps) {
  const { t } = useTranslation('moments');
  // Publisher-owned local files shown during the publish -> grant gap. Ordered
  // to match the projected media array (intent file order).
  const localPreviews = useSyncExternalStore(
    subscribePrivateMediaLocalPreviews,
    () => getPrivateMediaLocalPreviews(postId),
    () => [],
  );
  const allSettled = media.length > 0 && media.every((item) => (
    item.state === 'MEDIA_READY' || TERMINAL_MEDIA_FAILURE_STATES.has(item.state)
  ));
  // Once every projected item has converged (granted or terminally failed),
  // the local exchange is over; release the picked-file previews so the
  // granted render URL (or the failure tile) owns the paint.
  useEffect(() => {
    if (allSettled) releasePrivateMediaLocalPreviews(postId);
  }, [allSettled, postId]);
  const [selected, setSelected] = useState<string | null>(null);
  const resource = (item: PrivateMomentMediaProjection): ResourceView => ({
    // The lightbox only consumes authorized native render handles. A revoke
    // closes it; publisher-owned picked files remain transient tile previews.
    resourceId: `${item.objectId}:${item.renderUrl}`,
    source: item.renderUrl,
    name: item.altText || t('moments.private.media.ready.alt'),
    state: 'available',
    failureReason: t('moments.lightbox.unavailable'),
  });
  const images = media.filter(item => item.state === 'MEDIA_READY' && item.renderUrl
    && !item.mimeType?.startsWith('video/')).map(resource);
  const selectedIndex = images.findIndex(image => image.resourceId === selected);
  useEffect(() => {
    if (selected !== null && selectedIndex < 0) setSelected(null);
  }, [selected, selectedIndex]);
  if (media.length === 0) return null;

  const single = media.length === 1;
  return (
    <>
    <div
      data-private-media-grid
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${columnsFor(media.length)}, 1fr)`,
        gap: 3,
        marginTop: 10,
        maxWidth: single ? 300 : 340,
      }}
    >
      {media.map((item, index) => {
        // Publisher's local file during the grant gap (this post only).
        // Fail closed for terminal states: the failure tile below owns those.
        const localPreview = canShowLocalPreview(item.state)
          ? localPreviews[index]
          : undefined;
        return (
        <div
          key={item.objectId}
          data-private-media-state={item.state}
          data-private-media-access-path={item.accessPath}
          data-private-media-retryable={item.retryable || undefined}
          data-private-media-local={localPreview ? true : undefined}
          style={{
            position: 'relative',
            minHeight: single ? 180 : 108,
            aspectRatio: single ? 'auto' : '1 / 1',
            overflow: 'hidden',
            borderRadius: 'var(--pt-radius-md)',
            background: 'var(--pt-subtle)',
          }}
        >
          {localPreview?.isVideo ? (
            <VideoPlayer resource={{
              resourceId: `local:${postId}:${item.objectId}:${localPreview.src}`,
              source: localPreview.src,
              name: item.altText || t('moments.private.media.ready.alt'),
              state: 'available',
            }} />
          ) : localPreview ? (
            <Image
              resource={{
                resourceId: `local:${postId}:${item.objectId}:${localPreview.src}`,
                source: localPreview.src,
                name: item.altText || t('moments.private.media.ready.alt'),
                state: 'available',
              }}
              style={{
                display: 'block',
                width: '100%',
                height: '100%',
                minHeight: single ? 180 : 108,
                objectFit: 'cover',
              }}
            />
          ) : item.state === 'MEDIA_READY'
          && item.renderUrl
          && item.mimeType?.startsWith('video/') ? (
            <VideoPlayer resource={resource(item)} />
          ) : item.state === 'MEDIA_READY' && item.renderUrl ? (
            <Button actionId={`private-media.preview.${item.objectId}`} emphasis="quiet"
              aria-label={t('moments.lightbox.openImage', { index: 1, total: images.length })}
              onActivate={() => setSelected(resource(item).resourceId)}>
            <Image resource={resource(item)}
              style={{
                display: 'block',
                width: '100%',
                height: '100%',
                minHeight: single ? 180 : 108,
                objectFit: 'cover',
              }}
            />
            </Button>
          ) : (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                height: '100%',
                minHeight: single ? 180 : 108,
                padding: 10,
                textAlign: 'center',
              }}
            >
              <MediaStateIcon state={item.state} />
              <span style={{ color: 'var(--pt-secondary)' }}>
                {t(mediaStateLabel(item))}
              </span>
              {canOpen(item) && (
                <Button
                  actionId={`private-media.open.${item.objectId}`}
                  density="compact"
                  emphasis="quiet"
                  leading={<RefreshCcw size={12} />}
                  onActivate={() => onOpen(item.objectId)}
                >
                  {item.state === 'MEDIA_PLACEHOLDER'
                    ? t('moments.private.media.open')
                    : t('moments.private.action.retry')}
                </Button>
              )}
            </div>
          )}
          {localPreview && (
            <div
              aria-hidden
              data-private-media-local-badge
              style={{
                position: 'absolute',
                left: 4,
                bottom: 4,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 20,
                height: 20,
                borderRadius: '50%',
                color: 'var(--pt-on-primary)',
                background: 'rgba(0,0,0,0.45)',
              }}
            >
              <Spin size="small" />
            </div>
          )}
        </div>
        );
      })}
    </div>
    <Lightbox images={images} index={selectedIndex < 0 ? null : selectedIndex}
      onIndexChange={index => setSelected(images[index].resourceId)} onDismiss={() => setSelected(null)}
      copy={{ title: t('moments.lightbox.title'), close: t('moments.lightbox.close'),
        previous: t('moments.lightbox.previous'), next: t('moments.lightbox.next'),
        singleImage: t('moments.lightbox.singleImage'),
        openImage: (index, total) => t('moments.lightbox.openImage', { index, total }) }} />
    </>
  );
}
