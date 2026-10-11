import { theme } from 'antd';
import { GlobalLayout } from '../components/GlobalLayout';
import { LoginPage } from '../pages/LoginPage';
import { LanguageSwitcher } from '../components/common/LanguageSwitcher';
import { StationPicker } from '../components/common/StationPicker';
import type { AppLifecycle } from '../types/navigation';

// The app opens straight onto the login surface. The only prerequisite the
// login card itself enforces is a reachable Station (see stationGate).
// A brief, subtle fade avoids a hard cut on launch.
const ENTRANCE_MS = 320;

interface OnboardingViewProps {
  lifecycle: AppLifecycle;
}

export function OnboardingView({ lifecycle }: OnboardingViewProps) {
  const { token } = theme.useToken();

  return (
    <GlobalLayout sideNav={null}>
      <div
        style={{
          width: '100%',
          height: '100%',
          position: 'relative',
          background: token.colorBgLayout,
          overflow: 'hidden',
          animation: `pt-onboarding-fade ${ENTRANCE_MS}ms ease both`,
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 1,
          }}
        >
          <LoginPage
            onComplete={lifecycle.completeLogin}
            onLoginWithOAuthBridge={lifecycle.loginWithOAuthBridge}
            onSwitchAccount={lifecycle.switchAccount}
            onUnlockWithPin={lifecycle.unlockWithPin}
            restoredUser={lifecycle.restoredUser}
            knownAccounts={lifecycle.knownAccounts}
          />
        </div>

        {/* Station picker & language switcher — bottom left */}
        <div
          style={{
            position: 'absolute',
            bottom: 20,
            left: 20,
            zIndex: 3,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <StationPicker />
          <LanguageSwitcher />
        </div>
      </div>
    </GlobalLayout>
  );
}
