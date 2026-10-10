import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@lobehub/ui';
import { Input, Space, Tooltip, Typography, message, theme } from 'antd';
import {
  ImagePlus,
  LockKeyhole,
  RotateCcw,
  SendHorizontal,
  ShieldCheck,
  X,
} from 'lucide-react';
import { create } from '@bufbuild/protobuf';
import { convertFileSrc } from '@tauri-apps/api/core';
import {
  Audience_Kind,
  AudienceSchema,
  ImageAttachmentSchema,
  type Audience,
  type ImageAttachment,
} from '../../gen/proto/domain/social/post_pb';
import {
  ConversationKind,
  ConversationStatus,
} from '../../gen/proto/domain/chat/conversation_pb';
import { EncryptedMediaDescriptorSchema } from '../../gen/proto/domain/common/common_pb';
import { AudiencePicker } from './AudiencePicker';
import {
  audienceMayReachRemote,
  isAudienceSelectionComplete,
} from './audienceSelection';
import { api, type SocialEncryptedMediaDescriptorWire } from '../../services/desktop_api';
import {
  preparePrivateAudience,
  prepareRemotePrivateRecipient,
} from '../../runtimes/momentsRuntime';
import { privateMomentPublishIntent } from '../../store/moments';
import { log } from '../../utils/logger';
import { UserSquareAvatar } from '../common/UserSquareAvatar';
import { SocialPrivateState } from './surfaces';
import {
  useActiveDiscoverySlice,
  useActiveMomentsSlice,
  useActiveMomentsFederationSlice,
  useActivePrivateMomentsSlice,
  useActiveRelationshipsSlice,
  useActiveSocialChatSlice,
} from './useActiveMomentsStore';

const { TextArea } = Input;
const { Text } = Typography;

const TAG = 'moment-composer';

// MomentComposer — modal-style composer used by the "+ New" button
// in the feed pages and from the page-header CTAs.
//
// Why a modal (vs. an always-open in-page composer):
//   - Real estate: feed pages already feel busy; adding a 200px-tall
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

interface MomentComposerProps {
  /** Optional initial audience override (defaults to PUBLIC). */
  initialAudience?: Audience;
  /** Optional callback after successful publish. */
  onPublished?: (postId: string) => void;
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
  /** OSS upload state. */
  status: 'pending' | 'uploading' | 'done' | 'error';
  /** Populated when status === 'done'. */
  cid?: string;
  /** Typed descriptor persisted into CreateImagePostRequest.images. */
  image?: ImageAttachment;
  /** Populated when status === 'error'. */
  error?: string;
}

let pendingIdSeq = 0;
function makeLocalId(): string {
  pendingIdSeq += 1;
  return `pending-${Date.now()}-${pendingIdSeq}`;
}

function toEncryptedMediaDescriptor(wire: SocialEncryptedMediaDescriptorWire) {
  return create(EncryptedMediaDescriptorSchema, {
    encrypted: wire.encrypted,
    version: wire.version,
    suite: wire.suite,
    keyB64: wire.key_b64,
    nonceB64: wire.nonce_b64,
    plaintextSha256B64: wire.plaintext_sha256_b64,
    ciphertextSha256B64: wire.ciphertext_sha256_b64,
    plaintextSize: BigInt(wire.plaintext_size),
    ciphertextSize: BigInt(wire.ciphertext_size),
    chunking: wire.chunking || 'single-aead',
    chunkSize: wire.chunk_size ?? 0,
    chunkCount: wire.chunk_count ?? 0,
    tagSize: wire.tag_size ?? 0,
    nonceStrategy: wire.nonce_strategy ?? '',
  });
}

