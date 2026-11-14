import { useTranslation } from 'react-i18next';
import { create } from '@bufbuild/protobuf';
import { MomentAudiencePicker } from '@peers-touch/ui';
import { Audience_Kind, AudienceSchema, type Audience } from '../../gen/proto/domain/social/post_pb';

const OPTIONS = [
  [Audience_Kind.PUBLIC, 'public'], [Audience_Kind.FOLLOWERS, 'followers'],
  [Audience_Kind.FRIENDS, 'friends'], [Audience_Kind.CIRCLE, 'circle'],
  [Audience_Kind.GROUP, 'group'], [Audience_Kind.CUSTOM_ALLOW, 'customAllow'],
  [Audience_Kind.CUSTOM_DENY, 'customDeny'], [Audience_Kind.SELF, 'self'],
] as const;

/** Protocol adapter; peers-ui owns the shared audience presentation. */
export function AudiencePicker({ value, onChange, people = [], circles = [], groups = [], disabled }: {
  value: Audience; onChange: (next: Audience) => void;
  people?: readonly { actorPtid: string; label: string }[];
  circles?: readonly { id: string; label: string }[];
  groups?: readonly { conversationId: string; label: string }[]; disabled?: boolean;
}) {
  const { t } = useTranslation('moments');
  const custom = value.kind === Audience_Kind.CUSTOM_ALLOW || value.kind === Audience_Kind.CUSTOM_DENY;
  return <MomentAudiencePicker value={String(value.kind)} disabled={disabled}
    options={OPTIONS.map(([kind, key]) => ({ value: String(kind), label: t(`moments.audience.${key}`) }))}
    onChange={kind => onChange(create(AudienceSchema, {
      kind: Number(kind) as Audience_Kind, actorPtids: [],
      baseKind: Number(kind) === Audience_Kind.CUSTOM_DENY ? Audience_Kind.FOLLOWERS : Audience_Kind.KIND_UNSPECIFIED,
    }))}
    target={value.kind === Audience_Kind.CIRCLE ? {
      label: t('moments.compose.circleAudienceLabel'),
      options: circles.map(circle => ({ value: circle.id, label: circle.label })),
      value: value.target.case === 'circleId' ? value.target.value.toString() : undefined,
      missing: t('moments.placeholder.circleEmpty'),
      onChange: id => onChange(create(AudienceSchema, { kind: Audience_Kind.CIRCLE,
        target: { case: 'circleId', value: BigInt(id) } })),
    } : value.kind === Audience_Kind.GROUP ? {
      label: t('moments.compose.groupAudienceLabel'),
      options: groups.map(group => ({ value: group.conversationId, label: group.label })),
      value: value.target.case === 'groupConversationId' ? value.target.value : undefined,
      missing: t('moments.compose.noGroups'),
      onChange: id => onChange(create(AudienceSchema, { kind: Audience_Kind.GROUP,
        target: { case: 'groupConversationId', value: id } })),
    } : undefined}
    people={people.map(person => ({ id: person.actorPtid, label: person.label }))}
    actorIds={value.actorPtids} onToggleActor={custom ? id => onChange(create(AudienceSchema, {
      kind: value.kind, actorPtids: value.actorPtids.includes(id)
        ? value.actorPtids.filter(actor => actor !== id) : [...value.actorPtids, id].sort(),
      baseKind: value.kind === Audience_Kind.CUSTOM_DENY ? Audience_Kind.FOLLOWERS : Audience_Kind.KIND_UNSPECIFIED,
    })) : undefined}
    copy={{ audience: t('moments.compose.audienceLabel'),
      people: t(value.kind === Audience_Kind.CUSTOM_ALLOW ? 'moments.compose.allowedPeopleLabel' : 'moments.compose.excludedFollowersLabel'),
      noPeople: t('moments.circle.noPeopleFound') }} />;
}
