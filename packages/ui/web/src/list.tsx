import type { HTMLAttributes, ReactNode } from 'react';

/**
 * List primitives — the flat settings/preferences surface.
 *
 * Why this exists in the library: settings-style pages across desktop,
 * mobile and the prototype were each hand-rolling section/row markup and
 * painting per-page boxes (tinted cards, bordered alerts, bordered select
 * triggers). The recurring visual result was generic SaaS chrome.
 *
 * Contract:
 *  - A ListSection owns a quiet heading (12px secondary; an icon is opt-in
 *    semantic chrome, never decoration) and a body of ListRows.
 *  - ListRows are FLAT: no background, no border box; separation is one
 *    full-bleed hairline between rows. The only sanctioned grouping chrome
 *    is `inset`, which puts one related block in a single well.
 *  - The row is a two-zone grid: meaning (label/description/icon) on the
 *    left, the owning control on the right. The control slot composes other
 *    primitives (Switch, ghost Select, Button); this file never re-styles
 *    them.
 */
export interface ListSectionProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  /** Optional group title. Omit for a single-card page whose subject is
      already carried by the page heading (avoids a duplicated title). */
  title?: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  /** Wrap the rows in one subtle well (grouped, macOS-style). Default flat. */
  inset?: boolean;
}
export function ListSection({ title, description, icon, inset = false, children, className = '', ...props }: ListSectionProps) {
  const hasHeading = title != null || description != null || icon != null;
  return (
    <section {...props} className={`pt-list-section ${className}`} data-inset={inset || undefined} aria-label={typeof title === 'string' ? title : undefined}>
      {hasHeading && (
        <header className="pt-list-heading" data-icon={icon ? true : undefined}>
          {icon && <span className="pt-list-heading-icon" aria-hidden="true">{icon}</span>}
          <span className="pt-list-heading-text">
            {title != null && <h3>{title}</h3>}
            {description && <span className="pt-list-heading-desc">{description}</span>}
          </span>
        </header>
      )}
      <div className="pt-list-body">{children}</div>
    </section>
  );
}

export interface ListRowProps extends HTMLAttributes<HTMLDivElement> {
  label: ReactNode;
  description?: ReactNode;
  /** Optional semantic leading icon (trust/danger states); decorative use is forbidden. */
  icon?: ReactNode;
  /** The owning primitive: Switch, ghost Select, Button, Link, Tag … */
  control?: ReactNode;
}
export function ListRow({ label, description, icon, control, children, className = '', ...props }: ListRowProps) {
  return (
    <div {...props} className={`pt-list-row ${className}`}>
      <div className="pt-list-row-main">
        {icon && <span className="pt-list-row-icon" aria-hidden="true">{icon}</span>}
        <span className="pt-list-row-text">
          <span className="pt-list-row-label">{label}</span>
          {description && <span className="pt-list-row-desc">{description}</span>}
        </span>
      </div>
      {(control ?? children) != null && <span className="pt-list-row-control">{control ?? children}</span>}
    </div>
  );
}
