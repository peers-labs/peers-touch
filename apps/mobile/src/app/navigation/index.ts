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
