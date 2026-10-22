import { Send } from 'lucide-react';
import { registerModule } from './registry';
import { LarkChannelsSettings } from '../components/settings/channels/LarkChannelsSettings';

registerModule({
  id: 'channels',
  name: 'Channels',
  icon: Send,
  settingsPanel: LarkChannelsSettings,
  settingsEntry: {
    order: 40,
    sectionHostPolicy: { cache: 'selected-only' },
  },
});
