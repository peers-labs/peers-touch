import { User } from 'lucide-react';
import { registerModule } from './registry';
import { AccountTab } from '../components/settings/OAuth2Tab';

registerModule({
  id: 'account',
  name: 'OAuth Sign-In',
  icon: User,
  settingsPanel: AccountTab,
  settingsEntry: { order: 20, label: 'OAuth Sign-In' },
});
