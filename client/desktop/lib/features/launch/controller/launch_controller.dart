import 'dart:async';
import 'package:get/get.dart';
import 'package:peers_touch_base/logger/logging_service.dart';
import 'package:peers_touch_desktop/features/launch/model/content_source.dart';
import 'package:peers_touch_desktop/features/launch/model/feed_item.dart';
import 'package:peers_touch_desktop/features/launch/model/quick_action.dart';
import 'package:peers_touch_desktop/features/launch/service/feed_service.dart';
import 'package:peers_touch_desktop/features/launch/service/quick_action_service.dart';

class LaunchController extends GetxController {
  final FeedService _feedService = Get.find();
  final QuickActionService _quickActionService = Get.find();

  final feedItems = <ContentSource, List<FeedItem>>{}.obs;
  final quickActions = <QuickAction>[].obs;
  final isLoading = false.obs;
  final searchMode = false.obs;

  @override
  void onInit() {
    super.onInit();
    _loadInitialData();
  }

  Future<void> _loadInitialData() async {
    isLoading.value = true;

    try {
      await Future.wait([
        _loadQuickActions(),
        _loadStationFeed(),
        _loadLocalFeed(),
      ]);
    } catch (e) {
      LoggingService.error('Failed to load launch screen data: $e');
    } finally {
      isLoading.value = false;
    }
  }

  Future<void> _loadQuickActions() async {
    quickActions.value = await _quickActionService.getQuickActions();
  }

  Future<void> _loadStationFeed() async {
    final items = await _feedService.getStationFeed();
    feedItems[ContentSource.stationFeed] = items;
  }

  Future<void> _loadLocalFeed() async {
    final friends = await _feedService.getOnlineFriends();
    final recentChats = await _feedService.getRecentChats();
    final recentActivities = await _feedService.getRecentActivities();

    feedItems[ContentSource.friends] = friends;
    feedItems[ContentSource.recentChats] = recentChats;
    feedItems[ContentSource.recentActivities] = recentActivities;
  }

  void enterSearchMode() {
    searchMode.value = true;
  }

  void exitSearchMode() {
    searchMode.value = false;
  }

  void executeQuickAction(QuickAction action) {
    if (action.route != null) {
      Get.toNamed(action.route!);
    } else {
      action.onTap();
    }
  }

  @override
  Future<void> refresh() async {
    await _loadInitialData();
  }

  List<FeedItem> getAllFeedItems() {
    final allItems = <FeedItem>[];
    for (final items in feedItems.values) {
      allItems.addAll(items);
    }
    return allItems;
  }
}