export function MomentComposer({ initialAudience, onPublished }: MomentComposerProps) {
  const { t } = useTranslation('moments');
  const { token } = theme.useToken();

  const me = useActiveDiscoverySlice((s) => s.me);
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
        const identity = friend.displayName
          || friend.username
          || friend.federatedHandle
          || friend.actorPtid;
        const station = friend.homeStationName
          || friend.homeStationDomain
          || friend.homeStationPeerId;
        return {
          actorPtid: friend.actorPtid,
          label: station ? `${identity} · ${station}` : identity,
        };
      })
  ), [localStationPeerId, mutualFriends]);
  const followers = currentUserPtid
    ? followersByActor[currentUserPtid]?.items ?? []
    : [];
  const audiencePeople = useMemo(() => {
    const people = new Map<string, { actorPtid: string; label: string }>();
    for (const person of [...mutualFriends, ...followers]) {
      const identity = person.displayName
        || person.username
        || person.federatedHandle
        || person.actorPtid;
      const station = person.homeStationDomain || person.homeStationPeerId;
      people.set(person.actorPtid, {
        actorPtid: person.actorPtid,
        label: station ? `${identity} · ${station}` : identity,
      });
    }
    return [...people.values()].sort(
      (left, right) => left.actorPtid.localeCompare(right.actorPtid),
    );
  }, [followers, mutualFriends]);
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

  const writeDraft = (
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
  };

  const persistDraft = (
    nextText: string,
    nextAudience: Audience,
    nextPending: PendingImage[],
  ) => {
    readinessAttempt.current += 1;
    setReadinessReady(false);
    setCheckingReadiness(false);
    clearPrivatePublishState();
    draftRevision.current += 1;
    writeDraft(draftRevision.current, nextText, nextAudience, nextPending);
  };

  const checkpointDraft = (): number => {
    if (draftRevision.current === 0) {
      draftRevision.current = 1;
    }
    writeDraft(draftRevision.current, text, audience, pending);
    return draftRevision.current;
  };

  const handleClear = () => {
    if (text.trim()) {
      persistDraft(text, audience, pending);
    } else {
      clearDraft();
    }
    setText('');
    setPending([]);
  };

  // Sequential upload bounds Rust-side memory (multipart parser keeps
  // the body in memory pre-save). 9 images at e.g. 8MB each would
  // otherwise spike to ~70MB if uploaded in parallel.
  const uploadOne = async (filePath: string, localId: string) => {
    setPending((prev) =>
      prev.map((item) => (
        item.localId === localId ? { ...item, status: 'uploading' } : item
      )),
    );
    try {
      const uploaded = await api.ossUploadEncryptedAttachmentSocial(filePath);
      if (!uploaded?.cid) {
        throw new Error('upload returned no cid');
      }
      const image = create(ImageAttachmentSchema, {
        id: uploaded.cid,
        url: uploaded.cid,
        sizeBytes: BigInt(uploaded.media_encryption.plaintext_size || uploaded.size || 0),
        mediaEncryption: toEncryptedMediaDescriptor(uploaded.media_encryption),
      });
      const completed: PendingImage = {
        localId,
        filePath,
        previewSrc: pending.find((item) => item.localId === localId)?.previewSrc ?? '',
        status: 'done',
        cid: uploaded.cid,
        image,
      };
      setPending((prev) =>
        prev.map((p) =>
          p.localId === localId
            ? { ...completed, previewSrc: p.previewSrc }
            : p,
        ),
      );
      return completed;
    } catch (err) {
      const failed: PendingImage = {
        localId,
        filePath,
        previewSrc: pending.find((item) => item.localId === localId)?.previewSrc ?? '',
        status: 'error',
        error: String(err),
      };
      log.warn(TAG, 'image upload failed', { filePath, err: String(err) });
      setPending((prev) =>
        prev.map((p) =>
          p.localId === localId
            ? { ...failed, previewSrc: p.previewSrc }
            : p,
        ),
      );
      return failed;
    }
  };

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

    const fresh: PendingImage[] = paths.map((p) => ({
      localId: makeLocalId(),
      filePath: p,
      previewSrc: convertFileSrc(p),
      status: 'pending',
    }));
    const next = [...pending, ...fresh];
    setPending(next);
    persistDraft(text, audience, next);
  };

  const handleRemoveImage = (localId: string) => {
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
          ? { ...p, status: 'uploading', error: undefined }
          : p,
      ),
    );
    void uploadOne(target.filePath, localId);
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
      const uploaded: PendingImage[] = [];
      for (const item of pending) {
        if (item.status === 'done') {
          uploaded.push(item);
          continue;
        }
        const result = await uploadOne(item.filePath, item.localId);
        if (!result || result.status !== 'done') {
          throw new Error(result?.error ?? t('moments.compose.imageUploadFailed'));
        }
        uploaded.push(result);
      }
      const cids = uploaded
        .filter((item) => item.cid)
        .map((item) => item.cid as string);
      const images = uploaded
        .filter((item) => item.image)
        .map((item) => item.image as ImageAttachment);
      const id =
        cids.length > 0
          ? await createPost({
              kind: 'image',
              text: trimmed,
              imageIds: cids,
              images,
              audience,
            })
          : await createPost({ kind: 'text', text: trimmed, audience });
      message.success(t('moments.compose.published'));
      setText('');
      setPending([]);
      clearDraft();
      onPublished?.(id);
    } catch (err) {
      message.error(String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
      <div
        id="moments-composer"
        style={{
          padding: 2,
          background: token.colorBgContainer,
        }}
      >
        <div style={{ display: 'flex', gap: 12 }}>
          <UserSquareAvatar
            remoteUrl={me?.avatar || undefined}
            name={me?.displayName || me?.username || t('moments.author.unknown')}
            size={42}
            radius={12}
          />
          <div
            style={{
              flex: 1,
              minWidth: 0,
              padding: '8px 12px',
              border: `1px solid ${token.colorBorderSecondary}`,
              borderRadius: token.borderRadiusLG,
              background: token.colorBgContainer,
            }}
          >
            <TextArea
              data-moments-composer-input
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                persistDraft(e.target.value, audience, pending);
              }}
              placeholder={t('moments.compose.placeholder')}
              autoSize={{ minRows: 2, maxRows: 10 }}
              maxLength={5000}
              variant="borderless"
              style={{
                padding: 0,
                resize: 'none',
                background: 'transparent',
                fontSize: 15,
                lineHeight: 1.7,
              }}
            />
          </div>
        </div>

        {pending.length > 0 && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(72px, 1fr))',
              gap: 8,
              marginTop: 14,
              marginLeft: 54,
            }}
          >
            {pending.map((p) => (
              <PendingThumb
                key={p.localId}
                item={p}
                onRemove={() => handleRemoveImage(p.localId)}
                onRetry={() => handleRetryImage(p.localId)}
                token={token}
              />
            ))}
          </div>
        )}

        {privateAudience && privatePublishState !== 'IDLE' && (
          <div style={{ marginLeft: 54 }}>
            <SocialPrivateState
              state={privatePublishState}
              compact
              onRetry={
                checkingReadiness || submitting
                  ? undefined
                  : () => void handlePublish()
              }
            />
          </div>
        )}

        <Space
          wrap
          style={{
            justifyContent: 'space-between',
            width: '100%',
            marginTop: 12,
            paddingTop: 10,
            borderTop: `1px solid ${token.colorBorderSecondary}`,
          }}
          align="center"
        >
          <Space size={8} wrap>
            <Tooltip
              title={
                slotsLeft <= 0
                  ? t('moments.compose.imageMaxReached', { max: MAX_IMAGES_PER_POST })
                  : t('moments.compose.imagePickHint', {
                      remaining: slotsLeft,
                      max: MAX_IMAGES_PER_POST,
                    })
              }
            >
              <Button
                type="text"
                icon={<ImagePlus size={14} />}
                onClick={handlePickImages}
                disabled={slotsLeft <= 0 || submitting}
              >
                {pending.length > 0 ? `${pending.length}/${MAX_IMAGES_PER_POST}` : null}
              </Button>
            </Tooltip>
            {uploadingCount > 0 && (
              <Text type="secondary" style={{ fontSize: 12 }}>
                {t('moments.compose.imageUploadingProgress', {
                  uploading: uploadingCount,
                  total: pending.length,
                })}
              </Text>
            )}
          </Space>
          <Space size={8} wrap style={{ justifyContent: 'flex-end' }}>
            <Space size={4} style={{ color: token.colorTextSecondary, fontSize: 12 }}>
              <LockKeyhole size={13} />
              <span>{t('moments.compose.audienceLabel')}</span>
            </Space>
            <AudiencePicker
              value={audience}
              people={audiencePeople}
              circles={circleOptions}
              groups={groupOptions}
              onChange={(nextAudience) => {
                setAudience(nextAudience);
                persistDraft(text, nextAudience, pending);
              }}
              disabled={submitting}
            />
            {(text || pending.length > 0) && (
              <Button onClick={handleClear} disabled={submitting} type="text">
                {t('moments.compose.cancel')}
              </Button>
            )}
            <Button
              type="primary"
              onClick={handlePublish}
              loading={checkingReadiness || submitting}
              disabled={!canPublish}
              icon={
                privateAudience && !readyForCurrentDraft && !submitting
                  ? <ShieldCheck size={14} />
                  : <SendHorizontal size={14} />
              }
            >
              {privateAudience && !readyForCurrentDraft && !submitting
                ? t('moments.compose.checkRecipients')
                : t('moments.compose.publish')}
            </Button>
          </Space>
        </Space>
      </div>
  );
}

