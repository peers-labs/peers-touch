import 'package:get/get.dart';
import 'package:peers_touch_base/context/global_context.dart';
import 'package:peers_touch_base/widgets/avatar_resolver.dart';

/// Desktop implementation: resolve avatar by uid from GlobalContext (current user).
/// Other actors show placeholder until a per-actor cache is available.
class AvatarResolverDesktop implements AvatarResolver {
  @override
  String? getAvatarUrl(String actorId) {
    final gc = Get.find<GlobalContext>();
    if (gc.actorId != actorId) return null;
    final profile = gc.userProfile;
    if (profile == null) return null;
    final url = profile['avatarUrl'] ?? profile['avatar'];
    if (url == null || url.toString().isEmpty) return null;
    return url.toString();
  }

  @override
  String getFallbackName(String actorId) {
    final gc = Get.find<GlobalContext>();
    if (gc.actorId != actorId) return actorId;
    final profile = gc.userProfile;
    if (profile == null) return actorId;
    final name = profile['displayName'] ?? profile['display_name'] ?? profile['username'] ?? profile['handle'];
    if (name == null || name.toString().isEmpty) return actorId;
    return name.toString();
  }
}
