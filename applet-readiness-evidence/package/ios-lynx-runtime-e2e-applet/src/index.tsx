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
    <view style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
      <text>{state}</text>
    </view>
  );
}

root.render(<RuntimeE2EApplet />);
