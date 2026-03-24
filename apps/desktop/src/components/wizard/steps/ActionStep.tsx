import { useState, useEffect, useRef } from 'react';
import { Flexbox } from 'react-layout-kit';
import { Button, Progress, Typography, theme } from 'antd';
import { Loader, CheckCircle, XCircle } from 'lucide-react';
import { api } from '../../../services/desktop_api';
import type { WizardStep, WizardAPI } from '../../../services/desktop_api';

const { Text } = Typography;

interface Props {
  step: WizardStep;
  wizardContext: Record<string, any>;
  onNext: (data: Record<string, any>) => void;
  onBack: () => void;
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

async function executeAPI(apiDef: WizardAPI, ctx: Record<string, any>): Promise<void> {
  const apiStr = resolveTemplate(apiDef.api, ctx) as string;
  const body = apiDef.body ? resolveTemplate(apiDef.body, ctx) : undefined;

  const match = apiStr.match(/^(GET|POST|PUT|DELETE)\s+(.+)$/);
  if (!match) throw new Error(`Invalid API format: ${apiStr}`);

  const [, method, path] = match;
  await api.executeWizardApi(
    method as 'GET' | 'POST' | 'PUT' | 'DELETE',
    path,
    body === undefined ? undefined : body,
  );
}

export function ActionStep({ step, wizardContext, onNext, onBack }: Props) {
  const { token } = theme.useToken();
  const actions = step.actions || [];
  const autoExecute = step.config?.auto_execute !== false;

  const [running, setRunning] = useState(false);
  const [current, setCurrent] = useState(0);
  const [completed, setCompleted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const startedRef = useRef(false);

  const execute = async () => {
    if (running) return;
    setRunning(true);
    setError(null);
    setCurrent(0);

    for (let i = 0; i < actions.length; i++) {
      setCurrent(i);
      try {
        await executeAPI(actions[i], wizardContext);
      } catch (e: unknown) {
        if (!actions[i].optional) {
          setError(e instanceof Error ? e.message : 'Action failed');
          setRunning(false);
          return;
        }
      }
    }

    setCurrent(actions.length);
    setRunning(false);
    setCompleted(true);
  };

  useEffect(() => {
    if (autoExecute && !startedRef.current) {
      startedRef.current = true;
      execute();
    }
  }, []);

  useEffect(() => {
    if (completed) {
      const timer = setTimeout(() => onNext({ success: true }), 1500);
      return () => clearTimeout(timer);
    }
  }, [completed]);

  const progress = actions.length > 0 ? Math.round((current / actions.length) * 100) : 0;

  return (
    <Flexbox align="center" justify="center" gap={32} style={{ minHeight: '100%', padding: '40px 24px' }}>
      <Flexbox align="center" gap={12}>
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 16,
            background: 'linear-gradient(135deg, #43e97b, #38f9d7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {completed ? (
            <CheckCircle size={28} color="#fff" />
          ) : (
            <Loader size={28} color="#fff" style={running ? { animation: 'spin 1s linear infinite' } : undefined} />
          )}
        </div>
        <h2 style={{ fontSize: 26, fontWeight: 700, color: token.colorText, margin: 0 }}>
          {step.title}
        </h2>
        {step.desc && (
          <p style={{ fontSize: 15, color: token.colorTextSecondary, margin: 0, textAlign: 'center', maxWidth: 400 }}>
            {step.desc}
          </p>
        )}
      </Flexbox>

      <Flexbox
        align="center"
        gap={20}
        style={{
          width: '100%',
          maxWidth: 420,
          padding: 24,
          borderRadius: 16,
          background: token.colorFillQuaternary,
          border: `1px solid ${token.colorBorderSecondary}`,
        }}
      >
        <Progress
          percent={completed ? 100 : progress}
          status={error ? 'exception' : completed ? 'success' : 'active'}
          style={{ width: '100%' }}
        />

        {running && (
          <Text type="secondary">
            Executing step {current + 1} of {actions.length}...
          </Text>
        )}

        {completed && (
          <Flexbox align="center" gap={8}>
            <CheckCircle size={32} color={token.colorSuccess} />
            <Text strong style={{ color: token.colorSuccess }}>All actions completed</Text>
          </Flexbox>
        )}

        {error && (
          <Flexbox align="center" gap={8}>
            <XCircle size={32} color={token.colorError} />
            <Text type="danger">{error}</Text>
            <Button onClick={execute}>Retry</Button>
          </Flexbox>
        )}
      </Flexbox>

      {!autoExecute && !running && !completed && (
        <Flexbox horizontal gap={12}>
          <Button size="large" onClick={onBack} style={{ height: 44, paddingInline: 32, borderRadius: 22 }}>
            Back
          </Button>
          <Button type="primary" size="large" onClick={execute} style={{ height: 44, paddingInline: 32, borderRadius: 22 }}>
            Execute
          </Button>
        </Flexbox>
      )}

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </Flexbox>
  );
}
