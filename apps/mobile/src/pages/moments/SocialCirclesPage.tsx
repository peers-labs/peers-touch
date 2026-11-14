import type { MobileDetailRoute } from '../../app/navigation';
import { CirclesDetailHeader, SocialCirclesContent } from './SocialCirclesContent';

interface SocialCirclesPageProps {
  readonly onBack: () => void;
  readonly onOpenCircle: (route: Extract<MobileDetailRoute, { routeId: 'detail:social-circle' }>) => void;
}

/** An incoming Circle-list route consumes the same runtime-owned primary pane. */
export function SocialCirclesPage({ onBack, onOpenCircle }: SocialCirclesPageProps) {
  return <SocialCirclesContent query="" onOpenCircle={onOpenCircle}
    header={onCreate => <CirclesDetailHeader onBack={onBack} onCreate={onCreate} />} />;
}
