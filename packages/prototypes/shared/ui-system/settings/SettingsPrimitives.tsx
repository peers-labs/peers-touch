/**
 * Settings primitives — north-star frame counterparts of the desktop
 * components/settings/SettingsLayout.tsx (Container/Section/Row/ItemCard).
 *
 * They own material only (floating card, hairline-free zone separation);
 * every control inside a row is a real peers-ui component with local state
 * owned by the caller. No control is rendered for decoration.
 */
import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

export function SettingsSection({ icon: Icon, title, subtitle, extra, children }: {
  icon?: LucideIcon;
  title: string;
  subtitle?: string;
  extra?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="sk-settings-section" aria-label={title}>
      <header className="sk-settings-section-head">
        <div className="sk-settings-section-id">
          <h2>
            {Icon && <Icon size={16} strokeWidth={1.8} aria-hidden="true" />}
            {title}
          </h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {extra && <div className="sk-settings-section-extra">{extra}</div>}
      </header>
      {children}
    </section>
  );
}

export function SettingsRow({ label, description, children, vertical = false }: {
  label: ReactNode;
  description?: string;
  children: ReactNode;
  vertical?: boolean;
}) {
  return (
    <div className={`sk-settings-row${vertical ? ' is-vertical' : ''}`}>
      <div className="sk-settings-row-text">
        <span className="sk-settings-row-label">{label}</span>
        {description && <span className="sk-settings-row-desc">{description}</span>}
      </div>
      <div className="sk-settings-row-control">{children}</div>
    </div>
  );
}

export function SettingsItemCard({ children }: { children: ReactNode }) {
  return <div className="sk-settings-item">{children}</div>;
}
