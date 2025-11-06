import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_desktop/features/settings/model/setting_item.dart';

/// 设置项注册器接口
abstract class SettingRegistry {
  /// 注册设置分区
  void registerSection(SettingSection section);
  
  /// 获取所有设置分区
  List<SettingSection> getSections();
}

/// 设置管理器 - 统一管理所有设置项
class SettingManager implements SettingRegistry {
  static final SettingManager _instance = SettingManager._internal();
  
  factory SettingManager() => _instance;
  
  SettingManager._internal();
  
  final List<SettingSection> _sections = [];
  
  /// 注册设置分区
  @override
  void registerSection(SettingSection section) {
    _sections.add(section);
  }
  
  /// 获取所有设置分区
  @override
  List<SettingSection> getSections() {
    return List.from(_sections);
  }
  
  /// 初始化通用设置分区
  void initializeGeneralSettings() {
    // 通用设置分区（可变分区，便于后续更新项值）
    registerSection(SettingSection(
      id: 'general',
      title: '通用设置',
      icon: Icons.settings,
      items: [
        SettingItem(
          id: 'language',
          title: '语言',
          description: '选择应用语言',
          icon: Icons.language,
          type: SettingItemType.select,
          value: 'zh-CN',
          options: ['zh-CN', 'en-US'],
          onChanged: (val) {
            if (val is String) {
              switch (val) {
                case 'zh-CN':
                  Get.updateLocale(const Locale('zh', 'CN'));
                  break;
                case 'en-US':
                  Get.updateLocale(const Locale('en', 'US'));
                  break;
              }
            }
          },
        ),
        SettingItem(
          id: 'theme',
          title: '主题',
          description: '选择应用主题',
          icon: Icons.palette,
          type: SettingItemType.select,
          value: 'dark',
          options: ['dark', 'light', 'auto'],
          onChanged: (val) {
            if (val is String) {
              switch (val) {
                case 'dark':
                  Get.changeThemeMode(ThemeMode.dark);
                  break;
                case 'light':
                  Get.changeThemeMode(ThemeMode.light);
                  break;
                case 'auto':
                  Get.changeThemeMode(ThemeMode.system);
                  break;
              }
            }
          },
        ),
        SettingItem(
          id: 'color_scheme',
          title: '色彩方案',
          description: '选择应用色彩方案',
          icon: Icons.color_lens,
          type: SettingItemType.select,
          value: 'lobe_chat',
          options: ['lobe_chat', 'material', 'cupertino'],
          // 暂未实现不同方案的即时切换，这里预留回调
          onChanged: (val) {
            // TODO: 根据方案切换不同的 ThemeData 扩展（后续实现）
          },
        ),
      ],
    ));
    
    // 全局业务设置分区
    registerSection(SettingSection(
      id: 'global_business',
      title: '全局业务设置',
      icon: Icons.cloud,
      items: [
        SettingItem(
          id: 'backend_url',
          title: '后端节点地址',
          description: '设置后端服务地址',
          icon: Icons.cloud_queue,
          type: SettingItemType.textInput,
          value: 'http://localhost:8080',
          placeholder: '请输入后端服务地址',
        ),
        SettingItem(
          id: 'auth_token',
          title: '安全认证',
          description: '设置API认证令牌',
          icon: Icons.security,
          type: SettingItemType.textInput,
          value: '',
          placeholder: '请输入认证令牌',
        ),
      ],
    ));
  }
  
  /// 注册业务模块设置
  void registerBusinessModuleSettings(String moduleId, String moduleName, List<SettingItem> settings) {
    registerSection(SettingSection(
      id: 'module_$moduleId',
      title: moduleName,
      icon: Icons.extension,
      items: settings,
    ));
  }
}