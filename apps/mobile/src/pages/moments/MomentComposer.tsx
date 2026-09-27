/**
 * MomentComposer.tsx — Composer card with draft save/restore
 *
 * Renders the compose form for creating a new moment. Integrates
 * with DraftRestorationPort for draft persistence and recovery.
 * Audience selection, image attachment, and publish flow are
 * self-contained; the parent receives the created post via callback.
 *
 * W6B: Refactored from inline MomentsPage logic into standalone
 * component with draft recovery and audience selection.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Input, Popconfirm, Select, message, Typography } from 'antd';
import { AlertTriangle, ImagePlus, RotateCcw, Save, Send, Trash2 } from 'lucide-react';
import { create } from '@bufbuild/protobuf';

import { useMobileI18n } from '../../app/mobileI18n';
import type { MobileAuthSession } from '../../features/auth/authSession';
import type { MomentsGateway } from '../../services/gateways/momentsGateway';
import {
  discardNativeMomentMedia,
  pickNativeMedia,
  uploadNativeMomentMedia,
  type NativeStagedMediaHandle,
} from '../../services/mobileCommands';
import { useMomentsDraft, type MomentDraftPayload } from '../../features/social/useMomentsDraft';
import {
  Audience_Kind,
  AudienceSchema,
  type ImageAttachment,
  type Post,
} from '../../gen/proto/domain/social/post_pb';
import { readableErrorMessage } from '../../utils/errorMessage';

const { Text } = Typography;
const MAX_IMAGES_PER_POST = 9;

// ---------------------------------------------------------------------------
// Pending image type (local state only)
// ---------------------------------------------------------------------------

export interface PendingMomentImage {
  localId: string;
  previewUrl: string;
  status: 'uploading' | 'done' | 'error';
  source: 'local-upload' | 'restored-reference';
  stagedHandle?: NativeStagedMediaHandle;
  persistedRef?: string;
  image?: ImageAttachment;
  error?: string;
}

let pendingImageSeq = 0;

function nextPendingImageId(): string {
  pendingImageSeq += 1;
  return `mobile-moment-image-${Date.now()}-${pendingImageSeq}`;
}

function revokePreviewUrl(previewUrl: string): void {
  if (previewUrl.startsWith('blob:')) {
    URL.revokeObjectURL(previewUrl);
  }
}

const CROCKFORD_BASE32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function createMomentMediaRequestId(): string {
  const random = globalThis.crypto.getRandomValues(new Uint8Array(10));
  let time = BigInt(Date.now());
  let encodedTime = '';
  for (let index = 0; index < 10; index += 1) {
    encodedTime = CROCKFORD_BASE32[Number(time & 31n)] + encodedTime;
    time >>= 5n;
  }
  let entropy = 0n;
  for (const byte of random) entropy = (entropy << 8n) | BigInt(byte);
  let encodedEntropy = '';
  for (let index = 0; index < 16; index += 1) {
    encodedEntropy = CROCKFORD_BASE32[Number(entropy & 31n)] + encodedEntropy;
    entropy >>= 5n;
  }
  return encodedTime + encodedEntropy;
}

export function createRestoredMomentImages(
  mediaRefs: readonly string[],
): PendingMomentImage[] {
  return mediaRefs.map((persistedRef) => ({
    localId: nextPendingImageId(),
    previewUrl: persistedRef,
    status: 'done',
    source: 'restored-reference',
    persistedRef,
  }));
}

export function canPublishMoment(
  text: string,
  successfulMediaCount: number,
  uploadingCount: number,
  errorCount: number,
  publishing: boolean,
): boolean {
  return Boolean(text.trim() || successfulMediaCount > 0)
    && uploadingCount === 0
    && errorCount === 0
    && !publishing;
}

export function hasAuthoritativeImageReadback(
  post: Post,
  submitted: readonly PendingMomentImage[],
): boolean {
  if (submitted.length === 0) return true;
  if (post.content.case !== 'imagePost') return false;

  const returnedById = new Map(
    post.content.value.images.map((image) => [image.id || image.url, image]),
  );
  return submitted.every((item) => {
    const submittedId = item.persistedRef ?? item.image?.id ?? item.image?.url;
    if (!submittedId) return false;
    const returned = returnedById.get(submittedId);
    if (!returned) return false;
    if (!item.image?.mediaEncryption) return true;
    return returned.mediaEncryption?.keyB64 === item.image.mediaEncryption.keyB64
      && returned.mediaEncryption?.nonceB64 === item.image.mediaEncryption.nonceB64
      && returned.mediaEncryption?.ciphertextSha256B64
        === item.image.mediaEncryption.ciphertextSha256B64;
  });
}

// ---------------------------------------------------------------------------
// Audience options
// ---------------------------------------------------------------------------

const AUDIENCE_OPTIONS: Array<{ value: number; labelKey: string }> = [
  { value: Audience_Kind.PUBLIC, labelKey: 'mobile.moments.audience.public' },
  { value: Audience_Kind.FOLLOWERS, labelKey: 'mobile.moments.audience.followers' },
  { value: Audience_Kind.SELF, labelKey: 'mobile.moments.audience.self' },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface MomentComposerProps {
  readonly session: MobileAuthSession;
  readonly gateway: MomentsGateway;
  readonly onPublished: (post: Post) => void;
}

type PendingDraftRemoval =
  | { readonly kind: 'discard' }
  | { readonly kind: 'publish'; readonly post: Post };

export function MomentComposer({ session, gateway, onPublished }: MomentComposerProps) {
  const { t } = useMobileI18n();

  const [text, setText] = useState('');
  const [audienceKind, setAudienceKind] = useState<number>(Audience_Kind.PUBLIC);
  const [pendingImages, setPendingImages] = useState<PendingMomentImage[]>([]);
  const [publishing, setPublishing] = useState(false);
  const [pendingDraftRemoval, setPendingDraftRemoval] =
    useState<PendingDraftRemoval | null>(null);
  const pendingImagesRef = useRef<PendingMomentImage[]>([]);

  // Draft management
  const {
    draftRestored,
    hasDraft,
    saveDraft,
    persistDraftNow,
    discardDraft,
    retryPersistence,
    saving,
    discarding,
    persistenceFailure,
  } = useMomentsDraft(
    useCallback((payload: MomentDraftPayload) => {
      setText(payload.text);
      setAudienceKind(payload.audienceKind);
      setPendingImages((current) => {
        current.forEach((item) => revokePreviewUrl(item.previewUrl));
        return createRestoredMomentImages(payload.mediaRefs);
      });
    }, []),
  );

  // Keep ref in sync
  useEffect(() => {
    pendingImagesRef.current = pendingImages;
  }, [pendingImages]);

  // Cleanup preview URLs on unmount
  useEffect(() => () => {
    pendingImagesRef.current.forEach((item) => {
      revokePreviewUrl(item.previewUrl);
      if (item.stagedHandle) {
        void discardNativeMomentMedia({
          stationPeerId: session.stationPeerId,
          actorPtid: session.actorRef.ptid,
          deviceId: session.deviceId,
          lifecycleGeneration: session.lifecycleGeneration,
          sessionId: session.sessionId,
          handle: item.stagedHandle.handle,
        });
      }
    });
  }, [
    session.actorRef.ptid,
    session.deviceId,
    session.lifecycleGeneration,
    session.sessionId,
    session.stationPeerId,
  ]);

  const uploadingCount = useMemo(
    () => pendingImages.filter((item) => item.status === 'uploading').length,
    [pendingImages],
  );
  const errorCount = useMemo(
    () => pendingImages.filter((item) => item.status === 'error').length,
    [pendingImages],
  );
  const successfulMediaRefs = useMemo(
    () => pendingImages
      .filter((item) => item.status === 'done' && item.persistedRef)
      .map((item) => item.persistedRef as string),
    [pendingImages],
  );
  const slotsLeft = MAX_IMAGES_PER_POST - pendingImages.length;
  const canPublish = canPublishMoment(
    text,
    successfulMediaRefs.length,
    uploadingCount,
    errorCount,
    publishing,
  ) && !saving && !discarding && !pendingDraftRemoval;
  const hasComposerDraft = hasDraft || Boolean(text.trim()) || pendingImages.length > 0;
  const editingDisabled = publishing || Boolean(pendingDraftRemoval);

  // Auto-save text, audience, and generated-contract media references.
  useEffect(() => {
    if (!pendingDraftRemoval) {
      saveDraft(text, audienceKind, successfulMediaRefs);
    }
  }, [
    audienceKind,
    pendingDraftRemoval,
    saveDraft,
    successfulMediaRefs,
    text,
  ]);

  const resetComposer = useCallback(() => {
    pendingImagesRef.current.forEach((item) => {
      revokePreviewUrl(item.previewUrl);
      if (item.stagedHandle) {
        void discardNativeMomentMedia({
          stationPeerId: session.stationPeerId,
          actorPtid: session.actorRef.ptid,
          deviceId: session.deviceId,
          lifecycleGeneration: session.lifecycleGeneration,
          sessionId: session.sessionId,
          handle: item.stagedHandle.handle,
        });
      }
    });
    setPendingImages([]);
    setText('');
    setAudienceKind(Audience_Kind.PUBLIC);
    setPendingDraftRemoval(null);
  }, [
    session.actorRef.ptid,
    session.deviceId,
    session.lifecycleGeneration,
    session.sessionId,
    session.stationPeerId,
  ]);

  const completePublishedMoment = useCallback((post: Post) => {
    message.success(t('mobile.moments.published'));
    resetComposer();
    onPublished(post);
  }, [onPublished, resetComposer, t]);

  const handleDiscardDraft = useCallback(async () => {
    setPendingDraftRemoval({ kind: 'discard' });
    if (await discardDraft()) {
      resetComposer();
    }
  }, [discardDraft, resetComposer]);

  const handlePersistenceRetry = useCallback(async () => {
    if (!await retryPersistence()) return;

    if (pendingDraftRemoval?.kind === 'publish') {
      completePublishedMoment(pendingDraftRemoval.post);
    } else if (pendingDraftRemoval?.kind === 'discard') {
      resetComposer();
    }
  }, [
    completePublishedMoment,
    pendingDraftRemoval,
    resetComposer,
    retryPersistence,
  ]);

  // -- Image upload --

  const uploadOne = async (item: PendingMomentImage) => {
    if (!item.stagedHandle) return;
    try {
      const image = await uploadNativeMomentMedia({
        stationPeerId: session.stationPeerId,
        actorPtid: session.actorRef.ptid,
        deviceId: session.deviceId,
        lifecycleGeneration: session.lifecycleGeneration,
        sessionId: session.sessionId,
        handle: item.stagedHandle.handle,
      });
      const persistedRef = image.id || image.url;
      setPendingImages((current) => current.map((candidate) => (
        candidate.localId === item.localId
          ? {
            ...candidate,
            status: 'done',
            persistedRef,
            image,
            error: undefined,
          }
          : candidate
      )));
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      setPendingImages((current) => current.map((candidate) => (
        candidate.localId === item.localId
          ? { ...candidate, status: 'error', error: errorMsg }
          : candidate
      )));
    }
  };

  const handlePickImages = async () => {
    if (editingDisabled) return;
    if (pendingImages.some((item) => item.source === 'restored-reference')) {
      message.warning(t('mobile.moments.composer.mixedMediaUnavailable'));
      return;
    }
    if (slotsLeft <= 0) {
      message.warning(t('mobile.moments.imageMaxReached', { max: MAX_IMAGES_PER_POST }));
      return;
    }
    let selection: Awaited<ReturnType<typeof pickNativeMedia>>;
    try {
      selection = await pickNativeMedia({
        stationPeerId: session.stationPeerId,
        actorPtid: session.actorRef.ptid,
        sessionId: session.sessionId,
        requestId: createMomentMediaRequestId(),
        surfaceKind: 'moment_media',
        capability: 'photo_library',
        deadlineMs: Date.now() + 5 * 60 * 1000,
        acceptedMediaKinds: ['image'],
        maxItemCount: slotsLeft,
        maxTotalBytes: 30 * 1024 * 1024,
      });
    } catch (error) {
      message.error(readableErrorMessage(error, 'moment_media_pick_failed'));
      return;
    }
    if (selection.outcome === 'cancelled') return;
    if (selection.outcome !== 'selected') {
      message.error(selection.errorCode || `moment_media_${selection.outcome}`);
      return;
    }
    const drafts = selection.items.slice(0, slotsLeft).map((stagedHandle) => ({
      localId: nextPendingImageId(),
      stagedHandle,
      previewUrl: '',
      status: 'uploading' as const,
      source: 'local-upload' as const,
    }));
    setPendingImages((current) => [...current, ...drafts]);
    for (const item of drafts) {
      await uploadOne(item);
    }
  };

  const removeImage = (localId: string) => {
    if (editingDisabled) return;
    setPendingImages((current) => {
      const removed = current.find((item) => item.localId === localId);
      if (removed) {
        revokePreviewUrl(removed.previewUrl);
        if (removed.stagedHandle) {
          void discardNativeMomentMedia({
            stationPeerId: session.stationPeerId,
            actorPtid: session.actorRef.ptid,
            deviceId: session.deviceId,
            lifecycleGeneration: session.lifecycleGeneration,
            sessionId: session.sessionId,
            handle: removed.stagedHandle.handle,
          });
        }
      }
      return current.filter((item) => item.localId !== localId);
    });
  };

  const retryImage = (localId: string) => {
    if (editingDisabled) return;
    const target = pendingImages.find((item) => item.localId === localId);
    if (!target?.stagedHandle) return;
    setPendingImages((current) => current.map((item) => (
      item.localId === localId ? { ...item, status: 'uploading', error: undefined } : item
    )));
    void uploadOne({ ...target, status: 'uploading', error: undefined });
  };

  // -- Publish --

  const publish = async () => {
    const trimmed = text.trim();
    const completedImages = pendingImages.filter(
      (item) => item.status === 'done' && item.persistedRef,
    );
    if (!trimmed && completedImages.length === 0) {
      message.warning(t('mobile.moments.emptyError'));
      return;
    }
    if (uploadingCount > 0) {
      message.warning(t('mobile.moments.imageUploading'));
      return;
    }
    if (errorCount > 0) {
      message.warning(t('mobile.moments.imageHasErrors'));
      return;
    }
    if (!await persistDraftNow(text, audienceKind, successfulMediaRefs)) {
      return;
    }

    const images = completedImages
      .filter((item) => item.source === 'local-upload' && item.image)
      .map((item) => item.image as ImageAttachment);
    const imageIds = completedImages.map((item) => item.persistedRef as string);
    const hasRestoredReferences = completedImages.some(
      (item) => item.source === 'restored-reference',
    );
    const audience = create(AudienceSchema, { kind: audienceKind as Audience_Kind });

    setPublishing(true);
    let result: Awaited<ReturnType<MomentsGateway['createMoment']>>;
    try {
      result = await gateway.createMoment(
        images.length > 0
          || imageIds.length > 0
          ? {
            kind: 'image',
            text: trimmed,
            audience,
            imageIds,
            ...(hasRestoredReferences ? {} : { images }),
          }
          : { kind: 'text', text: trimmed, audience },
      );
    } catch (error) {
      setPublishing(false);
      message.error(readableErrorMessage(error, 'moment_publish_failed'));
      return;
    }

    if (
      result.ok
      && result.data.post
      && hasAuthoritativeImageReadback(result.data.post, completedImages)
    ) {
      const publishedPost = result.data.post;
      setPendingDraftRemoval({ kind: 'publish', post: publishedPost });
      const removed = await discardDraft();
      setPublishing(false);
      if (removed) completePublishedMoment(publishedPost);
    } else if (result.ok) {
      setPublishing(false);
      message.error(t('mobile.moments.imageReadbackFailed'));
    } else if (!result.ok) {
      setPublishing(false);
      message.error(result.error.message);
    }
  };

  return (
    <section className="moments-composer-card">
      {draftRestored && (
        <div className="moments-draft-banner">
          <Save size={14} />
          <Text className="moments-draft-text">{t('mobile.moments.composer.draftRestored')}</Text>
        </div>
      )}

      {persistenceFailure && (
        <div
          className="moments-state moments-state--error"
          data-draft-failure={persistenceFailure.operation}
          role="alert"
        >
          <AlertTriangle size={18} aria-hidden="true" />
          <Text type="secondary">
            {t('common.state.error')}: {persistenceFailure.message}
          </Text>
          <Button
            size="small"
            icon={<RotateCcw size={14} />}
            loading={saving || discarding}
            onClick={() => void handlePersistenceRetry()}
          >
            {t('common.action.retry')}
          </Button>
        </div>
      )}

      <div className="moments-composer-audience">
        <Text className="moments-composer-eyebrow">{t('mobile.moments.audience.label')}</Text>
        <Select
          value={audienceKind}
          onChange={(value: number) => setAudienceKind(value)}
          size="small"
          style={{ minWidth: 120 }}
          disabled={editingDisabled}
        >
          {AUDIENCE_OPTIONS.map((opt) => (
            <Select.Option key={opt.value} value={opt.value}>
              {t(opt.labelKey)}
            </Select.Option>
          ))}
        </Select>
      </div>

      <Input.TextArea
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder={t('mobile.moments.placeholder')}
        autoSize={{ minRows: 4, maxRows: 8 }}
        maxLength={5000}
        showCount
        disabled={editingDisabled}
      />

      {pendingImages.length > 0 && (
        <div className="moments-image-grid">
          {pendingImages.map((item) => (
            <div className={`moments-image-tile ${item.status}`} key={item.localId}>
              {item.source === 'local-upload' ? (
                <div className="moments-restored-image-reference">
                  <ImagePlus size={22} />
                  <span>{item.stagedHandle?.mimeType}</span>
                </div>
              ) : (
                <div className="moments-restored-image-reference">
                  <ImagePlus size={22} />
                  <span>{t('mobile.moments.composer.restoredImageReference')}</span>
                </div>
              )}
              <div className="moments-image-status">
                {item.status === 'uploading' && t('mobile.moments.imageUploadingShort')}
                {item.status === 'done' && t('mobile.moments.imageReady')}
                {item.status === 'error' && t('mobile.moments.imageFailed')}
              </div>
              <div className="moments-image-actions">
                {item.status === 'error' && item.stagedHandle && (
                  <button type="button" disabled={editingDisabled} onClick={() => retryImage(item.localId)} aria-label={t('mobile.moments.retryImage')}>
                    <RotateCcw size={14} />
                  </button>
                )}
                <button type="button" disabled={editingDisabled} onClick={() => removeImage(item.localId)} aria-label={t('mobile.moments.removeImage')}>
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="moments-composer-actions">
        {hasComposerDraft && (
          <Popconfirm
            title={t('mobile.moments.composer.rollbackConfirm')}
            okText={t('mobile.moments.composer.rollbackYes')}
            cancelText={t('mobile.moments.composer.rollbackNo')}
            onConfirm={handleDiscardDraft}
            disabled={editingDisabled}
          >
            <Button
              danger
              icon={<Trash2 size={16} />}
              disabled={editingDisabled}
              loading={discarding}
            >
              {t('mobile.moments.composer.discardDraft')}
            </Button>
          </Popconfirm>
        )}
        <Button
          icon={<ImagePlus size={16} />}
          onClick={() => void handlePickImages()}
          disabled={slotsLeft <= 0 || editingDisabled}
        >
          {t('mobile.moments.attachImage', { count: pendingImages.length, max: MAX_IMAGES_PER_POST })}
        </Button>
        <Button
          type="primary"
          icon={<Send size={16} />}
          onClick={() => void publish()}
          disabled={!canPublish}
          loading={publishing}
        >
          {t('mobile.moments.publish')}
        </Button>
      </div>
    </section>
  );
}
