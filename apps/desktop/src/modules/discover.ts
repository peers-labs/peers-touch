import { Compass } from 'lucide-react';
import { DiscoverSettings } from '../components/settings/DiscoverSettings';
import { registerModule } from './registry';

registerModule({
  id: 'discover',
  name: 'Discover',
  icon: Compass,
  settingsPanel: DiscoverSettings,
  settingsEntry: {
    order: 20,
    label: 'Discover',
    sectionHostPolicy: { cache: 'selected-only' },
  },
});
