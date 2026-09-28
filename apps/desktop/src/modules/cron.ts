import { Clock } from 'lucide-react';
import { registerModule } from './registry';
import { CronJobsSettings } from '../components/settings/CronJobsSettings';

registerModule({
  id: 'cron',
  name: 'Cron Jobs',
  icon: Clock,
  settingsPanel: CronJobsSettings,
  settingsEntry: {
    order: 45,
    sectionHostPolicy: { cache: 'selected-only' },
  },
});
