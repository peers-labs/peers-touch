import 'dart:io';
import 'package:dio/dio.dart';
import 'package:get/get.dart' hide FormData, MultipartFile;
import 'package:peers_touch_desktop/core/network/api_client.dart';

class DiscoveryRepository {
  final ApiClient _apiClient = Get.find<ApiClient>();

  /// Fetch user's outbox
  Future<Map<String, dynamic>> fetchOutbox(String username, {bool page = true}) async {
    final response = await _apiClient.get<Map<String, dynamic>>(
      '/activitypub/$username/outbox',
      query: {'page': page},
    );
    return response.data ?? {};
  }

  /// Submit a post (activity) to outbox
  Future<Map<String, dynamic>> submitPost(String username, Map<String, dynamic> activity) async {
    final response = await _apiClient.post<Map<String, dynamic>>(
      '/activitypub/$username/outbox',
      data: activity,
    );
    return response.data ?? {};
  }
}
