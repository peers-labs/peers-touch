import { Sparkles } from 'lucide-react';
import { makeMomentsPage } from './MomentsScaffoldPage';

export const MomentsFeedPage = makeMomentsPage(
  Sparkles,
  'moments.title',
  'moments.placeholder.feedEmpty',
  'moments.subtitle',
);
