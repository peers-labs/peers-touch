import 'package:get/get.dart';
import 'package:peers_touch_base/logger/logging_service.dart';
import 'package:peers_touch_desktop/features/launch/model/content_source.dart';
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
      return _getMockStationFeed();
    }
  }

  Future<List<FeedItem>> getOnlineFriends() async {
    try {
      return _getMockFriends();
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
      return _getMockRecentActivities();
    } catch (e) {
      LoggingService.error('Failed to fetch recent activities: $e');
      return [];
    }
  }

  List<FeedItem> _getMockStationFeed() {
    return [
      FeedItem(
        id: '1',
        type: FeedItemType.recommendation,
        title: 'Welcome to Peers-Touch',
        subtitle: 'Get started with your decentralized social network',
        timestamp: DateTime.now(),
        source: ContentSource.stationFeed,
      ),
      FeedItem(
        id: '2',
        type: FeedItemType.pluginContent,
        title: 'AI Programming Assistant Released',
        subtitle: 'New features for developers',
        timestamp: DateTime.now().subtract(const Duration(hours: 2)),
        source: ContentSource.stationFeed,
      ),
    ];
  }

  List<FeedItem> _getMockFriends() {
    return [
      FeedItem(
        id: 'friend_1',
        type: FeedItemType.recentActivity,
        title: 'Alice',
        subtitle: '@alice@peers.com',
        timestamp: DateTime.now(),
        source: ContentSource.friends,
      ),
      FeedItem(
        id: 'friend_2',
        type: FeedItemType.recentActivity,
        title: 'Bob',
        subtitle: '@bob@peers.org',
        timestamp: DateTime.now(),
        source: ContentSource.friends,
      ),
    ];
  }

  List<FeedItem> _getMockRecentActivities() {
    return [
      FeedItem(
        id: 'activity_1',
        type: FeedItemType.recentActivity,
        title: 'Opened AI Chat',
        subtitle: '5 minutes ago',
        timestamp: DateTime.now().subtract(const Duration(minutes: 5)),
        source: ContentSource.recentActivities,
      ),
    ];
  }
}
