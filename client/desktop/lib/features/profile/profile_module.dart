import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_base/context/global_context.dart';
import 'package:peers_touch_base/logger/logging_service.dart';
import 'package:peers_touch_ui/peers_touch_ui.dart';
import 'package:peers_touch_desktop/app/theme/theme_tokens.dart';
import 'package:peers_touch_desktop/app/theme/ui_kit.dart';
import 'package:peers_touch_desktop/features/profile/binding/profile_binding.dart';
import 'package:peers_touch_desktop/features/profile/controller/profile_controller.dart';
import 'package:peers_touch_desktop/features/profile/view/profile_page.dart';
import 'package:peers_touch_desktop/features/settings/controller/setting_controller.dart';
import 'package:peers_touch_desktop/features/settings/model/setting_item.dart';
import 'package:peers_touch_desktop/features/shell/controller/shell_controller.dart';
import 'package:peers_touch_desktop/features/shell/manager/primary_menu_manager.dart';

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
      final controller = Get.find<ProfileController>();
       return Obx(() {
         final d = controller.detail.value;
         
         if (d != null) {
           LoggingService.debug('Avatar Block: id=${d.id}, handle=${d.handle}');
         } else {
           LoggingService.debug('Avatar Block: detail is null');
         }
         
         return GestureDetector(
           behavior: HitTestBehavior.opaque,
           onTap: () => Get.find<ShellController>().openRightPanelWithOptions(
             (ctx) => const ProfilePage(embedded: true),
             width: 360,
             showCollapseButton: true,
             clearCenter: true,
           ),
           child: Container(
            height: UIKit.avatarBlockHeight,
            color: tokens?.bgLevel2 ?? theme.colorScheme.surface,
            child: Center(
                child: Avatar(
                  actorId: d?.id ?? '',
                  fallbackName: d?.handle ?? 'User',
                  size: 40,
                ),
              ),
          ),
         );
       });
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
      SettingItem(
        id: 'send_read_receipts',
        title: '发送已读回执',
        description: '关闭后，对方将看不到你是否已读消息',
        icon: Icons.done_all,
        type: SettingItemType.toggle,
        value: _getFeatureFlag('send_read_receipts', defaultValue: true),
        onChanged: (val) {
          if (val is bool) {
            _setFeatureFlag('send_read_receipts', val);
          }
        },
      ),
      SettingItem(
        id: 'show_online_status',
        title: '显示在线状态',
        description: '关闭后，其他人将看不到你的在线状态',
        icon: Icons.visibility,
        type: SettingItemType.toggle,
        value: _getFeatureFlag('show_online_status', defaultValue: true),
        onChanged: (val) {
          if (val is bool) {
            _setFeatureFlag('show_online_status', val);
          }
        },
      ),
      const SettingItem(
        id: 'notification_header',
        title: '通知设置',
        type: SettingItemType.sectionHeader,
      ),
      SettingItem(
        id: 'unread_badge_style',
        title: '未读角标样式',
        description: '选择消息未读角标的显示方式',
        icon: Icons.notifications_active,
        type: SettingItemType.select,
        value: _getFeatureFlagString('unread_badge_style', defaultValue: 'number'),
        options: const ['number', 'dot'],
        onChanged: (val) {
          if (val is String) {
            _setFeatureFlagString('unread_badge_style', val);
          }
        },
      ),
      const SettingItem(
        id: 'account_section',
        title: '账户',
        type: SettingItemType.sectionHeader,
      ),
      SettingItem(
        id: 'logout',
        title: '退出登录',
        description: '退出当前账号',
        icon: Icons.logout,
        type: SettingItemType.button,
        onTap: profileController.logout,
      ),
    ]);
  }
  
  /// Get feature flag from GlobalContext preferences (bool)
  static bool _getFeatureFlag(String key, {bool defaultValue = true}) {
    if (!Get.isRegistered<GlobalContext>()) return defaultValue;
    final gc = Get.find<GlobalContext>();
    final flags = gc.preferences['feature_flags'];
    if (flags is Map) {
      return flags[key] == true || (flags[key] == null && defaultValue);
    }
    return defaultValue;
  }
  
  /// Get feature flag from GlobalContext preferences (String)
  static String _getFeatureFlagString(String key, {String defaultValue = ''}) {
    if (!Get.isRegistered<GlobalContext>()) return defaultValue;
    final gc = Get.find<GlobalContext>();
    final flags = gc.preferences['feature_flags'];
    if (flags is Map && flags[key] is String) {
      return flags[key] as String;
    }
    return defaultValue;
  }
  
  /// Set feature flag in GlobalContext preferences (persists to storage)
  static Future<void> _setFeatureFlag(String key, bool value) async {
    await _setFeatureFlagValue(key, value);
  }
  
  /// Set feature flag string in GlobalContext preferences
  static Future<void> _setFeatureFlagString(String key, String value) async {
    await _setFeatureFlagValue(key, value);
  }
  
  /// Internal method to set any feature flag value
  static Future<void> _setFeatureFlagValue(String key, dynamic value) async {
    if (!Get.isRegistered<GlobalContext>()) return;
    final gc = Get.find<GlobalContext>();
    
    // Get current preferences
    final prefs = Map<String, dynamic>.from(gc.preferences);
    final flags = prefs['feature_flags'] is Map 
        ? Map<String, dynamic>.from(prefs['feature_flags'] as Map)
        : <String, dynamic>{};
    
    // Update flag
    flags[key] = value;
    prefs['feature_flags'] = flags;
    
    // Persist through GlobalContext (handles LocalStorage + Proto)
    await gc.updatePreferences(prefs);
    LoggingService.info('Feature flag updated: $key = $value');
  }
}
