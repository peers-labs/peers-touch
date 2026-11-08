import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Icon, MomentComposerSurface, TextArea } from '@peers-touch/ui';
import { message } from 'antd';
import { create } from '@bufbuild/protobuf';
import { convertFileSrc } from '@tauri-apps/api/core';
import {
  Audience_Kind,
  AudienceSchema,
  type Audience,
  type ImageAttachment,
} from '../../gen/proto/domain/social/post_pb';
import {
  ConversationKind,
  ConversationStatus,
} from '../../gen/proto/domain/chat/conversation_pb';
import { AudiencePicker } from './AudiencePicker';
import {
  audienceMayReachRemote,
  isAudienceSelectionComplete,
} from './audienceSelection';
import {
  ComposerMediaError,
  decideComposerImageAttachments,
  sniffPickedImageMagic,
  uploadPreparedPublicImage,
  type PublicComposerImage,
} from './composerMediaDecision';
import { api } from '../../services/desktop_api';
import { publicFeedErrorKey } from '../../services/publicFeedNative';
import {
  preparePrivateAudience,
  prepareRemotePrivateRecipient,
} from '../../runtimes/momentsRuntime';
import { privateMomentPublishIntent } from '../../store/moments';
import { log } from '../../utils/logger';
import { actorDisplayName } from '../../store/socialProfileProjection';
import { SocialPrivateState } from './surfaces';
import {
  useActiveMomentsSlice,
  useActiveMomentsFederationSlice,
  useActivePrivateMomentsSlice,
  useActiveRelationshipsSlice,
  useActiveSocialChatSlice,
} from './useActiveMomentsStore';


const TAG = 'moment-composer';

// MomentComposer — modal-style composer used by the "+ New" button
// in the feed pages and from the page-header CTAs.
//
// Why a modal (vs. an always-open in-page composer):
//   - Vertical space: feed pages already feel busy; adding a 200px-tall
//     composer at the top would push the first post below the fold.
//   - Draft persistence: when the modal closes WITHOUT publishing,
//     we save the text + audience into `useMomentsStore.composerDraft`
//     so the next open restores them (matches "save draft on close"
//     pattern from email clients).
//
// Image upload (P3): users can attach up to MAX_IMAGES_PER_POST images
// per Moment. Each pick is uploaded to /sub-oss/upload sequentially
// to bound peak memory on the Rust side; the resulting CIDs are
// embedded in CreateImagePostRequest.image_ids on publish.
// The "Publish" button stays disabled while ANY upload is in flight.

const MAX_IMAGES_PER_POST = 9;
// Text keystrokes coalesce into one global draft write after typing pauses.
// Image/audience changes stay immediate (discrete actions that also gate
// private-recipient readiness).
const DRAFT_PERSIST_DEBOUNCE_MS = 400;
// Bound pre-upload concurrency: two images validate/downsample/upload at a
// time so canvas work and multipart memory stay bounded on slow devices.
const PUBLIC_UPLOAD_CONCURRENCY = 2;
// One automatic retry per slot before surfacing the manual retry affordance.
const PUBLIC_UPLOAD_AUTO_RETRIES = 1;

interface MomentComposerProps {
  /** Optional initial audience override (defaults to PUBLIC). */
  initialAudience?: Audience;
  /** Optional callback after successful publish. */
  onPublished?: (postId: string) => void;
  onDismiss?: () => void;
}

function defaultAudience(): Audience {
  return create(AudienceSchema, { kind: Audience_Kind.PUBLIC });
}

function isPrivateAudience(audience: Audience): boolean {
  return audience.kind !== Audience_Kind.PUBLIC
    && audience.kind !== Audience_Kind.KIND_UNSPECIFIED;
}

