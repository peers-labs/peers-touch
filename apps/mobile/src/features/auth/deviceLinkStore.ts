import { create } from 'zustand';
import type { DeviceLinkProjection } from '../../services/deviceLink';

export interface DeviceLinkSnapshot {
  phase: 'idle' | 'scanning' | 'linking' | 'cancelling' | 'committed' | 'failed';
  projection: DeviceLinkProjection | null;
  busy: boolean;
  errorKey: string | null;
}

export const useDeviceLinkStore = create<DeviceLinkSnapshot>(() => ({
  phase: 'idle',
  projection: null,
  busy: false,
  errorKey: null,
}));
