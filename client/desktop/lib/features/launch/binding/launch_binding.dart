import 'package:get/get.dart';
import 'package:peers_touch_desktop/features/launch/controller/launch_controller.dart';
import 'package:peers_touch_desktop/features/launch/controller/search_controller.dart';
import 'package:peers_touch_desktop/features/launch/repository/launch_repository.dart';
import 'package:peers_touch_desktop/features/launch/service/feed_service.dart';
import 'package:peers_touch_desktop/features/launch/service/quick_action_service.dart';
import 'package:peers_touch_desktop/features/launch/service/search/search_aggregator_service.dart';

class LaunchBinding extends Bindings {
  @override
  void dependencies() {
    Get.lazyPut(() => LaunchRepository());
    Get.lazyPut(() => FeedService());
    Get.lazyPut(() => QuickActionService());
    Get.lazyPut(() => SearchAggregatorService());
    Get.lazyPut(() => LaunchController());
    Get.lazyPut(() => LaunchSearchController());
  }
}
