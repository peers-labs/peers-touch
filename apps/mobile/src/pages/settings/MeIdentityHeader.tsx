import { IconButton, Tag, Text } from '@peers-touch/ui';
import { useMobileI18n } from '../../app/mobileI18n';
import { MobileAvatar } from '../../components/MobileAvatar';
import { useAvatarAsset } from '../../runtimes/avatarAssetRuntime';
import type { ProfileImageField } from '../../runtimes/profileImageRuntime';

export interface MeIdentityHeaderModel {
  readonly actorPtid: string;
  readonly displayName: string;
  readonly handle: string;
  readonly avatar: string;
  readonly header: string;
  readonly tags: readonly string[];
  readonly posts: number | null;
  readonly following: number | null;
  readonly followers: number | null;
  readonly joined: string;
}
interface MeIdentityHeaderProps {
  readonly model: MeIdentityHeaderModel;
  readonly editingImage: ProfileImageField | null;
  readonly imageEditUnavailableReason?: string | undefined;
  readonly onPickImage: (field: ProfileImageField) => void;
}

export function MeIdentityHeader({ model, editingImage, imageEditUnavailableReason, onPickImage }: MeIdentityHeaderProps) {
  const { t, language } = useMobileI18n();
  const cover = useAvatarAsset(model.header);
  const joinedDate = new Date(model.joined);
  const joined = model.joined && Number.isFinite(joinedDate.getTime())
    ? new Intl.DateTimeFormat(language, { year: 'numeric', month: 'short' }).format(joinedDate) : '';
  const imageAction = (field: ProfileImageField) => <IconButton
    actionId={`settings.profile.change-${field}`} iconId="edit" density="comfortable" emphasis="secondary"
    label={t(field === 'avatar' ? 'mobile.settings.profile.changeAvatar' : 'mobile.settings.profile.changeCover')}
    execution={editingImage === field ? 'pending' : 'idle'}
    availability={imageEditUnavailableReason
      ? { kind: 'disabled', reason: imageEditUnavailableReason }
      : editingImage ? { kind: 'disabled', reason: t('mobile.settings.profile.imageBusy') } : undefined}
    data-acceptance-id={`settings-profile-${field}-edit`} onActivate={() => onPickImage(field)} />;
  return <header className="mobile-me-identity" data-me-profile>
    <div className="mobile-me-cover" data-hero-cover>
      {cover.src ? <img src={cover.src} alt="" /> : null}
      <span className="mobile-me-cover-action">{imageAction('header')}</span>
    </div>
    <div className="mobile-me-identity-body">
      <div className="mobile-me-avatar" data-hero-avatar>
        <MobileAvatar size={68} identityKey={model.actorPtid} name={model.displayName} src={model.avatar} />
        <span className="mobile-me-avatar-action">{imageAction('avatar')}</span>
      </div>
      <div className="mobile-me-name-row">
        <Text strong className="mobile-me-name" data-hero-name>{model.displayName}</Text>
        {model.tags[0] ? <Tag data-hero-tag>{model.tags[0]}</Tag> : null}
      </div>
      {model.handle ? <Text tone="secondary" data-hero-handle>{model.handle}</Text> : null}
      <div className="mobile-me-statistics" data-hero-stats>
        {([['posts', model.posts], ['following', model.following], ['followers', model.followers]] as const).map(([key, count]) => (
          <span key={key}><Text strong>{count ?? t('mobile.launch.unavailable')}</Text>
            <Text tone="secondary">{t(`mobile.settings.stats.${key}`)}</Text></span>
        ))}
        {joined ? <Text tone="secondary">{t('mobile.settings.profile.joined', { date: joined })}</Text> : null}
      </div>
    </div>
  </header>;
}
