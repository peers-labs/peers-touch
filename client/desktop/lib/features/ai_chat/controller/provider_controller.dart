import 'dart:convert';

import 'package:get/get.dart';
import 'package:peers_touch_base/model/domain/ai_box/provider.pb.dart';
import 'package:peers_touch_base/model/google/protobuf/timestamp.pb.dart';
import 'package:peers_touch_desktop/core/storage/local_storage.dart';
import 'package:peers_touch_desktop/features/ai_chat/service/provider_service.dart';
import 'package:peers_touch_desktop/features/ai_chat/controller/ai_chat_controller.dart';
import 'package:peers_touch_desktop/features/ai_chat/widgets/input_box/capability/capability_resolver.dart';
import 'package:peers_touch_desktop/features/ai_chat/widgets/input_box/models/model_capability.dart';

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
            (Get.find<LocalStorage>().get<bool>('client_request_mode_global') ??
            false);
      }
    } catch (e) {
      Get.snackbar('错误', '加载提供商失败: $e');
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
      Get.snackbar('成功', '提供商更新成功');
    } catch (e) {
      Get.snackbar('错误', '更新提供商失败: $e');
    }
  }

  /// 删除提供商
  Future<void> deleteProvider(String providerId) async {
    try {
      await _providerService.deleteProvider(providerId);
      await loadProviders();
      Get.snackbar('成功', '提供商删除成功');
    } catch (e) {
      Get.snackbar('错误', '删除提供商失败: $e');
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
      Get.snackbar('成功', '名称已更新');
    } catch (e) {
      Get.snackbar('错误', '更新名称失败: $e');
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

      Get.snackbar('成功', '当前提供商已切换');
    } catch (e) {
      Get.snackbar('错误', '切换提供商失败: $e');
    }
  }

  /// 测试提供商连接
  Future<void> testProviderConnection(String providerId) async {
    try {
      final provider = providers.firstWhere((p) => p.id == providerId);
      final settings = provider.settingsJson.isNotEmpty
          ? (jsonDecode(provider.settingsJson) as Map<String, dynamic>)
          : {};
      final apiKey = (settings['apiKey'] ?? '').toString();
      if (apiKey.isEmpty) {
        Get.snackbar('错误', '请先设置API密钥');
        return;
      }
      isLoading.value = true;
      final isConnected = await _providerService.testProviderConnection(
        provider,
      );

      if (isConnected) {
        Get.snackbar('成功', '连接测试通过');
      } else {
        Get.snackbar('失败', '连接测试失败');
      }
    } catch (e) {
      Get.snackbar('错误', '连接测试异常: $e');
    } finally {
      isLoading.value = false;
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
