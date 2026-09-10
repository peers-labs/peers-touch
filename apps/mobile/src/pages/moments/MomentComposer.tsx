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
import { Button, Input, Select, message, Typography } from 'antd';
import { ImagePlus, RotateCcw, Save, Send, Trash2 } from 'lucide-react';
import { create } from '@bufbuild/protobuf';

import { useMobileI18n } from '../../app/mobileI18n';
import type { MobileAuthSession } from '../../features/auth/authSession';
import { uploadMobileMomentImage } from '../../features/social/socialApiTypes';
import type { MomentsGateway } from '../../services/gateways/momentsGateway';
import { useMomentsDraft, type MomentDraftPayload } from '../../features/social/useMomentsDraft';
import {
  Audience_Kind,
  AudienceSchema,
  type ImageAttachment,
  type Post,
} from '../../gen/proto/domain/social/post_pb';

const { Text } = Typography;
const MAX_IMAGES_PER_POST = 9;

// ---------------------------------------------------------------------------
// Pending image type (local state only)
// ---------------------------------------------------------------------------

interface PendingMomentImage {
  localId: string;
  file: File;
  previewUrl: string;
  status: 'uploading' | 'done' | 'error';
  image?: ImageAttachment;
  error?: string;
}

let pendingImageSeq = 0;

function nextPendingImageId(): string {
  pendingImageSeq += 1;
  return `mobile-moment-image-${Date.now()}-${pendingImageSeq}`;
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

export function MomentComposer({ session, gateway, onPublished }: MomentComposerProps) {
  const { t } = useMobileI18n();

  const [text, setText] = useState('');
  const [audienceKind, setAudienceKind] = useState<number>(Audience_Kind.PUBLIC);
  const [pendingImages, setPendingImages] = useState<PendingMomentImage[]>([]);
  const [publishing, setPublishing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pendingImagesRef = useRef<PendingMomentImage[]>([]);

  // Draft management
  const { draftRestored, saveDraft, clearDraft } = useMomentsDraft(
    useCallback((payload: MomentDraftPayload) => {
      setText(payload.text);
      setAudienceKind(payload.audienceKind);
    }, []),
  );

  // Keep ref in sync
  useEffect(() => {
    pendingImagesRef.current = pendingImages;
  }, [pendingImages]);

  // Cleanup preview URLs on unmount
  useEffect(() => () => {
    pendingImagesRef.current.forEach((item) => URL.revokeObjectURL(item.previewUrl));
  }, []);

  // Auto-save draft on text/audience changes
  useEffect(() => {
    if (text.trim()) {
      saveDraft(text, audienceKind);
    }
  }, [text, audienceKind, saveDraft]);

  const uploadingCount = useMemo(
    () => pendingImages.filter((item) => item.status === 'uploading').length,
    [pendingImages],
  );
  const errorCount = useMemo(
    () => pendingImages.filter((item) => item.status === 'error').length,
    [pendingImages],
  );
  const slotsLeft = MAX_IMAGES_PER_POST - pendingImages.length;
  const canPublish = Boolean(text.trim()) && uploadingCount === 0 && errorCount === 0 && !publishing;

  // -- Image upload --

  const uploadOne = async (item: PendingMomentImage) => {
    try {
      const image = await uploadMobileMomentImage(session, item.file);
      setPendingImages((current) => current.map((candidate) => (
        candidate.localId === item.localId
          ? { ...candidate, status: 'done', image, error: undefined }
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

  const handleFilesSelected = async (files: FileList | null) => {
    if (!files?.length) return;
    const selected = Array.from(files).slice(0, Math.max(0, slotsLeft));
    if (!selected.length) {
      message.warning(t('mobile.moments.imageMaxReached', { max: MAX_IMAGES_PER_POST }));
      return;
    }

    const drafts = selected.map((file) => ({
      localId: nextPendingImageId(),
      file,
      previewUrl: URL.createObjectURL(file),
      status: 'uploading' as const,
    }));
    setPendingImages((current) => [...current, ...drafts]);
    for (const item of drafts) {
      await uploadOne(item);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeImage = (localId: string) => {
    setPendingImages((current) => {
      const removed = current.find((item) => item.localId === localId);
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      return current.filter((item) => item.localId !== localId);
    });
  };

  const retryImage = (localId: string) => {
    const target = pendingImages.find((item) => item.localId === localId);
    if (!target) return;
    setPendingImages((current) => current.map((item) => (
      item.localId === localId ? { ...item, status: 'uploading', error: undefined } : item
    )));
    void uploadOne({ ...target, status: 'uploading', error: undefined });
  };

  // -- Publish --

  const publish = async () => {
    const trimmed = text.trim();
    if (!trimmed) {
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

    const images = pendingImages
      .filter((item) => item.status === 'done' && item.image)
      .map((item) => item.image as ImageAttachment);
    const imageIds = images.map((image) => image.id || image.url).filter(Boolean);
    const audience = create(AudienceSchema, { kind: audienceKind as Audience_Kind });

    setPublishing(true);
    const result = await gateway.createMoment(
      images.length > 0
        ? { kind: 'image', text: trimmed, audience, imageIds, images }
        : { kind: 'text', text: trimmed, audience },
    );

    setPublishing(false);

    if (result.ok && result.data.post) {
      message.success(t('mobile.moments.published'));
      // Clear state
      pendingImages.forEach((item) => URL.revokeObjectURL(item.previewUrl));
      setPendingImages([]);
      setText('');
      setAudienceKind(Audience_Kind.PUBLIC);
      clearDraft();
      onPublished(result.data.post);
    } else if (!result.ok) {
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

      <div className="moments-composer-audience">
        <Text className="moments-composer-eyebrow">{t('mobile.moments.audience.label')}</Text>
        <Select
          value={audienceKind}
          onChange={(value: number) => setAudienceKind(value)}
          size="small"
          style={{ minWidth: 120 }}
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
      />

      {pendingImages.length > 0 && (
        <div className="moments-image-grid">
          {pendingImages.map((item) => (
            <div className={`moments-image-tile ${item.status}`} key={item.localId}>
              <img src={item.previewUrl} alt={t('mobile.moments.composer.restoreDraft')} />
              <div className="moments-image-status">
                {item.status === 'uploading' && t('mobile.moments.imageUploadingShort')}
                {item.status === 'done' && t('mobile.moments.imageReady')}
                {item.status === 'error' && t('mobile.moments.imageFailed')}
              </div>
              <div className="moments-image-actions">
                {item.status === 'error' && (
                  <button type="button" onClick={() => retryImage(item.localId)} aria-label={t('mobile.moments.retryImage')}>
                    <RotateCcw size={14} />
                  </button>
                )}
                <button type="button" onClick={() => removeImage(item.localId)} aria-label={t('mobile.moments.removeImage')}>
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="moments-composer-actions">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(event) => void handleFilesSelected(event.target.files)}
        />
        <Button
          icon={<ImagePlus size={16} />}
          onClick={() => fileInputRef.current?.click()}
          disabled={slotsLeft <= 0 || publishing}
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
