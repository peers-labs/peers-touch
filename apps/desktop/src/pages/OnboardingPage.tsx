import { useState } from 'react';
import { Flexbox } from 'react-layout-kit';
import { theme } from 'antd';
import { WelcomeStep } from '../components/onboarding/WelcomeStep';
import { InterestsStep } from '../components/onboarding/InterestsStep';
import { LanguageStep } from '../components/onboarding/LanguageStep';
import { ProviderSetupStep } from '../components/onboarding/ProviderSetupStep';
import { OAuthSignInStep } from '../components/onboarding/OAuthSignInStep';
import { api } from '../services/desktop_api';

interface Props {
  onComplete: () => void;
}

export function OnboardingPage({ onComplete }: Props) {
  const [step, setStep] = useState(0);
  const [interests, setInterests] = useState<string[]>([]);
  const [language, setLanguage] = useState('en');
  const { token } = theme.useToken();

  const handleInterests = (selected: string[]) => {
    setInterests(selected);
    api.setOnboarding({ interests: selected }).catch(() => {});
    setStep(3);
  };

  const handleLanguage = (lang: string) => {
    setLanguage(lang);
    api.setOnboarding({ language: lang }).catch(() => {});
    setStep(4);
  };

  const handleComplete = async () => {
    await api.setOnboarding({ completed: true }).catch(() => {});
    onComplete();
  };

  const steps = [
    <OAuthSignInStep key="oauth-signin" onNext={() => setStep(1)} />,
    <WelcomeStep key="welcome" onNext={() => setStep(2)} />,
    <InterestsStep key="interests" initial={interests} onNext={handleInterests} onBack={() => setStep(1)} />,
    <LanguageStep key="language" initial={language} onNext={handleLanguage} onBack={() => setStep(2)} />,
    <ProviderSetupStep key="provider" onComplete={handleComplete} onBack={() => setStep(3)} />,
  ];

  return (
    <Flexbox
      align="center"
      justify="center"
      style={{
        width: '100vw',
        height: '100vh',
        background: token.colorBgLayout,
      }}
    >
      <Flexbox
        style={{
          width: '100%',
          maxWidth: 560,
          minHeight: 520,
          background: token.colorBgContainer,
          borderRadius: 20,
          boxShadow: token.boxShadowTertiary,
          border: `1px solid ${token.colorBorderSecondary}`,
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        {/* Step indicators */}
        <Flexbox horizontal justify="center" gap={6} style={{ padding: '20px 24px 0' }}>
          {[0, 1, 2, 3, 4].map((i) => (
            <div
              key={i}
              style={{
                width: step === i ? 32 : 8,
                height: 8,
                borderRadius: 4,
                background: step === i ? token.colorPrimary : token.colorFillSecondary,
                transition: 'all 0.3s ease',
              }}
            />
          ))}
        </Flexbox>

        <Flexbox flex={1}>
          {steps[step]}
        </Flexbox>
      </Flexbox>
    </Flexbox>
  );
}
