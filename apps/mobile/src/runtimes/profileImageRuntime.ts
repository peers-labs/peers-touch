import { useSyncExternalStore } from 'react';
import { ProfileUpdateOutcome } from '../gen/proto/domain/actor/actor_pb';
import type { MobileRuntimeDescriptor } from '../app/lifecycle/types';
import type { MobileAuthSession } from '../features/auth/authSession';
import { useAuthStore } from '../features/auth/authStore';
import { mobileAuthScopeKey } from '../features/auth/mobileAuthIdentity';
import { useSocialStore } from '../features/social/socialStore';
import { readCurrentSocialProfile, updateCurrentSocialProfile } from '../features/social/socialRuntime';
import {
  createNativeMediaRequestId, discardNativeProfileImage, pickNativeMedia,
  previewNativeProfileImage, releaseNativeProfileImagePreview, uploadNativeProfileImage,
  type NativeMomentMediaInput,
} from '../services/mobileCommands';
import { prepareAvatarAsset } from './avatarAssetRuntime';
import { requireMobileMutationAdmission } from './mutationAdmission';

export type ProfileImageField = 'avatar' | 'header';
interface ImageDraft {
  readonly session: MobileAuthSession;
  readonly input: NativeMomentMediaInput;
  readonly field: ProfileImageField;
  readonly assetUrl: string;
  readonly accessHandle: string;
  readonly uploadedUrl: string;
  readonly committed: boolean;
  readonly observedRevision: bigint;
}
interface ProfileImageSnapshot {
  readonly status: 'idle' | 'picking' | 'uploading' | 'saving' | 'failed';
  readonly field: ProfileImageField | null;
  readonly draft: ImageDraft | null;
  readonly errorKey: string | null;
}
const EMPTY: ProfileImageSnapshot = Object.freeze({ status: 'idle', field: null, draft: null, errorKey: null });
let snapshot = EMPTY;
let revision = 0;
const listeners = new Set<() => void>();
const publish = (next: ProfileImageSnapshot) => {
  snapshot = Object.freeze(next);
  listeners.forEach(listener => listener());
};
const currentSession = (session: MobileAuthSession) => {
  const active = useAuthStore.getState().session;
  const social = useSocialStore.getState().authSession;
  return Boolean(active && social && active.sessionId === session.sessionId
    && social.sessionId === session.sessionId
    && mobileAuthScopeKey(active) === mobileAuthScopeKey(session)
    && mobileAuthScopeKey(social) === mobileAuthScopeKey(session));
};
const dispose = async (draft: ImageDraft | null) => {
  if (!draft) return;
  await releaseNativeProfileImagePreview(draft.accessHandle).catch(() => undefined);
  await discardNativeProfileImage(draft.input).catch(() => undefined);
};
const busy = () => ['picking', 'uploading', 'saving'].includes(snapshot.status);
function imageErrorKey(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error && error.code === 'MOBILE_PROFILE_IMAGE_FORMAT') {
    return 'mobile.settings.profile.imageFormat';
  }
  return error instanceof Error ? error.message : 'mobile.settings.profile.imageSaveFailed';
}

async function commit(draft: ImageDraft, expected: number): Promise<boolean> {
  const current = () => revision === expected && currentSession(draft.session);
  try {
    if (!current()) return false;
    requireMobileMutationAdmission(mobileAuthScopeKey(draft.session), 'profile');
    let next = draft;
    if (!next.uploadedUrl) {
      publish({ status: 'uploading', field: draft.field, draft: next, errorKey: null });
      const uploadedUrl = await uploadNativeProfileImage(next.input);
      if (!current()) return false;
      next = { ...next, uploadedUrl };
    }
    publish({ status: 'saving', field: next.field, draft: next, errorKey: null });
    if (!next.committed) {
      requireMobileMutationAdmission(mobileAuthScopeKey(draft.session), 'profile');
      const result = await updateCurrentSocialProfile({ [next.field]: next.uploadedUrl }, next.observedRevision);
      if (!current()) return false;
      if (result.result.outcome === ProfileUpdateOutcome.CONFLICT) throw new Error('mobile.settings.dirty.conflict');
      const readback = await readCurrentSocialProfile(true);
      if (!current()) return false;
      if (readback.profile[next.field] !== next.uploadedUrl) throw new Error('mobile.settings.profile.imageSaveFailed');
      next = { ...next, committed: true };
      publish({ status: 'saving', field: next.field, draft: next, errorKey: null });
    }
    await prepareAvatarAsset(next.uploadedUrl, next.session);
    if (!current()) return false;
    publish(EMPTY);
    await dispose(next);
    return true;
  } catch (error) {
    if (current()) publish({ ...snapshot, status: 'failed',
      errorKey: imageErrorKey(error) });
    return false;
  }
}

