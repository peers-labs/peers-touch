import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_desktop/features/shell/manager/primary_menu_manager.dart';
import 'controller/posting_controller.dart';
import 'view/composer_page.dart';

class PostingModule {
  static void register() {
    Get.put<PostingController>(PostingController(), permanent: true);
    PrimaryMenuManager.registerItem(const PrimaryMenuItem(
      id: 'posting',
      label: 'Post',
      icon: Icons.edit,
      isHead: true,
      order: 5,
      contentBuilder: (context) => ComposerPage(),
      toDIsplayPageTitle: false,
    ));
  }
}

