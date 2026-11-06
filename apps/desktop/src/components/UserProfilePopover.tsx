import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Popover, Spin } from '@peers-touch/ui';
import { useSessionStore } from '../store/session';
import { api, type AccountProfile } from '../services/desktop_api';
import { PublicProfileCard, type PublicProfileModel } from './profile/PublicProfileCard';
import { ProfilePrimaryAction } from './profile/ProfilePrimaryAction';
import { mergeAccountProfile } from './profile/profileModel';

interface Props {
  children: ReactNode;
}

/**
 * Self profile popover. Reuses PublicProfileCard — the only differences from
 * a peer card are the self profile fetch and the management primary action,
 * both supplied as props by this owner.
 */
export function UserProfilePopover({ children }: Props) {
  const [open, setOpen] = useState(false);
  const { t } = useTranslation('layout');
  const currentUser = useSessionStore((s) => s.currentUser);

  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [loading, setLoading] = useState(false);

  const model = useMemo<PublicProfileModel>(() => {
    const fallback: PublicProfileModel = {
      displayName: currentUser?.name || t('layout.user.defaultName'),
      avatar: currentUser?.avatarUrl,
      did: currentUser?.actorPtid,
    };
    if (!profile) return fallback;
    return mergeAccountProfile(
      fallback,
      profile,
      {
        posts: t('layout.user.posts'),
        followers: t('layout.user.followers'),
        following: t('layout.user.following'),
      },
      t('layout.user.joined'),
    );
  }, [currentUser, profile, t]);

  const content = (
    <div style={{ width: 320 }}>
      {loading && !profile ? (
        <div style={{ height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Spin size="small" />
        </div>
      ) : (
        <PublicProfileCard
          profile={model}
          actions={currentUser?.actorPtid ? (
            <ProfilePrimaryAction actorPtid={currentUser.actorPtid} />
          ) : null}
        />
      )}
    </div>
  );

  return (
    <Popover
      content={content}
      placement="right-bottom"
      open={open}
      className="ds-self-popover"
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen) {
          setLoading(true);
          api
            .profileGet()
            .then((p) => setProfile(p))
            .catch(() => {})
            .finally(() => setLoading(false));
        }
      }}
    >
      {children}
    </Popover>
  );
}

export function useUserAvatar(): { ptid?: string; url?: string; name: string; provider?: string } {
  const currentUser = useSessionStore((s) => s.currentUser);
  const { t } = useTranslation('layout');

  return useMemo(
    () => ({
      ptid: currentUser?.actorPtid || undefined,
      url: currentUser?.avatarUrl || undefined,
      name: currentUser?.name || t('layout.user.defaultName'),
      provider: currentUser?.loginProvider || currentUser?.loginMethod || undefined,
    }),
    [currentUser, t],
  );
}
