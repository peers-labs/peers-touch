import 'package:peers_touch_base/repositories/actor_repository.dart';
import 'package:peers_touch_desktop/core/network/api_client.dart';

class DesktopActorRepository implements ActorRepository {
  final ApiClient client;
  DesktopActorRepository(this.client);
  @override
  Future<Map<String, dynamic>?> fetchProfile({required String username}) async {
    final resp = await client.get('/activitypub/$username/profile');
    if (resp.statusCode == 200) {
      final data = resp.data;
      if (data is Map<String, dynamic>) return data;
      if (data is Map) return data.cast<String, dynamic>();
    }
    return null;
  }
  @override
  Future<List<Map<String, dynamic>>> fetchOutbox({required String username}) async {
    final resp = await client.get('/activitypub/$username/outbox');
    final data = resp.data;
    if (data is Map) {
      final items = data['items'] ?? data['data'] ?? data['outbox'] ?? [];
      if (items is List) {
        return items.whereType<Map>().map((e) => e.cast<String, dynamic>()).toList();
      }
    }
    return const [];
  }
  @override
  Future<List<Map<String, dynamic>>> fetchInbox({required String username}) async {
    final resp = await client.get('/activitypub/$username/inbox');
    final data = resp.data;
    if (data is Map) {
      final items = data['items'] ?? data['data'] ?? data['inbox'] ?? [];
      if (items is List) {
        return items.whereType<Map>().map((e) => e.cast<String, dynamic>()).toList();
      }
    }
    return const [];
  }
}
