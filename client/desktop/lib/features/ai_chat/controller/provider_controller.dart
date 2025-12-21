import 'dart:convert';

import 'package:get/get.dart';
import 'package:peers_touch_base/model/domain/ai_box/provider.pb.dart';
import 'package:peers_touch_base/model/domain/ai_box/ai_models.pb.dart';
import 'package:peers_touch_base/model/google/protobuf/timestamp.pb.dart';
import 'package:peers_touch_base/storage/local_storage.dart';
import 'package:peers_touch_desktop/features/ai_chat/service/provider_service.dart';
import 'package:peers_touch_desktop/features/ai_chat/controller/ai_chat_controller.dart';
import 'package:peers_touch_desktop/features/ai_chat/widgets/input_box/capability/capability_resolver.dart';
import 'package:peers_touch_desktop/features/ai_chat/widgets/input_box/models/model_capability.dart';

import 'package:peers_touch_base/i18n/generated/app_localizations.dart';

/// AI服务提供商控制器
class ProviderController extends GetxController {
  final ProviderService _providerService = Get.find();

  // 状态变量
  final providers = <Provider>[].obs;
  final currentProvider = Rx<Provider?>(null);
  final isLoading = false.obs;
  final selectedProviderId = ''.obs;
  final isApiKeyObscured = true.obs;
  final isClientRequestMode = false.obs;
  final modelSearchText = ''.obs;
  final modelTabIndex = 0.obs; // 0: All, 1: Enabled
  final connectionStatus = 'idle'.obs; // idle|checking|success|failure

  String get panelId => 'ai_provider';

  bool get shouldKeepAlive => false;

  @override
  void onInit() {
    super.onInit();
    loadProviders();
  }

  /// 加载所有提供商
  Future<void> loadProviders() async {
    isLoading.value = true;
    try {
      final loadedProviders = await _providerService.getProviders();
      // 迁移旧字段到 settingsJson（api_key/base_url -> apiKey/proxyUrl/defaultProxyUrl）
      final migrated = <Provider>[];
      for (final p in loadedProviders) {
        final settings = p.settingsJson.isNotEmpty
            ? (jsonDecode(p.settingsJson) as Map<String, dynamic>)
            : <String, dynamic>{};
        final config = p.configJson.isNotEmpty
            ? (jsonDecode(p.configJson) as Map<String, dynamic>)
            : <String, dynamic>{};
        var changed = false;
        // requestFormat 填充
        if ((settings['requestFormat'] ?? '').toString().isEmpty) {
          settings['requestFormat'] = (p.sourceType.isNotEmpty
              ? p.sourceType.toLowerCase()
              : 'openai');
          changed = true;
        }
        // apiKey 迁移
        final legacyKey = (config['api_key'] ?? '').toString();
        if ((settings['apiKey'] ?? '').toString().isEmpty &&
            legacyKey.isNotEmpty) {
          settings['apiKey'] = legacyKey;
          changed = true;
        }
        // proxyUrl/defaultProxyUrl 迁移
        final legacyUrl = (config['base_url'] ?? config['baseUrl'] ?? '')
            .toString();
        if (((settings['proxyUrl'] ?? '').toString().isEmpty) &&
            legacyUrl.isNotEmpty) {
          final cleaned = _sanitizeUrl(legacyUrl);
          settings['proxyUrl'] = cleaned;
          if ((settings['defaultProxyUrl'] ?? '').toString().isEmpty) {
            settings['defaultProxyUrl'] = cleaned;
          }
          changed = true;
        }
        if (changed) {
          final updated = (p.deepCopy() as Provider)
            ..settingsJson = jsonEncode(settings)
            ..updatedAt = Timestamp.fromDateTime(DateTime.now().toUtc());
          await _providerService.updateProvider(updated);
          migrated.add(updated);
        } else {
          migrated.add(p);
        }
      }
      providers.assignAll(migrated);

      // 加载当前提供商（优先使用会话级）
      String? sessionId;
      if (Get.isRegistered<AIChatController>()) {
        sessionId = Get.find<AIChatController>().selectedSessionId.value;
      }
      final current = sessionId != null
          ? await _providerService.getCurrentProviderForSession(sessionId)
          : await _providerService.getCurrentProvider();
      currentProvider.value = current;
      if (current != null) {
        selectedProviderId.value = current.id;
        final settings = current.settingsJson.isNotEmpty
            ? (jsonDecode(current.settingsJson) as Map<String, dynamic>)
            : {};
        isClientRequestMode.value =
            (await Get.find<LocalStorage>().get<bool>('client_request_mode_global') ??
            false);
      }
    } catch (e) {
      final context = Get.context;
      final l10n = context != null ? AppLocalizations.of(context)! : null;
      Get.snackbar(l10n?.error ?? 'Error', l10n?.providerLoadError(e.toString()) ?? 'Failed to load providers: $e');
    } finally {
      isLoading.value = false;
    }
  }

