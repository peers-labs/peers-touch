import { FileText } from 'lucide-react';
import { registerModule } from './registry';
import { LogsTab } from '../components/LogsTab';

registerModule({
  id: 'logs',
  name: 'Logs',
  icon: FileText,
  settingsPanel: LogsTab,
  settingsEntry: { order: 80, sectionHostPolicy: { cache: 'selected-only' } },
});
