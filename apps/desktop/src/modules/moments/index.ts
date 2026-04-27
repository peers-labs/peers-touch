import { Sparkles } from 'lucide-react';
import { registerModule } from '../registry';
import { MomentsFeedPage } from '../../pages/moments/MomentsFeedPage';

registerModule({
  id: 'moments',
  name: 'Moments',
  icon: Sparkles,
  page: MomentsFeedPage,
  sidebarEntry: { position: 'top', order: 25, title: 'Moments' },
});
