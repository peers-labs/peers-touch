import { root } from '@lynx-js/react';
import { sdk } from '@peers-touch/applet-sdk';
import { AtelierAppletPage } from './presentation/pages/AtelierAppletPage';

export async function bootstrapOfficialApplet() {
  await sdk.lifecycle.reportReady();
  await sdk.telemetry.track({
    name: 'official_applet.bootstrap',
    properties: {
      service: 'atelier',
    },
  });
}

root.render(<AtelierAppletPage />);

setTimeout(() => {
  void bootstrapOfficialApplet().catch((error) => {
    sdk.telemetry.reportError({
      code: 'ATELIER_BOOTSTRAP_FAILED',
      message: error instanceof Error ? error.message : 'Atelier applet bootstrap failed',
      details: { source: 'atelier.bootstrap' },
    }).catch(() => undefined);
  });
}, 0);
