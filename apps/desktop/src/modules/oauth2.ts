import { KeyRound } from 'lucide-react';
import { registerModule } from './registry';
import { OAuth2Tab } from '../components/settings/OAuth2Tab';

registerModule({
  id: 'oauth',
  name: 'OAuth',
  icon: KeyRound,
  settingsPanel: OAuth2Tab,
  settingsEntry: { order: 20 },
});
