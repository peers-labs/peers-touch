import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Select, Tooltip, theme } from 'antd';
import { Globe, Lock, UserCheck, Users, UsersRound, Eye } from 'lucide-react';
import { create } from '@bufbuild/protobuf';
import {
  Audience_Kind,
  AudienceSchema,
  type Audience,
} from '../../gen/proto/domain/social/post_pb';

// Audience picker for the composer.
//
// Why some options are disabled in P2:
//   - CIRCLE / GROUP / CUSTOM_ALLOW / CUSTOM_DENY require the server-
//     side ActorResolver + GroupMembershipChecker to enforce
//     visibility for non-author readers. Those land in P3, so
//     publishing under those audiences in P2 would silently fall
//     back to author-only visibility (a noop`Resolver returns no
//     members), which is worse than not offering them at all.
//   - We render them greyed with a tooltip that surfaces the
//     dependency so users understand the gap.
//
// SELF is fully supported: the post is stored on the
// `social_private_posts` table and the audience check trivially
// passes only for the author.

interface AudiencePickerProps {
  value: Audience;
  onChange: (next: Audience) => void;
  disabled?: boolean;
}

interface OptionDef {
  kind: Audience_Kind;
  i18nKey: string;
  Icon: typeof Globe;
  /** True if the option is fully wired in P2; false → greyed + tooltip. */
  enabled: boolean;
}

// Order is the surface a user reads top-to-bottom: most public
// first, most private last, then the disabled-in-P2 options grouped.
const OPTIONS: OptionDef[] = [
  { kind: Audience_Kind.PUBLIC, i18nKey: 'moments.audience.public', Icon: Globe, enabled: true },
  { kind: Audience_Kind.FOLLOWERS, i18nKey: 'moments.audience.followers', Icon: UserCheck, enabled: true },
  { kind: Audience_Kind.SELF, i18nKey: 'moments.audience.self', Icon: Lock, enabled: true },
  { kind: Audience_Kind.CIRCLE, i18nKey: 'moments.audience.circle', Icon: UsersRound, enabled: false },
  { kind: Audience_Kind.GROUP, i18nKey: 'moments.audience.group', Icon: Users, enabled: false },
  { kind: Audience_Kind.CUSTOM_ALLOW, i18nKey: 'moments.audience.customAllow', Icon: Eye, enabled: false },
  { kind: Audience_Kind.CUSTOM_DENY, i18nKey: 'moments.audience.customDeny', Icon: Eye, enabled: false },
];

export function AudiencePicker({ value, onChange, disabled }: AudiencePickerProps) {
  const { t } = useTranslation('moments');
  const { token } = theme.useToken();

  const opts = useMemo(
    () =>
      OPTIONS.map((o) => ({
        value: o.kind,
        label: (
          <Tooltip
            title={o.enabled ? undefined : t('moments.audience.comingP3')}
            placement="left"
          >
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                opacity: o.enabled ? 1 : 0.5,
                cursor: o.enabled ? 'pointer' : 'not-allowed',
              }}
            >
              <o.Icon size={14} color={token.colorTextSecondary} />
              {t(o.i18nKey)}
              {!o.enabled && (
                <span style={{ marginLeft: 4, fontSize: 11, color: token.colorTextTertiary }}>
                  {t('moments.audience.comingP3Tag')}
                </span>
              )}
            </span>
          </Tooltip>
        ),
        disabled: !o.enabled,
      })),
    [t, token.colorTextSecondary, token.colorTextTertiary],
  );

  return (
    <Select
      value={value.kind}
      onChange={(kind) => {
        // Build a fresh `Audience` message rather than mutating the
        // previous one — the composer treats the value as immutable
        // for cheap React equality checks.
        const next = create(AudienceSchema, {
          kind,
          // CIRCLE / GROUP need a target_id and CUSTOM_* need
          // actor_dids; neither flow is wired in P2 so we leave
          // them defaulted. The server gate rejects malformed
          // CIRCLE / GROUP audiences, which means the disabled
          // tooltip is the user-facing prevention rather than a
          // silent server reject.
          targetId: 0n,
          actorDids: [],
        });
        onChange(next);
      }}
      options={opts}
      disabled={disabled}
      style={{ minWidth: 160 }}
      size="middle"
      // popupMatchSelectWidth=false lets the dropdown widen to fit
      // the longer translated labels (e.g. "Followers only").
      popupMatchSelectWidth={false}
    />
  );
}