  /// 更新提供商
  Future<void> updateProvider(Provider provider) async {
    try {
      final updatedProvider = (provider.deepCopy() as Provider)
            ..updatedAt = Timestamp.fromDateTime(DateTime.now().toUtc());

      await _providerService.updateProvider(updatedProvider);
      await loadProviders();
      final context = Get.context;
      final l10n = context != null ? AppLocalizations.of(context)! : null;
      Get.snackbar(l10n?.success ?? 'Success', l10n?.providerUpdateSuccess ?? 'Provider updated successfully');
    } catch (e) {
      final context = Get.context;
      final l10n = context != null ? AppLocalizations.of(context)! : null;
      Get.snackbar(l10n?.error ?? 'Error', l10n?.providerUpdateError(e.toString()) ?? 'Failed to update provider: $e');
    }
  }

  /// 删除提供商
  Future<void> deleteProvider(String providerId) async {
    try {
      await _providerService.deleteProvider(providerId);
      await loadProviders();
      final context = Get.context;
      final l10n = context != null ? AppLocalizations.of(context)! : null;
      Get.snackbar(l10n?.success ?? 'Success', l10n?.providerDeleteSuccess ?? 'Provider deleted successfully');
    } catch (e) {
      final context = Get.context;
      final l10n = context != null ? AppLocalizations.of(context)! : null;
      Get.snackbar(l10n?.error ?? 'Error', l10n?.providerDeleteError(e.toString()) ?? 'Failed to delete provider: $e');
    }
  }

  Future<void> updateProviderName(String providerId, String newName) async {
    try {
      final p =
          providers.firstWhereOrNull((e) => e.id == providerId) ??
          currentProvider.value;
      if (p == null) return;
      final updated = (p.deepCopy() as Provider)
            ..name = newName
            ..updatedAt = Timestamp.fromDateTime(DateTime.now().toUtc());
      await _providerService.updateProvider(updated);
      await loadProviders();
      final context = Get.context;
      final l10n = context != null ? AppLocalizations.of(context)! : null;
      Get.snackbar(l10n?.success ?? 'Success', l10n?.nameUpdated ?? 'Name updated');
    } catch (e) {
      final context = Get.context;
      final l10n = context != null ? AppLocalizations.of(context)! : null;
      Get.snackbar(l10n?.error ?? 'Error', l10n?.nameUpdateError(e.toString()) ?? 'Failed to update name: $e');
    }
  }

