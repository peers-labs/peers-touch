import type { MobileRuntimeDescriptor } from '../app/lifecycle/types';
import { mobilePersonalizationScope } from './personalizationScope';

export interface ContactPreference {
  readonly nickname: string;
  readonly note: string;
}
export interface ContactPreferencesSnapshot {
  readonly contacts: Readonly<Record<string, ContactPreference>>;
  readonly status: 'loading' | 'ready' | 'failed';
  readonly errorKey: string | null;
}
const STORAGE_KEY = 'peers-touch.mobile.contact-preferences';
const EMPTY: ContactPreferencesSnapshot = Object.freeze({
  contacts: Object.freeze({}), status: 'loading', errorKey: null,
});

function parsePreferences(raw: Record<string, unknown> | null): Record<string, ContactPreference> {
  if (raw === null) return {};
  if (!raw.contacts || typeof raw.contacts !== 'object' || Array.isArray(raw.contacts)) {
    throw new Error('mobile.contacts.preferencesLoadFailed');
  }
  const result: Record<string, ContactPreference> = Object.create(null);
  for (const [ptid, value] of Object.entries(raw.contacts)) {
    if (!ptid || !value || typeof value !== 'object'
      || !('nickname' in value) || typeof value.nickname !== 'string'
      || !('note' in value) || typeof value.note !== 'string'
      || value.nickname.length > 100 || value.note.length > 1000) {
      throw new Error('mobile.contacts.preferencesLoadFailed');
    }
    result[ptid] = Object.freeze({ nickname: value.nickname, note: value.note });
  }
  return result;
}

export function createContactPreferencesRuntime() {
  let snapshot = EMPTY;
  let generation = 0;
  let readRevision = 0;
  const listeners = new Set<() => void>();
  const publish = (next: ContactPreferencesSnapshot) => {
    snapshot = Object.freeze(next);
    listeners.forEach(listener => listener());
  };
  const load = async () => {
    const scope = mobilePersonalizationScope.capture();
    const observed = generation;
    const observedRead = ++readRevision;
    const current = () => observed === generation && observedRead === readRevision && scope.current();
    try {
      const contacts = parsePreferences(await scope.read(STORAGE_KEY));
      if (current()) publish({ contacts: Object.freeze(contacts), status: 'ready', errorKey: null });
    } catch {
      if (current()) publish({ ...snapshot, status: 'failed', errorKey: 'mobile.contacts.preferencesLoadFailed' });
    }
  };
  return {
    read: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    load,
    save(ptid: string, preference: ContactPreference): Promise<boolean> {
      if (!ptid || preference.nickname.length > 100 || preference.note.length > 1000) {
        return Promise.reject(new Error('mobile.contacts.preferencesInvalid'));
      }
      const scope = mobilePersonalizationScope.capture();
      const observed = generation;
      readRevision += 1;
      const current = () => observed === generation && scope.current();
      // Read within the shared queue, so edits to separate contacts cannot erase
      // each other and a stale operation cannot choose a new actor's repository.
      return mobilePersonalizationScope.enqueue(async () => {
        if (!current()) return false;
        const contacts = parsePreferences(await scope.read(STORAGE_KEY));
        const next = { nickname: preference.nickname.trim(), note: preference.note.trim() };
        if (next.nickname || next.note) contacts[ptid] = next;
        else delete contacts[ptid];
        await scope.write(STORAGE_KEY, { contacts });
        const readback = parsePreferences(await scope.read(STORAGE_KEY));
        if (!current()) return false;
        readRevision += 1;
        if ((readback[ptid]?.nickname ?? '') !== next.nickname
          || (readback[ptid]?.note ?? '') !== next.note) {
          throw new Error('mobile.contacts.preferencesSaveFailed');
        }
        publish({ contacts: Object.freeze(readback), status: 'ready', errorKey: null });
        return true;
      });
    },
    install() {
      const reset = () => {
        generation += 1;
        publish(EMPTY);
        void load();
      };
      const unsubscribe = mobilePersonalizationScope.subscribe(reset);
      const release = mobilePersonalizationScope.retain();
      reset();
      return () => {
        generation += 1;
        unsubscribe();
        release();
        publish(EMPTY);
      };
    },
  };
}

export const mobileContactPreferences = createContactPreferencesRuntime();
export function createContactPreferencesRuntimeDescriptor(): MobileRuntimeDescriptor {
  let release: (() => void) | null = null;
  return {
    id: 'contact-preferences', title: 'Contact Preferences',
    responsibility: 'Owns actor-local contact names and notes with personalization lifetime.',
    dependsOn: ['session'],
    async bootstrap() { release?.(); release = mobileContactPreferences.install(); },
    async suspend() {},
    async resume() { await mobileContactPreferences.load(); },
    async teardown() {
      release?.();
      release = null;
      return { runtimeId: 'contact-preferences', success: true, durationMs: 0 };
    },
  };
}