interface PendingThumbProps {
  item: PendingImage;
  onRemove: () => void;
  onRetry: () => void;
  token: ReturnType<typeof theme.useToken>['token'];
}

function PendingThumb({ item, onRemove, onRetry, token }: PendingThumbProps) {
  const { t } = useTranslation('moments');
  const isError = item.status === 'error';
  const isUploading = item.status === 'uploading';
  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        aspectRatio: '1 / 1',
        borderRadius: token.borderRadius,
        overflow: 'hidden',
        background: token.colorBgLayout,
        border: `1px solid ${isError ? token.colorErrorBorder : token.colorBorder}`,
      }}
    >
      <img
        src={item.previewSrc}
        alt={t('moments.compose.imagePendingAlt')}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          opacity: isError ? 0.4 : isUploading ? 0.6 : 1,
        }}
      />

      {isUploading && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: token.colorWhite,
            fontSize: 11,
            fontWeight: 600,
            background: 'rgba(0,0,0,0.35)',
          }}
        >
          {t('moments.compose.imageUploadingShort')}
        </div>
      )}

      {isError && (
        <Tooltip title={item.error ?? t('moments.compose.imageUploadFailed')}>
          <button
            type="button"
            onClick={onRetry}
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
              color: token.colorWhite,
              fontSize: 11,
              fontWeight: 600,
              background: 'rgba(220,30,30,0.55)',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            <RotateCcw size={12} />
            {t('moments.compose.imageRetry')}
          </button>
        </Tooltip>
      )}

      <button
        type="button"
        onClick={onRemove}
        aria-label={t('moments.compose.imageRemove')}
        style={{
          position: 'absolute',
          top: 2,
          right: 2,
          width: 18,
          height: 18,
          padding: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'rgba(0,0,0,0.55)',
          color: token.colorWhite,
          border: 'none',
          borderRadius: '50%',
          cursor: 'pointer',
        }}
      >
        <X size={11} />
      </button>
    </div>
  );
}
