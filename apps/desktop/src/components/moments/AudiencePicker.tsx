import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Select, Space, theme } from 'antd';
import { Globe, UserRoundCheck, Users } from 'lucide-react';
import { create } from '@bufbuild/protobuf';
import {
  Audience_Kind,
  AudienceSchema,
  type Audience,
} from '../../gen/proto/domain/social/post_pb';

// Audience picker for the composer.
//
// Only fully wired audiences are shown. Unsupported modes stay out of
// the composer instead of appearing as disabled future-work clutter.

interface AudiencePickerProps {
  value: Audience;
  onChange: (next: Audience) => void;
  remoteFriends?: ReadonlyArray<{
    actorPtid: string;
    label: string;
  }>;
  disabled?: boolean;
}

interface OptionDef {
  kind: Audience_Kind;
  i18nKey: string;
  Icon: typeof Globe;
}

// Order is the surface a user reads top-to-bottom: most public
// first, most private last, then the disabled-in-P2 options grouped.
const OPTIONS: OptionDef[] = [
  { kind: Audience_Kind.PUBLIC, i18nKey: 'moments.audience.public', Icon: Globe },
  { kind: Audience_Kind.FOLLOWERS, i18nKey: 'moments.audience.followers', Icon: Users },
  { kind: Audience_Kind.FRIENDS, i18nKey: 'moments.audience.friends', Icon: Users },
  { kind: Audience_Kind.SELF, i18nKey: 'moments.audience.self', Icon: Users },
];

export function AudiencePicker({
  value,
  onChange,
  remoteFriends = [],
  disabled,
}: AudiencePickerProps) {
  const { t } = useTranslation('moments');
  const { token } = theme.useToken();

  const opts = useMemo(() => {
    const available = value.kind === Audience_Kind.CUSTOM_ALLOW || remoteFriends.length > 0
      ? [
          ...OPTIONS,
          {
            kind: Audience_Kind.CUSTOM_ALLOW,
            i18nKey: 'moments.audience.singleFriend',
            Icon: UserRoundCheck,
          },
        ]
      : OPTIONS;
    return available.map((o) => ({
        value: o.kind,
        label: (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <o.Icon size={14} color={token.colorTextSecondary} />
            {t(o.i18nKey)}
          </span>
        ),
      }));
  }, [remoteFriends.length, t, token.colorTextSecondary, value.kind]);

  return (
    <Space size={6} wrap>
      <Select
        value={value.kind}
        onChange={(kind) => {
          const next = create(AudienceSchema, {
            kind,
            target: { case: undefined },
            actorPtids: [],
          });
          onChange(next);
        }}
        options={opts}
        disabled={disabled}
        style={{ minWidth: 132 }}
        size="small"
        popupMatchSelectWidth={false}
      />
      {value.kind === Audience_Kind.CUSTOM_ALLOW && (
        <Select
          aria-label={t('moments.compose.remoteFriendLabel')}
          data-moments-remote-friend-picker
          value={value.actorPtids[0] || undefined}
          placeholder={t('moments.compose.remoteFriendPlaceholder')}
          options={remoteFriends.map((friend) => ({
            value: friend.actorPtid,
            label: friend.label,
          }))}
          onChange={(actorPtid) => {
            onChange(create(AudienceSchema, {
              kind: Audience_Kind.CUSTOM_ALLOW,
              target: { case: undefined },
              actorPtids: [actorPtid],
            }));
          }}
          disabled={disabled}
          style={{ minWidth: 180, maxWidth: 280 }}
          size="small"
          popupMatchSelectWidth={false}
        />
      )}
    </Space>
  );
}
