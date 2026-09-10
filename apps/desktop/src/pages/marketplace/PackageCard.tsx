import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import { Button } from '@lobehub/ui';
import { Tag, theme } from 'antd';
import { Bot, CheckCircle, Download, Eye, Plug, Puzzle, Server, Trash2 } from 'lucide-react';

import type { MarketSkillEntry } from '../../services/desktop_api';

interface PackageCardProps {
  entry: MarketSkillEntry;
  onInstall: (entry: MarketSkillEntry) => void;
  onOpen: (entry: MarketSkillEntry) => void;
  onUninstall: (entry: MarketSkillEntry) => void;
}

function packageIcon(packageType: string) {
  if (packageType === 'agent') return Bot;
  if (packageType === 'mcp') return Server;
  if (packageType === 'plugin') return Plug;
  return Puzzle;
}

function riskColor(riskLevel?: string) {
  if (riskLevel === 'high') return 'error';
  if (riskLevel === 'medium') return 'warning';
  if (riskLevel === 'low') return 'success';
  return 'default';
}

export const MarketplacePackageCard = memo<PackageCardProps>(({
  entry,
  onInstall,
  onOpen,
  onUninstall,
}) => {
  const { t } = useTranslation('agent');
  const { token } = theme.useToken();
  const packageType = entry.packageType || 'skill';
  const Icon = packageIcon(packageType);

  return (
    <Flexbox
      gap={token.marginSM}
      padding={token.paddingMD}
      style={{
        width: 280,
        border: `1px solid ${token.colorBorderSecondary}`,
        borderRadius: token.borderRadiusLG,
        background: token.colorBgContainer,
      }}
    >
      <Flexbox horizontal align="center" gap={token.marginSM}>
        <Flexbox
          align="center"
          justify="center"
          style={{
            width: 36,
            height: 36,
            flexShrink: 0,
            borderRadius: token.borderRadiusSM,
            background: token.colorPrimaryBg,
            color: token.colorPrimary,
          }}
        >
          <Icon size={18} />
        </Flexbox>
        <Flexbox style={{ flex: 1, minWidth: 0 }}>
          <span
            style={{
              color: token.colorText,
              fontSize: token.fontSize,
              fontWeight: token.fontWeightStrong,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {entry.name}
          </span>
          <span
            style={{
              color: token.colorTextTertiary,
              fontSize: token.fontSizeSM,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {entry.author || t('agent.marketplace.unknownPublisher')}
          </span>
        </Flexbox>
        <Tag style={{ margin: 0 }}>
          {t(`agent.marketplace.packageType.${packageType}`)}
        </Tag>
      </Flexbox>

      <span
        style={{
          minHeight: 36,
          color: token.colorTextSecondary,
          display: '-webkit-box',
          fontSize: token.fontSizeSM,
          overflow: 'hidden',
          WebkitBoxOrient: 'vertical',
          WebkitLineClamp: 2,
        }}
      >
        {entry.description || t('agent.marketplace.noDescription')}
      </span>

      <Flexbox horizontal gap={4} wrap="wrap">
        <Tag style={{ margin: 0 }}>
          {t('agent.marketplace.version', { version: entry.version || '1' })}
        </Tag>
        <Tag style={{ margin: 0 }}>
          {entry.trustLevel || t('agent.marketplace.trust.community')}
        </Tag>
        <Tag color={riskColor(entry.riskLevel)} style={{ margin: 0 }}>
          {t('agent.marketplace.risk', {
            risk: entry.riskLevel || t('agent.marketplace.risk.unknown'),
          })}
        </Tag>
      </Flexbox>

      <Flexbox horizontal justify="space-between">
        <Button
          icon={<Eye size={12} />}
          size="small"
          onClick={() => onOpen(entry)}
        >
          {t('agent.marketplace.details')}
        </Button>
        {entry.installed ? (
          <Flexbox horizontal align="center" gap={6}>
            <Tag icon={<CheckCircle size={10} />} color="success" style={{ margin: 0 }}>
              {t('agent.marketplace.installed')}
            </Tag>
            <Button
              aria-label={t('agent.marketplace.uninstall')}
              icon={<Trash2 size={12} />}
              size="small"
              title={t('agent.marketplace.uninstall')}
              onClick={(event) => {
                event.stopPropagation();
                onUninstall(entry);
              }}
            />
          </Flexbox>
        ) : (
          <Button
            icon={<Download size={12} />}
            size="small"
            type="primary"
            onClick={(event) => {
              event.stopPropagation();
              onInstall(entry);
            }}
          >
            {t('agent.marketplace.install')}
          </Button>
        )}
      </Flexbox>
    </Flexbox>
  );
});

MarketplacePackageCard.displayName = 'MarketplacePackageCard';
