import { Clock } from 'lucide-react';
import { registerModule } from './registry';
import { CronPage } from '../pages/CronPage';

registerModule({
  id: 'cron',
  name: 'Cron Jobs',
  icon: Clock,
  page: CronPage,
  sidebarEntry: { position: 'top', order: 40, title: 'Cron Jobs' },
});
