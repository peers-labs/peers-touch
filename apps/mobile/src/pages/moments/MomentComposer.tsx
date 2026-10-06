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
import { useMobileI18n } from '../../app/mobileI18n';
import type { MobileAuthSession } from '../../features/auth/authSession';
import type { SocialIntentPort } from '../../features/social/socialIntents';
import {
  discardNativeMomentMedia,
  pickNativeMedia,
  uploadNativeMomentMedia,
  type NativeStagedMediaHandle,
} from '../../services/mobileCommands';
import { useMomentsDraft, type MomentDraftPayload } from '../../features/social/useMomentsDraft';
import {
  type Audience,
  type ImageAttachment,
  type Post,
} from '../../gen/proto/domain/social/post_pb';
import { readableErrorMessage } from '../../utils/errorMessage';
import {
  SOCIAL_AUDIENCE_CHOICES,
  buildSocialAudience,
  isPublicSocialAudience,
  socialAudienceChoiceFromAudience,
  socialAudienceTargetFromAudience,
  type SocialAudienceChoice,
} from '../../features/social/socialAudience';
import { useSocialCirclesStore } from '../../features/social/socialCircles';
import { useGroupStore } from '../../features/group/groupStore';

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
  return mediaRefs.map((persistedRef) => {
    const staged = decodeStagedMediaRef(persistedRef);
    return {
      localId: nextPendingImageId(),
      previewUrl: persistedRef,
      status: 'done',
      source: 'restored-reference',
      persistedRef,
      ...(staged ? {
        stagedHandle: {
          handle: staged.handle,
          mediaKind: 'image' as const,
          mimeType: staged.mimeType,
          byteLength: 0,
          sha256Base64: '',
        },
      } : {}),
    };
  });
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

interface StagedMediaReference {
  readonly handle: string;
  readonly attachmentId: string;
  readonly mimeType: string;
}

const STAGED_MEDIA_PREFIX = 'native-moment-v1:';

function encodeStagedMediaRef(
  stagedHandle: NativeStagedMediaHandle,
  attachmentId: string,
): string {
  return `${STAGED_MEDIA_PREFIX}${encodeURIComponent(stagedHandle.handle)}:${encodeURIComponent(
    attachmentId,
  )}:${encodeURIComponent(stagedHandle.mimeType)}`;
}

function decodeStagedMediaRef(reference: string): StagedMediaReference | null {
  if (!reference.startsWith(STAGED_MEDIA_PREFIX)) return null;
  const fields = reference.slice(STAGED_MEDIA_PREFIX.length).split(':');
  if (fields.length !== 3 || fields.some((field) => !field)) return null;
  return {
    handle: decodeURIComponent(fields[0]),
    attachmentId: decodeURIComponent(fields[1]),
    mimeType: decodeURIComponent(fields[2]),
  };
}

