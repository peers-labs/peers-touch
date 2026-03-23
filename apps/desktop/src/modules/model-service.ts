import { Cpu } from 'lucide-react';
import { registerModule } from './registry';
import { ModelServiceTab } from '../components/ModelServiceTab';

registerModule({
  id: 'models',
  name: 'Model Service',
  icon: Cpu,
  settingsPanel: ModelServiceTab,
  settingsEntry: { order: 15 },
});
