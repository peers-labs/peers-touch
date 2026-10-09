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

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { Button, message, Typography } from 'antd';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronRight,
  Globe2,
  LockKeyhole,
  RotateCcw,
  ShieldCheck,
  UserMinus,
  UserRound,
  UsersRound,
  X,
  type LucideIcon,
} from 'lucide-react';

import { useLifecycleKernel } from '../../app/lifecycle';
import { useVisualKeyboardOverlap } from '../../app/layout/useVisualKeyboardOverlap';
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
import { useSocialStore } from '../../features/social/socialStore';
import {
  MomentAudienceTargetPicker,
  type MomentAudienceTargetChoice,
} from './MomentAudienceTargetPicker';
import './MomentComposer.css';

const { Text } = Typography;
const MAX_IMAGES_PER_POST = 9;
const VISIBLE_SOCIAL_AUDIENCE_CHOICES = SOCIAL_AUDIENCE_CHOICES.filter(
  (choice) => choice.id !== 'DIRECT',
);
const MOMENT_MEDIA_PREVIEW_GRADIENTS = [
  'linear-gradient(135deg, #fccb90 0%, #d57eeb 100%)',
  'linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%)',
  'linear-gradient(135deg, #e0c3fc 0%, #8ec5fc 100%)',
] as const;

function isMomentAudienceTargetChoice(
  choice: SocialAudienceChoice,
): choice is MomentAudienceTargetChoice {
  return choice === 'CIRCLE'
    || choice === 'GROUP'
    || choice === 'CUSTOM_ALLOW'
    || choice === 'CUSTOM_DENY';
}

const SOCIAL_AUDIENCE_PRESENTATION: Record<
  SocialAudienceChoice,
  { readonly detailKey: string; readonly icon: LucideIcon }
> = {
  PUBLIC: {
    detailKey: 'mobile.moments.audience.publicDescription',
    icon: Globe2,
  },
  FOLLOWERS: {
    detailKey: 'mobile.moments.audience.followersDescription',
    icon: UsersRound,
  },
  FRIENDS: {
    detailKey: 'mobile.moments.audience.friendsDescription',
    icon: ShieldCheck,
  },
  CIRCLE: {
    detailKey: 'mobile.moments.audience.circleDescription',
    icon: UsersRound,
  },
  GROUP: {
    detailKey: 'mobile.moments.audience.groupDescription',
    icon: UsersRound,
  },
  CUSTOM_ALLOW: {
    detailKey: 'mobile.moments.audience.customAllowDescription',
    icon: UserRound,
  },
  CUSTOM_DENY: {
    detailKey: 'mobile.moments.audience.customDenyDescription',
    icon: UserMinus,
  },
  DIRECT: {
    detailKey: 'mobile.moments.audience.directDescription',
    icon: UserRound,
  },
  SELF: {
    detailKey: 'mobile.moments.audience.selfDescription',
    icon: LockKeyhole,
  },
};

export interface MomentComposerStyle extends CSSProperties {
  '--moment-composer-keyboard-overlap': string;
}

export function createMomentComposerStyle(
  keyboardOverlapHeight: number,
): MomentComposerStyle {
  return {
    '--moment-composer-keyboard-overlap': `${keyboardOverlapHeight}px`,
  };
}

export interface MomentMediaPreviewStyle extends CSSProperties {
  '--moment-media-preview-bg': string;
}

export function createMomentMediaPreviewStyle(
  index: number,
): MomentMediaPreviewStyle {
  return {
    '--moment-media-preview-bg':
      MOMENT_MEDIA_PREVIEW_GRADIENTS[
        index % MOMENT_MEDIA_PREVIEW_GRADIENTS.length
      ],
  };
}

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
  audienceReady: boolean,
): boolean {
  return Boolean(text.trim() || successfulMediaCount > 0)
    && audienceReady
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
  readonly pickOnOpen?: boolean;
  readonly onTargetVisibilityChange?: (visible: boolean) => void;
  readonly onPublished: () => void;
  readonly onClose: () => void;
}

type PendingDraftRemoval = { readonly kind: 'publish' };

