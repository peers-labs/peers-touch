import 'package:flutter/material.dart';
import 'package:peers_touch_desktop/features/shell/manager/primary_menu_manager.dart';
import 'package:peers_touch_desktop/features/peers_admin/peers_admin_binding.dart';
import 'package:peers_touch_desktop/features/peers_admin/view/peers_admin_page.dart';

/// Peers Admin 模块注册到主壳菜单
class PeersAdminModule {
  static void register() {
    // 注入依赖
    PeersAdminBinding().dependencies();
    // 注册为头部区域菜单项
    PrimaryMenuManager.registerItem(
      const PrimaryMenuItem(
        id: 'peers_admin',
        label: 'Peers Admin',
        icon: Icons.hub,
        isHead: true,
        order: 50,
        contentBuilder: _buildPage,
        toDIsplayPageTitle: false,
      ),
    );
  }

  static Widget _buildPage(BuildContext context) => const PeersAdminPage();
}