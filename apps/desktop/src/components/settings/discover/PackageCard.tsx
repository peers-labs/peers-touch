import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Icon, Tag, type IconId, type Tone } from '@peers-touch/ui';

import type { MarketSkillEntry } from '../../../services/desktop_api';

interface PackageCardProps {
  entry: MarketSkillEntry;
  onInstall: (entry: MarketSkillEntry) => void;
  onOpen: (entry: MarketSkillEntry) => void;
  onUninstall: (entry: MarketSkillEntry) => void;
}

type PackageType = 'agent' | 'mcp' | 'plugin' | 'skill';

function packageIconId(packageType: string): IconId {
  if (packageType === 'agent') return 'bot';
  if (packageType === 'mcp') return 'server';
  if (packageType === 'plugin') return 'plug';
  return 'puzzle';
}

function riskTone(riskLevel?: string): Tone {
  if (riskLevel === 'high') return 'danger';
  if (riskLevel === 'medium') return 'warning';
  if (riskLevel === 'low') return 'success';
  return 'neutral';
}

export const MarketplacePackageCard = memo<PackageCardProps>(({
  entry,
  onInstall,
  onOpen,
  onUninstall,
}) => {
  const { t } = useTranslation('agent');
  const packageType = (entry.packageType || 'skill') as PackageType;
  const blocked = entry.installPolicy === 'blocked' || entry.revoked;
  const signatureVerified = entry.signatureStatus === 'verified';

  return (
    <article
      className="sc-package-card"
      data-package-id={entry.identifier}
      data-package-policy={entry.installPolicy || 'blocked'}
      data-package-revoked={entry.revoked ? 'true' : 'false'}
      data-testid={`marketplace-package-${entry.identifier}`}
    >
      <div className="sc-package-card__head">
        <span className="sc-package-card__icon">
          <Icon iconId={packageIconId(packageType)} size={18} />
        </span>
        <span className="sc-package-card__identity">
          <span className="sc-package-card__name">{entry.name}</span>
          <span className="sc-package-card__author">
            {entry.author || t('agent.marketplace.unknownPublisher')}
          </span>
        </span>
        <Tag>{t(`agent.marketplace.packageType.${packageType}`)}</Tag>
      </div>

      <span className="sc-package-card__desc">
        {entry.description || t('agent.marketplace.noDescription')}
      </span>

      <div className="sc-package-card__tags">
        <Tag>
          {t('agent.marketplace.version', { version: entry.version || '1' })}
        </Tag>
        <Tag
          tone={signatureVerified ? 'success' : 'danger'}
          leading={
            <Icon iconId={signatureVerified ? 'shield-check' : 'shield-alert'} size={10} />
          }
        >
          {signatureVerified
            ? entry.trustLevel || t('agent.marketplace.trust.unknown')
            : t('agent.marketplace.signature.invalid')}
        </Tag>
        <Tag tone={riskTone(entry.riskLevel)}>
          {t('agent.marketplace.risk', {
            risk: entry.riskLevel || t('agent.marketplace.risk.unknown'),
          })}
        </Tag>
        {entry.revoked && (
          <Tag tone="danger">
            {t('agent.marketplace.revoked')}
          </Tag>
        )}
      </div>

      <div className="sc-package-card__actions">
        <Button
          actionId={`marketplace-detail-${entry.identifier}`}
          data-testid={`marketplace-detail-${entry.identifier}`}
          density="compact"
          leading={<Icon iconId="eye" size={12} />}
          label={t('agent.marketplace.details')}
          onActivate={() => onOpen(entry)}
        />
        {entry.installed ? (
          <span className="sc-package-card__installed">
            <Tag tone="success" leading={<Icon iconId="circle-check-big" size={10} />}>
              {t('agent.marketplace.installed')}
            </Tag>
            <Button
              actionId={`marketplace-uninstall-${entry.identifier}`}
              data-testid={`marketplace-uninstall-${entry.identifier}`}
              aria-label={t('agent.marketplace.uninstall')}
              title={t('agent.marketplace.uninstall')}
              density="compact"
              leading={<Icon iconId="delete" size={12} />}
              label={t('agent.marketplace.uninstall')}
              onActivate={(event) => {
                event.stopPropagation();
                onUninstall(entry);
              }}
            />
          </span>
        ) : (
          <Button
            actionId={`marketplace-install-${entry.identifier}`}
            data-testid={`marketplace-install-${entry.identifier}`}
            title={blocked ? t('agent.marketplace.installBlocked') : undefined}
            density="compact"
            emphasis="primary"
            leading={<Icon iconId="download" size={12} />}
            label={t('agent.marketplace.install')}
            availability={blocked
              ? { kind: 'disabled', reason: t('agent.marketplace.installBlocked') }
              : undefined}
            onActivate={(event) => {
              event.stopPropagation();
              onInstall(entry);
            }}
          />
        )}
      </div>
    </article>
  );
});

MarketplacePackageCard.displayName = 'MarketplacePackageCard';
