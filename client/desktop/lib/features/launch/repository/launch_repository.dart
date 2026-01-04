import 'package:get/get.dart';
import 'package:peers_touch_base/logger/logging_service.dart';
import 'package:peers_touch_base/network/dio/http_service.dart';

class LaunchRepository {
  final IHttpService _httpService = Get.find();

  Future<List<Map<String, dynamic>>> fetchPersonalizedFeed() async {
    try {
      final response = await _httpService.get<Map<String, dynamic>>(
        '/launcher/feed',
      );

      if (response['items'] != null) {
        return List<Map<String, dynamic>>.from(response['items']);
      }
      return [];
    } catch (e) {
      LoggingService.error('Failed to fetch personalized feed: $e');
      return [];
    }
  }

  Future<List<Map<String, dynamic>>> searchStationContent(String query) async {
    try {
      final response = await _httpService.get<Map<String, dynamic>>(
        '/launcher/search',
        queryParameters: {
          'q': query,
          'limit': 10,
        },
      );

      if (response['results'] != null) {
        return List<Map<String, dynamic>>.from(response['results']);
      }
      return [];
    } catch (e) {
      LoggingService.error('Failed to search station content: $e');
      return [];
    }
  }
}
