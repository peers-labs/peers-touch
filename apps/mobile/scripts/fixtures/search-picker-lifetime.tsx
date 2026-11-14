import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { UIProvider } from '@peers-touch/ui';
import { create } from '@bufbuild/protobuf';
import { MobileI18nProvider } from '../../src/app/mobileI18n';
import { MobileNavigationHost } from '../../src/components/MobileNavigationHost';
import { useSocialCirclesStore } from '../../src/features/social/socialCircles';
import { useSocialStore } from '../../src/features/social/socialStore';
import { SocialCircleMemberPickerPage } from '../../src/pages/moments/SocialCircleMemberPickerPage';
import { MomentAudienceTargetPicker } from '../../src/pages/moments/MomentAudienceTargetPicker';
import { FederationContextSchema } from '../../src/gen/proto/domain/federation/federation_projection_service_pb';
import '../../src/styles.css';
import '../../src/pages/moments/Moments.css';

// Component-only controlled data boundary. The actual pages, stores, Activity
// owner and CSS run unchanged; this fixture never connects to Station.
const actor = {
  id: 'bob', ptid: 'ptid:bob', homeStationPeerId: 'station-test',
  username: 'bob', displayName: 'Bob', avatar: '',
};
const stats = { circleClears: 0, peopleClears: 0, circleSearches: 0, peopleSearches: 0 };
const samples: { circleRows: number; audienceRows: number }[] = [];
const clearCircle = useSocialCirclesStore.getState().clearPickerSearch;
const clearPeople = useSocialStore.getState().clearPeopleSearch;
useSocialCirclesStore.setState({
  refreshMembers: async () => {},
  clearPickerSearch: () => { stats.circleClears += 1; clearCircle(); },
  searchPickerPeople: async () => {
    stats.circleSearches += 1;
    useSocialCirclesStore.setState({ pickerResults: [actor], pickerLoading: false });
  },
});
useSocialStore.setState({
  loadPeerProfile: async () => {},
  refreshFederationContexts: async () => {},
  peopleSearchFederations: [create(FederationContextSchema, {
    federationId: 'fed-test', name: 'Test', status: 'active',
  })],
  clearPeopleSearch: () => { stats.peopleClears += 1; clearPeople(); },
  searchPeople: async () => {
    stats.peopleSearches += 1;
    useSocialStore.setState({ peopleSearchResults: [], peopleSearchLoading: true });
    await Promise.resolve();
    useSocialStore.setState({ peopleSearchResults: [actor], peopleSearchLoading: false });
  },
});
Object.assign(window, { searchPickerLifetimeFixture: { stats, samples } });

function Fixture() {
  const [visible, setVisible] = useState(true);
  const [mounted, setMounted] = useState(true);
  const sampleFirstPaint = () => requestAnimationFrame(() => {
    const visibleRows = (selector: string) => Array.from(document.querySelectorAll(selector))
      .filter(node => !node.closest('[hidden]') && node.getClientRects().length > 0).length;
    samples.push({
      circleRows: visibleRows('[data-acceptance-id="social-circle-member-candidate"]'),
      audienceRows: visibleRows('[data-acceptance-id="social-audience-actor"]'),
    });
  });
  return <UIProvider><MobileI18nProvider>
    <nav onClickCapture={sampleFirstPaint}>
      <button onClick={() => setVisible(false)}>Hide pickers</button>
      <button onClick={() => setVisible(true)}>Show pickers</button>
      <button onClick={() => setMounted(false)}>Exit pickers</button>
    </nav>
    {mounted ? <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', height: 640 }}>
      <div style={{ transform: 'translateZ(0)', height: '100%' }}><MobileNavigationHost primary={visible
        ? { key: 'circle-picker', content: <SocialCircleMemberPickerPage circleId="test" onBack={() => {}} /> }
        : { key: 'circle-sibling', content: <p>Circle sibling</p> }} /></div>
      <div style={{ transform: 'translateZ(0)', height: '100%' }}><MobileNavigationHost primary={visible
        ? { key: 'audience-picker', content: <MomentAudienceTargetPicker choice="CUSTOM_ALLOW"
            selectedActorLabels={{}} selectedActorPtids={[]} onDismiss={() => {}}
            onSelectCircle={() => {}} onSelectGroup={() => {}} onSelectActors={() => {}} /> }
        : { key: 'audience-sibling', content: <p>Audience sibling</p> }} /></div>
    </div> : null}
  </MobileI18nProvider></UIProvider>;
}

createRoot(document.getElementById('root')!).render(<Fixture />);
