import { Bot } from 'lucide-react';
import { registerModule } from './registry';
import { BotsSettings } from '../components/settings/BotsSettings';

registerModule({
  id: 'bots',
  name: 'Bots',
  icon: Bot,
  settingsPanel: BotsSettings,
  settingsEntry: {
    order: 45,
    label: 'Bots',
    sectionHostPolicy: { cache: 'selected-only' },
  },
});
