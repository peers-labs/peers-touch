import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MobileAuthSession } from '../features/auth/authSession';
import { ProfileUpdateOutcome } from '../gen/proto/domain/actor/actor_pb';

const ports = vi.hoisted(() => ({
  session: null as MobileAuthSession | null,
  socialSession: null as MobileAuthSession | null,
  authListener: null as null | ((next: { session: MobileAuthSession | null }, previous: { session: MobileAuthSession | null }) => void),
  profile: vi.fn(), update: vi.fn(), pick: vi.fn(), preview: vi.fn(),
  upload: vi.fn(), release: vi.fn(), discard: vi.fn(), prepare: vi.fn(), admit: vi.fn(),
}));
vi.mock('../features/auth/authStore', () => ({
  useAuthStore: {
    getState: () => ({ session: ports.session }),
    subscribe: (listener: typeof ports.authListener) => {
      ports.authListener = listener;
      return () => { ports.authListener = null; };
    },
  },
}));
vi.mock('../features/social/socialStore', () => ({
  useSocialStore: { getState: () => ({ authSession: ports.socialSession }) },
}));
vi.mock('../features/social/socialRuntime', () => ({
  readCurrentSocialProfile: ports.profile, updateCurrentSocialProfile: ports.update,
}));
vi.mock('../services/mobileCommands', () => ({
  createNativeMediaRequestId: () => 'profile-picker',
  pickNativeMedia: ports.pick, previewNativeProfileImage: ports.preview,
  uploadNativeProfileImage: ports.upload, discardNativeProfileImage: ports.discard,
  releaseNativeProfileImagePreview: ports.release,
}));
vi.mock('./avatarAssetRuntime', () => ({ prepareAvatarAsset: ports.prepare }));
vi.mock('./mutationAdmission', () => ({ requireMobileMutationAdmission: ports.admit }));
import { createProfileImageRuntimeDescriptor, mobileProfileImages } from './profileImageRuntime';

const session: MobileAuthSession = {
  stationPeerId: 'station-a', stationUrl: 'https://station.example',
  sessionId: 'session-a', deviceId: 'device-a', lifecycleGeneration: 1,
  actorRef: { ptid: 'ptid:alice' }, authenticatedAt: 1,
};
const imageUrl = 'https://station.example/oss/avatar';
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
let descriptor: ReturnType<typeof createProfileImageRuntimeDescriptor>;
beforeEach(async () => {
  mobileProfileImages.discard();
  vi.resetAllMocks();
  ports.session = session;
  ports.socialSession = session;
  ports.profile.mockResolvedValue({ actorPtid: session.actorRef.ptid, profile: { profileRevision: 8n, avatar: imageUrl, header: imageUrl } });
  ports.update.mockResolvedValue({ result: { outcome: ProfileUpdateOutcome.APPLIED } });
  ports.pick.mockResolvedValue({ outcome: 'selected', items: [{ handle: 'native-stage' }] });
  ports.preview.mockResolvedValue({ assetUrl: 'profile-image://localhost/preview', accessHandle: 'preview-grant' });
  ports.upload.mockResolvedValue(imageUrl);
  ports.release.mockResolvedValue(undefined); ports.discard.mockResolvedValue(undefined);
  ports.prepare.mockResolvedValue(undefined);
  descriptor = createProfileImageRuntimeDescriptor();
  await descriptor.bootstrap({} as never);
});
afterEach(async () => { await descriptor.teardown({} as never); });