  /// 设置当前提供商
  Future<void> setCurrentProvider(String providerId) async {
    try {
      // 如果有选中的会话，则设置会话级当前提供商
      if (Get.isRegistered<AIChatController>()) {
        final sid = Get.find<AIChatController>().selectedSessionId.value;
        if (sid != null && sid.isNotEmpty) {
          await _providerService.setCurrentProviderForSession(sid, providerId);
        } else {
          await _providerService.setCurrentProvider(providerId);
        }
      } else {
        await _providerService.setCurrentProvider(providerId);
      }
      selectedProviderId.value = providerId;

      // 重新加载当前提供商
      String? sessionId;
      if (Get.isRegistered<AIChatController>()) {
        sessionId = Get.find<AIChatController>().selectedSessionId.value;
      }
      final current = sessionId != null
          ? await _providerService.getCurrentProviderForSession(sessionId)
          : await _providerService.getCurrentProvider();
      currentProvider.value = current;

      final context = Get.context;
      final l10n = context != null ? AppLocalizations.of(context)! : null;
      Get.snackbar(l10n?.success ?? 'Success', l10n?.providerSwitched ?? 'Current provider switched');
    } catch (e) {
      final context = Get.context;
      final l10n = context != null ? AppLocalizations.of(context)! : null;
      Get.snackbar(l10n?.error ?? 'Error', l10n?.providerSwitchError(e.toString()) ?? 'Failed to switch provider: $e');
    }
  }

  /// 测试提供商连接（静默，无全局 Loading），返回布尔结果
  Future<bool> testProviderConnection(String providerId) async {
    try {
      final provider = providers.firstWhere((p) => p.id == providerId);
      final settings = provider.settingsJson.isNotEmpty
          ? (jsonDecode(provider.settingsJson) as Map<String, dynamic>)
          : {};
      final apiKey = (settings['apiKey'] ?? '').toString();
      if (apiKey.isEmpty) {
        connectionStatus.value = 'failure';
        return false;
      }
      connectionStatus.value = 'checking';
      final isConnected = await _providerService.testProviderConnection(provider);
      connectionStatus.value = isConnected ? 'success' : 'failure';
      return isConnected;
    } catch (_) {
      connectionStatus.value = 'failure';
      return false;
    }
  }

  /// 获取提供商的模型列表
  Future<List<String>> fetchProviderModels(String providerId) async {
    try {
      final provider = providers.firstWhere((p) => p.id == providerId);
      final models = await _providerService.fetchProviderModels(provider);
      if (models.isEmpty) return models;
      final settings = provider.settingsJson.isNotEmpty
          ? (jsonDecode(provider.settingsJson) as Map<String, dynamic>)
          : {};
      settings['models'] = models;

      // Inject capabilities
      final capabilities = <String, Map<String, dynamic>>{};
      for (final model in models) {
        final cap = CapabilityResolver.resolve(provider: provider.sourceType, modelId: model);
        capabilities[model] = {
          'supportsText': cap.supportsText,
          'supportsImageInput': cap.supportsImageInput,
          'supportsFileInput': cap.supportsFileInput,
          'supportsAudioInput': cap.supportsAudioInput,
          'supportsStreaming': cap.supportsStreaming,
          'maxImages': cap.maxImages,
          'maxFiles': cap.maxFiles,
          'maxAudio': cap.maxAudio,
        };
      }
      settings['modelCapabilities'] = capabilities;

      // 补充 modelInfos，至少包含 id 与 displayName（=id）
      final List<dynamic> infos = List<dynamic>.from(settings['modelInfos'] ?? <dynamic>[]);
      final existingIds = infos.whereType<Map>().map((e) => e['id']?.toString() ?? '').where((e) => e.isNotEmpty).toSet();
      for (final mid in models) {
        if (!existingIds.contains(mid)) {
          infos.add({
            'id': mid,
            'displayName': mid,
            'organization': provider.name,
          });
        }
      }
      settings['modelInfos'] = infos;

      final updated = (provider.deepCopy() as Provider)
            ..settingsJson = jsonEncode(settings)
            ..updatedAt = Timestamp.fromDateTime(DateTime.now().toUtc());
      await _providerService.updateProvider(updated);
      await loadProviders();
      return models;
    } catch (e) {
      return [];
    }
  }

