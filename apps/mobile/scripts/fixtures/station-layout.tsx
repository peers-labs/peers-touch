import { createRoot } from 'react-dom/client';
import { UIProvider } from '@peers-touch/ui';

import { MobileI18nProvider } from '../../src/app/mobileI18n';
import { StationSelector } from '../../src/features/station/StationSelector';
import '../../src/styles.css';

const label = new URLSearchParams(window.location.search).has('long')
  ? 'Home Station with a long identity that must remain readable on a narrow screen'
  : 'Home Station';
const station = {
  stationPeerId: 'station-layout-fixture',
  label,
  url: 'https://station.example',
  online: true,
  createdAt: 1,
  lastUsedAt: 1,
};

createRoot(document.getElementById('root')!).render(
  <UIProvider>
    <MobileI18nProvider>
      <div style={{ width: 'min(100% - 44px, 340px)', margin: 22 }}>
        <StationSelector
          entries={[station]}
          activeStationPeerId={station.stationPeerId}
          checking={false}
          verifyingUrls={[]}
          checkedUrls={[station.url]}
          error={null}
          suggestions={[{
            seedId: 'suggested-layout-fixture',
            kind: 'relay',
            displayName: label,
            canonicalOrigin: 'https://relay.example',
            regions: ['global'],
            freshness: 'current',
            actionable: true,
            sourceSequence: 1,
          }]}
          onAdd={async () => false}
          onSelectSuggestion={async () => false}
          onSelect={() => {}}
          onRemove={() => {}}
        />
      </div>
    </MobileI18nProvider>
  </UIProvider>,
);
