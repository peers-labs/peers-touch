import { IconButton, Segmented } from '@peers-touch/ui';
import type { IconId } from '@peers-touch/ui';
import { useTranslation } from 'react-i18next';
import './social-scope.css';

// SocialScopeBar — the single header for the Social surface.
//
// Per the confirmed mobile-social-parity prototype the persistent control is a
// thin two-way scope segment (Home / Explore). Full-screen destinations that are
// not part of the feed (Search, Audiences) are quiet icon entries beside it, not
// additional top-level tabs. The New Post CTA stays one primary icon action.

export interface SocialScopeBarTab {
  value: string;
  label: string;
}

export interface SocialScopeEntry {
  value: string;
  iconId: IconId;
  label: string;
  onActivate: () => void;
}

export interface SocialScopeBarProps {
  title?: string;
  subtitle?: string;
  tabs?: SocialScopeBarTab[];
  activeTab?: string;
  onTabChange?: (value: string) => void;
  /** Quiet icon entries for full-screen destinations (search, audiences). */
  entries?: SocialScopeEntry[];
  primaryAction?: {
    label: string;
    iconId?: IconId;
    onClick: () => void;
    disabled?: boolean;
  };
  compact?: boolean;
}

export function SocialScopeBar({
  title,
  subtitle,
  tabs,
  activeTab,
  onTabChange,
  entries,
  primaryAction,
  compact,
}: SocialScopeBarProps) {
  const { t } = useTranslation('moments');

  const defaultTitle = title ?? t('moments.title');
  const defaultSubtitle = subtitle ?? t('moments.subtitle');

  return (
    <header className={`pt-social-scope${compact ? ' pt-social-scope--compact' : ''}`}>
      <div className="pt-social-scope__heading">
        <h1 className="pt-social-scope__title">{defaultTitle}</h1>
        {defaultSubtitle && (
          <p className="pt-social-scope__subtitle">{defaultSubtitle}</p>
        )}
      </div>

      <div className="pt-social-scope__controls">
        {tabs && tabs.length > 0 && (
          <Segmented
            aria-label={t('moments.scope.label', { defaultValue: 'Social scope' })}
            value={activeTab}
            onValueChange={(value) => onTabChange?.(String(value))}
            options={tabs.map((tab) => ({ value: tab.value, label: tab.label }))}
          />
        )}
        {entries?.map((entry) => (
          <IconButton
            key={entry.value}
            actionId={`social.scope.${entry.value}`}
            iconId={entry.iconId}
            iconSize={17}
            label={entry.label}
            emphasis="quiet"
            aria-current={activeTab === entry.value ? 'page' : undefined}
            data-active={activeTab === entry.value || undefined}
            onActivate={entry.onActivate}
          />
        ))}
        {primaryAction && (
          <IconButton
            actionId="social.scope.compose"
            iconId={primaryAction.iconId ?? 'plus'}
            iconSize={18}
            label={primaryAction.label}
            emphasis="primary"
            availability={primaryAction.disabled ? { kind: 'disabled', reason: primaryAction.label } : undefined}
            onActivate={primaryAction.onClick}
          />
        )}
      </div>
    </header>
  );
}
