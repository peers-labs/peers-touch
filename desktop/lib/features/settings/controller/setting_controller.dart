import 'package:get/get.dart';
import 'package:flutter/material.dart';
import 'package:dio/dio.dart';
import 'dart:convert';
import 'package:peers_touch_desktop/core/services/setting_manager.dart';
import 'package:peers_touch_desktop/features/settings/model/setting_item.dart';
import 'package:peers_touch_desktop/features/settings/model/setting_search_result.dart';

class SettingController extends GetxController {
  final SettingManager _settingManager = SettingManager();
  late final StorageService _localStorage;
  late final SecureStorageService _secureStorage;
  final Map<String, TextEditingController> _textControllers = {};
  final Map<String, String?> _itemErrors = {};
  // 后端地址测试相关状态
  final backendTestPath = 'Ping'.obs; // 可选：Ping / Health
  final backendVerified = true.obs;   // 失败后置为 false，用于控制输入框边框
  
  // 当前选中的设置分区
  final selectedSection = Rx<String>('general');
  
  // 所有设置分区
  final sections = RxList<SettingSection>([]);
  
  // 搜索关键字（全局搜索设置项）
  final searchQuery = ''.obs;
  
  @override
  void onInit() {
    super.onInit();
    _localStorage = Get.find<StorageService>();
    _secureStorage = Get.find<SecureStorageService>();
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

  /// 更新设置项的备选项（用于 select 类型动态选项）
  void updateSettingOptions(String sectionId, String itemId, List<String> options) {
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
          value: currentItem.value,
          options: options,
          placeholder: currentItem.placeholder,
          onTap: currentItem.onTap,
          onChanged: currentItem.onChanged,
        );
        sections.refresh();
      }
    }
  }

  /// 设置或清除设置项错误态
  void setItemError(String sectionId, String itemId, String? error) {
    final key = _storageKey(sectionId, itemId);
    _itemErrors[key] = error;
    sections.refresh();
  }

  /// 获取设置项错误信息（null 表示无错误）
  String? getItemError(String sectionId, String itemId) {
    final key = _storageKey(sectionId, itemId);
    return _itemErrors[key];
  }

  /// 获取或创建文本输入控制器，避免因重建导致光标跳转
  TextEditingController getTextController(String sectionId, String itemId, String? initialValue) {
    final key = _storageKey(sectionId, itemId);
    final existing = _textControllers[key];
    if (existing != null) return existing;
    final ctrl = TextEditingController(text: initialValue ?? '');
    _textControllers[key] = ctrl;
    return ctrl;
  }

  @override
  void onClose() {
    for (final c in _textControllers.values) {
      c.dispose();
    }
    _textControllers.clear();
    super.onClose();
  }

  /// 规范化后端基础地址，自动补全协议与默认地址
  String _normalizeBaseUrl(String input) {
    final trimmed = input.trim();
    if (trimmed.isEmpty) return 'http://localhost:8080';
    final hasScheme = trimmed.startsWith('http://') || trimmed.startsWith('https://');
    final url = hasScheme ? trimmed : 'http://$trimmed';
    try {
      final uri = Uri.parse(url);
      if (uri.scheme.isEmpty) return 'http://localhost:8080';
      return url;
    } catch (_) {
      return 'http://localhost:8080';
    }
  }

  /// 测试后端地址指定 path（Ping/Health），结果通过通知栏展示
  Future<void> testBackendAddress(String baseUrlInput) async {
    final base = _normalizeBaseUrl(baseUrlInput);
    final path = backendTestPath.value == 'Health' ? '/management/health' : '/management/ping';
    final Uri fullUri = Uri.parse(base).resolve(path);
    try {
      final dio = Dio(BaseOptions(
        connectTimeout: const Duration(seconds: 8),
        receiveTimeout: const Duration(seconds: 12),
      ));
      final resp = await dio.getUri(fullUri);
      backendVerified.value = true;
      final dataText = resp.data is String ? resp.data.toString() : jsonEncode(resp.data);
      Get.snackbar('地址测试', '成功：$dataText');
    } catch (e) {
      backendVerified.value = false;
      Get.snackbar('地址测试', '失败：$e');
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

  void refreshSections() {
    sections.refresh();
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
                  if (item.type == SettingItemType.textInput) {
                    final ctrlKey = _storageKey(section.id, item.id);
                    final ctrl = _textControllers[ctrlKey];
                    if (ctrl != null) ctrl.text = s.toString();
                  }
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
            // 同步文本输入的控制器内容
            if (item.type == SettingItemType.textInput) {
              final ctrlKey = _storageKey(section.id, item.id);
              final ctrl = _textControllers[ctrlKey];
              if (ctrl != null) ctrl.text = stored.toString();
            }
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