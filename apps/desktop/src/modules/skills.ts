import { BookMarked } from 'lucide-react';
import { registerModule } from './registry';
import { SkillsTab } from '../components/SkillsTab';

registerModule({
  id: 'skills',
  name: 'Skills',
  icon: BookMarked,
  settingsPanel: SkillsTab,
  settingsEntry: { order: 30 },
});
