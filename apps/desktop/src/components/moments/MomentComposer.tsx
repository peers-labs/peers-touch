import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Input, Modal, Space, message, theme } from 'antd';
import { ImagePlus } from 'lucide-react';
import { create } from '@bufbuild/protobuf';
import {
  Audience_Kind,
  AudienceSchema,
  type Audience,
} from '../../gen/proto/domain/social/post_pb';
import { AudiencePicker } from './AudiencePicker';
import { useMomentsStore } from '../../store/moments';

const { TextArea } = Input;

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
// Image attachments: the picker button is rendered but disabled in
// P2 with a tooltip explaining the OSS dependency. When OSS lands
// the only change here is enabling the button + wiring `imageIds`.

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
  const [submitting, setSubmitting] = useState(false);

  const handleClose = () => {
    // Stash a draft only if the user typed something AND we're not
    // closing as part of a successful publish.
    if (text.trim()) {
      setDraft({ text, audience, mentions: [] });
    } else {
      clearDraft();
    }
    onClose();
  };

  const handlePublish = async () => {
    const trimmed = text.trim();
    if (!trimmed) {
      message.warning(t('moments.compose.emptyError'));
      return;
    }
    setSubmitting(true);
    try {
      const id = await createPost({ kind: 'text', text: trimmed, audience });
      message.success(t('moments.compose.published'));
      setText('');
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
        <Space style={{ justifyContent: 'space-between', width: '100%' }}>
          <Space size={8}>
            <Button
              size="small"
              icon={<ImagePlus size={14} />}
              disabled
              title={t('moments.compose.imageDisabled')}
            >
              {t('moments.compose.attachImage')}
            </Button>
            <span style={{ color: token.colorTextTertiary, fontSize: 12 }}>
              {t('moments.compose.imageDisabled')}
            </span>
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
            disabled={!text.trim()}
          >
            {t('moments.compose.publish')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
