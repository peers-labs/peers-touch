import { Users } from 'lucide-react';
import { makeMomentsPage } from './MomentsScaffoldPage';

export const CircleManagePage = makeMomentsPage(
  Users,
  'moments.action.manageCircles',
  'moments.placeholder.circleEmpty',
);
