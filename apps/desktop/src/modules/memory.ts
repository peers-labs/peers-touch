import { Brain } from 'lucide-react';
import { registerModule } from './registry';
import { MemoryPage } from '../pages/MemoryPage';
import { MemorySettingsTab } from '../components/settings/MemorySettingsTab';

registerModule({
  id: 'memory',
  name: 'Memory',
  icon: Brain,
  page: MemoryPage,
  settingsPanel: MemorySettingsTab,
  sidebarEntry: { position: 'top', order: 35, title: 'Memory' },
  settingsEntry: { order: 25, label: 'Memory & Embedding' },
});
