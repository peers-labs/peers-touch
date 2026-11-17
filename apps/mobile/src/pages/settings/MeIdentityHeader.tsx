import { ProfileIdentityHeader } from '../../components/ProfileIdentityHeader';
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

/**
 * Self profile hero. Thin adapter over the shared ProfileIdentityHeader so
 * the settings tab and every peer profile route render one identity layout.
 */
export function MeIdentityHeader({ model, editingImage, imageEditUnavailableReason, onPickImage }: MeIdentityHeaderProps) {
  return <ProfileIdentityHeader
    self
    bleed
    actorPtid={model.actorPtid}
    displayName={model.displayName}
    handle={model.handle}
    avatar={model.avatar}
    cover={model.header}
    tags={model.tags}
    stats={{ posts: model.posts, following: model.following, followers: model.followers }}
    joined={model.joined}
    editingImage={editingImage}
    imageEditUnavailableReason={imageEditUnavailableReason}
    onPickImage={onPickImage}
  />;
}
