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
import { sessionIdentityScope, type SessionIdentityScope } from '../kernel/sessionIdentity';

export const PERSONALIZATION_LANGUAGE_KEY = 'peers-touch-lang';
export const PERSONALIZATION_CHAT_SHORTCUT_KEY = 'settings.chat.screenshotShortcut';
export const PERSONALIZATION_SHOW_USABLE_PROVIDERS_KEY = 'settings.providers.showUsableOnly';

export function capturePersonalizationScope(): SessionIdentityScope | null {
  return sessionIdentityScope(useSessionStore.getState());
}

export function isPersonalizationScopeCurrent(scope: SessionIdentityScope | null): boolean {
  const current = capturePersonalizationScope();
  return current?.actorPtid === scope?.actorPtid
    && current?.stationPeerId === scope?.stationPeerId
    && current?.sessionEpoch === scope?.sessionEpoch;
}

function actorPreferences(scope: SessionIdentityScope | null) {
  if (!scope) return null;
  return createDesktopClientStorageRuntime({
    ptid: scope.actorPtid, stationPeerId: scope.stationPeerId,
  }).repositories.chatPreferences;
}

export async function readPersonalization(
  key: string,
  scope: SessionIdentityScope | null = capturePersonalizationScope(),
): Promise<unknown | null> {
  const repository = actorPreferences(scope);
  if (!repository) return null;
  return repository.readValue(key);
}

export async function writePersonalization(
  key: string,
  value: string | boolean,
  scope: SessionIdentityScope | null = capturePersonalizationScope(),
): Promise<boolean> {
  if (!isPersonalizationScopeCurrent(scope)) return false;
  const repository = actorPreferences(scope);
  if (!repository) return false;
  await repository.write(key, value);
  return true;
}
