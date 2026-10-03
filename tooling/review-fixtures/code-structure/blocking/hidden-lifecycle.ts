type Profile = {
  id: string;
  displayName: string;
};

declare const profileCache: Map<string, Profile>;
declare function refreshProfile(id: string): Promise<void>;

export function getProfile(id: string): Profile | undefined {
  refreshProfile(id).catch(() => undefined);
  return profileCache.get(id);
}
