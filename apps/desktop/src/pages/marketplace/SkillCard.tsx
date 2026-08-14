// Skill card for the marketplace grid.

import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import { Button, Tag, theme } from 'antd';
import { Download, CheckCircle } from 'lucide-react';

import type { MarketSkillEntry } from '../../services/desktop_api';

interface SkillCardProps {
  skill: MarketSkillEntry;
  onInstall: (skill: MarketSkillEntry) => void;
}

export const MarketplaceSkillCard = memo<SkillCardProps>(({ skill, onInstall }) => {
  const { t } = useTranslation('agent');
  const { token } = theme.useToken();

  return (
    <Flexbox
      gap={token.marginSM}
      padding={token.paddingMD}
      style={{
        width: 280,
        borderRadius: token.borderRadiusLG,
        border: `1px solid ${token.colorBorderSecondary}`,
        background: token.colorBgContainer,
        transition: 'box-shadow 0.2s',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLDivElement).style.boxShadow = token.boxShadowSecondary;
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.boxShadow = 'none';
      }}
    >
      <Flexbox gap={4}>
        <span
          style={{
            fontWeight: token.fontWeightStrong,
            fontSize: token.fontSize,
            color: token.colorText,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {skill.name}
        </span>
        {skill.author && (
          <span style={{ fontSize: token.fontSizeSM, color: token.colorTextTertiary }}>
            {skill.author}
          </span>
        )}
      </Flexbox>

      <span
        style={{
          fontSize: token.fontSizeSM,
          color: token.colorTextSecondary,
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
          minHeight: 36,
        }}
      >
        {skill.description}
      </span>

      <Flexbox horizontal gap={4} align="center" justify="space-between">
        <Flexbox horizontal gap={4}>
          {skill.keywords?.slice(0, 2).map((kw) => (
            <Tag key={kw} style={{ fontSize: 10, lineHeight: '16px', margin: 0 }}>
              {kw}
            </Tag>
          ))}
        </Flexbox>

        {skill.installed ? (
          <Tag
            icon={<CheckCircle size={10} />}
            color="success"
            style={{ margin: 0 }}
          >
            {t('agent.marketplace.installed')}
          </Tag>
        ) : (
          <Button
            size="small"
            type="primary"
            icon={<Download size={12} />}
            onClick={() => onInstall(skill)}
          >
            {t('agent.marketplace.install')}
          </Button>
        )}
      </Flexbox>
    </Flexbox>
  );
});

MarketplaceSkillCard.displayName = 'MarketplaceSkillCard';
