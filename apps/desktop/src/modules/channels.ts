import { Send } from 'lucide-react';
import { registerModule } from './registry';
import { ChannelsSettings } from '../components/settings/ChannelsSettings';

registerModule({
  id: 'channels',
  name: 'Channels',
  icon: Send,
  settingsPanel: ChannelsSettings,
  settingsEntry: {
    order: 40,
    sectionHostPolicy: { cache: 'selected-only' },
  },
});
