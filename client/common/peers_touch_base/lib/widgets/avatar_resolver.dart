/// Resolves avatar URL and display name by actor/user id.
/// Register an implementation (e.g. from desktop) so that [Avatar] can
/// resolve by uid only without callers passing [avatarUrl].
abstract class AvatarResolver {
  /// Returns avatar URL for [actorId] from local cache, or null if unknown / no avatar.
  /// This is synchronous and only checks local cache.
  String? getAvatarUrl(String actorId);

  /// Returns display name for fallback/placeholder when URL is missing.
  /// Default can be actorId if not registered.
  String getFallbackName(String actorId) => actorId;

  /// Fetches actor basic info from server and caches it.
  /// Returns the avatar URL if found, null otherwise.
  /// This should be called when getAvatarUrl returns null.
  Future<String?> fetchAvatarUrl(String actorId) async => null;
}
