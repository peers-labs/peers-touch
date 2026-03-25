import { ShieldCheck } from 'lucide-react';
import { registerModule } from './registry';
import { AuthTab } from '../components/settings/OAuth2Tab';

registerModule({
  id: 'auth',
  name: 'Auth',
  icon: ShieldCheck,
  settingsPanel: AuthTab,
  settingsEntry: { order: 25 },
});
