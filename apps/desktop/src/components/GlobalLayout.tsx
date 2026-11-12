import type { ReactNode } from 'react';

interface GlobalLayoutProps {
  sideNav: ReactNode;
  children: ReactNode;
  overlay?: ReactNode;
}

/**
 * Production north-star frame: a constant 60px identity/navigation rail
 * beside the flexible content stage. The frame owns layout only — pages own
 * their content and project their own data (Page/Runtime/Boot contracts).
 */
export function GlobalLayout({ sideNav, children, overlay }: GlobalLayoutProps) {
  return (
    <div className="ds-shell">
      {sideNav}
      <div className="ds-stage">{children}</div>
      {overlay}
    </div>
  );
}
