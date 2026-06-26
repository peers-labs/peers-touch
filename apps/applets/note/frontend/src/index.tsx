import { root } from '@lynx-js/react';
import { sdk } from '@peers-touch/applet-sdk';
import { NoteAppletPage } from './presentation/pages/NoteAppletPage';

export async function bootstrapOfficialApplet() {
  await sdk.lifecycle.reportReady();
  await sdk.telemetry.track({
    name: 'official_applet.bootstrap',
    properties: {
      service: 'note',
    },
  });
}

void bootstrapOfficialApplet();

root.render(<NoteAppletPage />);
