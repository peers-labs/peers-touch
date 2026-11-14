import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Button } from '@peers-touch/ui';
import { MobileNorthStarProvider } from '../../src/app/MobileNorthStarProvider';
import { MobileI18nProvider } from '../../src/app/mobileI18n';
import { installMobileWebGuards } from '../../src/app/installMobileWebGuards';
import { MobileDebugPanelDrawer } from '../../src/acceptance/debug/MobileDebugPanelDrawer';
import '../../src/styles.css';

Object.assign(window, {
  __TAURI_INTERNALS__: {
    invoke: async () => {
      throw new Error('Native diagnostics unavailable in this component fixture. '.repeat(20));
    },
  },
});
installMobileWebGuards();

function Fixture() {
  const [activations, setActivations] = useState(0);
  return <MobileNorthStarProvider><MobileI18nProvider>
    <main className="page-container" data-test-debug-underlying
      style={{ height: '100dvh', overflow: 'auto' }}>
      {Array.from({ length: 60 }, (_, index) => (
        <p key={index} style={{ minHeight: 32, flexShrink: 0 }}>Underlying row {index}</p>
      ))}
    </main>
    <footer style={{
      position: 'fixed', bottom: 'var(--safe-area-bottom)', height: 'var(--tabbar-height)',
      width: '100%', display: 'flex', justifyContent: 'flex-end',
    }}>
      <Button actionId="debug.fixture.normal-action" density="comfortable"
        onActivate={() => setActivations(count => count + 1)}>
        Normal action {activations}
      </Button>
    </footer>
    <MobileDebugPanelDrawer />
  </MobileI18nProvider></MobileNorthStarProvider>;
}

createRoot(document.getElementById('root')!).render(<Fixture />);
