import type { ComponentType } from 'react';
import { useAppLifecycle } from './hooks/useAppLifecycle';
import { OnboardingView } from './views/OnboardingView';
import { ReadyView } from './views/ReadyView';
import type { AppState, AppLifecycle } from './types/navigation';

interface ViewProps {
  lifecycle: AppLifecycle;
}

const APP_VIEWS: Record<AppState, ComponentType<ViewProps>> = {
  onboarding: OnboardingView,
  // Warm resume: show ReadyView immediately (auto-transitions from 'resuming' to 'ready')
  resuming: ReadyView,
  ready: ReadyView,
};

function App() {
  const lifecycle = useAppLifecycle();
  const View = APP_VIEWS[lifecycle.state];
  return <View lifecycle={lifecycle} />;
}

export default App;
