/// Resolves avatar URL and display name by actor/user id.
/// Register an implementation (e.g. from desktop) so that [Avatar] can
/// resolve by uid only without callers passing [avatarUrl].
abstract class AvatarResolver {
  /// Returns avatar URL for [actorId], or null if unknown / no avatar.
  String? getAvatarUrl(String actorId);

  /// Returns display name for fallback/placeholder when URL is missing.
  /// Default can be actorId if not registered.
  String getFallbackName(String actorId) => actorId;
}
