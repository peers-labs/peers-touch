import { Blocks } from 'lucide-react';
import { registerModule } from './registry';
import { AppletsPage } from '../pages/AppletsPage';

registerModule({
  id: 'applets',
  name: 'Applets',
  icon: Blocks,
  page: AppletsPage,
  sidebarEntry: { position: 'top', order: 30, title: 'Applets' },
});
