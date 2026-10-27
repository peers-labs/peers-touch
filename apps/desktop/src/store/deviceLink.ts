import { createDesktopStore } from './createDesktopStore';
import type { DeviceLinkProjection } from '../services/deviceLink';

interface DeviceLinkView {
  open: boolean;
  busy: boolean;
  error: boolean;
  projection: DeviceLinkProjection | null;
  selectedClaimId: string | null;
}
export const useDeviceLinkStore = createDesktopStore<DeviceLinkView>('device-link', () => ({
  open: false, busy: false, error: false, projection: null, selectedClaimId: null,
}));
