/**
 * Barrel re-exports for the navigation module.
 */

export {
  primaryTabDescriptors,
  detailDescriptors,
  overlayDescriptors,
  findNavigationDescriptor,
  navigationDescriptorsByLayout,
  isRouteAvailable,
} from './navigationDescriptors';
export type { NavigationDescriptor, NavigationLayout } from './navigationDescriptors';

export {
  saveScrollPosition,
  restoreScrollPosition,
  clearScrollPosition,
  clearAllScrollPositions,
  saveFocusTarget,
  restoreFocusTarget,
} from './scrollRestoration';

export {
  applyMobileNavigationIntent,
  activeMobileDetailRoute,
  navigationLocationKey,
  readMobileNavigationProjection,
  resetMobileNavigation,
  useMobileNavigationStore,
} from './navigationStore';
export type {
  MobileChatDetailRoute,
  MobileDetailRoute,
  MobileNavigationIntent,
  MobileNavigationProjection,
  MobileOverlayRoute,
  MobilePrimaryRouteId,
  MobileSettingDetailId,
} from './navigationStore';

export {
  registerSettingsExitGuard,
  requestSettingsExit,
} from './settingsExitGuard';
export type {
  SettingsExitAction,
  SettingsExitRequest,
} from './settingsExitGuard';
