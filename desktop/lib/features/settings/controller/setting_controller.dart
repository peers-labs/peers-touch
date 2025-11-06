import 'package:get/get.dart';
import 'package:peers_touch_desktop/core/services/setting_manager.dart';
import 'package:peers_touch_desktop/core/storage/local_storage.dart';
import 'package:peers_touch_desktop/core/storage/secure_storage.dart';
import 'package:peers_touch_desktop/features/settings/model/setting_item.dart';
import 'package:peers_touch_desktop/features/settings/model/setting_search_result.dart';

class SettingController extends GetxController {
  final SettingManager _settingManager = SettingManager();
  late final LocalStorage _localStorage;
  late final SecureStorage _secureStorage;
  
  // 当前选中的设置分区
  final selectedSection = Rx<String>('general');
  
  // 所有设置分区
  final sections = RxList<SettingSection>([]);
  
  // 搜索关键字（全局搜索设置项）
  final searchQuery = ''.obs;
  
  @override
  void onInit() {
    super.onInit();
    _localStorage = Get.find<LocalStorage>();
    _secureStorage = Get.find<SecureStorage>();
    _initializeSettings();
  }
  
  /// 初始化设置
  void _initializeSettings() {
    // 初始化通用设置
    _settingManager.initializeGeneralSettings();
    
    // 获取所有设置分区并加载已持久化的值
    final loadedSections = _settingManager.getSections();
    _loadPersistedValues(loadedSections);
    sections.value = loadedSections;
    
    // 默认选中第一个分区
    if (sections.isNotEmpty) {
      selectedSection.value = sections.first.id;
    }
  }
  
  /// 切换设置分区
  void selectSection(String sectionId) {
    selectedSection.value = sectionId;
  }
  
  /// 更新搜索关键字
  void setSearchQuery(String query) {
    searchQuery.value = query;
  }
  
  /// 获取当前选中的分区
  SettingSection? getCurrentSection() {
    return sections.firstWhere(
      (section) => section.id == selectedSection.value,
      orElse: () => sections.first,
    );
  }
  
  /// 根据搜索关键字返回全局匹配结果
  List<SettingSearchResult> getSearchResults() {
    final q = searchQuery.value.trim().toLowerCase();
    if (q.isEmpty) return [];
    final results = <SettingSearchResult>[];
    for (final section in sections) {
      for (final item in section.items) {
        final hay = '${item.title} ${item.description ?? ''} ${item.id}'.toLowerCase();
        if (hay.contains(q)) {
          results.add(SettingSearchResult(sectionId: section.id, item: item));
        }
      }
    }
    return results;
  }
  
  /// 更新设置项值
  void updateSettingValue(String sectionId, String itemId, dynamic value) {
    // 更新内存中的值
    final idx = sections.indexWhere((s) => s.id == sectionId);
    if (idx != -1) {
      final section = sections[idx];
      final itemIdx = section.items.indexWhere((i) => i.id == itemId);
      if (itemIdx != -1) {
        final currentItem = section.items[itemIdx];
        section.items[itemIdx] = SettingItem(
          id: currentItem.id,
          title: currentItem.title,
          description: currentItem.description,
          icon: currentItem.icon,
          type: currentItem.type,
          value: value,
          options: currentItem.options,
          placeholder: currentItem.placeholder,
          onTap: currentItem.onTap,
          onChanged: currentItem.onChanged,
        );
        sections.refresh();
      }
    }

    // 持久化到存储（敏感信息使用安全存储）
    final key = _storageKey(sectionId, itemId);
    final useSecure = _isSensitive(itemId);
    if (useSecure && value is String) {
      _secureStorage.set(key, value);
    } else {
      _localStorage.set(key, value);
    }
  }
  
  /// 注册业务模块设置
  void registerModuleSettings(String moduleId, String moduleName, List<SettingItem> settings) {
    _settingManager.registerBusinessModuleSettings(moduleId, moduleName, settings);
    
    // 刷新设置分区列表
    final loadedSections = _settingManager.getSections();
    _loadPersistedValues(loadedSections);
    sections.value = loadedSections;
  }

  void _loadPersistedValues(List<SettingSection> targetSections) {
    for (final section in targetSections) {
      for (var i = 0; i < section.items.length; i++) {
        final item = section.items[i];
        final key = _storageKey(section.id, item.id);
        dynamic stored;
        if (_isSensitive(item.id)) {
          // 异步从安全存储读取
          _secureStorage.get(key).then((s) {
            if (s != null) {
              final idx = targetSections.indexWhere((sec) => sec.id == section.id);
              if (idx != -1) {
                final itemIdx = targetSections[idx].items.indexWhere((it) => it.id == item.id);
                if (itemIdx != -1) {
                  targetSections[idx].items[itemIdx] = SettingItem(
                    id: item.id,
                    title: item.title,
                    description: item.description,
                    icon: item.icon,
                    type: item.type,
                    value: s,
                    options: item.options,
                    placeholder: item.placeholder,
                    onTap: item.onTap,
                    onChanged: item.onChanged,
                  );
                  sections.refresh();
                }
              }
            }
          });
        } else {
          stored = _localStorage.get<dynamic>(key);
          if (stored != null) {
            section.items[i] = SettingItem(
              id: item.id,
              title: item.title,
              description: item.description,
              icon: item.icon,
              type: item.type,
              value: stored,
              options: item.options,
              placeholder: item.placeholder,
              onTap: item.onTap,
              onChanged: item.onChanged,
            );
          }
        }
      }
    }
  }

  String _storageKey(String sectionId, String itemId) => 'settings:$sectionId:$itemId';

  bool _isSensitive(String itemId) {
    final id = itemId.toLowerCase();
    return id.contains('token') || id.contains('secret') || id.contains('password');
  }
}