  /// 手动新增模型（使用 AiModel 原型），并与现有 settingsJson 字段对齐。
  /// 返回 true 表示成功，false 表示失败（并保留对话框）。
  Future<bool> addManualModel(AiModel model) async {
    // 优先使用模型携带的 providerId 定位 Provider，其次回退到 currentProvider
    final cp = providers.firstWhereOrNull((p) => p.id == model.providerId) ?? currentProvider.value;
    if (cp == null) return false;
    try {
      final settings = cp.settingsJson.isNotEmpty
          ? (jsonDecode(cp.settingsJson) as Map<String, dynamic>)
          : <String, dynamic>{};

      // 1) models 列表（字符串）
      final List<String> models = List<String>.from((settings['models'] ?? <String>[]) as List);
      if (!models.contains(model.id)) {
        models.add(model.id);
      }
      settings['models'] = models;

      // 2) 启用列表
      final List<String> enabled = List<String>.from((settings['enabledModels'] ?? <String>[]) as List);
      if (model.enabled && !enabled.contains(model.id)) {
        enabled.add(model.id);
      }
      settings['enabledModels'] = enabled;

      // 3) 能力映射（复用 CapabilityResolver）
      final cap = CapabilityResolver.resolve(provider: cp.sourceType, modelId: model.id);
      final Map<String, dynamic> caps = Map<String, dynamic>.from(settings['modelCapabilities'] ?? <String, dynamic>{});
      caps[model.id] = {
        'supportsText': cap.supportsText,
        'supportsImageInput': cap.supportsImageInput,
        'supportsFileInput': cap.supportsFileInput,
        'supportsAudioInput': cap.supportsAudioInput,
        'supportsStreaming': cap.supportsStreaming,
        'maxImages': cap.maxImages,
        'maxFiles': cap.maxFiles,
        'maxAudio': cap.maxAudio,
      };
      settings['modelCapabilities'] = caps;

      // 4) 完整信息（强类型 AiModel 的 JSON）
      final List<dynamic> infos = List<dynamic>.from(settings['modelInfos'] ?? <dynamic>[]);
      final info = _aiModelToJson(model);
      final idx = infos.indexWhere((e) => e is Map && e['id'] == model.id);
      if (idx >= 0) {
        infos[idx] = info;
      } else {
        infos.add(info);
      }
      settings['modelInfos'] = infos;

      final updated = (cp.deepCopy() as Provider)
            ..settingsJson = jsonEncode(settings)
            ..updatedAt = Timestamp.fromDateTime(DateTime.now().toUtc());
      await _providerService.updateProvider(updated);
      await loadProviders();
      return true;
    } catch (e) {
      Get.snackbar('错误', '添加模型失败: $e');
      return false;
    }
  }

  Map<String, dynamic> _aiModelToJson(AiModel m) {
    Map<String, dynamic> decodeOrEmpty(String s) {
      if (s.isEmpty) return <String, dynamic>{};
      try {
        final obj = jsonDecode(s);
        if (obj is Map) return obj.cast<String, dynamic>();
        return <String, dynamic>{};
      } catch (_) {
        return <String, dynamic>{};
      }
    }

    return {
      'id': m.id,
      'displayName': m.displayName,
      'description': m.description,
      'organization': m.organization,
      'enabled': m.enabled,
      'providerId': m.providerId,
      'type': m.type,
      'sort': m.sort,
      'userId': m.userId,
      'pricing': decodeOrEmpty(m.pricingJson),
      'parameters': decodeOrEmpty(m.parametersJson),
      'config': decodeOrEmpty(m.configJson),
      'abilities': decodeOrEmpty(m.abilitiesJson),
      'contextWindowTokens': m.contextWindowTokens,
      'source': m.source,
      'releasedAt': m.releasedAt,
    }..removeWhere((key, value) => value == null || (value is String && value.isEmpty));
  }

  void toggleApiKeyVisibility() {
    isApiKeyObscured.value = !isApiKeyObscured.value;
  }

