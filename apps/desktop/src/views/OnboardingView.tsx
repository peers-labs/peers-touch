import { GlobalLayout } from '../components/GlobalLayout';
import { LoginPage } from '../pages/LoginPage';
import type { AppLifecycle } from '../types/navigation';

// The app opens straight onto the login surface. The auth card owns sign-in and
// the Station switcher; the only prerequisite is a reachable Station.

interface OnboardingViewProps {
  lifecycle: AppLifecycle;
}

export function OnboardingView({ lifecycle }: OnboardingViewProps) {
  return (
    <GlobalLayout sideNav={null}>
      <LoginPage
        onComplete={lifecycle.completeLogin}
        onLoginWithOAuthBridge={lifecycle.loginWithOAuthBridge}
        onFreshPasswordAuthenticated={lifecycle.freshPasswordAuthenticated}
        onSwitchAccount={lifecycle.switchAccount}
        onUnlockWithPin={lifecycle.unlockWithPin}
        restoredUser={lifecycle.restoredUser}
        knownAccounts={lifecycle.knownAccounts}
      />
    </GlobalLayout>
  );
}
