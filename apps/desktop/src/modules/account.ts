import { User } from 'lucide-react';
import { registerModule } from './registry';
import { AccountTab } from '../components/settings/OAuth2Tab';

registerModule({
  id: 'account',
  name: 'Account',
  icon: User,
  settingsPanel: AccountTab,
  settingsEntry: { order: 20 },
});
