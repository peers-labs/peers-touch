import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Dialog, TextArea } from '@peers-touch/ui';
import { publicFeedErrorKey } from '../../services/publicFeedNative';
import { useActiveMomentsStore } from './useActiveMomentsStore';

/** Selected-only editor; the Native journal owns signed commits and retries. */
export function MomentTextEditor({ postId, text, onClose }: {
  postId: string;
  text: string;
  onClose: () => void;
}) {
  const { t } = useTranslation('moments');
  const update = useActiveMomentsStore(state => state.updatePostText);
  const [draft, setDraft] = useState(text);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState('');
  const operation = useRef({ text, id: crypto.randomUUID() });
  const submitting = useRef(false);
  const save = async () => {
    if (submitting.current || !draft.trim() || draft === text) return;
    submitting.current = true;
    if (operation.current.text !== draft) operation.current = { text: draft, id: crypto.randomUUID() };
    setPending(true);
    setFailure('');
    try {
      await update(postId, draft, operation.current.id);
      onClose();
    } catch (error) {
      setFailure(t(publicFeedErrorKey(error)));
    } finally {
      submitting.current = false;
      setPending(false);
    }
  };
  const cancel = () => { if (!submitting.current) onClose(); };
  return (
    <Dialog open title={t('moments.edit.title')} onDismiss={cancel}
      closeLabel={t('moments.action.cancel')} description={t('moments.edit.description')}
      footer={<>
        <Button actionId={`moment.edit.cancel.${postId}`} label={t('moments.action.cancel')}
          emphasis="quiet" availability={pending ? { kind: 'disabled', reason: t('moments.reaction.pending') } : undefined}
          onActivate={cancel} />
        <Button actionId={`moment.edit.save.${postId}`} label={t('moments.edit.save')}
          data-acceptance-id="social-edit-save" emphasis="primary" execution={pending ? 'pending' : 'idle'}
          availability={draft.trim() && draft !== text ? undefined
            : { kind: 'disabled', reason: t('moments.edit.changeRequired') }}
          onActivate={() => void save()} />
      </>}>
      <TextArea value={draft} onValueChange={setDraft} readOnly={pending}
        minimumRows={5} maximumRows={12} autoFocus
        aria-label={t('moments.edit.title')} data-acceptance-id="social-edit-input" />
      {failure && <Alert tone="danger" title={failure} data-acceptance-id="social-edit-error" />}
    </Dialog>
  );
}
