import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_base/i18n/generated/app_localizations.dart';
import 'package:peers_touch_base/network/dio/http_service_locator.dart';
import 'package:peers_touch_base/storage/local_storage.dart';
import 'package:peers_touch_desktop/features/settings/model/setting_item.dart';

/// Setting registry interface
abstract class SettingRegistry {
  /// Register setting section
  void registerSection(SettingSection section);
  
  /// Get all setting sections
  List<SettingSection> getSections();
}

/// Setting manager - manages all settings
class SettingManager implements SettingRegistry {
  
  factory SettingManager() => _instance;
  
  SettingManager._internal();
  static final SettingManager _instance = SettingManager._internal();
  
  final List<SettingSection> _sections = [];
  
  /// Register setting section
  @override
  void registerSection(SettingSection section) {
    _sections.add(section);
  }
  
  /// Get all setting sections
  @override
  List<SettingSection> getSections() {
    return List.from(_sections);
  }
  
  /// Initialize general settings
  void initializeGeneralSettings() {
    // General settings section (mutable, for future updates)
    registerSection(SettingSection(
      id: 'general',
      title: 'General Settings',
      icon: Icons.settings,
      items: [
        SettingItem(
          id: 'language',
          title: 'Language',
          description: 'Select application language',
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
          title: 'Theme',
          description: 'Select application theme',
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
          title: 'Color Scheme',
          description: 'Select application color scheme',
          icon: Icons.color_lens,
          type: SettingItemType.select,
          value: 'lobe_chat',
          options: ['lobe_chat', 'material', 'cupertino'],
          // Immediate switching not implemented yet, reserved callback
          onChanged: (val) {
            // TODO: Switch ThemeData extensions based on scheme (future implementation)
          },
        ),
      ],
    ));
    
    // Global business settings section
    registerSection(SettingSection(
      id: 'global_business',
      title: 'Global Business Settings',
      icon: Icons.cloud,
      items: [
        SettingItem(
          id: 'backend_url',
          title: 'Backend Node Address',
          description: 'Set backend service address',
          icon: Icons.cloud_queue,
          type: SettingItemType.textInput,
          value: HttpServiceLocator().baseUrl,
          placeholder: 'Enter backend service address',
        ),
        SettingItem(
          id: 'auth_token',
          title: 'Security Auth',
          description: 'Set API authentication token',
          icon: Icons.security,
          type: SettingItemType.textInput,
          value: '',
          placeholder: 'Enter authentication token',
        ),
      ],
    ));

    // Advanced settings section
    registerSection(SettingSection(
      id: 'advanced_design',
      title: 'Advanced Settings',
      icon: Icons.design_services,
      items: [
        SettingItem(
          id: 'clear_data',
          title: 'Clear Data',
          description: 'Clear all local storage data',
          icon: Icons.delete_forever,
          type: SettingItemType.button,
          onTap: () {
            final l = AppLocalizations.of(Get.context!)!;
            Get.dialog(
              AlertDialog(
                title: Text(l.confirm),
                content: Text(l.clearDataConfirmation),
                actions: [
                  TextButton(
                    onPressed: () => Get.back(),
                    child: Text(l.cancel),
                  ),
                  TextButton(
                    onPressed: () async {
                      await LocalStorage().clear();
                      Get.back(); // Close the dialog
                      Get.snackbar(l.success, l.dataClearedSuccess);
                    },
                    child: Text(l.confirm),
                  ),
                ],
              ),
            );
          },
        ),
      ],
    ));
  }
  
  /// Register business module settings
  void registerBusinessModuleSettings(String moduleId, String moduleName, List<SettingItem> settings) {
    registerSection(SettingSection(
      id: 'module_$moduleId',
      title: moduleName,
      icon: Icons.extension,
      items: settings,
    ));
  }
}