export const mobileProfileImages = {
  read: () => snapshot,
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  async pick(field: ProfileImageField): Promise<boolean> {
    if (busy()) return false;
    const session = useAuthStore.getState().session;
    if (!session || !currentSession(session)) return false;
    const expected = ++revision;
    const previous = snapshot;
    const current = () => revision === expected && currentSession(session);
    let selectedInput: NativeMomentMediaInput | null = null;
    try {
      requireMobileMutationAdmission(mobileAuthScopeKey(session), 'profile');
      publish({ ...previous, status: 'picking', field, errorKey: null });
      const profile = await readCurrentSocialProfile(true);
      if (!current()) return false;
      if (profile.profile.profileRevision <= 0n) throw new Error('mobile.settings.profileUnavailable');
      const picked = await pickNativeMedia({
        stationPeerId: session.stationPeerId, actorPtid: session.actorRef.ptid, sessionId: session.sessionId,
        requestId: createNativeMediaRequestId(), surfaceKind: 'profile_image', capability: 'photo_library',
        deadlineMs: Date.now() + 5 * 60_000, acceptedMediaKinds: ['image'],
        maxItemCount: 1, maxTotalBytes: 8 * 1024 * 1024,
      });
      if (!current()) {
        if (picked.outcome === 'selected') {
          await Promise.all(picked.items.map(item => discardNativeProfileImage({
            stationPeerId: session.stationPeerId, actorPtid: session.actorRef.ptid, sessionId: session.sessionId,
            deviceId: session.deviceId, lifecycleGeneration: session.lifecycleGeneration, handle: item.handle,
          }).catch(() => undefined)));
        }
        return false;
      }
      if (picked.outcome === 'cancelled') { publish(previous); return false; }
      if (picked.outcome !== 'selected' || picked.items.length !== 1) {
        throw new Error(picked.outcome === 'permission_required'
          ? 'mobile.settings.profile.imagePermission' : 'mobile.settings.profile.imagePickFailed');
      }
      selectedInput = {
        stationPeerId: session.stationPeerId, actorPtid: session.actorRef.ptid, sessionId: session.sessionId,
        deviceId: session.deviceId, lifecycleGeneration: session.lifecycleGeneration, handle: picked.items[0]!.handle,
      };
      const preview = await previewNativeProfileImage(selectedInput);
      if (!current()) {
        await releaseNativeProfileImagePreview(preview.accessHandle);
        await discardNativeProfileImage(selectedInput);
        return false;
      }
      await dispose(previous.draft);
      if (!current()) {
        await releaseNativeProfileImagePreview(preview.accessHandle);
        await discardNativeProfileImage(selectedInput);
        return false;
      }
      const draft: ImageDraft = {
        session, input: selectedInput, field, ...preview, uploadedUrl: '', committed: false,
        observedRevision: profile.profile.profileRevision,
      };
      publish({ status: 'uploading', field, draft, errorKey: null });
      return commit(draft, expected);
    } catch (error) {
      if (selectedInput) await discardNativeProfileImage(selectedInput).catch(() => undefined);
      if (current()) publish({ ...previous, status: 'failed', field,
        errorKey: imageErrorKey(error) });
      return false;
    }
  },
  async retry(): Promise<boolean> {
    const draft = snapshot.draft;
    if (!draft || busy() || !currentSession(draft.session)) return false;
    const expected = ++revision;
    publish({ ...snapshot, status: 'saving', field: draft.field, errorKey: null });
    try {
      // Explicit retry may apply the retained choice against the latest revision.
      const profile = await readCurrentSocialProfile(true);
      if (expected !== revision || !currentSession(draft.session)) return false;
      return commit({ ...draft, observedRevision: profile.profile.profileRevision }, expected);
    } catch (error) {
      if (expected === revision && currentSession(draft.session)) {
        publish({ ...snapshot, status: 'failed', errorKey: imageErrorKey(error) });
      }
      return false;
    }
  },
  discard() {
    revision += 1;
    const draft = snapshot.draft;
    publish(EMPTY);
    void dispose(draft);
  },
};

export function useProfileImage() {
  return useSyncExternalStore(mobileProfileImages.subscribe, mobileProfileImages.read, () => EMPTY);
}

export function createProfileImageRuntimeDescriptor(): MobileRuntimeDescriptor {
  let release: (() => void) | null = null;
  return {
    id: 'profile-images', title: 'Profile Images',
    responsibility: 'Owns native profile previews, upload/readback and scope-fenced retry.',
    dependsOn: ['social'],
    async bootstrap() {
      release?.();
      release = useAuthStore.subscribe((next, previous) => {
        if (next.session?.sessionId !== previous.session?.sessionId
          || (next.session && previous.session && mobileAuthScopeKey(next.session) !== mobileAuthScopeKey(previous.session))) {
          mobileProfileImages.discard();
        }
      });
    },
    async suspend() {},
    async resume() {},
    async teardown() {
      release?.(); release = null;
      revision += 1;
      const draft = snapshot.draft;
      publish(EMPTY);
      await dispose(draft);
      return { runtimeId: 'profile-images', success: true, durationMs: 0 };
    },
  };
}
