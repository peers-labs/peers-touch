import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Input, message, Typography } from 'antd';
import { ImagePlus, RotateCcw, Send, Trash2 } from 'lucide-react';
import { create } from '@bufbuild/protobuf';

import { useMobileI18n } from '../app/mobileI18n';
import { useAuthStore } from '../features/auth/authStore';
import { uploadMobileMomentImage } from '../features/social/socialApi';
import { useSocialStore } from '../features/social/socialStore';
import {
  Audience_Kind,
  AudienceSchema,
  type ImageAttachment,
} from '../gen/proto/domain/social/post_pb';

const { Text } = Typography;
const MAX_IMAGES_PER_POST = 9;

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

export function MomentsPage() {
  const { t } = useMobileI18n();
  const authSession = useAuthStore((state) => state.session);
  const api = useSocialStore((state) => state.api);
  const [text, setText] = useState('');
  const [pendingImages, setPendingImages] = useState<PendingMomentImage[]>([]);
  const [publishing, setPublishing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pendingImagesRef = useRef<PendingMomentImage[]>([]);

  useEffect(() => {
    pendingImagesRef.current = pendingImages;
  }, [pendingImages]);

  useEffect(() => () => {
    pendingImagesRef.current.forEach((item) => URL.revokeObjectURL(item.previewUrl));
  }, []);

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

  const uploadOne = async (item: PendingMomentImage) => {
    if (!authSession) return;
    try {
      const image = await uploadMobileMomentImage(authSession, item.file);
      setPendingImages((current) => current.map((candidate) => (
        candidate.localId === item.localId
          ? { ...candidate, status: 'done', image, error: undefined }
          : candidate
      )));
    } catch (error) {
      setPendingImages((current) => current.map((candidate) => (
        candidate.localId === item.localId
          ? { ...candidate, status: 'error', error: error instanceof Error ? error.message : String(error) }
          : candidate
      )));
    }
  };

  const handleFilesSelected = async (files: FileList | null) => {
    if (!files?.length || !authSession) return;
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

  const publish = async () => {
    const trimmed = text.trim();
    if (!api || !authSession) {
      message.warning(t('mobile.social.notAuthenticated'));
      return;
    }
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

    setPublishing(true);
    try {
      await api.createMoment(images.length > 0
        ? {
          kind: 'image',
          text: trimmed,
          audience: create(AudienceSchema, { kind: Audience_Kind.PUBLIC }),
          imageIds,
          images,
        }
        : {
          kind: 'text',
          text: trimmed,
          audience: create(AudienceSchema, { kind: Audience_Kind.PUBLIC }),
        });
      message.success(t('mobile.moments.published'));
      pendingImages.forEach((item) => URL.revokeObjectURL(item.previewUrl));
      setPendingImages([]);
      setText('');
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setPublishing(false);
    }
  };

  return (
    <div className="page-container moments-page">
      <div className="page-header">
        <div className="header-title">{t('mobile.moments.title')}</div>
      </div>

      <section className="moments-composer-card">
        <Text className="moments-composer-eyebrow">{t('mobile.moments.publicAudience')}</Text>
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
                <img src={item.previewUrl} alt="" />
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
            disabled={!authSession || slotsLeft <= 0 || publishing}
          >
            {t('mobile.moments.attachImage', { count: pendingImages.length, max: MAX_IMAGES_PER_POST })}
          </Button>
          <Button type="primary" icon={<Send size={16} />} onClick={() => void publish()} disabled={!canPublish} loading={publishing}>
            {t('mobile.moments.publish')}
          </Button>
        </div>
      </section>
    </div>
  );
}
