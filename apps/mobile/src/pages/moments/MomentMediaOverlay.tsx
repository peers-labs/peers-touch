import { convertFileSrc } from '@tauri-apps/api/core';
import { useEffect, useMemo, useState } from 'react';
import { Button, Typography } from 'antd';
import { LoaderCircle, RotateCcw, X } from 'lucide-react';

import { useMobileI18n } from '../../app/mobileI18n';
import { isAccessGranted } from '../../features/auth/authSession';
import { useAuthStore } from '../../features/auth/authStore';
import type { SocialIntentPort } from '../../features/social/socialIntents';
import type {
  ImageAttachment,
  VideoAttachment,
} from '../../gen/proto/domain/social/post_pb';
import {
  createMomentMediaGateway,
} from '../../services/gateways/momentMediaGateway';
import { readableErrorMessage } from '../../utils/errorMessage';

const { Text } = Typography;

export type MomentMediaSelection =
  | {
      readonly route: 'PUBLIC';
      readonly kind: 'image' | 'video';
      readonly attachment: ImageAttachment | VideoAttachment;
      readonly returnFocus: HTMLElement | null;
    }
  | {
      readonly route: 'PRIVATE';
      readonly kind: 'image' | 'video';
      readonly postId: string;
      readonly objectId: string;
      readonly returnFocus: HTMLElement | null;
    };

interface MomentMediaOverlayProps {
  readonly selection: MomentMediaSelection;
  readonly intents: Pick<SocialIntentPort, 'openPrivateMedia'>;
  readonly onClose: () => void;
}

type OverlayState =
  | { readonly status: 'loading'; readonly source: null; readonly objectUrl: false }
  | { readonly status: 'ready'; readonly source: string; readonly objectUrl: boolean }
  | { readonly status: 'failed'; readonly source: null; readonly objectUrl: false; readonly error: string };

export function MomentMediaOverlay({
  selection,
  intents,
  onClose,
}: MomentMediaOverlayProps) {
  const { t } = useMobileI18n();
  const session = useAuthStore((state) => (
    isAccessGranted(state.accessDecision) ? state.session : null
  ));
  const gateway = useMemo(
    () => session ? createMomentMediaGateway(session) : null,
    [session],
  );
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<OverlayState>({
    status: 'loading',
    source: null,
    objectUrl: false,
  });

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    let objectUrl: string | null = null;
    setState({ status: 'loading', source: null, objectUrl: false });

    const load = async (): Promise<{ source: string; objectUrl: boolean }> => {
      if (selection.route === 'PUBLIC') {
        if (!gateway) throw new Error('mobile.moments.media.sessionUnavailable');
        const blob = await gateway.loadMedia(
          selection.attachment,
          selection.kind === 'video' ? 'video/*' : 'image/*',
          controller.signal,
        );
        objectUrl = URL.createObjectURL(blob);
        return { source: objectUrl, objectUrl: true };
      }

      const projection = await intents.openPrivateMedia(
        selection.postId,
        selection.objectId,
      );
      const media = projection.content && 'media' in projection.content
        ? projection.content.media.find((item) => item.objectId === selection.objectId)
        : undefined;
      if (media?.state !== 'MEDIA_READY' || !media.localPath) {
        throw new Error(media?.errorCode || 'mobile.moments.media.privateUnavailable');
      }
      return { source: convertFileSrc(media.localPath), objectUrl: false };
    };

    void load()
      .then((result) => {
        if (!active) {
          if (result.objectUrl) URL.revokeObjectURL(result.source);
          return;
        }
        setState({ status: 'ready', ...result });
      })
      .catch((error) => {
        if (!active || (error as { name?: string }).name === 'AbortError') return;
        setState({
          status: 'failed',
          source: null,
          objectUrl: false,
          error: readableErrorMessage(error, 'mobile.moments.media.previewFailed'),
        });
      });

    return () => {
      active = false;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [attempt, gateway, intents, selection]);

  useEffect(() => () => {
    selection.returnFocus?.focus();
  }, [selection.returnFocus]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="moments-media-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={t('mobile.moments.media.preview')}
      onClick={onClose}
    >
      <button
        type="button"
        className="moments-media-overlay-close"
        onClick={onClose}
        aria-label={t('common.action.close')}
      >
        <X size={22} />
      </button>
      <div
        className="moments-media-overlay-content"
        onClick={(event) => event.stopPropagation()}
      >
        {state.status === 'loading' && (
          <div className="moments-media-overlay-state" role="status">
            <LoaderCircle size={28} />
            <Text>{t('common.state.loading')}</Text>
          </div>
        )}
        {state.status === 'failed' && (
          <div className="moments-media-overlay-state" role="alert">
            <Text type="danger">{t('mobile.moments.media.previewFailed')}</Text>
            <Button
              icon={<RotateCcw size={16} />}
              onClick={() => setAttempt((current) => current + 1)}
            >
              {t('common.action.retry')}
            </Button>
          </div>
        )}
        {state.status === 'ready' && selection.kind === 'image' && (
          <img src={state.source} alt="" />
        )}
        {state.status === 'ready' && selection.kind === 'video' && (
          <video src={state.source} controls playsInline />
        )}
      </div>
    </div>
  );
}
