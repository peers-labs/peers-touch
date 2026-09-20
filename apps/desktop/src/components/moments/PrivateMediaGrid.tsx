import { Button } from '@lobehub/ui';
import { Image, Spin, Typography, theme } from 'antd';
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

const { Text } = Typography;

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

function isRetryable(state: PrivateMediaState): boolean {
  return state === 'MEDIA_PLACEHOLDER' || state === 'MEDIA_OFFLINE_RETRYABLE';
}

function MediaStateIcon({ state }: { state: PrivateMediaState }) {
  const { token } = theme.useToken();
  if (isBusy(state)) return <Spin size="small" />;
  if (state === 'MEDIA_INTEGRITY_FAILURE') {
    return <ShieldAlert size={20} color={token.colorError} />;
  }
  if (state === 'MEDIA_ACCESS_DENIED') {
    return <LockKeyhole size={20} color={token.colorWarning} />;
  }
  if (state === 'MEDIA_OFFLINE_RETRYABLE') {
    return <WifiOff size={20} color={token.colorWarning} />;
  }
  return <ImageIcon size={20} color={token.colorTextTertiary} />;
}

export function PrivateMediaGrid({ media, onOpen }: PrivateMediaGridProps) {
  const { token } = theme.useToken();
  const { t } = useTranslation('moments');
  if (media.length === 0) return null;

  const single = media.length === 1;
  return (
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
          style={{
            position: 'relative',
            minHeight: single ? 180 : 108,
            aspectRatio: single ? 'auto' : '1 / 1',
            overflow: 'hidden',
            borderRadius: token.borderRadius,
            background: token.colorFillSecondary,
          }}
        >
          {item.state === 'MEDIA_READY' && item.renderUrl ? (
            <Image
              src={item.renderUrl}
              alt={item.altText || t('moments.private.media.ready.alt')}
              preview={{ mask: false }}
              style={{
                display: 'block',
                width: '100%',
                height: '100%',
                minHeight: single ? 180 : 108,
                objectFit: 'cover',
              }}
            />
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
              <Text type="secondary" style={{ fontSize: 12 }}>
                {t(`moments.private.media.${item.state}`)}
              </Text>
              {isRetryable(item.state) && (
                <Button
                  size="small"
                  type="text"
                  icon={<RefreshCcw size={12} />}
                  onClick={() => onOpen(item.objectId)}
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
  );
}
