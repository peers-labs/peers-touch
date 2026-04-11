import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Popover, Typography, theme } from 'antd';
import { Flexbox } from 'react-layout-kit';
import { CircleDot, HelpCircle } from 'lucide-react';
import { api, type ConfigFieldMeta } from '../services/desktop_api';

const { Text } = Typography;

interface ConfigBadgeProps {
  section: string;
  label?: string;
}

export function ConfigBadge({ section, label }: ConfigBadgeProps) {
  const { token } = theme.useToken();
  const { t } = useTranslation('common');
  const [data, setData] = useState<Record<string, ConfigFieldMeta> | null>(null);

  useEffect(() => {
    api.getConfigSection(section).then(setData).catch(() => {});
  }, [section]);

  if (!data) return null;

  const customFields = Object.entries(data).filter(([, m]) => m.source === 'custom');
  const isCustom = customFields.length > 0;

  const content = (
    <Flexbox gap={8} style={{ maxWidth: 280 }}>
      <Text strong style={{ fontSize: 13 }}>
        {label || section} — {isCustom ? t('common.configBadge.customized') : t('common.configBadge.default')}
      </Text>
      {isCustom ? (
        <>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {t('common.configBadge.modifiedFields')}
          </Text>
          {customFields.map(([field, meta]) => (
            <Flexbox key={field} horizontal align="center" justify="space-between" gap={8}>
              <Text code style={{ fontSize: 11 }}>{field}</Text>
              <Text style={{ fontSize: 11 }}>{JSON.stringify(meta.value)}</Text>
            </Flexbox>
          ))}
          <Text type="secondary" style={{ fontSize: 11 }}>
            {t('common.configBadge.defaultHint')}
          </Text>
        </>
      ) : (
        <Text type="secondary" style={{ fontSize: 12 }}>
          {t('common.configBadge.usingDefaults', { section: label || section })}
        </Text>
      )}
    </Flexbox>
  );

  return (
    <Popover content={content} trigger="hover" placement="bottomLeft">
      <Flexbox
        horizontal
        align="center"
        gap={4}
        style={{ cursor: 'help', padding: '2px 6px', borderRadius: 4 }}
      >
        <CircleDot
          size={10}
          style={{
            color: isCustom ? token.colorPrimary : token.colorTextQuaternary,
          }}
        />
        <Text
          style={{
            fontSize: 11,
            color: isCustom ? token.colorPrimary : token.colorTextQuaternary,
          }}
        >
          {isCustom ? t('common.configBadge.customizedLabel') : t('common.configBadge.defaultLabel')}
        </Text>
        <HelpCircle size={10} style={{ color: token.colorTextQuaternary }} />
      </Flexbox>
    </Popover>
  );
}
