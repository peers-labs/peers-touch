import { ATELIER_VIEW_SURFACE } from '../domain/projection.contract.generated';

export interface OfficialCenteredStateView {
  titleKey: string;
  detailKey: string;
}

const centeredStateLabelKeyByStatus = ATELIER_VIEW_SURFACE.centeredStateLabelKeyByStatus;

export type OfficialCenteredStateKind = keyof typeof centeredStateLabelKeyByStatus;

export function deriveOfficialCenteredStateView(status: OfficialCenteredStateKind): OfficialCenteredStateView {
  return centeredStateLabelKeyByStatus[status];
}
