import 'package:get/get.dart' hide FormData, MultipartFile;
import 'package:peers_touch_base/network/dio/http_service_locator.dart';

class DiscoveryRepository {
  final _httpService = HttpServiceLocator().httpService;

  /// Fetch user's outbox
  Future<Map<String, dynamic>> fetchOutbox(String username, {bool page = true}) async {
    final data = await _httpService.get<Map<String, dynamic>>(
      '/activitypub/$username/outbox',
      queryParameters: {'page': page},
    );
    return data;
  }

  /// Submit a post (activity) to outbox
  Future<Map<String, dynamic>> submitPost(String username, Map<String, dynamic> activity) async {
    final data = await _httpService.post<Map<String, dynamic>>(
      '/activitypub/$username/outbox',
      data: activity,
    );
    return data;
  }
}
