import 'package:flutter/material.dart';
import 'package:peers_touch_desktop/features/shell/manager/primary_menu_manager.dart';
import 'binding/discovery_binding.dart';
import 'view/discovery_page.dart';

class DiscoveryModule {
  static void register() {
    // Register binding
    DiscoveryBinding().dependencies();

    // Register menu item
    PrimaryMenuManager.registerItem(PrimaryMenuItem(
      id: 'discovery',
      label: 'Discovery',
      icon: Icons.explore,
      isHead: true,
      order: 10, 
      contentBuilder: (context) => const DiscoveryPage(),
      toDIsplayPageTitle: false,
    ));
  }
}
