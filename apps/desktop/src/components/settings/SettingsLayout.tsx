import type { CSSProperties, ReactNode } from 'react';
import {
  pageColumnWidth,
  type PageWidthTier,
} from '../../layout/pageWidth';

/**
 * North-star settings layout primitives.
 *
 * The shared settings skeleton owns no antd/lobehub chrome anymore: geometry
 * and tonal steps come from @peers-touch/ui tokens via the sc-settings-*
 * classes in ui/northstar.css, matching the prototype grouped-card grammar
 * (white cards on the paper floor, plain-text titles, hairlines inside the
 * card only). The exported prop contract is unchanged so section components
 * migrate independently.
 */

interface SettingsContainerProps {
  children: ReactNode;
  /**
   * Responsive width tier. Forms default to `narrow`; management consoles use
   * `standard`/`wide`. The column is always centered with edge gutters.
   */
  tier?: PageWidthTier;
  style?: CSSProperties;
  fullHeight?: boolean;
}

export function SettingsContainer({
  children,
  tier = 'narrow',
  style,
  fullHeight,
}: SettingsContainerProps) {
  return (
    <div
      className="sc-settings-column"
      data-pt-settings-column={tier}
      data-full-height={fullHeight ? 'true' : 'false'}
      style={{
        width: pageColumnWidth(tier),
        ...style,
      }}
    >
      {children}
    </div>
  );
}

interface SettingsSectionProps {
  icon?: ReactNode;
  title: string;
  subtitle?: string;
  extra?: ReactNode;
  children: ReactNode;
  style?: CSSProperties;
}

interface SettingsPanelHeaderProps {
  icon: ReactNode;
  title: string;
  subtitle?: string;
  extra?: ReactNode;
  actions?: ReactNode;
}

export function SettingsPanelHeader({
  icon,
  title,
  subtitle,
  extra,
  actions,
}: SettingsPanelHeaderProps) {
  return (
    <div className="sc-panel-header">
      <div className="sc-panel-header__main">
        <div className="sc-panel-header__title-row">
          <span className="sc-panel-header__icon">{icon}</span>
          <h4 className="sc-panel-header__title">{title}</h4>
          {extra}
        </div>
        {subtitle && (
          <span className="sc-panel-header__subtitle">{subtitle}</span>
        )}
      </div>
      {actions && (
        <div className="sc-panel-header__actions">
          {actions}
        </div>
      )}
    </div>
  );
}

export function SettingsSection({
  icon,
  title,
  subtitle,
  extra,
  children,
  style,
}: SettingsSectionProps) {
  return (
    <section className="sc-settings-section" style={style}>
      <div className="sc-settings-section__head">
        <div className="sc-settings-section__id">
          <h2 className="sc-settings-section__title">
            {icon ? <span className="sc-settings-section__icon">{icon}</span> : null}
            {title}
          </h2>
          {subtitle && <p className="sc-settings-section__subtitle">{subtitle}</p>}
        </div>
        {extra && <div className="sc-settings-section__extra">{extra}</div>}
      </div>
      {/* One elevated card holds the related rows; hairlines live inside. */}
      <div className="sc-settings-card">{children}</div>
    </section>
  );
}

interface SettingsItemCardProps {
  children: ReactNode;
  style?: CSSProperties;
}

/**
 * Inset card used inside a section when one block needs its own raised
 * surface (e.g. the security PIN panel). Token-only, peers-ui grammar; it
 * must not reintroduce antd/lobehub chrome into the settings skeleton.
 */
export function SettingsItemCard({ children, style }: SettingsItemCardProps) {
  return (
    <div className="sc-settings-item-card" style={style}>
      {children}
    </div>
  );
}

interface SettingsRowProps {
  label: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  vertical?: boolean;
  style?: CSSProperties;
}

export function SettingsRow({
  label,
  description,
  children,
  vertical,
  style,
}: SettingsRowProps) {
  if (vertical) {
    return (
      <div className="sc-settings-row sc-settings-row--vertical" style={style}>
        <span className="sc-settings-row__label-group">
          <span className="sc-settings-row__label">{label}</span>
          {description && (
            <span className="sc-settings-row__description">{description}</span>
          )}
        </span>
        {children}
      </div>
    );
  }

  return (
    <div className="sc-settings-row" style={style}>
      <span className="sc-settings-row__label-group">
        <span className="sc-settings-row__label">{label}</span>
        {description && (
          <span className="sc-settings-row__description">{description}</span>
        )}
      </span>
      <span className="sc-settings-row__control">{children}</span>
    </div>
  );
}
