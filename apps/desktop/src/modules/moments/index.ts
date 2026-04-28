import { Sparkles } from 'lucide-react';
import { registerModule } from '../registry';
import { MomentsApp } from '../../pages/moments/MomentsApp';

registerModule({
  id: 'moments',
  name: 'Moments',
  icon: Sparkles,
  page: MomentsApp,
  sidebarEntry: { position: 'top', order: 25, title: 'Moments' },
});
