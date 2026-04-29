import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Input, Modal, Space, Tooltip, message, theme } from 'antd';
import { ImagePlus, X, RotateCcw } from 'lucide-react';
import { create } from '@bufbuild/protobuf';
import { convertFileSrc } from '@tauri-apps/api/core';
import {
  Audience_Kind,
  AudienceSchema,
  type Audience,
} from '../../gen/proto/domain/social/post_pb';
import { AudiencePicker } from './AudiencePicker';
import { useMomentsStore } from '../../store/moments';
import { api } from '../../services/desktop_api';
import { log } from '../../utils/logger';

const { TextArea } = Input;

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
  open: boolean;
  onClose: () => void;
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
  /** Populated when status === 'error'. */
  error?: string;
}

let pendingIdSeq = 0;
function makeLocalId(): string {
  pendingIdSeq += 1;
  return `pending-${Date.now()}-${pendingIdSeq}`;
}

export function MomentComposer({ open, onClose, initialAudience, onPublished }: MomentComposerProps) {
  const { t } = useTranslation('moments');
  const { token } = theme.useToken();

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

  // Reset image queue whenever the modal closes — drafts intentionally
  // preserve text + audience (cheap, no side effects) but NOT image
  // uploads (they consume OSS storage; resuming silently feels wrong).
  useEffect(() => {
    if (!open) setPending([]);
  }, [open]);

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

  const handleClose = () => {
    if (text.trim()) {
      setDraft({ text, audience, mentions: [] });
    } else {
      clearDraft();
    }
    onClose();
  };

  // Sequential upload bounds Rust-side memory (multipart parser keeps
  // the body in memory pre-save). 9 images at e.g. 8MB each would
  // otherwise spike to ~70MB if uploaded in parallel.
  const uploadOne = async (filePath: string, localId: string) => {
    try {
      const uploaded = await api.ossUploadAttachmentSocial(filePath);
      if (!uploaded?.cid) {
        throw new Error('upload returned no cid');
      }
      setPending((prev) =>
        prev.map((p) =>
          p.localId === localId
            ? { ...p, status: 'done', cid: uploaded.cid }
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

    setSubmitting(true);
    try {
      const id =
        cids.length > 0
          ? await createPost({
              kind: 'image',
              text: trimmed,
              imageIds: cids,
              audience,
            })
          : await createPost({ kind: 'text', text: trimmed, audience });
      message.success(t('moments.compose.published'));
      setText('');
      setPending([]);
      clearDraft();
      onPublished?.(id);
      onClose();
    } catch (err) {
      message.error(String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      title={t('moments.compose.title')}
      onCancel={handleClose}
      footer={null}
      width={560}
      destroyOnClose
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <TextArea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t('moments.compose.placeholder')}
          autoSize={{ minRows: 4, maxRows: 12 }}
          maxLength={5000}
          showCount
        />

        {pending.length > 0 && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(72px, 1fr))',
              gap: 8,
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

        <Space style={{ justifyContent: 'space-between', width: '100%' }}>
          <Space size={8}>
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
                size="small"
                icon={<ImagePlus size={14} />}
                onClick={handlePickImages}
                disabled={slotsLeft <= 0 || submitting}
              >
                {t('moments.compose.attachImage')}
                {pending.length > 0
                  ? ` (${pending.length}/${MAX_IMAGES_PER_POST})`
                  : ''}
              </Button>
            </Tooltip>
            {uploadingCount > 0 && (
              <span style={{ color: token.colorTextTertiary, fontSize: 12 }}>
                {t('moments.compose.imageUploadingProgress', {
                  uploading: uploadingCount,
                  total: pending.length,
                })}
              </span>
            )}
          </Space>
          <Space size={8}>
            <span style={{ color: token.colorTextSecondary, fontSize: 12 }}>
              {t('moments.compose.audienceLabel')}
            </span>
            <AudiencePicker value={audience} onChange={setAudience} disabled={submitting} />
          </Space>
        </Space>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button onClick={handleClose} disabled={submitting}>
            {t('moments.compose.cancel')}
          </Button>
          <Button
            type="primary"
            onClick={handlePublish}
            loading={submitting}
            disabled={!canPublish}
          >
            {t('moments.compose.publish')}
          </Button>
        </div>
      </div>
    </Modal>
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
        alt="pending"
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
