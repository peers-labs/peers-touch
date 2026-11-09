import { GlobalLayout } from '../components/GlobalLayout';
import { BRANDING } from '../branding';
import type { AppLifecycle } from '../types/navigation';

interface ResumingViewProps {
  lifecycle: AppLifecycle;
}

/**
 * Warm-resume splash shown while the restored session is validated.
 * North-star boot grammar: neutral paper canvas, ink wordmark, one pine
 * connection mark — no chromatic gradient, no component-library spinner.
 * Mirrors the pre-React #pt-boot-fallback in index.html so startup is
 * continuous from bundle load through session resume.
 */
export function ResumingView({ lifecycle: _lifecycle }: ResumingViewProps) {
  return (
    <GlobalLayout sideNav={null}>
      <div className="ds-boot">
        <span className="ds-boot-wordmark">{BRANDING.appName}</span>
        <span className="ds-boot-ring" aria-label="Loading" role="status" />
      </div>
    </GlobalLayout>
  );
}
