import { type ComponentType, lazy, Suspense } from 'react';
import { FeedbackHost } from '@peers-touch/ui';
import { useAppLifecycle } from './hooks/useAppLifecycle';
import { useAppRuntime } from './hooks/useAppRuntime';
import { useWindowSurface } from './hooks/useWindowSurface';
import { OnboardingView } from './views/OnboardingView';
import { ResumingView } from './views/ResumingView';
import { ReadyView } from './views/ReadyView';
import { SurfaceTransitionVeil } from './components/SurfaceTransitionVeil';
import './services/identityHandlers';
import { feedbackChannel } from './ui/feedback';
import type { AppState, AppLifecycle } from './types/navigation';

const DevOverlayProvider = import.meta.env.DEV
  ? lazy(() => import('./dev/DevOverlayProvider'))
  : null;

interface ViewProps {
  lifecycle: AppLifecycle;
}

const APP_VIEWS: Record<AppState, ComponentType<ViewProps>> = {
  onboarding: OnboardingView,
  resuming: ResumingView,
  ready: ReadyView,
};

function App() {
  const lifecycle = useAppLifecycle();
  const criticalRuntimeReady = useAppRuntime(lifecycle);

  const viewState = lifecycle.state === 'ready' && !criticalRuntimeReady
    ? 'resuming'
    : lifecycle.state;
  const View = APP_VIEWS[viewState];

  // Owns the native auth/ready geometry transition and the boot veil that
  // hides the resize; the ready shell mounts only once its frame is settled.
  const surfaceTransition = useWindowSurface(viewState);
  const isReadyTransition = viewState === 'ready';
  const mountReadyShell =
    isReadyTransition && surfaceTransition.readySurfaceSettled;

  return (
    <>
      {isReadyTransition ? (
        // The heavy shell mounts only after its frame is settled; the veil
        // covers the gap so the ready shell never paints at an interim width.
        mountReadyShell ? <ReadyView lifecycle={lifecycle} /> : null
      ) : (
        <View lifecycle={lifecycle} />
      )}
      {/* Fixed-position sibling so the same veil covers both the expand
          (login → ready) and the shrink (logout → auth) transitions. */}
      <SurfaceTransitionVeil
        visible={surfaceTransition.veilVisible}
        leaving={surfaceTransition.veilLeaving}
      />
      <FeedbackHost channel={feedbackChannel} />
      {DevOverlayProvider && <Suspense fallback={null}><DevOverlayProvider /></Suspense>}
    </>
  );
}

export default App;
