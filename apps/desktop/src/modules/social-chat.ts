import { MessageCircle } from 'lucide-react';
import { registerModule } from './registry';
import { SocialChatPage } from '../pages/SocialChatPage';

registerModule({
  id: 'chat',
  name: 'Chat',
  icon: MessageCircle,
  page: SocialChatPage,
});
