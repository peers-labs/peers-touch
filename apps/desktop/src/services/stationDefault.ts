// First-run default Station policy (XCFG-D04):
// - When the local Station registry is empty and the user has never made a
//   choice, an actionable x-config default relay seed is applied once.
// - Any explicit user action (manual select / add / remove) permanently wins:
//   cloud defaults are never re-applied afterwards on this profile.

const USER_CHOICE_KEY = "pt.station.userChoice.v1";
const AUTO_APPLIED_KEY = "pt.station.autoDefault.v1";

export type AutoDefaultRecord = {
  seedId: string;
  appliedAt: number;
};

export type KVStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function activeStorage(): KVStorage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function hasUserChosenStation(
  storage: KVStorage | null = activeStorage(),
): boolean {
  return storage?.getItem(USER_CHOICE_KEY) === "1";
}

export function markStationUserChoice(
  storage: KVStorage | null = activeStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(USER_CHOICE_KEY, "1");
    storage.removeItem(AUTO_APPLIED_KEY);
  } catch {
    // Storage may be unavailable in restricted contexts; auto policy then
    // simply stays inactive.
  }
}

export function loadStationAutoDefault(
  storage: KVStorage | null = activeStorage(),
): AutoDefaultRecord | null {
  const raw = storage?.getItem(AUTO_APPLIED_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as AutoDefaultRecord;
    return typeof parsed.seedId === "string" ? parsed : null;
  } catch {
    return null;
  }
}

export function storeStationAutoDefault(
  seedId: string,
  storage: KVStorage | null = activeStorage(),
): void {
  if (!storage) return;
  try {
    const record: AutoDefaultRecord = { seedId, appliedAt: Date.now() };
    storage.setItem(AUTO_APPLIED_KEY, JSON.stringify(record));
  } catch {
    // Ignore persistence failure; in-flight guards still prevent loops.
  }
}

// A default may auto-apply only while the user has never chosen and this
// exact seed has not been applied already.
export function shouldAutoApplyDefault(
  seedId: string | null | undefined,
  storage: KVStorage | null = activeStorage(),
): boolean {
  if (!seedId || hasUserChosenStation(storage)) return false;
  const applied = loadStationAutoDefault(storage);
  return applied?.seedId !== seedId;
}