export function MomentComposer({
  session,
  intents,
  pickOnOpen = false,
  onTargetVisibilityChange,
  onPublished,
  onClose,
}: MomentComposerProps) {
  const { t } = useMobileI18n();
  const lifecycle = useLifecycleKernel();
  const keyboardOverlapHeight = useVisualKeyboardOverlap();
  const composerStyle = useMemo(
    () => createMomentComposerStyle(keyboardOverlapHeight),
    [keyboardOverlapHeight],
  );

  const [text, setText] = useState('');
  const [audienceChoice, setAudienceChoice] =
    useState<SocialAudienceChoice>('PUBLIC');
  const [circleId, setCircleId] = useState('');
  const [groupConversationId, setGroupConversationId] = useState('');
  const [actorPtidsInput, setActorPtidsInput] = useState('');
  const [audienceActorLabels, setAudienceActorLabels] = useState<
    Record<string, string>
  >({});
  const [pendingImages, setPendingImages] = useState<PendingMomentImage[]>([]);
  const [audienceOpen, setAudienceOpen] = useState(false);
  const [targetAudienceChoice, setTargetAudienceChoice] =
    useState<MomentAudienceTargetChoice | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [pendingDraftRemoval, setPendingDraftRemoval] =
    useState<PendingDraftRemoval | null>(null);
  const pendingImagesRef = useRef<PendingMomentImage[]>([]);
  const initialPickStartedRef = useRef(false);
  const draftIdRef = useRef(globalThis.crypto.randomUUID());
  const circles = useSocialCirclesStore((state) => state.circles);
  const messagingConversations = useSocialStore(
    (state) => state.messagingConversations,
  );
  const groups = useMemo(
    () => messagingConversations.filter(
      (conversation) => conversation.active && conversation.kind === 2,
    ),
    [messagingConversations],
  );
  const selectedActorPtids = useMemo(
    () => actorPtidsFromInput(actorPtidsInput),
    [actorPtidsInput],
  );
  const audience = useMemo<Audience | null>(() => {
    try {
      return buildSocialAudience(audienceChoice, {
        circleId,
        groupConversationId,
        actorPtids: selectedActorPtids,
      });
    } catch {
      return null;
    }
  }, [
    audienceChoice,
    circleId,
    groupConversationId,
    selectedActorPtids,
  ]);

  // Draft management
  const {
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
      const restoredActorPtids = restoredTarget.actorPtids ?? [];
      setActorPtidsInput(restoredActorPtids.join(', '));
      setAudienceActorLabels(Object.fromEntries(
        restoredActorPtids.map((actorPtid) => [actorPtid, actorPtid]),
      ));
      setPendingImages((current) => {
        current.forEach((item) => revokePreviewUrl(item.previewUrl));
        const restoredImages = createRestoredMomentImages(payload.mediaRefs);
        pendingImagesRef.current = restoredImages;
        return restoredImages;
      });
    }, []),
  );

  // Keep ref in sync
  useEffect(() => {
    pendingImagesRef.current = pendingImages;
  }, [pendingImages]);

  useEffect(
    () => () => onTargetVisibilityChange?.(false),
    [onTargetVisibilityChange],
  );

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
    Boolean(audience),
  ) && !saving && !discarding && !pendingDraftRemoval;
  const editingDisabled = publishing || Boolean(pendingDraftRemoval);
  const audienceLabel = t(
    SOCIAL_AUDIENCE_CHOICES.find((choice) => choice.id === audienceChoice)?.labelKey
      ?? 'mobile.moments.audience.public',
  );
  const audiencePresentation = SOCIAL_AUDIENCE_PRESENTATION[audienceChoice];
  const AudienceIcon = audiencePresentation.icon;
  const selectedCircle = circles.find(
    (circle) => circle.id.toString() === circleId,
  );
  const selectedGroup = groups.find(
    (group) => group.conversationId === groupConversationId,
  );
  const selectedActorNames = selectedActorPtids.map(
    (actorPtid) => audienceActorLabels[actorPtid] ?? actorPtid,
  );
  const audienceDetail = audienceChoice === 'CIRCLE' && selectedCircle
    ? `${selectedCircle.name} · ${t('mobile.social.circles.memberCount', {
        count: selectedCircle.memberCount.toString(),
      })}`
    : audienceChoice === 'GROUP' && selectedGroup
      ? `${selectedGroup.name || selectedGroup.conversationId} · ${t(
          'mobile.moments.audience.activeMembers',
          { count: selectedGroup.memberPtids.length },
        )}`
      : audienceChoice === 'CUSTOM_ALLOW' && selectedActorNames.length > 0
        ? selectedActorNames.join(', ')
        : audienceChoice === 'CUSTOM_DENY' && selectedActorNames.length > 0
          ? t('mobile.moments.audience.followersExceptSelection', {
              names: selectedActorNames.join(', '),
            })
          : t(audiencePresentation.detailKey);

  // Auto-save text, audience, and generated-contract media references.
  useEffect(() => {
    if (
      lifecycle.phase === 'ACTIVE'
      && !pendingDraftRemoval
      && audience
    ) {
      saveDraft(text, audience, successfulMediaRefs);
    }
  }, [
    audience,
    lifecycle.phase,
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
    setAudienceActorLabels({});
    setAudienceOpen(false);
    setTargetAudienceChoice(null);
    onTargetVisibilityChange?.(false);
    draftIdRef.current = globalThis.crypto.randomUUID();
    setPendingDraftRemoval(null);
  }, [
    session.actorRef.ptid,
    session.deviceId,
    session.lifecycleGeneration,
    session.sessionId,
    session.stationPeerId,
    onTargetVisibilityChange,
  ]);

  const completePublishedMoment = useCallback(() => {
    message.success(t('mobile.moments.published'));
    resetComposer();
    onPublished();
  }, [onPublished, resetComposer, t]);

  const handlePersistenceRetry = useCallback(async () => {
    if (!await retryPersistence()) return;

    if (pendingDraftRemoval?.kind === 'publish') {
      completePublishedMoment();
    }
  }, [
    completePublishedMoment,
    pendingDraftRemoval,
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

  useEffect(() => {
    if (!pickOnOpen || initialPickStartedRef.current) return undefined;
    initialPickStartedRef.current = true;
    const timer = setTimeout(() => {
      if (pendingImagesRef.current.length === 0) {
        void handlePickImages();
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [pickOnOpen]);

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

  if (targetAudienceChoice) {
    return (
      <MomentAudienceTargetPicker
        choice={targetAudienceChoice}
        selectedActorLabels={audienceActorLabels}
        selectedActorPtids={selectedActorPtids}
        onBack={() => {
          onTargetVisibilityChange?.(false);
          setTargetAudienceChoice(null);
          setAudienceOpen(true);
        }}
        onSelectCircle={(nextCircleId) => {
          setCircleId(nextCircleId);
          setAudienceChoice('CIRCLE');
          onTargetVisibilityChange?.(false);
          setTargetAudienceChoice(null);
          setAudienceOpen(false);
        }}
        onSelectGroup={(nextGroupConversationId) => {
          setGroupConversationId(nextGroupConversationId);
          setAudienceChoice('GROUP');
          onTargetVisibilityChange?.(false);
          setTargetAudienceChoice(null);
          setAudienceOpen(false);
        }}
        onSelectActors={(actorPtids, actorLabels) => {
          setActorPtidsInput(actorPtids.join(', '));
          setAudienceActorLabels({ ...actorLabels });
          setAudienceChoice(targetAudienceChoice);
          onTargetVisibilityChange?.(false);
          setTargetAudienceChoice(null);
          setAudienceOpen(false);
        }}
      />
    );
  }

  return (
    <div
      className="moments-sheet-backdrop moments-composer-backdrop moment-composer-overlay"
      data-product-surface="moments.composer"
      data-keyboard-overlap={keyboardOverlapHeight}
      role="presentation"
      style={composerStyle}
    >
      <section
        className="moments-bottom-sheet moments-composer-card moment-composer-surface"
        data-acceptance-id="social-composer"
        data-audience-choice={audienceChoice}
        role="dialog"
        aria-modal="true"
        aria-label={t('mobile.moments.newPost')}
        aria-busy={publishing}
      >
        <div className="moments-sheet-handle" />
        <header className="moments-sheet-header moment-composer-header">
          <button
            type="button"
            aria-label={t('common.action.close')}
            disabled={editingDisabled}
            onClick={onClose}
          >
            <X size={20} />
          </button>
          <h2>{t('mobile.moments.newPost')}</h2>
          <button
            type="button"
            className="primary"
            data-acceptance-id="social-composer-publish"
            disabled={!canPublish}
            aria-busy={publishing}
            onClick={() => void publish()}
          >
            {t('mobile.moments.publish')}
          </button>
        </header>

        {persistenceFailure && (
          <div
            className="moments-state moments-state--error"
            data-draft-failure={persistenceFailure.operation}
            data-product-surface="moments.composer-draft-failed"
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

        <textarea
          className="moment-composer-textarea"
          value={text}
          data-acceptance-id="social-composer-text"
          aria-label={t('mobile.moments.placeholder')}
          onChange={(event) => setText(event.target.value)}
          placeholder={t('mobile.moments.placeholder')}
          maxLength={5000}
          disabled={editingDisabled}
        />

        {pendingImages.length > 0 && (
          <div
            className="moment-composer-media"
            aria-label={t('mobile.moments.composer.restoredImageReference')}
          >
          {pendingImages.map((item, index) => (
            <div
              className={`moment-composer-media-preview ${item.status}`}
              data-product-surface={`moments.composer-media-${
                item.status === 'done' ? 'ready' : item.status
              }`}
              key={item.localId}
              style={createMomentMediaPreviewStyle(index)}
            >
              {item.status === 'error' && item.stagedHandle && (
                <button
                  type="button"
                  className="moment-composer-media-retry"
                  disabled={editingDisabled}
                  onClick={() => retryImage(item.localId)}
                  aria-label={t('mobile.moments.retryImage')}
                >
                  <RotateCcw size={15} />
                </button>
              )}
              <button
                type="button"
                className="moment-composer-media-remove"
                disabled={editingDisabled}
                onClick={() => removeImage(item.localId)}
                aria-label={t('mobile.moments.removeImage')}
              >
                <X size={15} />
              </button>
            </div>
          ))}
          </div>
        )}

        <button
          type="button"
          className="moment-composer-audience-row"
          data-acceptance-id="social-audience-select"
          data-product-surface="moments.composer-audience"
          disabled={editingDisabled}
          onClick={() => setAudienceOpen(true)}
        >
          <span className="moment-composer-audience-icon">
            <AudienceIcon size={17} />
          </span>
          <span className="moment-composer-audience-copy">
            <strong>{audienceLabel}</strong>
            <small>{audienceDetail}</small>
          </span>
          <ChevronRight size={17} />
        </button>

        {!audience && (
          <Text
            className="moment-composer-validation"
            type="danger"
            role="alert"
          >
            {t('mobile.moments.audience.targetRequired')}
          </Text>
        )}

        <div className="moment-composer-meta">
          <span>
            <ShieldCheck size={14} />
            {t('mobile.moments.composer.privacyHint')}
          </span>
          <span>{text.length}/5000</span>
        </div>
      </section>

      {audienceOpen && (
        <div className="moments-sheet-backdrop moments-audience-backdrop" role="presentation">
          <section
            className="moments-bottom-sheet moments-audience-sheet"
            role="dialog"
            aria-modal="true"
            aria-label={t('mobile.moments.audience.label')}
          >
            <div className="moments-sheet-handle" />
            <header className="moments-sheet-header">
              <button
                type="button"
                aria-label={t('common.action.back')}
                onClick={() => setAudienceOpen(false)}
              >
                <ArrowLeft size={20} />
              </button>
              <h2>{t('mobile.moments.audience.label')}</h2>
              <span />
            </header>
            <p className="moment-audience-sheet-copy">
              {t('mobile.moments.audience.sheetDescription')}
            </p>
            <div className="moments-audience-list">
              {VISIBLE_SOCIAL_AUDIENCE_CHOICES.map((option) => {
                const presentation = SOCIAL_AUDIENCE_PRESENTATION[option.id];
                const OptionIcon = presentation.icon;
                return (
                  <button
                    key={option.id}
                    type="button"
                    className="moments-choice-row moment-audience-choice"
                    data-audience-option={option.id}
                    onClick={() => {
                      if (isMomentAudienceTargetChoice(option.id)) {
                        setAudienceOpen(false);
                        onTargetVisibilityChange?.(true);
                        setTargetAudienceChoice(option.id);
                        return;
                      }
                      setAudienceChoice(option.id);
                      setAudienceOpen(false);
                    }}
                  >
                    <span className="moment-audience-choice-icon">
                      <OptionIcon size={18} />
                    </span>
                    <span className="moment-audience-choice-copy">
                      <strong>{t(option.labelKey)}</strong>
                      <small>{t(presentation.detailKey)}</small>
                    </span>
                    {audienceChoice === option.id
                      ? <Check size={18} />
                      : <ChevronRight size={17} />}
                  </button>
                );
              })}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
