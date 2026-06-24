import { ReactNode } from 'react';
import { Typography, theme } from 'antd';
import { Globe, Lock, UserCheck, UsersRound, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  Audience_Kind,
  RelationshipReason_Kind,
} from '../../../gen/proto/domain/social/post_pb';

// SocialTrustMeta — the "source · reason · audience" meta line.
//
// Visual contract:
//   - Always the SAME component, regardless of feed / detail /
//     circle surfaces.
//   - Never over-sized; typography stays in the 12–13px band.
//   - Station domain truncates with ellipsis; long handles get a
//     tooltip, not a line-break.
//   - Icon + label per segment; the middle dot separator is the
//     only chrome.
//
// Honesty contract (from UI Identity / Social Desktop rules):
//   - Missing source / audience / reason are displayed as "unknown"
//     or simply omitted, not fabricated.
//   - Station moderation / policy state does NOT leak into this
//     meta line. If something is hidden, it's handled in a
//     dedicated trust banner above the post, not here.

const { Text } = Typography;

export interface SocialTrustMetaProps {
  source?: {
    kind?: 'local' | 'remote' | 'unknown';
    stationDomain?: string;
  };
  reason?: {
    label?: string;
    /** Optional icon override — otherwise derived from kind if set. */
    kind?: RelationshipReason_Kind;
  };
  audience?: {
    kind: Audience_Kind;
    label?: string;
  };
  children?: ReactNode;
}

function AudienceIcon({ kind }: { kind: Audience_Kind }) {
  const { token } = theme.useToken();
  const size = 11;
  const color = token.colorTextTertiary;
  switch (kind) {
    case Audience_Kind.PUBLIC:
      return <Globe size={size} color={color} />;
    case Audience_Kind.FOLLOWERS:
      return <UserCheck size={size} color={color} />;
    case Audience_Kind.CIRCLE:
      return <UsersRound size={size} color={color} />;
    case Audience_Kind.GROUP:
      return <Users size={size} color={color} />;
    case Audience_Kind.SELF:
      return <Lock size={size} color={color} />;
    default:
      return <Globe size={size} color={color} />;
  }
}

function ReasonIcon({ kind }: { kind?: RelationshipReason_Kind }) {
  const { token } = theme.useToken();
  if (!kind) return null;
  switch (kind) {
    case RelationshipReason_Kind.RELATIONSHIP_REASON_FOLLOWING:
    case RelationshipReason_Kind.RELATIONSHIP_REASON_MUTUAL:
      return <UserCheck size={11} color={token.colorTextTertiary} />;
    case RelationshipReason_Kind.RELATIONSHIP_REASON_CIRCLE:
      return <UsersRound size={11} color={token.colorTextTertiary} />;
    case RelationshipReason_Kind.RELATIONSHIP_REASON_MENTIONED:
      return <Users size={11} color={token.colorTextTertiary} />;
    default:
      return null;
  }
}

export function SocialTrustMeta({ source, reason, audience, children }: SocialTrustMetaProps) {
  const { token } = theme.useToken();
  const { t } = useTranslation('moments');

  const segments: ReactNode[] = [];

  if (source) {
    const label = source.stationDomain
      ? source.kind === 'remote'
        ? t('moments.source.station', { station: source.stationDomain })
        : source.stationDomain
      : source.kind === 'unknown'
        ? t('moments.source.unresolved')
        : t('moments.source.local');
    segments.push(
      <span
        key="source"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          maxWidth: 280,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={source.stationDomain}
      >
        <Globe size={11} color={token.colorTextTertiary} />
        <Text style={{ fontSize: 12, color: token.colorTextSecondary }}>{label}</Text>
      </span>,
    );
  }

  if (reason && reason.label) {
    segments.push(
      <span
        key="reason"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
        }}
      >
        <ReasonIcon kind={reason.kind} />
        <Text style={{ fontSize: 12, color: token.colorTextSecondary }}>{reason.label}</Text>
      </span>,
    );
  }

  if (audience) {
    segments.push(
      <span
        key="audience"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
        }}
      >
        <AudienceIcon kind={audience.kind} />
        <Text style={{ fontSize: 12, color: token.colorTextSecondary }}>
          {audience.label ?? t('moments.audience.public')}
        </Text>
      </span>,
    );
  }

  if (!segments.length && !children) return null;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 8,
        marginTop: 4,
        marginBottom: 4,
      }}
    >
      {segments.map((seg, idx) => (
        <span
          key={idx}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          {seg}
          {idx < segments.length - 1 && (
            <Text style={{ fontSize: 12, color: token.colorTextTertiary }}>·</Text>
          )}
        </span>
      ))}
      {children}
    </div>
  );
}
