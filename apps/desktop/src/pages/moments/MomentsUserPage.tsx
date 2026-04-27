import { UserRound } from 'lucide-react';
import { makeMomentsPage } from './MomentsScaffoldPage';

export const MomentsUserPage = makeMomentsPage(
  UserRound,
  'moments.tab.profile',
  'moments.placeholder.userEmpty',
);
