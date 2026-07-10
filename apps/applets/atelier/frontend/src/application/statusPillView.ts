import { ATELIER_STATUS_LABEL_KEY_BY_STATUS, ATELIER_VIEW_SURFACE } from '../domain/projection.contract.generated';
import type { AtelierViewStatus } from '../domain/projection.contract.generated';

export type OfficialStatusPillTone =
  (typeof ATELIER_VIEW_SURFACE.recovery.statusSeverityByStatus)[AtelierViewStatus];

export interface OfficialStatusPillView {
  tone: OfficialStatusPillTone;
  labelKey: string;
}

const statusSeverityByStatus = ATELIER_VIEW_SURFACE.recovery.statusSeverityByStatus as Record<AtelierViewStatus, OfficialStatusPillTone>;
const statusLabelKeyByStatus = ATELIER_STATUS_LABEL_KEY_BY_STATUS as Record<AtelierViewStatus, string>;

export function deriveOfficialStatusPillView(status: AtelierViewStatus): OfficialStatusPillView {
  return {
    tone: statusSeverityByStatus[status],
    labelKey: statusLabelKeyByStatus[status],
  };
}
