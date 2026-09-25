import { useEffect, useMemo, useState } from 'react';
import { Button, Typography } from 'antd';
import { ImageOff, LoaderCircle, RotateCcw } from 'lucide-react';

import { useMobileI18n } from '../../app/mobileI18n';
import { isAccessGranted } from '../../features/auth/authSession';
import { useAuthStore } from '../../features/auth/authStore';
import type { ImageAttachment } from '../../gen/proto/domain/social/post_pb';
import {
  createMomentMediaGateway,
  type MomentMediaGateway,
} from '../../services/gateways/momentMediaGateway';
import { readableErrorMessage } from '../../utils/errorMessage';

const { Text } = Typography;

type MomentImageState =
  | { readonly status: 'loading'; readonly src: null; readonly error: null }
  | { readonly status: 'ready'; readonly src: string; readonly error: null }
  | { readonly status: 'failed'; readonly src: null; readonly error: string };

interface MomentImageProps {
  readonly attachment: ImageAttachment;
  readonly alt: string;
}

export async function loadMomentImageObjectUrl(
  gateway: MomentMediaGateway,
  attachment: ImageAttachment,
  signal: AbortSignal,
  createObjectUrl: (blob: Blob) => string = URL.createObjectURL,
): Promise<string> {
  return createObjectUrl(await gateway.loadImage(attachment, signal));
}

export function revokeMomentImageObjectUrl(
  source: string | null,
  revokeObjectUrl: (url: string) => void = URL.revokeObjectURL,
): void {
  if (source) revokeObjectUrl(source);
}

export function MomentImage({ attachment, alt }: MomentImageProps) {
  const { t } = useMobileI18n();
  const session = useAuthStore((state) => (
    isAccessGranted(state.accessDecision) ? state.session : null
  ));
  const gateway = useMemo(
    () => session ? createMomentMediaGateway(session) : null,
    [session],
  );
  const attachmentKey = [
    attachment.id,
    attachment.url,
    attachment.mediaEncryption?.ciphertextSha256B64 ?? '',
  ].join('\u0000');
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<MomentImageState>({
    status: 'loading',
    src: null,
    error: null,
  });

  useEffect(() => {
    if (!gateway) {
      setState({
        status: 'failed',
        src: null,
        error: 'mobile.moments.media.sessionUnavailable',
      });
      return undefined;
    }

    const controller = new AbortController();
    let active = true;
    let objectUrl: string | null = null;
    setState({ status: 'loading', src: null, error: null });
    void loadMomentImageObjectUrl(gateway, attachment, controller.signal)
      .then((source) => {
        objectUrl = source;
        if (!active) {
          revokeMomentImageObjectUrl(objectUrl);
          objectUrl = null;
          return;
        }
        setState({ status: 'ready', src: source, error: null });
      })
      .catch((error) => {
        if (!active || (error as { name?: string }).name === 'AbortError') return;
        setState({
          status: 'failed',
          src: null,
          error: readableErrorMessage(error, 'moment_media_failed'),
        });
      });

    return () => {
      active = false;
      controller.abort();
      revokeMomentImageObjectUrl(objectUrl);
      objectUrl = null;
    };
  }, [attachmentKey, attempt, gateway]);

  if (state.status === 'ready') {
    return (
      <img
        src={state.src}
        alt={alt}
        loading="lazy"
        onError={() => {
          revokeMomentImageObjectUrl(state.src);
          setState({
            status: 'failed',
            src: null,
            error: 'mobile.moments.media.decodeFailed',
          });
        }}
      />
    );
  }

  if (state.status === 'failed') {
    return (
      <div
        className="moments-restored-image-reference moments-image-recovery"
        data-moment-image-failure={state.error}
        role="alert"
      >
        <ImageOff size={22} aria-hidden="true" />
        <Text type="secondary">{t('mobile.moments.imageFailed')}</Text>
        <Button
          type="text"
          size="small"
          icon={<RotateCcw size={14} />}
          onClick={() => setAttempt((current) => current + 1)}
          aria-label={t('common.action.retry')}
        />
      </div>
    );
  }

  return (
    <div
      className="moments-restored-image-reference moments-image-loading"
      role="status"
      aria-label={t('common.state.loading')}
    >
      <LoaderCircle size={22} aria-hidden="true" />
    </div>
  );
}