describe('native profile image lifecycle', () => {
  it('uses the observed revision and retains its preview until authoritative readback and display are ready', async () => {
    const display = deferred<void>();
    ports.prepare.mockReturnValue(display.promise);
    const saving = mobileProfileImages.pick('avatar');
    await vi.waitFor(() => expect(ports.prepare).toHaveBeenCalled());
    expect(ports.update).toHaveBeenCalledWith({ avatar: imageUrl }, 8n);
    expect(ports.profile).toHaveBeenCalledTimes(2);
    expect(mobileProfileImages.read().draft?.committed).toBe(true);
    expect(ports.release).not.toHaveBeenCalled();
    display.resolve();
    await expect(saving).resolves.toBe(true);
    expect(mobileProfileImages.read().status).toBe('idle');
    expect(ports.release).toHaveBeenCalledWith('preview-grant');
    expect(ports.discard).toHaveBeenCalledWith(expect.objectContaining({ handle: 'native-stage', sessionId: 'session-a' }));
  });

  it('retains a conflicted choice and retries at the latest revision without uploading twice', async () => {
    ports.update.mockResolvedValueOnce({ result: { outcome: ProfileUpdateOutcome.CONFLICT } });
    await expect(mobileProfileImages.pick('header')).resolves.toBe(false);
    expect(mobileProfileImages.read()).toMatchObject({
      status: 'failed', errorKey: 'mobile.settings.dirty.conflict', draft: { uploadedUrl: imageUrl },
    });
    ports.profile.mockResolvedValue({ profile: { profileRevision: 9n, header: imageUrl } });
    await expect(mobileProfileImages.retry()).resolves.toBe(true);
    expect(ports.update).toHaveBeenLastCalledWith({ header: imageUrl }, 9n);
    expect(ports.upload).toHaveBeenCalledTimes(1);
  });

  it('retries display failure without resubmitting a confirmed profile change', async () => {
    ports.prepare.mockRejectedValueOnce(new Error('mobile.settings.profile.imageDisplayFailed'));
    await expect(mobileProfileImages.pick('avatar')).resolves.toBe(false);
    expect(mobileProfileImages.read().draft?.committed).toBe(true);
    await expect(mobileProfileImages.retry()).resolves.toBe(true);
    expect(ports.upload).toHaveBeenCalledTimes(1);
    expect(ports.update).toHaveBeenCalledTimes(1);
    expect(ports.prepare).toHaveBeenCalledTimes(2);
  });

  it('cleans a picker result arriving after logout without previewing or publishing it', async () => {
    const picked = deferred<{ outcome: string; items: { handle: string }[] }>();
    ports.pick.mockReturnValue(picked.promise);
    const picking = mobileProfileImages.pick('avatar');
    await vi.waitFor(() => expect(ports.pick).toHaveBeenCalled());
    ports.session = null; ports.socialSession = null;
    ports.authListener?.({ session: null }, { session });
    picked.resolve({ outcome: 'selected', items: [{ handle: 'late-stage' }] });
    await expect(picking).resolves.toBe(false);
    expect(ports.preview).not.toHaveBeenCalled();
    expect(ports.discard).toHaveBeenCalledWith(expect.objectContaining({ handle: 'late-stage', sessionId: 'session-a' }));
    expect(mobileProfileImages.read().status).toBe('idle');
  });

  it('rechecks write admission after upload and preserves the draft on revocation', async () => {
    const upload = deferred<string>();
    ports.upload.mockReturnValue(upload.promise);
    const saving = mobileProfileImages.pick('avatar');
    await vi.waitFor(() => expect(ports.upload).toHaveBeenCalled());
    ports.admit.mockImplementation(() => { throw new Error('mobile.recovery.writeRevocation.body'); });
    upload.resolve(imageUrl);
    await expect(saving).resolves.toBe(false);
    expect(ports.update).not.toHaveBeenCalled();
    expect(mobileProfileImages.read()).toMatchObject({ status: 'failed', draft: { uploadedUrl: imageUrl } });
    expect(ports.discard).not.toHaveBeenCalled();
  });

  it('preserves the previous failed draft when the replacement picker is cancelled', async () => {
    ports.upload.mockRejectedValueOnce(new Error('offline'));
    await mobileProfileImages.pick('avatar');
    const previous = mobileProfileImages.read().draft;
    ports.pick.mockResolvedValue({ outcome: 'cancelled', items: [] });
    await expect(mobileProfileImages.pick('header')).resolves.toBe(false);
    expect(mobileProfileImages.read().draft).toBe(previous);
    expect(ports.discard).not.toHaveBeenCalled();
  });
});
