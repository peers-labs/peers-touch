import { MomentTrustMeta } from '@peers-touch/ui';
import { Globe, Lock, MessagesSquare, UserCheck, UserRoundX, UsersRound, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Audience_Kind, RelationshipReason_Kind } from '../../../gen/proto/domain/social/post_pb';

export interface SocialTrustMetaProps {
  source?: { kind?: 'local' | 'remote' | 'unknown'; stationLabel?: string };
  reason?: { label?: string; kind?: RelationshipReason_Kind };
  audience?: { kind: Audience_Kind; label?: string };
}
function audienceIcon(kind: Audience_Kind) {
  const Icon = kind === Audience_Kind.SELF ? Lock : kind === Audience_Kind.FOLLOWERS ? UserCheck
    : kind === Audience_Kind.FRIENDS || kind === Audience_Kind.CUSTOM_ALLOW ? Users
      : kind === Audience_Kind.CIRCLE ? UsersRound : kind === Audience_Kind.GROUP ? MessagesSquare
        : kind === Audience_Kind.CUSTOM_DENY ? UserRoundX : Globe;
  return <Icon size={11} />;
}
/** Protocol labels are adapted here; trust-line presentation lives in peers-ui. */
export function SocialTrustMeta({ source, reason, audience }: SocialTrustMetaProps) {
  const { t } = useTranslation('moments');
  const label = source?.stationLabel?.trim();
  return <MomentTrustMeta segments={[
    ...(source ? [{ id: 'source', label: label
      ? source.kind === 'remote' ? t('moments.source.station', { station: label }) : label
      : t(source.kind === 'unknown' ? 'moments.source.unresolved'
        : source.kind === 'remote' ? 'moments.source.remote' : 'moments.source.local') }] : []),
    ...(reason?.label ? [{ id: 'reason', label: reason.label }] : []),
    ...(audience ? [{ id: 'audience', label: audience.label ?? t('moments.audience.public'),
      icon: audienceIcon(audience.kind) }] : []),
  ]} />;
}