interface PendingImage {
  /** Stable id for React keys; survives upload status transitions. */
  localId: string;
  /** Absolute path returned by the picker. */
  filePath: string;
  /** Tauri-converted file:// src for instant preview. */
  previewSrc: string;
  /**
   * OSS upload state. 'private' slots are held for Secure Content (never
   * uploaded to OSS); switching the audience back to public re-enqueues them.
   */
  status: 'pending' | 'uploading' | 'done' | 'error' | 'private';
  /** Populated when status === 'done'. */
  cid?: string;
  /** Typed descriptor persisted into CreateImagePostRequest.images. */
  image?: ImageAttachment;
  /** Shared decision-module result so publish can reuse an
   * already-uploaded slot without re-uploading. */
  uploaded?: PublicComposerImage;
  /** Populated when status === 'error'. */
  error?: string;
}

let pendingIdSeq = 0;
function makeLocalId(): string {
  pendingIdSeq += 1;
  return `pending-${Date.now()}-${pendingIdSeq}`;
}

export function MomentComposer({ initialAudience, onPublished, onDismiss }: MomentComposerProps) {
  const { t } = useTranslation('moments');
  const {
    draft,
    setDraft,
    clearDraft,
    createPost,
    circles,
    circleMembers,
  } = useActiveMomentsSlice((s) => ({
    draft: s.composerDraft,
    setDraft: s.setComposerDraft,
    clearDraft: s.clearComposerDraft,
    createPost: s.createPost,
    circles: s.circles,
    circleMembers: s.circleMembers,
  }));
  const { privatePublish, clearPrivatePublishState } = useActivePrivateMomentsSlice((s) => ({
    privatePublish: s.publish,
    clearPrivatePublishState: s.clearPublishState,
  }));
  const localStationPeerId = useActiveMomentsFederationSlice(
    (s) => s.self?.home_station_peer_id.trim() ?? '',
  );
  const { mutualFriends, followersByActor } = useActiveRelationshipsSlice((s) => ({
    mutualFriends: s.mutualFriends,
    followersByActor: s.followersByActor,
  }));
  const {
    conversations,
    conversationMembers,
    currentUserPtid,
  } = useActiveSocialChatSlice((s) => ({
    conversations: s.conversations,
    conversationMembers: s.conversationMembers,
    currentUserPtid: s.currentUserPtid,
  }));

  const [text, setText] = useState<string>(() => draft?.text ?? '');
  const [audience, setAudience] = useState<Audience>(
    () => draft?.audience ?? initialAudience ?? defaultAudience(),
  );
  const [pending, setPending] = useState<PendingImage[]>(() =>
    (draft?.files ?? []).map((file) => ({
      localId: file.intentId,
      filePath: file.filePath,
      previewSrc: file.previewSrc,
      status: 'pending',
    })),
  );
  const [draftId] = useState(() => draft?.draftId ?? makeLocalId());
  const draftRevision = useRef(draft?.revision ?? 0);
  const readinessAttempt = useRef(0);
  // Bounded pre-upload queue. Mirrors are read by async queue workers, which
  // outlive the render closure that enqueued them.
  const pendingMirrorRef = useRef<PendingImage[]>([]);
  const audienceMirrorRef = useRef<Audience>(audience);
  // Queue entries are self-contained: the worker must not read React state,
  // which is not yet committed when a pick handler enqueues synchronously.
  const uploadQueueRef = useRef<Array<{ localId: string; filePath: string }>>([]);
  const queuedUploadIdsRef = useRef<Set<string>>(new Set());
  const activeUploadsRef = useRef(0);
  const [readinessReady, setReadinessReady] = useState(false);
  const [checkingReadiness, setCheckingReadiness] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const uploadingCount = useMemo(
    () => pending.filter((p) => p.status === 'uploading').length,
    [pending],
  );
  const errorCount = useMemo(
    () => pending.filter((p) => p.status === 'error').length,
    [pending],
  );
  const remoteFriends = useMemo(() => (
    mutualFriends
      .filter((friend) => {
        const homeStationPeerId = friend.homeStationPeerId.trim();
        return Boolean(
          homeStationPeerId
          && (
            !localStationPeerId
            || homeStationPeerId !== localStationPeerId
          )
        );
      })
      .map((friend) => {
        const identity = actorDisplayName(friend.displayName)
          || actorDisplayName(friend.username, t('moments.circle.memberUnavailable'));
        const station = friend.homeStationName
          || friend.homeStationDomain
          || friend.homeStationPeerId;
        return {
          actorPtid: friend.actorPtid,
          label: station ? `${identity} · ${station}` : identity,
        };
      })
  ), [localStationPeerId, mutualFriends, t]);
  const followers = currentUserPtid
    ? followersByActor[currentUserPtid]?.items ?? []
    : [];
  const audiencePeople = useMemo(() => {
    const people = new Map<string, { actorPtid: string; label: string }>();
    for (const person of [...mutualFriends, ...followers]) {
      const identity = actorDisplayName(person.displayName)
        || actorDisplayName(person.username, t('moments.circle.memberUnavailable'));
      const station = person.homeStationDomain || person.homeStationPeerId;
      people.set(person.actorPtid, {
        actorPtid: person.actorPtid,
        label: station ? `${identity} · ${station}` : identity,
      });
    }
    return [...people.values()].sort(
      (left, right) => left.actorPtid.localeCompare(right.actorPtid),
    );
  }, [followers, mutualFriends, t]);
  const circleOptions = useMemo(
    () => circles.map((circle) => ({
      id: circle.id.toString(),
      label: circle.name,
    })),
    [circles],
  );
  const groupOptions = useMemo(
    () => conversations
      .filter((conversation) => (
        conversation.kind === ConversationKind.GROUP
        && conversation.status === ConversationStatus.ACTIVE
      ))
      .map((conversation) => ({
        conversationId: conversation.conversationId,
        label: conversation.name || conversation.conversationId,
      }))
      .sort((left, right) => left.conversationId.localeCompare(right.conversationId)),
    [conversations],
  );
  const remoteFriendPtids = useMemo(
    () => new Set(remoteFriends.map((friend) => friend.actorPtid)),
    [remoteFriends],
  );
  const remoteFollowerPtids = useMemo(
    () => new Set(
      followers
        .filter((follower) => (
          follower.homeStationPeerId
          && follower.homeStationPeerId !== localStationPeerId
        ))
        .map((follower) => follower.actorPtid),
    ),
    [followers, localStationPeerId],
  );
  const selectedCircleMemberPtids = audience.kind === Audience_Kind.CIRCLE
    && audience.target.case === 'circleId'
    ? (circleMembers[audience.target.value.toString()] ?? [])
      .map((member) => member.actorPtid)
    : [];
  const selectedGroupMembers = audience.kind === Audience_Kind.GROUP
    && audience.target.case === 'groupConversationId'
    ? conversationMembers[audience.target.value]
    : undefined;
  const selectedGroupHasRemote = !localStationPeerId
    || !selectedGroupMembers?.length
    || selectedGroupMembers.some((member) => (
      member.ptid !== currentUserPtid
      && (
        !member.actorHomeStationPeerId
        || member.actorHomeStationPeerId !== localStationPeerId
      )
    ));
  const slotsLeft = MAX_IMAGES_PER_POST - pending.length;
  const privateAudience = isPrivateAudience(audience);
  const audienceComplete = isAudienceSelectionComplete(audience);
  const requiresRemoteAdmission = audienceMayReachRemote(audience, {
    remoteFriendPtids,
    remoteFollowerPtids,
    selectedCircleMemberPtids,
    selectedGroupHasRemote,
  });
  const privatePublishState = privatePublish.draftId === draftId
    ? privatePublish.state
    : 'IDLE';
  const readyForCurrentDraft = (
    privateAudience
    && privatePublishState === 'READY_PRIVATE'
    && readinessReady
  );
  const canPublish =
    !!text.trim()
    && audienceComplete
    && uploadingCount === 0
    && errorCount === 0
    && !checkingReadiness
    && !submitting;

  const writeDraft = useCallback((
    revision: number,
    nextText: string,
    nextAudience: Audience,
    nextPending: PendingImage[],
  ) => {
    setDraft({
      draftId,
      revision,
      text: nextText,
      audience: nextAudience,
      mentions: [],
      files: nextPending.map((item) => ({
        intentId: item.localId,
        filePath: item.filePath,
        previewSrc: item.previewSrc,
      })),
    });
  }, [draftId, setDraft]);

  // Trailing global-store write. Only setDraft is delayed; readiness
  // invalidation stays synchronous. Any immediate commit cancels the pending
  // write, and the revision guard drops a stale timer at flush time.
  const draftWriteTimerRef = useRef<number | null>(null);
  const scheduledDraftWriteRef = useRef<{
    revision: number;
    text: string;
    audience: Audience;
    pending: PendingImage[];
  } | null>(null);

  const cancelScheduledDraftWrite = useCallback(() => {
    if (draftWriteTimerRef.current !== null) {
      window.clearTimeout(draftWriteTimerRef.current);
      draftWriteTimerRef.current = null;
    }
    scheduledDraftWriteRef.current = null;
  }, []);

  const scheduleDraftWrite = useCallback((
    revision: number,
    nextText: string,
    nextAudience: Audience,
    nextPending: PendingImage[],
  ) => {
    if (draftWriteTimerRef.current !== null) {
      window.clearTimeout(draftWriteTimerRef.current);
    }
    scheduledDraftWriteRef.current = {
      revision,
      text: nextText,
      audience: nextAudience,
      pending: nextPending,
    };
    draftWriteTimerRef.current = window.setTimeout(() => {
      draftWriteTimerRef.current = null;
      const scheduled = scheduledDraftWriteRef.current;
      scheduledDraftWriteRef.current = null;
      if (scheduled && scheduled.revision === draftRevision.current) {
        writeDraft(
          scheduled.revision,
          scheduled.text,
          scheduled.audience,
          scheduled.pending,
        );
      }
    }, DRAFT_PERSIST_DEBOUNCE_MS);
  }, [writeDraft]);

  // Flush a pending store write on unmount so the last keystrokes survive.
  useEffect(() => {
    const timerRef = draftWriteTimerRef;
    const scheduledRef = scheduledDraftWriteRef;
    const revisionRef = draftRevision;
    const writer = writeDraft;
    return () => {
      if (timerRef.current === null) return;
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
      const scheduled = scheduledRef.current;
      scheduledRef.current = null;
      if (scheduled && scheduled.revision === revisionRef.current) {
        writer(
          scheduled.revision,
          scheduled.text,
          scheduled.audience,
          scheduled.pending,
        );
      }
    };
  }, [writeDraft]);

  const invalidateDraftReadiness = () => {
    readinessAttempt.current += 1;
    setReadinessReady(false);
    setCheckingReadiness(false);
    // Skip the global private-store fan-out on every keystroke while no
    // readiness state exists for this (or any) draft.
    if (privatePublish.state !== 'IDLE' || privatePublish.draftId) {
      clearPrivatePublishState();
    }
  };

  const persistDraft = (
    nextText: string,
    nextAudience: Audience,
    nextPending: PendingImage[],
    mode: 'immediate' | 'trailing' = 'immediate',
  ) => {
    invalidateDraftReadiness();
    draftRevision.current += 1;
    if (mode === 'trailing') {
      scheduleDraftWrite(draftRevision.current, nextText, nextAudience, nextPending);
    } else {
      cancelScheduledDraftWrite();
      writeDraft(draftRevision.current, nextText, nextAudience, nextPending);
    }
  };

  const checkpointDraft = (): number => {
    cancelScheduledDraftWrite();
    if (draftRevision.current === 0) {
      draftRevision.current = 1;
    }
    writeDraft(draftRevision.current, text, audience, pending);
    return draftRevision.current;
  };

  // Keep queue mirrors current across async upload boundaries.
  useEffect(() => {
    pendingMirrorRef.current = pending;
    audienceMirrorRef.current = audience;
  });

  const uploadSlotThroughDecision = useCallback(
    (filePath: string) => uploadPreparedPublicImage(
      { filePath },
      {
        uploadPath: (path) => api.ossUploadAttachmentSocial(path),
        uploadBytes: ({ filename, mime, bytes }) =>
          api.ossUploadAttachmentSocialBytes({
            filename,
            mime_type: mime,
            bytes: Array.from(bytes),
          }),
      },
    ),
    [],
  );

  // Bounded worker: takes the next queued PUBLIC slot, flips it to
  // uploading, and resolves it (with one automatic retry) independently of
  // the other slots. PRIVATE slots never reach OSS.
  const pumpUploadQueue = useCallback(() => {
    while (
      activeUploadsRef.current < PUBLIC_UPLOAD_CONCURRENCY
      && uploadQueueRef.current.length > 0
    ) {
      const entry = uploadQueueRef.current.shift();
      if (!entry) break;
      queuedUploadIdsRef.current.delete(entry.localId);
      const { localId, filePath } = entry;

      if (isPrivateAudience(audienceMirrorRef.current)) {
        setPending((prev) => prev.map((item) => (
          item.localId === localId && item.status === 'pending'
            ? { ...item, status: 'private' }
            : item
        )));
        continue;
      }
      const slot = pendingMirrorRef.current.find((item) => item.localId === localId);
      if (slot?.status === 'done') continue;

      activeUploadsRef.current += 1;
      setPending((prev) => prev.map((item) => (
        item.localId === localId ? { ...item, status: 'uploading' } : item
      )));

      const settle = async () => {
        let result: PublicComposerImage | null = null;
        let lastError: unknown = null;
        for (let attempt = 0; attempt <= PUBLIC_UPLOAD_AUTO_RETRIES; attempt += 1) {
          try {
            result = await uploadSlotThroughDecision(filePath);
            break;
          } catch (err) {
            lastError = err;
          }
        }
        // The slot may have been removed while the upload was in flight.
        const stillPresent = pendingMirrorRef.current.some(
          (item) => item.localId === localId,
        );
        if (!stillPresent) return;
        if (result) {
          setPending((prev) => prev.map((item) => (
            item.localId === localId
              ? {
                ...item,
                status: 'done',
                cid: result!.cid,
                image: result!.attachment,
                uploaded: result!,
                error: undefined,
              }
              : item
          )));
        } else {
          log.warn(TAG, 'image upload failed after retry', {
            filePath,
            err: String(lastError),
          });
          setPending((prev) => prev.map((item) => (
            item.localId === localId
              ? {
                ...item,
                status: 'error',
                error: lastError instanceof ComposerMediaError
                  ? t(`moments.compose.media.${lastError.code}`, { defaultValue: lastError.code })
                  : String(lastError),
              }
              : item
          )));
        }
      };

      void settle().finally(() => {
        activeUploadsRef.current = Math.max(0, activeUploadsRef.current - 1);
        pumpUploadQueue();
      });
    }
  }, [t, uploadSlotThroughDecision]);

  const enqueueUploads = useCallback((
    entries: Array<{ localId: string; filePath: string }>,
  ) => {
    entries.forEach((entry) => {
      if (queuedUploadIdsRef.current.has(entry.localId)) return;
      queuedUploadIdsRef.current.add(entry.localId);
      uploadQueueRef.current.push(entry);
    });
    pumpUploadQueue();
  }, [pumpUploadQueue]);

  // Restored draft slots resume their upload (or flip to private) on mount.
  useEffect(() => {
    if (pending.length === 0) return;
    enqueueUploads(pending.map((item) => ({
      localId: item.localId,
      filePath: item.filePath,
    })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handlePickImages = async () => {
    if (slotsLeft <= 0) {
      message.warning(t('moments.compose.imageMaxReached', { max: MAX_IMAGES_PER_POST }));
      return;
    }
    let paths: string[];
    try {
      paths = await api.ossPickImageSocial(slotsLeft);
    } catch {
      // User cancelled; nothing to do.
      return;
    }
    if (!paths.length) return;

    // Cheap bounded magic-header preflight: an unsupported type
    // (notably HEIC without a native transcoder) is rejected before it
    // enters the draft, without decoding whole files at pick time.
    // Full decode validation happens through the shared decision at
    // upload. The native picker already granted exactly these files.
    const picked = paths.map((p) => ({ filePath: p }));
    const settled = await Promise.allSettled(
      picked.map((file) => sniffPickedImageMagic(file)),
    );
    const accepted: string[] = [];
    let rejected = 0;
    settled.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        accepted.push(paths[index]!);
      } else {
        rejected += 1;
        log.warn(TAG, 'picked image rejected', {
          filePath: paths[index],
          err: String(result.reason),
        });
      }
    });
    if (!accepted.length) {
      message.error(t('moments.compose.media.IMAGE_TYPE_UNSUPPORTED'));
      return;
    }
    if (rejected > 0) {
      message.warning(t('moments.compose.media.IMAGE_TYPE_UNSUPPORTED'));
    }

    const privatePick = isPrivateAudience(audience);
    const fresh: PendingImage[] = accepted.map((p) => ({
      localId: makeLocalId(),
      filePath: p,
      previewSrc: convertFileSrc(p),
      // PUBLIC slots pre-upload in the bounded queue; PRIVATE slots are
      // held for Secure Content and never reach OSS.
      status: privatePick ? 'private' : 'pending',
    }));
    const next = [...pending, ...fresh];
    setPending(next);
    persistDraft(text, audience, next);
    if (!privatePick) {
      enqueueUploads(fresh.map((item) => ({
        localId: item.localId,
        filePath: item.filePath,
      })));
    }
  };

  const handleRemoveImage = (localId: string) => {
    queuedUploadIdsRef.current.delete(localId);
    uploadQueueRef.current = uploadQueueRef.current.filter(
      (entry) => entry.localId !== localId,
    );
    const next = pending.filter((item) => item.localId !== localId);
    setPending(next);
    persistDraft(text, audience, next);
  };

  const handleRetryImage = (localId: string) => {
    const target = pending.find((p) => p.localId === localId);
    if (!target) return;
    setPending((prev) =>
      prev.map((p) =>
        p.localId === localId
          ? { ...p, status: isPrivateAudience(audience) ? 'private' : 'pending', error: undefined }
          : p,
      ),
    );
    if (!isPrivateAudience(audience)) {
      enqueueUploads([{ localId, filePath: target.filePath }]);
    }
  };

  // Switching audience moves slots between the OSS queue and Secure Content
  // ownership without dropping already-completed uploads.
  const handleAudienceChange = (nextAudience: Audience) => {
    setAudience(nextAudience);
    persistDraft(text, nextAudience, pending);
    if (isPrivateAudience(nextAudience)) {
      queuedUploadIdsRef.current.clear();
      uploadQueueRef.current = [];
      setPending((prev) => prev.map((item) => (
        item.status === 'pending'
          ? { ...item, status: 'private' }
          : item
      )));
      return;
    }
    const requeue = pending
      .filter((item) => item.status === 'private')
      .map((item) => ({ localId: item.localId, filePath: item.filePath }));
    setPending((prev) => prev.map((item) => (
      item.status === 'private'
        ? { ...item, status: 'pending' }
        : item
    )));
    if (requeue.length > 0) enqueueUploads(requeue);
  };

  const handlePublish = async () => {
    const trimmed = text.trim();
    if (!trimmed) {
      message.warning(t('moments.compose.emptyError'));
      return;
    }
    if (uploadingCount > 0) {
      message.warning(t('moments.compose.imageUploading'));
      return;
    }
    if (errorCount > 0) {
      message.warning(t('moments.compose.imageHasErrors'));
      return;
    }

    if (privateAudience) {
      const publishRevision = checkpointDraft();
      const privateDraft = pending.length > 0
        ? {
            kind: 'image' as const,
            text: trimmed,
            imageIds: [],
            localFiles: pending.map((item) => ({
              intentId: item.localId,
              filePath: item.filePath,
              previewSrc: item.previewSrc,
            })),
            audience,
            draftId,
            draftRevision: publishRevision,
          }
        : {
            kind: 'text' as const,
            text: trimmed,
            audience,
            draftId,
            draftRevision: publishRevision,
          };

      if (!readyForCurrentDraft) {
        const attempt = ++readinessAttempt.current;
        setCheckingReadiness(true);
        try {
          const intent = privateMomentPublishIntent(privateDraft);
          const result = requiresRemoteAdmission
            ? await prepareRemotePrivateRecipient(intent)
            : await preparePrivateAudience(intent);
          if (
            attempt === readinessAttempt.current
            && draftRevision.current === publishRevision
            && result.state === 'READY_PRIVATE'
          ) {
            setReadinessReady(true);
          }
        } catch (err) {
          log.warn(TAG, 'private recipient readiness failed', { err: String(err) });
        } finally {
          if (attempt === readinessAttempt.current) {
            setCheckingReadiness(false);
          }
        }
        return;
      }

      setSubmitting(true);
      try {
        const id = await createPost(privateDraft);
        message.success(t('moments.compose.published'));
        cancelScheduledDraftWrite();
        setText('');
        setPending([]);
        setReadinessReady(false);
        clearDraft();
        clearPrivatePublishState();
        onPublished?.(id);
      } catch (err) {
        message.error(String(err));
      } finally {
        setSubmitting(false);
      }
      return;
    }

    setSubmitting(true);
    try {
      // PUBLIC media converges on the single composer decision
      // module — the exact same path the acceptance harness drives —
      // so picker/preview/upload routing can never diverge. Already
      // uploaded slots are reused; remaining ones are validated and
      // uploaded here.
      const files = pending.map((item) => ({ filePath: item.filePath }));
      const preuploaded = new Map(
        pending
          .filter((item): item is PendingImage & { status: 'done' } =>
            item.status === 'done' && !!item.uploaded)
          .map((item) => [item.filePath, item.uploaded!]),
      );
      const decision = await decideComposerImageAttachments({
        audience,
        files,
        uploader: (path) => api.ossUploadAttachmentSocial(path),
        bytesUploader: ({ filename, mime, bytes }) =>
          api.ossUploadAttachmentSocialBytes({
            filename,
            mime_type: mime,
            bytes: Array.from(bytes),
          }),
        preuploaded,
      });
      if (decision.kind !== 'public-attachments') {
        throw new Error(t('moments.compose.media.IMAGE_UPLOAD_FAILED'));
      }
      // Reflect freshly uploaded attachments on their slots.
      setPending((prev) => prev.map((item, index) => {
        const resolved = decision.kind === 'public-attachments'
          ? decision.results[index]
          : undefined;
        return resolved
          ? { ...item, status: 'done', cid: resolved.cid, image: resolved.attachment, uploaded: resolved }
          : item;
      }));
      const id =
        decision.imageIds.length > 0
          ? await createPost({
              kind: 'image',
              text: trimmed,
              imageIds: decision.imageIds,
              images: decision.attachments,
              audience,
              draftId,
              draftRevision: draftRevision.current,
            })
          : await createPost({ kind: 'text', text: trimmed, audience, draftId, draftRevision: draftRevision.current });
      message.success(t('moments.compose.published'));
      cancelScheduledDraftWrite();
      setText('');
      setPending([]);
      clearDraft();
      onPublished?.(id);
    } catch (err) {
      // Preserve the draft and surface the failed slot so the user
      // can retry that image instead of losing the selection.
      if (err instanceof ComposerMediaError) {
        setPending((prev) => prev.map((item) => (
          item.filePath === err.filePath
            ? {
                ...item,
                status: 'error',
                error: t(`moments.compose.media.${err.code}`, { defaultValue: err.code }),
              }
            : item
        )));
        message.error(t(`moments.compose.media.${err.code}`, { defaultValue: err.code }));
      } else {
        message.error(isPrivateAudience(audience) ? String(err) : t(publicFeedErrorKey(err)));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const busy = checkingReadiness || submitting;
  const disabledReason = !text.trim() ? t('moments.compose.emptyError')
    : !audienceComplete ? t('moments.private.state.AUDIENCE_REQUIRED.description')
      : uploadingCount > 0 ? t('moments.compose.imageUploading')
        : errorCount > 0 ? t('moments.compose.imageHasErrors') : t('moments.reaction.pending');
  return <MomentComposerSurface id="moments-composer" disabled={busy}
    images={pending.map(item => ({
      id: item.localId, src: item.previewSrc, alt: t('moments.compose.imagePendingAlt'),
      status: item.status === 'uploading' ? t('moments.compose.imageUploadingShort')
        : item.status === 'private' ? t('moments.compose.privateSlot') : undefined,
      error: item.error, onRetry: () => handleRetryImage(item.localId),
    }))}
    onRemoveImage={handleRemoveImage}
    copy={{ removeImage: t('moments.compose.imageRemove'), retryImage: t('moments.compose.imageRetry') }}
    editor={<TextArea className="sk-compose-input" aria-label={t('moments.compose.title')}
      data-moments-composer-input framing="embedded" minimumRows={4} maximumRows={8}
      value={text} disabled={busy} onValueChange={next => {
        setText(next); persistDraft(next, audience, pending, 'trailing');
      }} placeholder={t('moments.compose.placeholder')} maxLength={5000} />}
    toolbar={<Button actionId="compose.images" emphasis="quiet" leading={<Icon iconId="image-plus" size={15} />}
      label={pending.length ? `${t('moments.compose.attachImage')} ${pending.length}/${MAX_IMAGES_PER_POST}`
        : t('moments.compose.attachImage')}
      availability={slotsLeft <= 0 || busy ? { kind: 'disabled', reason: t('moments.compose.imageMaxReached', { max: MAX_IMAGES_PER_POST }) } : undefined}
      onActivate={() => void handlePickImages()} />}
    audience={<AudiencePicker value={audience} people={audiencePeople} circles={circleOptions} groups={groupOptions}
      onChange={handleAudienceChange} disabled={busy} />}
    status={privateAudience && privatePublishState !== 'IDLE'
      ? <SocialPrivateState state={privatePublishState} compact onRetry={busy ? undefined : () => void handlePublish()} /> : undefined}
    footer={<>
      {onDismiss && <Button actionId="compose.cancel" emphasis="quiet" label={t('moments.compose.cancel')}
        availability={busy ? { kind: 'disabled', reason: t('moments.reaction.pending') } : undefined}
        onActivate={() => { checkpointDraft(); onDismiss(); }} />}
      <Button actionId="compose.publish" emphasis="primary" data-acceptance-id="social-composer-publish"
        onActivate={() => void handlePublish()} execution={busy ? 'pending' : 'idle'}
        availability={canPublish ? undefined : { kind: 'disabled', reason: disabledReason }}
        label={privateAudience && !readyForCurrentDraft && !submitting ? t('moments.compose.checkRecipients') : t('moments.compose.publish')} />
    </>} />;
}
