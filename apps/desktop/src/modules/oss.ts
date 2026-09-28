import { FolderOpen } from 'lucide-react';
import { registerModule } from './registry';
import { MyFilesSettings } from '../components/settings/MyFilesSettings';

registerModule({
  id: 'oss',
  name: 'My Files',
  icon: FolderOpen,
  settingsPanel: MyFilesSettings,
  settingsEntry: {
    order: 52,
    sectionHostPolicy: { cache: 'selected-only' },
  },
});
