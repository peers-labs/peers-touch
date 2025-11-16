import 'package:flutter/material.dart';
import 'package:get/get.dart';

import 'package:peers_touch_desktop/features/shell/manager/primary_menu_manager.dart';
import 'package:peers_touch_desktop/features/shell/controller/shell_controller.dart';
import 'package:peers_touch_desktop/app/theme/theme_tokens.dart';
import 'package:peers_touch_desktop/app/theme/ui_kit.dart';

import 'package:peers_touch_desktop/features/profile/profile_binding.dart';
import 'package:peers_touch_desktop/features/profile/view/profile_page.dart';
import 'package:peers_touch_desktop/features/profile/controller/profile_controller.dart';
import 'package:peers_touch_desktop/features/settings/controller/setting_controller.dart';
import 'package:peers_touch_desktop/features/settings/model/setting_item.dart';

/// 个人主页模块注册
class ProfileModule {
  static void register() {
    // 注入依赖
    ProfileBinding().dependencies();

    // 注入 Profile 的设置到统一 Settings 模块
    _registerProfileSettings();

    // 配置头像块点击进入个人页
    PrimaryMenuManager.setAvatarBlockBuilder((context) {
      final theme = Theme.of(context);
      final tokens = theme.extension<WeChatTokens>();
      return GetBuilder<ProfileController>(
        builder: (controller) {
          final d = controller.detail.value;
          return GestureDetector(
            behavior: HitTestBehavior.opaque,
            onTap: () => Get.find<ShellController>().openRightPanelWithOptions(
              (ctx) => const ProfilePage(embedded: true),
              width: 360,
              showCollapseButton: true,
              // 切到 Profile 时清空左/中区域，避免保留其它页内容
              clearCenter: true,
            ),
            child: Container(
              height: UIKit.avatarBlockHeight,
              color: tokens?.bgLevel2 ?? theme.colorScheme.surface,
              child: Center(
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(UIKit.radiusLg(context)),
                  child: SizedBox(
                    width: 40,
                    height: 40,
                    child: (d?.avatarUrl != null && d!.avatarUrl!.isNotEmpty)
                        ? Image.network(d.avatarUrl!, fit: BoxFit.cover)
                        : Icon(Icons.person, color: tokens?.textPrimary ?? theme.colorScheme.onSurface, size: 28),
                  ),
                ),
              ),
            ),
          );
        },
      );
    });
  }

  static void _registerProfileSettings() {
    final settingController = Get.find<SettingController>();
    final profileController = Get.find<ProfileController>();
    final d = profileController.detail.value;

    settingController.registerModuleSettings('profile', '个人设置', [
      const SettingItem(
        id: 'privacy_header',
        title: '隐私设置',
        type: SettingItemType.sectionHeader,
      ),
      SettingItem(
        id: 'default_visibility',
        title: '默认可见范围',
        description: '设置内容的默认可见范围',
        icon: Icons.visibility,
        type: SettingItemType.select,
        value: d?.defaultVisibility ?? 'public',
        options: const ['public', 'unlisted', 'followers', 'private'],
        onChanged: (val) {
          if (val is String) {
            profileController.setDefaultVisibility(val);
          }
        },
      ),
      SettingItem(
        id: 'approve_followers_manually',
        title: '手动批准关注',
        description: '是否需要手动批准新的关注请求',
        icon: Icons.person_add,
        type: SettingItemType.toggle,
        value: d?.manuallyApprovesFollowers ?? true,
        onChanged: (val) {
          if (val is bool) {
            profileController.setManuallyApprovesFollowers(val);
          }
        },
      ),
      SettingItem(
        id: 'message_permission',
        title: '私信权限',
        description: '允许哪些人向你发送私信',
        icon: Icons.mail_outline,
        type: SettingItemType.select,
        value: d?.messagePermission ?? 'mutual',
        options: const ['everyone', 'mutual', 'none'],
        onChanged: (val) {
          if (val is String) {
            profileController.setMessagePermission(val);
          }
        },
      ),
    ]);
  }
}