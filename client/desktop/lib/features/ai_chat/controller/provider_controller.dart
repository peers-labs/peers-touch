import 'dart:convert';

import 'package:get/get.dart';
import 'package:peers_touch_base/model/domain/ai_box/provider.pb.dart';
import 'package:peers_touch_base/model/google/protobuf/timestamp.pb.dart';
import 'package:peers_touch_desktop/core/storage/secure_storage.dart';
import 'package:peers_touch_desktop/features/ai_chat/service/provider_service.dart';
import 'package:peers_touch_desktop/features/ai_chat/controller/ai_chat_controller.dart';

/// AI服务提供商控制器
class ProviderController extends GetxController {
  final ProviderService _providerService = Get.find();

  // 状态变量
  final providers = <Provider>[].obs;
  final currentProvider = Rx<Provider?>(null);
  final isLoading = false.obs;
  final selectedProviderId = ''.obs;

  // UI状态
  final isApiKeyObscured = true.obs;
  final isClientRequestMode = false.obs;
  final currentModels = <String>[].obs;

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
      providers.assignAll(loadedProviders);

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
      }
    } catch (e) {
      Get.snackbar('错误', '加载提供商失败: $e');
    } finally {
      isLoading.value = false;
    }
  }

  /// 切换API密钥可见性
  void toggleApiKeyVisibility() {
    isApiKeyObscured.value = !isApiKeyObscured.value;
  }

  /// 更新提供商
  Future<void> updateProvider(Provider provider) async {
    try {
      final updatedProvider = provider.rebuild(
          (b) => b..updatedAt = Timestamp.fromDateTime(DateTime.now().toUtc()));

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
      await _deleteApiKey(providerId);
      await loadProviders();
      Get.snackbar('成功', '提供商删除成功');
    } catch (e) {
      Get.snackbar('错误', '删除提供商失败: $e');
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
      final apiKey = await _getApiKey(providerId);

      if (apiKey == null || apiKey.isEmpty) {
        Get.snackbar('错误', '请先设置API密钥');
        return;
      }

      // 创建临时提供商用于测试
      final settings = jsonDecode(provider.settingsJson) as Map<String, dynamic>;
      settings['apiKey'] = apiKey;

      final testProvider =
          provider.rebuild((b) => b..settingsJson = jsonEncode(settings));

      isLoading.value = true;
      final isConnected =
          await _providerService.testProviderConnection(testProvider);

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
      final apiKey = await _getApiKey(providerId);

      if (apiKey == null || apiKey.isEmpty) {
        return [];
      }

      // 创建临时提供商用于获取模型
      final settings = jsonDecode(provider.settingsJson) as Map<String, dynamic>;
      settings['apiKey'] = apiKey;

      final testProvider =
          provider.rebuild((b) => b..settingsJson = jsonEncode(settings));

      return await _providerService.fetchProviderModels(testProvider);
    } catch (e) {
      return [];
    }
  }

  /// 获取API密钥
  Future<String?> _getApiKey(String providerId) async {
    return await Get.find<SecureStorage>().get('provider_key_$providerId');
  }

  /// 删除API密钥
  Future<void> _deleteApiKey(String providerId) async {
    await Get.find<SecureStorage>().remove('provider_key_$providerId');
  }
}