  Future<void> updateField(String key, dynamic value) async {
    final cp = currentProvider.value;
    if (cp == null) return;
    final settings = cp.settingsJson.isNotEmpty
        ? (jsonDecode(cp.settingsJson) as Map<String, dynamic>)
        : {};
    settings[key] = value;
    final updated = (cp.deepCopy() as Provider)
          ..settingsJson = jsonEncode(settings)
          ..updatedAt = Timestamp.fromDateTime(DateTime.now().toUtc());
    await _providerService.updateProvider(updated);
    await loadProviders();
  }

  Future<void> toggleEnabled(bool on) async {
    final cp = currentProvider.value;
    if (cp == null) return;
    final updated = (cp.deepCopy() as Provider)
          ..enabled = on
          ..updatedAt = Timestamp.fromDateTime(DateTime.now().toUtc());
    await _providerService.updateProvider(updated);
    await loadProviders();
  }

  Future<void> setClientRequestMode(bool on) async {
    isClientRequestMode.value = on;
    await Get.find<LocalStorage>().set('client_request_mode_global', on);
  }

  void filterModels(String text) {
    modelSearchText.value = text;
  }

  void setModelTabIndex(int index) {
    modelTabIndex.value = index;
  }

  Future<void> toggleModelEnabled(String modelId, bool on) async {
    final cp = currentProvider.value;
    if (cp == null) return;
    final settings = cp.settingsJson.isNotEmpty
        ? (jsonDecode(cp.settingsJson) as Map<String, dynamic>)
        : {};
    final List<String> enabled = List<String>.from(
      (settings['enabledModels'] ?? <String>[]) as List,
    );
    if (on) {
      if (!enabled.contains(modelId)) enabled.add(modelId);
    } else {
      enabled.remove(modelId);
    }
    settings['enabledModels'] = enabled;
    final updated = (cp.deepCopy() as Provider)
          ..settingsJson = jsonEncode(settings)
          ..updatedAt = Timestamp.fromDateTime(DateTime.now().toUtc());
    await _providerService.updateProvider(updated);
    await loadProviders();
  }

  Future<void> deleteModel(String modelId) async {
    final cp = currentProvider.value;
    if (cp == null) return;
    final settings = cp.settingsJson.isNotEmpty
        ? (jsonDecode(cp.settingsJson) as Map<String, dynamic>)
        : {};
    // models
    final List<String> models = List<String>.from((settings['models'] ?? <String>[]) as List);
    models.removeWhere((m) => m == modelId);
    settings['models'] = models;
    // enabledModels
    final List<String> enabled = List<String>.from((settings['enabledModels'] ?? <String>[]) as List);
    enabled.removeWhere((m) => m == modelId);
    settings['enabledModels'] = enabled;
    // capabilities
    final Map<String, dynamic> caps = Map<String, dynamic>.from(settings['modelCapabilities'] ?? <String, dynamic>{});
    caps.remove(modelId);
    settings['modelCapabilities'] = caps;
    // infos
    final List<dynamic> infos = List<dynamic>.from(settings['modelInfos'] ?? <dynamic>[]);
    infos.removeWhere((e) => e is Map && e['id']?.toString() == modelId);
    settings['modelInfos'] = infos;
    final updated = (cp.deepCopy() as Provider)
          ..settingsJson = jsonEncode(settings)
          ..updatedAt = Timestamp.fromDateTime(DateTime.now().toUtc());
    await _providerService.updateProvider(updated);
    await loadProviders();
    Get.snackbar('成功', '模型已删除');
  }

  String _sanitizeUrl(String raw) {
    var s = raw.trim();
    if (s.startsWith('`') && s.endsWith('`')) {
      s = s.substring(1, s.length - 1);
    }
    // 去除内部多余反引号与空格
    s = s.replaceAll('`', '').trim();
    return s;
  }

  Future<void> load() async => loadProviders();

  Future<void> refresh() async => loadProviders();
}
