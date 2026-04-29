import { MessageSquare } from 'lucide-react';
import { makeMomentsPage } from './MomentsScaffoldPage';

export const MomentDetailPage = makeMomentsPage(
  MessageSquare,
  'moments.action.openPost',
  'moments.placeholder.detailEmpty',
);
