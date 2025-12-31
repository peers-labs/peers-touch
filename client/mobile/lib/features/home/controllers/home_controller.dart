import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_mobile/components/common/floating_action_ball.dart';
import 'package:peers_touch_mobile/controller/controller.dart';
import 'package:peers_touch_mobile/pages/actor/auth_wrapper.dart';
import 'package:peers_touch_mobile/pages/chat/chat_page.dart';
import 'package:peers_touch_mobile/pages/me/me_home.dart';

class HomeController extends GetxController {
  final RxInt currentIndex = 0.obs;
  final RxList<FloatingActionOption> currentOptions = <FloatingActionOption>[].obs;
  final GlobalKey<FloatingActionBallState> floatingActionBallKey =
      GlobalKey<FloatingActionBallState>();

  final List<Widget> pages = [
    const _HomeDashboard(), // Placeholder for Home tab
    const ChatPage(),
    MeHomePage(),
  ];

  @override
  void onInit() {
    super.onInit();
    // Initial update
    updateOptions();
  }

  void changePage(int index) {
    currentIndex.value = index;
    updateOptions();
  }

  void updateOptions() {
    final currentPage = pages[currentIndex.value];
    currentOptions.value = _getPageOptions(currentPage);
  }

  List<FloatingActionOption> _getPageOptions(Widget page) {
    if (page is ChatPage) return ChatPage.actionOptions;
    if (page is MeHomePage) return MeHomePage.actionOptions;
    return [];
  }

  String? getCurrentPageKey() {
    switch (currentIndex.value) {
      default:
        return null;
    }
  }

  void handleOutsideTap() {
    final floatingActionBallState = floatingActionBallKey.currentState;
    if (floatingActionBallState != null && floatingActionBallState.isExpanded) {
      floatingActionBallState.collapse();
    }
  }
  
  void logout() async {
    await ControllerManager.authService.logout();
    Get.offAll(() => const AuthWrapper());
  }
}

class _HomeDashboard extends StatelessWidget {
  const _HomeDashboard();

  @override
  Widget build(BuildContext context) {
    final controller = Get.find<HomeController>();
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const Text('Home'),
          const SizedBox(height: 20),
          ElevatedButton(
            onPressed: controller.logout,
            child: const Text('Logout'),
          ),
          const SizedBox(height: 10),
          ElevatedButton(
            onPressed: () => Get.toNamed('/network-test'),
            child: const Text('Test Network Connection'),
          ),
        ],
      ),
    );
  }
}
