import { Send } from 'lucide-react';
import { registerModule } from './registry';
import { ChannelsTab } from '../components/ChannelsTab';
import { ChannelsPage } from '../pages/ChannelsPage';

registerModule({
  id: 'channels',
  name: 'Channels',
  icon: Send,
  page: ChannelsPage,
  settingsPanel: ChannelsTab,
  sidebarEntry: { position: 'top', order: 50, title: 'Channels' },
  settingsEntry: { order: 40 },
});
