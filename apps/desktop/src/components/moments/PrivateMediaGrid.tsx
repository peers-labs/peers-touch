import { useEffect, useState } from 'react';
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

interface PrivateMediaGridProps {
  media: PrivateMomentMediaProjection[];
  onOpen: (objectId: string) => void;
}

function columnsFor(count: number): number {
  if (count <= 1) return 1;
  if (count === 2 || count === 4) return 2;
  return 3;
}

function isBusy(state: PrivateMediaState): boolean {
  return [
    'MEDIA_GRANT_PENDING',
    'MEDIA_DOWNLOADING',
    'MEDIA_DECRYPTING',
  ].includes(state);
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

export function PrivateMediaGrid({ media, onOpen }: PrivateMediaGridProps) {
  const { t } = useTranslation('moments');
  const [selected, setSelected] = useState<string | null>(null);
  const resource = (item: PrivateMomentMediaProjection): ResourceView => ({
    // Native-authorized render handles are the only source. A revoke removes
    // the resource and closes any preview; a new grant has a new identity.
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
      {media.map((item) => (
        <div
          key={item.objectId}
          data-private-media-state={item.state}
          data-private-media-access-path={item.accessPath}
          data-private-media-retryable={item.retryable || undefined}
          style={{
            position: 'relative',
            minHeight: single ? 180 : 108,
            aspectRatio: single ? 'auto' : '1 / 1',
            overflow: 'hidden',
            borderRadius: 'var(--pt-radius-md)',
            background: 'var(--pt-subtle)',
          }}
        >
          {item.state === 'MEDIA_READY'
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
        </div>
      ))}
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
