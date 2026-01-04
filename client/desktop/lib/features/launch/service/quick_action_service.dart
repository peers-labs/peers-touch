import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_desktop/app/routes/app_routes.dart';
import 'package:peers_touch_desktop/features/launch/model/quick_action.dart';

class QuickActionService extends GetxService {
  Future<List<QuickAction>> getQuickActions() async {
    return [
      QuickAction(
        id: 'chat',
        label: 'Chat',
        icon: Icons.chat_bubble_outline,
        route: AppRoutes.home,
        onTap: () => Get.toNamed(AppRoutes.home),
        isPinned: true,
      ),
      QuickAction(
        id: 'ai',
        label: 'AI',
        icon: Icons.smart_toy_outlined,
        route: AppRoutes.home,
        onTap: () => Get.toNamed(AppRoutes.home),
        isPinned: true,
      ),
      QuickAction(
        id: 'post',
        label: 'Post',
        icon: Icons.edit_outlined,
        route: AppRoutes.home,
        onTap: () => Get.toNamed(AppRoutes.home),
        isPinned: true,
      ),
      QuickAction(
        id: 'profile',
        label: 'Profile',
        icon: Icons.person_outline,
        route: AppRoutes.profile,
        onTap: () => Get.toNamed(AppRoutes.profile),
        isPinned: true,
      ),
    ];
  }
}
