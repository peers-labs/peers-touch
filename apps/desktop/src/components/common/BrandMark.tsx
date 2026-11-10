import { memo } from 'react';

/**
 * Peers brand mark — the vector "P" tile shared with the macOS tray asset
 * (`src-tauri/icons/tray-icon-macos.svg`). Vector keeps the login brand mark
 * crisp at any DPR instead of scaling a bitmap.
 */
export interface BrandMarkProps {
  size?: number;
  className?: string;
}

export const BrandMark = memo(function BrandMark({
  size = 22,
  className,
}: BrandMarkProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 36 36"
      role="img"
      aria-label="Peers"
      focusable="false"
    >
      <rect x="1" y="1" width="34" height="34" rx="8" fill="var(--pt-accent)" />
      <path
        fill="var(--pt-surface)"
        fillRule="evenodd"
        d="M11 8 H19 C23.418278 8 26 10.581722 26 15 C26 19.418278 23.418278 22 19 22 H16 V28 H11 Z M16 12.5 V17.5 H19 C20.656854 17.5 21.5 16.656854 21.5 15 C21.5 13.343146 20.656854 12.5 19 12.5 Z"
      />
    </svg>
  );
});
