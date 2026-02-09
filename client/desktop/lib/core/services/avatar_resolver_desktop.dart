import 'package:get/get.dart';
import 'package:peers_touch_base/context/global_context.dart';
import 'package:peers_touch_base/logger/logging_service.dart';
import 'package:peers_touch_base/network/dio/http_service_locator.dart';
import 'package:peers_touch_base/widgets/avatar_resolver.dart';

/// Actor info for caching avatar and display name
class ActorInfo {
  final String actorId;
  final String? avatarUrl;
  final String? displayName;
  final String? username;

  ActorInfo({
    required this.actorId,
    this.avatarUrl,
    this.displayName,
    this.username,
  });

  /// For avatar fallback letter, prefer username (short unique id like "a", "bob")
  /// over displayName (which might have common prefixes like "User A")
  String get fallbackName => username ?? displayName ?? actorId;
}

/// Desktop implementation: resolve avatar by uid.
/// Maintains a global actor cache to resolve ANY user's avatar, not just current user.
/// 
/// Architecture:
/// - Current user: resolved from GlobalContext.userProfile
/// - Other users: resolved from _actorCache, populated by FriendChatController
///   when loading friends list and group members
class AvatarResolverDesktop implements AvatarResolver {
  /// Global actor cache: actorId -> ActorInfo
  /// Populated by controllers when loading friends, group members, etc.
  final Map<String, ActorInfo> _actorCache = {};

  /// Register an actor's info for later resolution
  void registerActor({
    required String actorId,
    String? avatarUrl,
    String? displayName,
    String? username,
  }) {
    final existing = _actorCache[actorId];
    // Only update if we have new info
    final newAvatar = avatarUrl ?? existing?.avatarUrl;
    final newDisplayName = displayName ?? existing?.displayName;
    final newUsername = username ?? existing?.username;

    _actorCache[actorId] = ActorInfo(
      actorId: actorId,
      avatarUrl: newAvatar,
      displayName: newDisplayName,
      username: newUsername,
    );

    LoggingService.debug(
        'AvatarResolver: Registered actor $actorId, avatar=${newAvatar != null}, name=$newDisplayName');
  }

  /// Register multiple actors at once (batch update)
  void registerActors(List<ActorInfo> actors) {
    for (final actor in actors) {
      registerActor(
        actorId: actor.actorId,
        avatarUrl: actor.avatarUrl,
        displayName: actor.displayName,
        username: actor.username,
      );
    }
  }

  /// Clear all cached actors
  void clearCache() {
    _actorCache.clear();
    LoggingService.debug('AvatarResolver: Cache cleared');
  }

  /// Get cached actor info
  ActorInfo? getActorInfo(String actorId) => _actorCache[actorId];

  @override
  String? getAvatarUrl(String actorId) {
    // 1. Check current user first (always most up-to-date)
    final gc = Get.find<GlobalContext>();
    if (gc.actorId == actorId) {
      final profile = gc.userProfile;
      if (profile != null) {
        final url = profile['avatarUrl'] ?? profile['avatar'];
        if (url != null && url.toString().isNotEmpty) {
          return url.toString();
        }
      }
    }

    // 2. Check actor cache for other users
    final cached = _actorCache[actorId];
    if (cached?.avatarUrl != null && cached!.avatarUrl!.isNotEmpty) {
      return cached.avatarUrl;
    }

    return null;
  }

  @override
  String getFallbackName(String actorId) {
    // 1. Check current user first
    final gc = Get.find<GlobalContext>();
    if (gc.actorId == actorId) {
      final profile = gc.userProfile;
      if (profile != null) {
        // Prefer username for avatar letter (short, unique)
        // over displayName (might have common prefixes like "User")
        final name = profile['username'] ??
            profile['handle'] ??
            profile['displayName'] ??
            profile['display_name'];
        if (name != null && name.toString().isNotEmpty) {
          return name.toString();
        }
      }
    }

    // 2. Check actor cache for other users
    final cached = _actorCache[actorId];
    if (cached != null) {
      return cached.fallbackName;
    }

    return actorId;
  }

  /// Track pending fetches to avoid duplicate requests
  final Set<String> _pendingFetches = {};

  @override
  Future<String?> fetchAvatarUrl(String actorId) async {
    // Check cache first
    final cached = getAvatarUrl(actorId);
    if (cached != null) {
      return cached;
    }

    // Avoid duplicate requests
    if (_pendingFetches.contains(actorId)) {
      LoggingService.debug('AvatarResolver: Already fetching $actorId');
      return null;
    }

    _pendingFetches.add(actorId);

    try {
      LoggingService.debug('AvatarResolver: Fetching basic info for $actorId');
      final client = HttpServiceLocator().httpService;
      final response = await client.getResponse<Map<String, dynamic>>(
        '/activitypub/actors/$actorId/basic-info',
      );

      if (response.statusCode == 200 && response.data != null) {
        final data = response.data!;
        final avatarUrl = data['avatar_url'] as String?;
        final displayName = data['display_name'] as String?;
        final username = data['username'] as String?;

        // Cache the result
        registerActor(
          actorId: actorId,
          avatarUrl: avatarUrl,
          displayName: displayName,
          username: username,
        );

        LoggingService.debug(
            'AvatarResolver: Fetched $actorId, avatar=${avatarUrl != null}');
        return avatarUrl;
      }
    } catch (e) {
      LoggingService.warning('AvatarResolver: Failed to fetch $actorId: $e');
    } finally {
      _pendingFetches.remove(actorId);
    }

    return null;
  }
}
