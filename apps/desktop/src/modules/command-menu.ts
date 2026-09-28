import { Command } from 'lucide-react';

import { CommandPaletteSettings } from '../components/settings/CommandPaletteSettings';
import { registerModule } from './registry';

registerModule({
  id: 'command-menu',
  name: 'Command Palette',
  icon: Command,
  settingsPanel: CommandPaletteSettings,
  settingsEntry: {
    order: 46,
    sectionHostPolicy: { cache: 'selected-only' },
  },
});