function actorPtidsFromInput(value: string): string[] {
  return value.split(/[\s,]+/).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface MomentComposerProps {
  readonly session: MobileAuthSession;
  readonly intents: Pick<SocialIntentPort, 'publishMoment'>;
  readonly onPublished: () => void;
}

type PendingDraftRemoval =
  | { readonly kind: 'discard' }
  | { readonly kind: 'publish' };

export function MomentComposer({ session, intents, onPublished }: MomentComposerProps) {
  const { t } = useMobileI18n();

  const [text, setText] = useState('');
  const [audienceChoice, setAudienceChoice] =
    useState<SocialAudienceChoice>('PUBLIC');
  const [circleId, setCircleId] = useState('');
  const [groupConversationId, setGroupConversationId] = useState('');
  const [actorPtidsInput, setActorPtidsInput] = useState('');
  const [pendingImages, setPendingImages] = useState<PendingMomentImage[]>([]);
  const [publishing, setPublishing] = useState(false);
  const [pendingDraftRemoval, setPendingDraftRemoval] =
    useState<PendingDraftRemoval | null>(null);
  const pendingImagesRef = useRef<PendingMomentImage[]>([]);
  const draftIdRef = useRef(globalThis.crypto.randomUUID());
  const circles = useSocialCirclesStore((state) => state.circles);
  const groups = useGroupStore((state) => state.groups);
  const audience = useMemo<Audience | null>(() => {
    try {
      return buildSocialAudience(audienceChoice, {
        circleId,
        groupConversationId,
        actorPtids: actorPtidsFromInput(actorPtidsInput),
      });
    } catch {
      return null;
    }
  }, [actorPtidsInput, audienceChoice, circleId, groupConversationId]);

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
      const restoredChoice = socialAudienceChoiceFromAudience(payload.audience);
      const restoredTarget = socialAudienceTargetFromAudience(payload.audience);
      setAudienceChoice(restoredChoice);
      setCircleId(restoredTarget.circleId ?? '');
      setGroupConversationId(restoredTarget.groupConversationId ?? '');
      setActorPtidsInput((restoredTarget.actorPtids ?? []).join(', '));
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
  ) && Boolean(audience) && !saving && !discarding && !pendingDraftRemoval;
  const hasComposerDraft = hasDraft || Boolean(text.trim()) || pendingImages.length > 0;
  const editingDisabled = publishing || Boolean(pendingDraftRemoval);

  // Auto-save text, audience, and generated-contract media references.
  useEffect(() => {
    if (!pendingDraftRemoval && audience) {
      saveDraft(text, audience, successfulMediaRefs);
    }
  }, [
    audience,
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
    setAudienceChoice('PUBLIC');
    setCircleId('');
    setGroupConversationId('');
    setActorPtidsInput('');
    draftIdRef.current = globalThis.crypto.randomUUID();
    setPendingDraftRemoval(null);
  }, [
    session.actorRef.ptid,
    session.deviceId,
    session.lifecycleGeneration,
    session.sessionId,
    session.stationPeerId,
  ]);

  const completePublishedMoment = useCallback(() => {
    message.success(t('mobile.moments.published'));
    resetComposer();
    onPublished();
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
      completePublishedMoment();
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

  const uploadPublicImage = async (
    item: PendingMomentImage,
  ): Promise<PendingMomentImage> => {
    if (!item.stagedHandle) return item;
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
      const uploaded = {
        ...item,
        status: 'done' as const,
        persistedRef,
        image,
        stagedHandle: undefined,
        error: undefined,
      };
      setPendingImages((current) => current.map((candidate) => (
        candidate.localId === item.localId
          ? uploaded
          : candidate
      )));
      return uploaded;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      setPendingImages((current) => current.map((candidate) => (
        candidate.localId === item.localId
          ? { ...candidate, status: 'error', error: errorMsg }
          : candidate
      )));
      throw error;
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
    const drafts = selection.items.slice(0, slotsLeft).map((stagedHandle) => {
      const localId = nextPendingImageId();
      const attachmentId = globalThis.crypto.randomUUID();
      return {
        localId,
        stagedHandle,
        previewUrl: '',
        status: 'done' as const,
        source: 'local-upload' as const,
        persistedRef: encodeStagedMediaRef(stagedHandle, attachmentId),
      };
    });
    setPendingImages((current) => [...current, ...drafts]);
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
      item.localId === localId ? { ...item, status: 'done', error: undefined } : item
    )));
  };

  // -- Publish --

  const publish = async () => {
    const trimmed = text.trim();
    let completedImages = pendingImages.filter(
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
    if (!audience) {
      message.error(t('mobile.moments.audience.targetRequired'));
      return;
    }
    if (!await persistDraftNow(text, audience, successfulMediaRefs)) {
      return;
    }

    setPublishing(true);
    if (isPublicSocialAudience(audience)) {
      try {
        completedImages = await Promise.all(
          completedImages.map((item) => uploadPublicImage(item)),
        );
      } catch (error) {
        setPublishing(false);
        message.error(readableErrorMessage(error, 'moment_media_upload_failed'));
        return;
      }
      const uploadedRefs = completedImages
        .map((item) => item.persistedRef)
        .filter((reference): reference is string => Boolean(reference));
      if (!await persistDraftNow(text, audience, uploadedRefs)) {
        setPublishing(false);
        return;
      }
    }

    const images = completedImages
      .filter((item) => item.image)
      .map((item) => item.image as ImageAttachment);
    const imageIds = completedImages.map((item) => item.persistedRef as string);
    const privateFiles = completedImages.map((item) => {
      const reference = item.persistedRef
        ? decodeStagedMediaRef(item.persistedRef)
        : null;
      return reference
        ? { handle: reference.handle, attachmentId: reference.attachmentId }
        : null;
    });
    if (
      !isPublicSocialAudience(audience)
      && privateFiles.some((file) => file === null)
    ) {
      setPublishing(false);
      message.error(t('mobile.moments.audience.privateMediaUnavailable'));
      return;
    }

    let result: Awaited<ReturnType<SocialIntentPort['publishMoment']>>;
    try {
      result = await intents.publishMoment({
        draftId: draftIdRef.current,
        draftRevision: 1,
        draft: completedImages.length > 0
          ? {
            kind: 'image',
            text: trimmed,
            audience,
            imageIds,
            ...(images.length === completedImages.length ? { images } : {}),
          }
          : { kind: 'text', text: trimmed, audience },
        ...(privateFiles.length > 0
          ? { privateFiles: privateFiles.filter((file) => file !== null) }
          : {}),
      });
    } catch (error) {
      setPublishing(false);
      message.error(readableErrorMessage(error, 'moment_publish_failed'));
      return;
    }

    const published = result.route === 'PUBLIC'
      ? result.outcome.ok
        && Boolean(result.outcome.data.post)
        && hasAuthoritativeImageReadback(
          result.outcome.data.post as Post,
          completedImages,
        )
      : result.projection.state === 'PUBLISHED'
        && Boolean(result.projection.postId);

    if (published) {
      setPendingDraftRemoval({ kind: 'publish' });
      const removed = await discardDraft();
      setPublishing(false);
      if (removed) completePublishedMoment();
    } else if (result.route === 'PUBLIC' && result.outcome.ok) {
      setPublishing(false);
      message.error(t('mobile.moments.imageReadbackFailed'));
    } else if (result.route === 'PUBLIC' && !result.outcome.ok) {
      setPublishing(false);
      message.error(result.outcome.error.message);
    } else if (result.route === 'PRIVATE') {
      setPublishing(false);
      message.error(
        result.projection.state === 'UNKNOWN_OUTCOME'
          ? t('mobile.moments.publishUnknown')
          : t('mobile.moments.publishPrivateFailed'),
      );
    }
  };

  return (
    <section
      className="moments-composer-card"
      data-acceptance-id="social-composer"
      data-audience-choice={audienceChoice}
    >
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
          value={audienceChoice}
          data-acceptance-id="social-audience-select"
          onChange={(value: SocialAudienceChoice) => {
            setAudienceChoice(value);
            if (value === 'CIRCLE' && !circleId && circles[0]) {
              setCircleId(circles[0].id.toString());
            }
            if (value === 'GROUP' && !groupConversationId && groups[0]) {
              setGroupConversationId(groups[0].ulid);
            }
          }}
          size="small"
          style={{ minWidth: 180 }}
          disabled={editingDisabled}
        >
          {SOCIAL_AUDIENCE_CHOICES.map((option) => (
            <Select.Option key={option.id} value={option.id}>
              {t(option.labelKey)}
            </Select.Option>
          ))}
        </Select>
        {audienceChoice === 'CIRCLE' && (
          <Select
            value={circleId || undefined}
            data-acceptance-id="social-audience-circle"
            onChange={setCircleId}
            placeholder={t('mobile.moments.audience.selectCircle')}
            disabled={editingDisabled}
            style={{ minWidth: 180 }}
          >
            {circles.map((circle) => (
              <Select.Option key={circle.id.toString()} value={circle.id.toString()}>
                {circle.name}
              </Select.Option>
            ))}
          </Select>
        )}
        {audienceChoice === 'GROUP' && (
          <Select
            value={groupConversationId || undefined}
            data-acceptance-id="social-audience-group"
            onChange={setGroupConversationId}
            placeholder={t('mobile.moments.audience.selectGroup')}
            disabled={editingDisabled}
            style={{ minWidth: 180 }}
          >
            {groups.map((group) => (
              <Select.Option key={group.ulid} value={group.ulid}>
                {group.name || group.ulid}
              </Select.Option>
            ))}
          </Select>
        )}
        {(audienceChoice === 'CUSTOM_ALLOW'
          || audienceChoice === 'CUSTOM_DENY'
          || audienceChoice === 'DIRECT') && (
          <Input
            value={actorPtidsInput}
            data-acceptance-id="social-audience-actors"
            onChange={(event) => setActorPtidsInput(event.target.value)}
            placeholder={t(
              audienceChoice === 'DIRECT'
                ? 'mobile.moments.audience.directPlaceholder'
                : 'mobile.moments.audience.recipientsPlaceholder',
            )}
            disabled={editingDisabled}
            status={audience ? undefined : 'error'}
          />
        )}
      </div>

      {!audience && (
        <Text type="danger" role="alert">
          {t('mobile.moments.audience.targetRequired')}
        </Text>
      )}

      <Input.TextArea
        value={text}
        data-acceptance-id="social-composer-text"
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
          data-acceptance-id="social-composer-publish"
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
