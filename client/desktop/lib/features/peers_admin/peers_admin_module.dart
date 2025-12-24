import 'package:flutter/material.dart';
import 'package:peers_touch_desktop/features/peers_admin/binding/peers_admin_binding.dart';
import 'package:peers_touch_desktop/features/peers_admin/view/peers_admin_page.dart';
import 'package:peers_touch_desktop/features/shell/manager/primary_menu_manager.dart';

class PeersAdminModule {
  static void register() {
    // Register binding
    PeersAdminBinding().dependencies();

    // Register menu item
    PrimaryMenuManager.registerItem(PrimaryMenuItem(
      id: 'peers_admin',
      label: 'Admin',
      icon: Icons.admin_panel_settings,
      isHead: true, // Bottom area
      order: 10, 
      contentBuilder: (context) => const PeersAdminPage(),
      toDIsplayPageTitle: false,
    ));
  }
}