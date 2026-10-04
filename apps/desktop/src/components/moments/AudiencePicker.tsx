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
  people?: ReadonlyArray<{
    actorPtid: string;
    label: string;
  }>;
  circles?: ReadonlyArray<{
    id: string;
    label: string;
  }>;
  groups?: ReadonlyArray<{
    conversationId: string;
    label: string;
  }>;
  disabled?: boolean;
}

interface OptionDef {
  kind: Audience_Kind;
  i18nKey: string;
  Icon: typeof Globe;
}

// Order is the surface a user reads top-to-bottom: broad audiences first,
// explicit collections next, and the author-only option last.
const OPTIONS: OptionDef[] = [
  { kind: Audience_Kind.PUBLIC, i18nKey: 'moments.audience.public', Icon: Globe },
  { kind: Audience_Kind.FOLLOWERS, i18nKey: 'moments.audience.followers', Icon: Users },
  { kind: Audience_Kind.FRIENDS, i18nKey: 'moments.audience.friends', Icon: Users },
  { kind: Audience_Kind.CIRCLE, i18nKey: 'moments.audience.circle', Icon: Users },
  { kind: Audience_Kind.GROUP, i18nKey: 'moments.audience.group', Icon: Users },
  { kind: Audience_Kind.CUSTOM_ALLOW, i18nKey: 'moments.audience.customAllow', Icon: UserRoundCheck },
  { kind: Audience_Kind.CUSTOM_DENY, i18nKey: 'moments.audience.customDeny', Icon: Users },
  { kind: Audience_Kind.SELF, i18nKey: 'moments.audience.self', Icon: Users },
];

export function AudiencePicker({
  value,
  onChange,
  people = [],
  circles = [],
  groups = [],
  disabled,
}: AudiencePickerProps) {
  const { t } = useTranslation('moments');
  const { token } = theme.useToken();

  const opts = useMemo(
    () => OPTIONS.map((o) => ({
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
      })),
    [t, token.colorTextSecondary],
  );

  return (
    <Space size={6} wrap>
      <Select
        aria-label={t('moments.compose.audienceLabel')}
        data-moments-audience-kind
        value={value.kind}
        onChange={(kind) => {
          const next = create(AudienceSchema, {
            kind,
            target: { case: undefined },
            actorPtids: [],
            baseKind: kind === Audience_Kind.CUSTOM_DENY
              ? Audience_Kind.FOLLOWERS
              : Audience_Kind.KIND_UNSPECIFIED,
          });
          onChange(next);
        }}
        options={opts}
        disabled={disabled}
        style={{ minWidth: 132 }}
        size="small"
        popupMatchSelectWidth={false}
      />
      {value.kind === Audience_Kind.CIRCLE && (
        <Select
          aria-label={t('moments.compose.circleAudienceLabel')}
          data-moments-audience-target="circle"
          value={value.target.case === 'circleId'
            ? value.target.value.toString()
            : undefined}
          placeholder={t('moments.compose.circleAudiencePlaceholder')}
          options={circles.map((circle) => ({
            value: circle.id,
            label: circle.label,
          }))}
          onChange={(circleId) => {
            onChange(create(AudienceSchema, {
              kind: Audience_Kind.CIRCLE,
              target: {
                case: 'circleId',
                value: BigInt(circleId),
              },
            }));
          }}
          disabled={disabled}
          style={{ minWidth: 180, maxWidth: 280 }}
          size="small"
          popupMatchSelectWidth={false}
        />
      )}
      {value.kind === Audience_Kind.GROUP && (
        <Select
          aria-label={t('moments.compose.groupAudienceLabel')}
          data-moments-audience-target="group"
          value={value.target.case === 'groupConversationId'
            ? value.target.value
            : undefined}
          placeholder={t('moments.compose.groupAudiencePlaceholder')}
          options={groups.map((group) => ({
            value: group.conversationId,
            label: group.label,
          }))}
          onChange={(groupConversationId) => {
            onChange(create(AudienceSchema, {
              kind: Audience_Kind.GROUP,
              target: {
                case: 'groupConversationId',
                value: groupConversationId,
              },
            }));
          }}
          disabled={disabled}
          style={{ minWidth: 180, maxWidth: 280 }}
          size="small"
          popupMatchSelectWidth={false}
        />
      )}
      {(value.kind === Audience_Kind.CUSTOM_ALLOW
        || value.kind === Audience_Kind.CUSTOM_DENY) && (
        <Select
          aria-label={value.kind === Audience_Kind.CUSTOM_ALLOW
            ? t('moments.compose.allowedPeopleLabel')
            : t('moments.compose.excludedFollowersLabel')}
          data-moments-audience-actors
          mode="multiple"
          value={[...value.actorPtids]}
          placeholder={value.kind === Audience_Kind.CUSTOM_ALLOW
            ? t('moments.compose.allowedPeoplePlaceholder')
            : t('moments.compose.excludedFollowersPlaceholder')}
          options={people.map((person) => ({
            value: person.actorPtid,
            label: person.label,
          }))}
          onChange={(actorPtids) => {
            onChange(create(AudienceSchema, {
              kind: value.kind,
              target: { case: undefined },
              actorPtids: [...actorPtids].sort(),
              baseKind: value.kind === Audience_Kind.CUSTOM_DENY
                ? Audience_Kind.FOLLOWERS
                : Audience_Kind.KIND_UNSPECIFIED,
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
