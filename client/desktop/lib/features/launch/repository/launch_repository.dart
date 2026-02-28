import 'package:get/get.dart';
import 'package:peers_touch_base/logger/logging_service.dart';
import 'package:peers_touch_base/model/domain/launcher/launcher.pb.dart';
import 'package:peers_touch_base/network/dio/http_service.dart';

class LaunchRepository {
  final IHttpService _httpService = Get.find();

  Future<List<Map<String, dynamic>>> fetchPersonalizedFeed() async {
    try {
      final request = GetFeedRequest()..limit = 20;
      
      final response = await _httpService.post<GetFeedResponse>(
        '/launcher/feed',
        data: request,
        fromJson: (bytes) => GetFeedResponse.fromBuffer(bytes),
      );

      return response.items.map((item) => {
        'id': item.id,
        'type': item.type,
        'title': item.title,
        'subtitle': item.subtitle,
        'image_url': item.imageUrl,
        'timestamp': item.timestamp,
        'source': item.source,
        'metadata': item.metadata,
      }).toList();
    } catch (e) {
      LoggingService.error('Failed to fetch personalized feed: $e');
      return [];
    }
  }

  Future<List<Map<String, dynamic>>> searchStationContent(String query) async {
    try {
      final request = SearchRequest()
        ..query = query
        ..limit = 10;
      
      final response = await _httpService.post<SearchResponse>(
        '/launcher/search',
        data: request,
        fromJson: (bytes) => SearchResponse.fromBuffer(bytes),
      );

      return response.results.map((result) => {
        'id': result.id,
        'type': result.type,
        'title': result.title,
        'subtitle': result.subtitle,
        'image_url': result.imageUrl,
        'action_url': result.actionUrl,
        'metadata': result.metadata,
      }).toList();
    } catch (e) {
      LoggingService.error('Failed to search station content: $e');
      return [];
    }
  }
}
