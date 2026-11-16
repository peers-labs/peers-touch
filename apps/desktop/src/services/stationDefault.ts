// Explicit Station choice marker (NCP-D24):
// - The verified Station registry persists the active Station id and restores
//   it at launch; there is no implicit default and no auto-applied suggestion.
// - This marker only records that the user performed an explicit Station action
//   (select / add / remove). Any explicit action permanently wins over cloud
//   or local suggestions.

const USER_CHOICE_KEY = "pt.station.userChoice.v1";

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
  } catch {
    // Storage may be unavailable in restricted contexts; the registry's active
    // Station id still remains the durable selection record.
  }
}
