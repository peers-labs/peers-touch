import { Cpu } from 'lucide-react';
import { registerModule } from './registry';
import { ModelServiceTab } from '../components/ModelServiceTab';

registerModule({
  id: 'models',
  name: 'Models',
  icon: Cpu,
  settingsPanel: ModelServiceTab,
  settingsEntry: { order: 15 },
});
