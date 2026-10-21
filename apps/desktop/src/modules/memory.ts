import { Brain } from 'lucide-react';
import { registerModule } from './registry';
import { MemorySettingsSection } from '../components/settings/MemorySettingsSection';

registerModule({
  id: 'memory',
  name: 'Memory',
  icon: Brain,
  settingsPanel: MemorySettingsSection,
  settingsEntry: {
    order: 25,
    label: 'Memory',
    sectionHostPolicy: { cache: 'selected-only' },
  },
});
