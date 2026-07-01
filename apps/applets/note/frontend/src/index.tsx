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

root.render(<NoteAppletPage />);

setTimeout(() => {
  void bootstrapOfficialApplet().catch((error) => {
    sdk.telemetry.reportError({
      code: 'NOTE_BOOTSTRAP_FAILED',
      message: error instanceof Error ? error.message : 'Note applet bootstrap failed',
      details: { source: 'note.bootstrap' },
    }).catch(() => undefined);
  });
}, 0);
