import { useEffect, useState } from 'react';
import { Button, Dialog, Field, TextField, TextArea } from '@peers-touch/ui';
import type { ProviderDetail } from '../../services/desktop_api';
import { useTranslation } from 'react-i18next';
import { useActiveProviderSlice } from './useActiveSettingsStores';
import { notifyError, notifySuccess } from '../../ui/feedback';

interface UpdateProviderModalProps {
  open: boolean;
  detail: ProviderDetail;
  onClose: () => void;
}

export function UpdateProviderModal({ open, detail, onClose }: UpdateProviderModalProps) {
  const { t } = useTranslation('provider');
  const [name, setName] = useState(detail.name);
  const [description, setDescription] = useState(detail.description ?? '');
  const [logo, setLogo] = useState(detail.logo || '');
  const [loading, setLoading] = useState(false);
  const { updateProvider } = useActiveProviderSlice((s) => ({
    updateProvider: s.updateProvider,
  }));

  // Every open starts a clean form (antd destroyOnHidden parity).
  useEffect(() => {
    if (open) {
      setName(detail.name);
      setDescription(detail.description ?? '');
      setLogo(detail.logo || '');
    }
  }, [open, detail]);

  const nameMissing = name.trim().length === 0;

  const handleOk = async () => {
    if (nameMissing) return;
    try {
      setLoading(true);
      // TODO: Add a dedicated update-profile endpoint for custom providers.
      // For now we call updateProvider which only updates api_key/base_url/enabled.
      await updateProvider(detail.id, detail.api_key, detail.base_url, detail.enabled);
      // name/description/logo stay local until the profile endpoint ships.
      void description;
      void logo;
      notifySuccess(t('provider.updateProvider.updated'));
      onClose();
    } catch (e: unknown) {
      if (e instanceof Error) notifyError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog
      open={open}
      onDismiss={onClose}
      title={t('provider.updateProvider.title')}
      width={480}
      closeLabel={t('provider.detail.disableConfirm.cancel')}
      footer={
        <>
          <Button
            actionId="update-provider-cancel"
            emphasis="quiet"
            label={t('provider.detail.disableConfirm.cancel')}
            onActivate={onClose}
          />
          <Button
            actionId="update-provider-ok"
            emphasis="primary"
            execution={loading ? 'pending' : 'idle'}
            label={t('provider.updateProvider.okText')}
            availability={nameMissing
              ? { kind: 'disabled', reason: t('provider.updateProvider.providerNameRequired') }
              : undefined}
            onActivate={() => void handleOk()}
          />
        </>
      }
    >
      <div className="sc-provider-form" data-provider-update-form>
        <Field label={t('provider.updateProvider.providerId')}>
          <TextField value={detail.id} disabled />
        </Field>
        <Field
          label={t('provider.updateProvider.providerName')}
          required
          validation={nameMissing
            ? { state: 'invalid', message: t('provider.updateProvider.providerNameRequired') }
            : undefined}
        >
          <TextField
            placeholder={t('provider.updateProvider.providerNamePlaceholder')}
            value={name}
            onValueChange={setName}
          />
        </Field>
        <Field label={t('provider.updateProvider.providerDescription')}>
          <TextArea
            placeholder={t('provider.updateProvider.providerDescPlaceholder')}
            rows={2}
            value={description}
            onValueChange={setDescription}
          />
        </Field>
        <Field label={t('provider.updateProvider.providerLogo')}>
          <TextField
            placeholder={t('provider.updateProvider.providerLogoPlaceholder')}
            value={logo}
            onValueChange={setLogo}
          />
        </Field>
      </div>
    </Dialog>
  );
}
