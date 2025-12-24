import 'package:peers_touch_base/network/dio/http_service.dart';
import 'package:peers_touch_base/repositories/actor_repository.dart';

class DesktopActorRepository implements ActorRepository {
  DesktopActorRepository(this.client);
  final IHttpService client;
  
  @override
  Future<Map<String, dynamic>?> fetchProfile({required String username}) async {
    try {
      final resp = await client.getResponse<dynamic>('/activitypub/$username/profile');
      if (resp.statusCode == 200) {
        final data = resp.data;
        if (data is Map<String, dynamic>) return data;
        if (data is Map) return data.cast<String, dynamic>();
      }
    } catch (_) {
      // Ignore errors (e.g. 404) and return null
    }
    return null;
  }
  
  @override
  Future<List<Map<String, dynamic>>> fetchOutbox({required String username}) async {
    try {
      final resp = await client.getResponse<dynamic>('/activitypub/$username/outbox');
      final data = resp.data;
      if (data is Map) {
        final items = data['items'] ?? data['data'] ?? data['outbox'] ?? [];
        if (items is List) {
          return items.whereType<Map>().map((e) => e.cast<String, dynamic>()).toList();
        }
      }
    } catch (_) {}
    return const [];
  }
  
  @override
  Future<List<Map<String, dynamic>>> fetchInbox({required String username}) async {
    try {
      final resp = await client.getResponse<dynamic>('/activitypub/$username/inbox');
      final data = resp.data;
      if (data is Map) {
        final items = data['items'] ?? data['data'] ?? data['inbox'] ?? [];
        if (items is List) {
          return items.whereType<Map>().map((e) => e.cast<String, dynamic>()).toList();
        }
      }
    } catch (_) {}
    return const [];
  }
}
