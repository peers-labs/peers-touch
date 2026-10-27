import { BookOpen } from 'lucide-react';
import { registerModule } from './registry';
import { KnowledgeSettings } from '../components/settings/KnowledgeSettings';

registerModule({
  id: 'knowledge',
  name: 'Knowledge',
  icon: BookOpen,
  settingsPanel: KnowledgeSettings,
  settingsEntry: {
    order: 26,
    sectionHostPolicy: { cache: 'selected-only' },
  },
});
