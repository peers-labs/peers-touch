import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_mobile/components/navigation/bottom_nav_bar.dart';
import 'package:peers_touch_mobile/components/sync_status_bar.dart';
import 'package:peers_touch_mobile/features/home/controllers/home_controller.dart';
import 'package:peers_touch_mobile/utils/floating_layout_manager.dart';

class HomePage extends GetView<HomeController> {
  const HomePage({super.key});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: controller.handleOutsideTap,
      behavior: HitTestBehavior.translucent,
      child: Scaffold(
        body: Obx(() => Stack(
          children: [
            // Current Page
            controller.pages[controller.currentIndex.value],
            
            // Sync status bar at the top
            Positioned(top: 0, left: 0, right: 0, child: SyncStatusBar()),
            
            // Floating Action Ball
            if (controller.currentOptions.isNotEmpty)
              FloatingLayoutManager.positionedFloatingActionBall(
                context: context,
                key: ValueKey(controller.currentIndex.value), // Force rebuild on page change
                options: controller.currentOptions,
                globalKey: controller.floatingActionBallKey,
              ),
              
            // Scroll to Top Button
            if (controller.getCurrentPageKey() != null)
              FloatingLayoutManager.positionedScrollToTopButton(
                context: context,
                pageKey: controller.getCurrentPageKey()!,
                hasFloatingOptions: controller.currentOptions.isNotEmpty,
                optionsCount: controller.currentOptions.length,
              ),
          ],
        )),
        bottomNavigationBar: Obx(() => BottomNavBar(
          currentIndex: controller.currentIndex.value,
          onTap: controller.changePage,
          onOutsideTap: controller.handleOutsideTap,
        )),
      ),
    );
  }
}
