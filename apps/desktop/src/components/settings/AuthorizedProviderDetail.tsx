import { Typography, theme } from 'antd';
import { Button, toast } from '@lobehub/ui';
import { Flexbox } from 'react-layout-kit';
import { Star } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ProviderDetail } from '../../services/desktop_api';
import { useActiveProviderSlice } from './useActiveSettingsStores';

export function AuthorizedProviderDetail({ detail }: { detail: ProviderDetail }) {
  const { t } = useTranslation('provider');
  const { token } = theme.useToken();
  const { runtimeDefault, setRuntimeDefault, defaultSaving, defaultStatus, loadRuntimeDefault, detailLoading } = useActiveProviderSlice((s) => ({
    runtimeDefault: s.runtimeDefault, setRuntimeDefault: s.setRuntimeDefault,
    defaultSaving: s.defaultSaving, defaultStatus: s.defaultStatus,
    loadRuntimeDefault: s.loadRuntimeDefault, detailLoading: s.detailLoading,
  }));
  return (
    <Flexbox data-authorized-provider-detail gap={16} style={{ padding: token.paddingLG, overflowY: 'auto', minWidth: 0 }}>
      <Typography.Title level={4} style={{ margin: 0 }}>{detail.name}</Typography.Title>
      <Typography.Paragraph type="secondary">{t('provider.detail.authorizedDescription')}</Typography.Paragraph>
      {defaultStatus === 'error' && <Flexbox gap={8}>
        <Typography.Text role="alert" type="secondary">{t('provider.modelService.defaultLoadFailed')}</Typography.Text>
        <Button onClick={() => void loadRuntimeDefault()}>{t('provider.menu.retry')}</Button>
      </Flexbox>}
      {defaultSaving && <Typography.Text role="status" type="secondary">{t('provider.modelService.saving')}</Typography.Text>}
      {detail.models.map((model) => {
        const selected = runtimeDefault?.providerId === detail.id && runtimeDefault.modelId === model.id;
        return (
          <Flexbox key={model.id} data-authorized-model={model.id} horizontal align="center" gap={12}
            style={{ paddingBlock: token.paddingSM, flexWrap: 'wrap', borderBottom: `1px solid ${token.colorBorderSecondary}` }}>
            <Flexbox flex={1} gap={4} style={{ minWidth: 0 }}>
              <Typography.Text strong ellipsis>{model.display_name || model.id}</Typography.Text>
            </Flexbox>
            {(!model.type || model.type === 'chat') && <Button size="small" type={selected ? 'primary' : 'default'} icon={<Star size={14} />}
              data-default-model={model.id}
              disabled={selected || defaultSaving || defaultStatus !== 'ready' || detailLoading}
              aria-label={t('provider.detail.defaultForModel', { model: model.display_name || model.id })}
              onClick={() => void setRuntimeDefault(detail.id, model.id)
                .then(() => toast.success(t('provider.menu.defaultSet')))
                .catch(() => toast.error(t('provider.modelService.failedToSave')))}>
              {t(selected ? 'provider.menu.defaultCurrent' : 'provider.menu.setDefault')}
            </Button>}
          </Flexbox>
        );
      })}
    </Flexbox>
  );
}
