import { type ComponentType, lazy, Suspense } from 'react';
import { useAppLifecycle } from './hooks/useAppLifecycle';
import { useAppRuntime } from './hooks/useAppRuntime';
import { OnboardingView } from './views/OnboardingView';
import { ResumingView } from './views/ResumingView';
import { ReadyView } from './views/ReadyView';
import './services/identityHandlers';
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

  return (
    <>
      <View lifecycle={lifecycle} />
      {DevOverlayProvider && <Suspense fallback={null}><DevOverlayProvider /></Suspense>}
    </>
  );
}

export default App;
