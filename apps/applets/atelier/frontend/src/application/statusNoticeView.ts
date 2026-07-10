import { ATELIER_VIEW_SURFACE } from '../domain/projection.contract.generated';
import type { AtelierStatusNoticeKind } from '../domain/projection.contract.generated';

export interface OfficialStatusNoticeView {
  titleKey: string;
  detailKey: string;
}

const statusNoticeLabelKeyByStatus = ATELIER_VIEW_SURFACE.statusNoticeLabelKeyByStatus satisfies Record<
  AtelierStatusNoticeKind,
  OfficialStatusNoticeView
>;

export function deriveOfficialStatusNoticeView(status: AtelierStatusNoticeKind): OfficialStatusNoticeView {
  return statusNoticeLabelKeyByStatus[status];
}
