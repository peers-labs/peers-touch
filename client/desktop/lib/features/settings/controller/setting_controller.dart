import 'package:get/get.dart';
import 'package:flutter/material.dart';
import 'package:peers_touch_base/logger/logging_service.dart';
import 'dart:convert';
import 'package:peers_touch_desktop/core/services/setting_manager.dart';
import 'package:peers_touch_base/storage/local_storage.dart';
import 'package:peers_touch_base/storage/secure_storage.dart';
import 'package:peers_touch_desktop/features/settings/model/setting_item.dart';
import 'package:peers_touch_desktop/features/settings/model/setting_search_result.dart';
import 'package:peers_touch_base/network/dio/http_service_locator.dart';
import 'package:peers_touch_base/network/dio/http_service_impl.dart';
import 'package:peers_touch_base/i18n/generated/app_localizations.dart';

class SettingController extends GetxController {
  final SettingManager _settingManager = SettingManager();
  late final LocalStorage _localStorage;
  late final SecureStorage _secureStorage;
  final Map<String, TextEditingController> _textControllers = {};
  final Map<String, String?> _itemErrors = {};
  
  // Backend address test related status
  final backendTestPath = 'Ping'.obs; // Optional: Ping / Health
  final backendVerified = true.obs;   // Set to false on failure to control input border
  
  // Currently selected setting section
  final selectedSection = Rx<String>('general');
  
  // All setting sections
  final sections = RxList<SettingSection>([]);
  
  // Search query (global setting item search)
  final searchQuery = ''.obs;
  
  @override
  void onInit() {
    super.onInit();
    _localStorage = Get.find<LocalStorage>();
    _secureStorage = Get.find<SecureStorage>();
    _initializeSettings();
  }
  
  /// Initialize settings
  void _initializeSettings() {
    // Initialize general settings
    _settingManager.initializeGeneralSettings();
    
    // Get all setting sections and load persisted values
    final loadedSections = _settingManager.getSections();
    _loadPersistedValues(loadedSections);
    sections.value = loadedSections;
    
    // Default select first section
    if (sections.isNotEmpty) {
      selectedSection.value = sections.first.id;
    }
  }
  
  /// Switch setting section
  void selectSection(String sectionId) {
    selectedSection.value = sectionId;
    final section = sections.firstWhereOrNull((s) => s.id == sectionId);
    if (section != null) {
      if (section.refreshOnTabSwitch && !section.keepAlive) {
        section.onRefresh?.call();
      } else {
        section.onLoad?.call();
      }
    }
  }
  
  /// Update search query
  void setSearchQuery(String query) {
    searchQuery.value = query;
  }
  
  /// Get currently selected section
  SettingSection? getCurrentSection() {
    return sections.firstWhere(
      (section) => section.id == selectedSection.value,
      orElse: () => sections.first,
    );
  }
  
  /// Get global match results based on search query
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

  /// Update setting item value
  void updateSettingValue(String sectionId, String itemId, dynamic value) {
    // Update value in memory
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

    // Persist to storage (sensitive info uses secure storage)
    final key = _storageKey(sectionId, itemId);
    final useSecure = _isSensitive(itemId);
    if (useSecure && value is String) {
      _secureStorage.set(key, value);
    } else {
      _localStorage.set(key, value);
    }
  }

  /// Update setting item options (for select type dynamic options)
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

  /// Set or clear setting item error state
  void setItemError(String sectionId, String itemId, String? error) {
    final key = _storageKey(sectionId, itemId);
    _itemErrors[key] = error;
    sections.refresh();
  }

  /// Get setting item error message (null means no error)
  String? getItemError(String sectionId, String itemId) {
    final key = _storageKey(sectionId, itemId);
    return _itemErrors[key];
  }

  /// Get or create text input controller to avoid cursor jump due to rebuild
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

  /// Normalize backend base URL, auto-complete protocol and default address
  String _normalizeBaseUrl(String input) {
    final trimmed = input.trim();
    if (trimmed.isEmpty) return HttpServiceLocator().baseUrl;
    final hasScheme = trimmed.startsWith('http://') || trimmed.startsWith('https://');
    final url = hasScheme ? trimmed : 'http://$trimmed';
    try {
      final uri = Uri.parse(url);
      if (uri.scheme.isEmpty) return 'http://localhost:18080';
      return url;
    } catch (_) {
      return 'http://localhost:18080';
    }
  }

  /// Test backend address specific path (Ping/Health), show result via snackbar
  Future<void> testBackendAddress(String baseUrlInput) async {
    final base = _normalizeBaseUrl(baseUrlInput);
    // we now only support the health endpoint.
    final path = backendTestPath.value == 'Health' ? '/management/health' : '/management/health';
    try {
      final httpService = HttpServiceImpl(baseUrl: base);
      final respData = await httpService.get(path);
      
      backendVerified.value = true;
      final dataText = respData is String ? respData : jsonEncode(respData);
      final l = AppLocalizations.of(Get.context!)!;
      Get.snackbar(l.addressTest, l.successWithData(dataText));
    } catch (e) {
      backendVerified.value = false;
      LoggingService.warning('Address Test', 'Failed: $e');
      final l = AppLocalizations.of(Get.context!)!;
      Get.snackbar(l.addressTest, l.failedWithData(e.toString()));
    }
  }
  
  /// Register business module settings
  void registerModuleSettings(String moduleId, String moduleName, List<SettingItem> settings) {
    _settingManager.registerBusinessModuleSettings(moduleId, moduleName, settings);
    
    // Refresh setting section list
    final loadedSections = _settingManager.getSections();
    _loadPersistedValues(loadedSections);
    sections.value = loadedSections;
  }

  void refreshSections() {
    sections.refresh();
  }

  Future<void> _loadPersistedValues(List<SettingSection> targetSections) async {
    for (final section in targetSections) {
      for (var i = 0; i < section.items.length; i++) {
        final item = section.items[i];
        final key = _storageKey(section.id, item.id);
        dynamic stored;
        if (_isSensitive(item.id)) {
          // Async read from secure storage
          final s = await _secureStorage.get(key);
          if (s != null) {
            _updateSectionItem(targetSections, section.id, item, s);
          }
        } else {
          stored = await _localStorage.get<dynamic>(key);
          if (stored != null) {
            _updateSectionItem(targetSections, section.id, item, stored);
          }
        }
      }
    }
  }

  void _updateSectionItem(List<SettingSection> targetSections, String sectionId, SettingItem item, dynamic value) {
    final idx = targetSections.indexWhere((sec) => sec.id == sectionId);
    if (idx != -1) {
      final itemIdx = targetSections[idx].items.indexWhere((it) => it.id == item.id);
      if (itemIdx != -1) {
        targetSections[idx].items[itemIdx] = SettingItem(
          id: item.id,
          title: item.title,
          description: item.description,
          icon: item.icon,
          type: item.type,
          value: value,
          options: item.options,
          placeholder: item.placeholder,
          onTap: item.onTap,
          onChanged: item.onChanged,
        );
        sections.refresh();
        if (item.type == SettingItemType.textInput) {
          final ctrlKey = _storageKey(sectionId, item.id);
          final ctrl = _textControllers[ctrlKey];
          if (ctrl != null) ctrl.text = value.toString();
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
