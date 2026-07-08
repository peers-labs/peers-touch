import { ATELIER_VIEW_SURFACE } from '../domain/projection.contract.generated';
import type { AtelierViewStatus } from '../domain/projection.contract.generated';

export type OfficialStatusPillTone =
  (typeof ATELIER_VIEW_SURFACE.recovery.statusSeverityByStatus)[AtelierViewStatus];

export interface OfficialStatusPillView {
  tone: OfficialStatusPillTone;
  labelKey: string;
}

const statusSeverityByStatus = ATELIER_VIEW_SURFACE.recovery.statusSeverityByStatus as Record<AtelierViewStatus, OfficialStatusPillTone>;
const statusLabelKeyByStatus: Record<AtelierViewStatus, string> = {
  loading: 'atelier.status.loading',
  empty: 'atelier.status.empty',
  ready: 'atelier.status.ready',
  reconciling: 'atelier.status.reconciling',
  degraded: 'atelier.status.degraded',
  disconnected: 'atelier.status.disconnected',
  'auth-denied': 'atelier.status.authDenied',
  error: 'atelier.status.error',
};

export function deriveOfficialStatusPillView(status: AtelierViewStatus): OfficialStatusPillView {
  return {
    tone: statusSeverityByStatus[status],
    labelKey: statusLabelKeyByStatus[status],
  };
}
