import { KeyRound } from 'lucide-react';
import { registerModule } from './registry';
import { ConnectionsTab } from '../components/settings/OAuth2Tab';

registerModule({
  id: 'connections',
  name: 'Connections',
  icon: KeyRound,
  settingsPanel: ConnectionsTab,
  settingsEntry: { order: 26 },
});
