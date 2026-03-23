import { useState, useEffect, useCallback } from 'react';
import { Flexbox } from 'react-layout-kit';
import { Spin, theme } from 'antd';
import { api } from '../../services/api';
import type { WizardConfig, WizardStep as WizardStepType, WizardAPI } from '../../services/api';
import { WelcomeStep } from './steps/WelcomeStep';
import { OAuthLoginStep } from './steps/OAuthLoginStep';
import { ProviderSelectStep } from './steps/ProviderSelectStep';
import { FormStep } from './steps/FormStep';
import { ActionStep } from './steps/ActionStep';
import { CompleteStep } from './steps/CompleteStep';

interface Props {
  onComplete: () => void;
}

function resolveTemplate(value: any, ctx: Record<string, any>): any {
  if (typeof value === 'string') {
    return value.replace(/\{\{\.(\w+)\.(\w+)\}\}/g, (_, stepId, field) => {
      return ctx[stepId]?.[field] ?? '';
    });
  }
  if (typeof value === 'object' && value !== null) {
    if (Array.isArray(value)) {
      return value.map((v) => resolveTemplate(v, ctx));
    }
    const result: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) {
      result[k] = resolveTemplate(v, ctx);
    }
    return result;
  }
  return value;
}

async function executeOnSubmitAPIs(apis: WizardAPI[], ctx: Record<string, any>): Promise<void> {
  const BASE_URL = import.meta.env.VITE_API_URL || '/api';
  for (const apiDef of apis) {
    const apiStr = resolveTemplate(apiDef.api, ctx) as string;
    const body = apiDef.body ? resolveTemplate(apiDef.body, ctx) : undefined;

    const match = apiStr.match(/^(GET|POST|PUT|DELETE)\s+(.+)$/);
    if (!match) continue;

    const [, method, path] = match;
    const url = path.startsWith('/api') ? path.replace(/^\/api/, BASE_URL) : `${BASE_URL}${path}`;

    await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(typeof body === 'string' ? JSON.parse(body) : body) : undefined,
    });
  }
}

export function WizardRenderer({ onComplete }: Props) {
  const { token } = theme.useToken();
  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState<WizardConfig | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [wizardContext, setWizardContext] = useState<Record<string, any>>({});

  useEffect(() => {
    Promise.all([api.getWizard(), api.getWizardState()])
      .then(([wizardResp, state]) => {
        if (wizardResp.available && wizardResp.config) {
          setConfig(wizardResp.config);

          if (state.context && Object.keys(state.context).length > 0) {
            setWizardContext(state.context);
          }

          if (state.current_step && wizardResp.config.steps) {
            const idx = wizardResp.config.steps.findIndex((s) => s.id === state.current_step);
            if (idx >= 0) setStepIndex(idx);
          }
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const handleStepNext = useCallback(async (stepId: string, data: Record<string, any>) => {
    const newContext = { ...wizardContext, [stepId]: data };
    setWizardContext(newContext);

    try {
      await api.saveWizardStep(stepId, data);
    } catch {
      // Non-critical; continue even if state save fails
    }

    // Execute on_submit APIs if defined
    const currentStep = config?.steps.find((s) => s.id === stepId);
    if (currentStep?.on_submit && currentStep.on_submit.length > 0) {
      try {
        await executeOnSubmitAPIs(currentStep.on_submit, newContext);
      } catch {
        // Non-critical
      }
    }

    setStepIndex((prev) => prev + 1);
  }, [wizardContext, config]);

  const handleComplete = useCallback(async () => {
    try {
      await api.completeWizard();
    } catch {
      // Fallback
      await api.setOnboarding({ completed: true }).catch(() => {});
    }
    onComplete();
  }, [onComplete]);

  if (loading) {
    return (
      <Flexbox align="center" justify="center" style={{ width: '100vw', height: '100vh' }}>
        <Spin size="large" />
      </Flexbox>
    );
  }

  if (!config) {
    return null;
  }

  const steps = config.steps;
  const currentStep = steps[stepIndex];

  if (!currentStep) {
    handleComplete();
    return null;
  }

  const renderStep = (step: WizardStepType) => {
    switch (step.type) {
      case 'welcome':
        return (
          <WelcomeStep
            step={step}
            branding={config.branding}
            onNext={() => handleStepNext(step.id, {})}
          />
        );
      case 'oauth_login':
        return (
          <OAuthLoginStep
            step={step}
            onNext={(data) => handleStepNext(step.id, data)}
            onBack={() => setStepIndex((prev) => Math.max(0, prev - 1))}
          />
        );
      case 'provider_select':
        return (
          <ProviderSelectStep
            step={step}
            onNext={(data) => handleStepNext(step.id, data)}
            onBack={() => setStepIndex((prev) => Math.max(0, prev - 1))}
          />
        );
      case 'form':
        return (
          <FormStep
            step={step}
            onNext={(data) => handleStepNext(step.id, data)}
            onBack={() => setStepIndex((prev) => Math.max(0, prev - 1))}
          />
        );
      case 'action':
        return (
          <ActionStep
            step={step}
            wizardContext={wizardContext}
            onNext={(data) => handleStepNext(step.id, data)}
            onBack={() => setStepIndex((prev) => Math.max(0, prev - 1))}
          />
        );
      case 'complete':
        return (
          <CompleteStep
            step={step}
            wizardContext={wizardContext}
            onComplete={handleComplete}
          />
        );
      default:
        return null;
    }
  };

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
          {steps.map((s, i) => (
            <div
              key={s.id}
              style={{
                width: stepIndex === i ? 32 : 8,
                height: 8,
                borderRadius: 4,
                background: stepIndex === i
                  ? (config.branding.primary_color || token.colorPrimary)
                  : i < stepIndex
                    ? token.colorPrimaryBg
                    : token.colorFillSecondary,
                transition: 'all 0.3s ease',
              }}
            />
          ))}
        </Flexbox>

        <Flexbox flex={1}>
          {renderStep(currentStep)}
        </Flexbox>
      </Flexbox>
    </Flexbox>
  );
}
