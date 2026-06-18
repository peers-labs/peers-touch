import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@lobehub/ui';
import { Card, Input, Space, Tooltip, Typography, message, theme } from 'antd';
import { ImagePlus, LockKeyhole, RotateCcw, SendHorizontal, X } from 'lucide-react';
import { create } from '@bufbuild/protobuf';
import { convertFileSrc } from '@tauri-apps/api/core';
import {
  Audience_Kind,
  AudienceSchema,
  ImageAttachmentSchema,
  type Audience,
  type ImageAttachment,
} from '../../gen/proto/domain/social/post_pb';
import { EncryptedMediaDescriptorSchema } from '../../gen/proto/domain/common/common_pb';
import { AudiencePicker } from './AudiencePicker';
import { useMomentsStore } from '../../store/moments';
import { useDiscoveryStore } from '../../store/discovery';
import { api, type SocialEncryptedMediaDescriptorWire } from '../../services/desktop_api';
import { log } from '../../utils/logger';
import { UserSquareAvatar } from '../common/UserSquareAvatar';

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

interface PendingImage {
  /** Stable id for React keys; survives upload status transitions. */
  localId: string;
  /** Absolute path returned by the picker. */
  filePath: string;
  /** Tauri-converted file:// src for instant preview. */
  previewSrc: string;
  /** OSS upload state. */
  status: 'uploading' | 'done' | 'error';
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

  const me = useDiscoveryStore((s) => s.me);
  const draft = useMomentsStore((s) => s.composerDraft);
  const setDraft = useMomentsStore((s) => s.setComposerDraft);
  const clearDraft = useMomentsStore((s) => s.clearComposerDraft);
  const createPost = useMomentsStore((s) => s.createPost);

  const [text, setText] = useState<string>(() => draft?.text ?? '');
  const [audience, setAudience] = useState<Audience>(
    () => draft?.audience ?? initialAudience ?? defaultAudience(),
  );
  const [pending, setPending] = useState<PendingImage[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const uploadingCount = useMemo(
    () => pending.filter((p) => p.status === 'uploading').length,
    [pending],
  );
  const errorCount = useMemo(
    () => pending.filter((p) => p.status === 'error').length,
    [pending],
  );
  const slotsLeft = MAX_IMAGES_PER_POST - pending.length;
  const canPublish =
    !!text.trim() && uploadingCount === 0 && errorCount === 0 && !submitting;

  const handleClear = () => {
    if (text.trim()) {
      setDraft({ text, audience, mentions: [] });
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
      setPending((prev) =>
        prev.map((p) =>
          p.localId === localId
            ? { ...p, status: 'done', cid: uploaded.cid, image }
            : p,
        ),
      );
    } catch (err) {
      log.warn(TAG, 'image upload failed', { filePath, err: String(err) });
      setPending((prev) =>
        prev.map((p) =>
          p.localId === localId
            ? { ...p, status: 'error', error: String(err) }
            : p,
        ),
      );
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
      status: 'uploading',
    }));
    setPending((prev) => [...prev, ...fresh]);

    for (const item of fresh) {
      await uploadOne(item.filePath, item.localId);
    }
  };

  const handleRemoveImage = (localId: string) => {
    setPending((prev) => prev.filter((p) => p.localId !== localId));
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

    const cids = pending
      .filter((p) => p.status === 'done' && p.cid)
      .map((p) => p.cid as string);
    const images = pending
      .filter((p) => p.status === 'done' && p.image)
      .map((p) => p.image as ImageAttachment);

    setSubmitting(true);
    try {
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
    <Card
      id="moments-composer"
      style={{
        marginBottom: 10,
        borderColor: token.colorBorderSecondary,
        borderRadius: 16,
        boxShadow: 'none',
        overflow: 'hidden',
      }}
      bodyStyle={{ padding: 0 }}
    >
      <div
        style={{
          padding: 14,
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
          <div style={{ flex: 1, minWidth: 0 }}>
            <TextArea
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setDraft({ text: e.target.value, audience, mentions: [] });
              }}
              placeholder={t('moments.compose.placeholder')}
              autoSize={{ minRows: 2, maxRows: 10 }}
              maxLength={5000}
              bordered={false}
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
            <AudiencePicker value={audience} onChange={setAudience} disabled={submitting} />
            {(text || pending.length > 0) && (
              <Button onClick={handleClear} disabled={submitting} type="text">
                {t('moments.compose.cancel')}
              </Button>
            )}
            <Button
              type="primary"
              onClick={handlePublish}
              loading={submitting}
              disabled={!canPublish}
              icon={<SendHorizontal size={14} />}
            >
              {t('moments.compose.publish')}
            </Button>
          </Space>
        </Space>
      </div>
    </Card>
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
