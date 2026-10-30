import { Typography, theme } from 'antd';
import { Button, Tag, toast } from '@lobehub/ui';
import { Flexbox } from 'react-layout-kit';
import { Star } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ProviderDetail } from '../../services/desktop_api';
import { useActiveProviderSlice } from './useActiveSettingsStores';

export function AuthorizedProviderDetail({ detail }: { detail: ProviderDetail }) {
  const { t } = useTranslation('provider');
  const { token } = theme.useToken();
  const { runtimeDefault, setRuntimeDefault } = useActiveProviderSlice((s) => ({
    runtimeDefault: s.runtimeDefault, setRuntimeDefault: s.setRuntimeDefault,
  }));
  return (
    <Flexbox gap={16} style={{ padding: 24, overflowY: 'auto', minWidth: 0 }}>
      <Typography.Title level={4} style={{ margin: 0 }}>{detail.name}</Typography.Title>
      <Typography.Paragraph type="secondary">{t('provider.detail.authorizedDescription')}</Typography.Paragraph>
      <Tag color="blue">{t(detail.owner_scope === 'station' ? 'provider.detail.shared' : 'provider.detail.personal')}</Tag>
      {detail.models.map((model) => {
        const selected = runtimeDefault?.providerId === detail.id && runtimeDefault.modelId === model.id;
        return (
          <Flexbox key={model.id} horizontal align="center" gap={12} style={{ paddingBlock: 12, borderBottom: `1px solid ${token.colorBorderSecondary}` }}>
            <Flexbox flex={1} gap={4} style={{ minWidth: 0 }}>
              <Typography.Text strong ellipsis>{model.display_name || model.id}</Typography.Text>
              <Typography.Text type="secondary" ellipsis>{model.id}</Typography.Text>
            </Flexbox>
            <Button size="small" type={selected ? 'primary' : 'default'} icon={<Star size={14} />}
              aria-label={t('provider.detail.defaultForModel', { model: model.display_name || model.id })}
              onClick={() => void setRuntimeDefault(detail.id, model.id)
                .then(() => toast.success(t('provider.menu.defaultSet')))
                .catch((error) => toast.error(error instanceof Error ? error.message : t('provider.detail.saveFailed')))}>
              {t(selected ? 'provider.menu.defaultCurrent' : 'provider.menu.setDefault')}
            </Button>
          </Flexbox>
        );
      })}
    </Flexbox>
  );
}
