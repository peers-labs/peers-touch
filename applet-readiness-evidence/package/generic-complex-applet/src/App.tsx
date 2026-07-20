import { useEffect, useState } from '@lynx-js/react';
import { runAppletReadinessFlow } from './main';

type ReadinessState = 'pending' | 'pass' | 'fail';

export function App() {
  const [state, setState] = useState<ReadinessState>('pending');
  const [error, setError] = useState<string>('');

  useEffect(() => {
    let mounted = true;
    void runAppletReadinessFlow()
      .then(() => {
        if (mounted) setState('pass');
      })
      .catch((err: unknown) => {
        if (!mounted) return;
        setError(err instanceof Error ? err.message : String(err));
        setState('fail');
      });
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <view style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 16 }}>
      <text style={{ fontSize: 16, color: state === 'fail' ? '#cf1322' : '#262626' }}>
        {state}
      </text>
      {error ? (
        <text style={{ fontSize: 11, color: '#cf1322', marginTop: 8 }}>
          {error}
        </text>
      ) : null}
    </view>
  );
}
