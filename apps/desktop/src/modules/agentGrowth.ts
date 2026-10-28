import { TrendingUp } from 'lucide-react';
import { registerModule } from './registry';
import { AgentGrowthTab } from '../components/settings/AgentGrowthTab';

registerModule({
  id: 'agent-growth',
  name: 'Agent Growth',
  icon: TrendingUp,
  settingsPanel: AgentGrowthTab,
  settingsEntry: {
    order: 46,
    label: 'Agent Growth',
    sectionHostPolicy: { cache: 'selected-only' },
  },
});
