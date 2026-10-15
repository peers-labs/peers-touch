import type {
  MobileDetailRoute,
  MobileOverlayRoute,
} from '../app/navigation';
import type { MobileAuthSession } from '../features/auth/authSession';
import type { StoredStationRegistry } from '../features/station/stationRegistry';
import { ChatPage } from '../pages/ChatPage';
import { ContactsPage } from '../pages/ContactsPage';
import { MomentsPage } from '../pages/MomentsPage';
import { SettingsPage } from '../pages/SettingsPage';
import { SocialCircleDetailPage } from '../pages/moments/SocialCircleDetailPage';
import { SocialCircleMemberPickerPage } from '../pages/moments/SocialCircleMemberPickerPage';
import { SocialCirclesPage } from '../pages/moments/SocialCirclesPage';
import { SocialProfilePage } from '../pages/moments/SocialProfilePage';
import { SocialSearchPage } from '../pages/moments/SocialSearchPage';

export type MobileTabId = 'chat' | 'moments' | 'contacts' | 'settings';

export function mobileDetailTab(route: MobileDetailRoute | null): MobileTabId | null {
  switch (route?.routeId) {
    case 'detail:chat-conversation':
    case 'detail:group-conversation':
      return 'chat';
    case 'detail:contact-profile':
      return 'contacts';
    case 'detail:moment':
    case 'detail:social-search':
    case 'detail:social-profile':
    case 'detail:social-circles':
    case 'detail:social-circle':
    case 'detail:social-circle-members':
      return 'moments';
    case 'detail:setting':
      return 'settings';
    default:
      return null;
  }
}

/** Selected-only page composition; all freshness remains in the feature owners. */
export function MobilePageHost({
  tabId, stationRegistry, authSession, activeDetail, activeOverlay,
  onStartConversation, onOpenDetail, onOpenOverlay, onCloseOverlay,
  onBack, onMomentsImmersiveVisibilityChange, onChangeStation, onLogout,
}: {
  readonly tabId: MobileTabId;
  readonly stationRegistry: StoredStationRegistry;
  readonly authSession: MobileAuthSession | null;
  readonly activeDetail: MobileDetailRoute | null;
  readonly activeOverlay: MobileOverlayRoute | null;
  readonly onStartConversation: () => void;
  readonly onOpenDetail: (route: MobileDetailRoute) => void;
  readonly onOpenOverlay: (route: MobileOverlayRoute) => void;
  readonly onCloseOverlay: () => void;
  readonly onBack: () => void;
  readonly onMomentsImmersiveVisibilityChange: (visible: boolean) => void;
  readonly onChangeStation: () => Promise<void>;
  readonly onLogout: () => Promise<void>;
}) {
  switch (tabId) {
    case 'chat':
      return <ChatPage
        activeDetail={activeDetail?.routeId === 'detail:chat-conversation'
          || activeDetail?.routeId === 'detail:group-conversation' ? activeDetail : null}
        onStartConversation={onStartConversation}
        onBack={onBack}
        onOpenConversation={onOpenDetail}
        onOpenContact={(actorPtid) => onOpenDetail({ routeId: 'detail:contact-profile', actorPtid })}
      />;
    case 'contacts':
      return <ContactsPage
        activeContactPtid={activeDetail?.routeId === 'detail:contact-profile' ? activeDetail.actorPtid : null}
        activeOverlay={activeOverlay}
        onOpenChat={onOpenDetail}
        onOpenContact={(actorPtid) => onOpenDetail({ routeId: 'detail:contact-profile', actorPtid })}
        onOpenOverlay={onOpenOverlay}
        onCloseOverlay={onCloseOverlay}
        onBack={onBack}
      />;
    case 'settings':
      return <SettingsPage
        authSession={authSession}
        stationRegistry={stationRegistry}
        activeSettingId={activeDetail?.routeId === 'detail:setting' ? activeDetail.settingId : null}
        onOpenSetting={(settingId) => onOpenDetail({ routeId: 'detail:setting', settingId })}
        onBack={onBack}
        onChangeStation={onChangeStation}
        onLogout={onLogout}
      />;
    case 'moments':
      switch (activeDetail?.routeId) {
        case 'detail:social-search':
          return <SocialSearchPage onBack={onBack} onOpenProfile={onOpenDetail} />;
        case 'detail:social-circles':
          return <SocialCirclesPage onBack={onBack} onOpenCircle={onOpenDetail} />;
        case 'detail:social-circle':
          return <SocialCircleDetailPage circleId={activeDetail.circleId}
            onBack={onBack} onOpenMembers={onOpenDetail} />;
        case 'detail:social-circle-members':
          return <SocialCircleMemberPickerPage circleId={activeDetail.circleId} onBack={onBack} />;
        case 'detail:social-profile':
          return <SocialProfilePage actorPtid={activeDetail.actorPtid} federationId={activeDetail.federationId}
            onBack={onBack} onOpenChat={onOpenDetail}
            onOpenMoment={(postId) => onOpenDetail({ routeId: 'detail:moment', postId })} />;
        default:
          return <MomentsPage
            activePostId={activeDetail?.routeId === 'detail:moment' ? activeDetail.postId : null}
            onOpenProfile={(actorPtid, federationId) => onOpenDetail({
              routeId: 'detail:social-profile', actorPtid, federationId,
            })}
            onOpenSearch={() => onOpenDetail({ routeId: 'detail:social-search' })}
            onOpenCircles={() => onOpenDetail({ routeId: 'detail:social-circles' })}
            onImmersiveVisibilityChange={onMomentsImmersiveVisibilityChange}
            onBack={onBack}
          />;
      }
  }
}
