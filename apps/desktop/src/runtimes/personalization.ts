// Identity-scoped personalization (Settings ownership layer L2).
//
// Personalization expresses how an individual wants the product to look and
// behave on this device. It is keyed by (app, station, actor) in the shared
// client-storage kernel, never by the install: a shared device must not show
// one actor's language, shortcuts, or list filters to the next person who
// signs in. These values do not sync across devices; Station-owned business
// configuration (L1) is a different owner.
//
// See docs/architecture/platform/client/settings-ownership.md.

import { createDesktopClientStorageRuntime } from '../storage/desktopClientStorage';
import { useSessionStore } from '../store/session';

export const PERSONALIZATION_LANGUAGE_KEY = 'peers-touch-lang';
export const PERSONALIZATION_CHAT_SHORTCUT_KEY = 'settings.chat.screenshotShortcut';
export const PERSONALIZATION_SHOW_USABLE_PROVIDERS_KEY = 'settings.providers.showUsableOnly';

/** Actor PTID of the currently authenticated desktop session, or null. */
export function activeActorPtid(): string | null {
  const session = useSessionStore.getState();
  if (!session.authenticated) return null;
  return session.currentUser?.actorPtid ?? null;
}

function actorPreferences(actorPtid?: string | null) {
  const ptid = actorPtid === undefined ? activeActorPtid() : actorPtid;
  if (!ptid) return null;
  return createDesktopClientStorageRuntime({ ptid }).repositories.chatPreferences;
}

export async function readPersonalization<T>(
  key: string,
  actorPtid?: string | null,
): Promise<T | null> {
  const repository = actorPreferences(actorPtid);
  if (!repository) return null;
  return (await repository.readValue(key)) as T | null;
}

export async function writePersonalization<T>(
  key: string,
  value: T,
  actorPtid?: string | null,
): Promise<boolean> {
  const repository = actorPreferences(actorPtid);
  if (!repository) return false;
  await repository.write(key, value as Record<string, unknown>);
  return true;
}
