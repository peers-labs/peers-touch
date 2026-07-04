import { root } from '@lynx-js/react';
import { useEffect, useState } from '@lynx-js/react';
import { sdk } from '@peers-touch/applet-sdk';

void sdk.storage.set('ios-runtime-e2e', 'ok')
  .then(() => sdk.storage.get('ios-runtime-e2e'));

function RuntimeE2EApplet() {
  const [state, setState] = useState('pending');

  useEffect(() => {
    let mounted = true;
    void sdk.storage.set('ios-runtime-e2e', 'ok')
      .then(() => sdk.storage.get('ios-runtime-e2e'))
      .then((value) => {
        if (value !== 'ok') {
          throw new Error('storage roundtrip mismatch');
        }
        if (mounted) setState('pass');
      })
      .catch((error) => {
        if (mounted) setState(error instanceof Error ? error.message : String(error));
      });
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <view style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0f172a', padding: 24 }}>
      <view style={{ backgroundColor: state === 'pass' ? '#16a34a' : '#f59e0b', borderRadius: 18, paddingTop: 24, paddingBottom: 24, paddingLeft: 28, paddingRight: 28 }}>
        <text style={{ color: '#ffffff', fontSize: 30, fontWeight: 'bold', textAlign: 'center' }}>
          iOS Lynx Runtime E2E
        </text>
        <text style={{ color: '#dcfce7', fontSize: 22, marginTop: 12, textAlign: 'center' }}>
          {state === 'pass' ? 'PASS storage bridge' : state}
        </text>
      </view>
    </view>
  );
}

root.render(<RuntimeE2EApplet />);
