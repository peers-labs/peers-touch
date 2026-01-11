import 'package:get/get.dart';
import 'package:peers_touch_base/logger/logging_service.dart';
import 'package:peers_touch_desktop/features/launch/model/feed_item.dart';
import 'package:peers_touch_desktop/features/launch/repository/launch_repository.dart';

class FeedService extends GetxService {
  final LaunchRepository _repository = Get.find();

  Future<List<FeedItem>> getStationFeed() async {
    try {
      final response = await _repository.fetchPersonalizedFeed();
      return response.map((json) => FeedItem.fromJson(json)).toList();
    } catch (e) {
      LoggingService.error('Failed to fetch station feed: $e');
      rethrow;
    }
  }

  Future<List<FeedItem>> getOnlineFriends() async {
    try {
      return [];
    } catch (e) {
      LoggingService.error('Failed to fetch online friends: $e');
      return [];
    }
  }

  Future<List<FeedItem>> getRecentChats() async {
    try {
      return [];
    } catch (e) {
      LoggingService.error('Failed to fetch recent chats: $e');
      return [];
    }
  }

  Future<List<FeedItem>> getRecentActivities() async {
    try {
      return [];
    } catch (e) {
      LoggingService.error('Failed to fetch recent activities: $e');
      return [];
    }
  }
}
