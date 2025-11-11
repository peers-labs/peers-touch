import 'package:get/get.dart';
import 'package:peers_touch_desktop/features/ai_chat/model/provider.dart';
import 'package:peers_touch_desktop/features/ai_chat/service/provider_service.dart';
import 'package:peers_touch_storage/peers_touch_storage.dart';

/// AI服务提供商控制器
class ProviderController extends GetxController {
  final ProviderService _providerService = ProviderService();
  
  // 状态变量
  final providers = <Provider>[].obs;
  final currentProvider = Rx<Provider?>(null);
  final isLoading = false.obs;
  final selectedProviderId = ''.obs;
  
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
      
      // 加载当前提供商
      final current = await _providerService.getCurrentProvider();
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
  
  /// 添加新提供商
  Future<void> addProvider({
    required String name,
    required String sourceType,
    String? apiKey,
    String? baseUrl,
  }) async {
    try {
      final now = DateTime.now().toUtc();
      final providerId = '${sourceType.toLowerCase()}-${now.millisecondsSinceEpoch}';
      
      final newProvider = Provider(
        id: providerId,
        name: name,
        peersUserId: 'default', // TODO: 获取当前用户ID
        sort: providers.length,
        enabled: true,
        sourceType: sourceType,
        settings: {
          'baseUrl': baseUrl ?? _getDefaultBaseUrl(sourceType),
        },
        config: {
          'temperature': 0.7,
          'maxTokens': 2048,
        },
        accessedAt: now,
        createdAt: now,
        updatedAt: now,
      );
      
      await _providerService.saveProvider(newProvider);
      
      // 保存API密钥到安全存储
      if (apiKey != null && apiKey.isNotEmpty) {
        await _saveApiKey(providerId, apiKey);
      }
      
      await loadProviders();
      Get.snackbar('成功', '提供商添加成功');
    } catch (e) {
      Get.snackbar('错误', '添加提供商失败: $e');
    }
  }
  
  /// 更新提供商
  Future<void> updateProvider(Provider provider) async {
    try {
      final updatedProvider = provider.copyWith(
        updatedAt: DateTime.now().toUtc(),
      );
      
      await _providerService.saveProvider(updatedProvider);
      await loadProviders();
      Get.snackbar('成功', '提供商更新成功');
    } catch (e) {
      Get.snackbar('错误', '更新提供商失败: $e');
    }
  }
  
  /// 删除提供商
  Future<void> deleteProvider(String providerId) async {
    try {
      await _providerService.deleteProvider(providerId, 'default');
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
      await _providerService.setCurrentProvider(providerId);
      selectedProviderId.value = providerId;
      
      // 重新加载当前提供商
      final current = await _providerService.getCurrentProvider();
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
      final testProvider = provider.copyWith(
        keyVaults: apiKey,
      );
      
      isLoading.value = true;
      final isConnected = await _providerService.testProviderConnection(testProvider);
      
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
      final testProvider = provider.copyWith(
        keyVaults: apiKey,
      );
      
      return await _providerService.fetchProviderModels(testProvider);
    } catch (e) {
      return [];
    }
  }
  
  /// 保存API密钥
  Future<void> _saveApiKey(String providerId, String apiKey) async {
    // TODO: 实现安全的密钥存储
    await Get.find<SecureStorage>().set('provider_key_$providerId', apiKey);
  }

  /// 更新（保存）API密钥（公开方法，供设置面板调用）
  Future<void> updateApiKey(String providerId, String apiKey) async {
    try {
      await _saveApiKey(providerId, apiKey);
      Get.snackbar('成功', 'API Key 已更新');
    } catch (e) {
      Get.snackbar('错误', '更新 API Key 失败: $e');
      rethrow;
    }
  }
  
  /// 获取API密钥
  Future<String?> _getApiKey(String providerId) async {
    // TODO: 实现安全的密钥获取
    return await Get.find<SecureStorage>().get('provider_key_$providerId');
  }
  
  /// 删除API密钥
  Future<void> _deleteApiKey(String providerId) async {
    await Get.find<SecureStorage>().remove('provider_key_$providerId');
  }
  
  /// 获取默认基础URL
  String _getDefaultBaseUrl(String sourceType) {
    switch (sourceType.toLowerCase()) {
      case 'openai':
        return 'https://api.openai.com/v1';
      case 'ollama':
        return 'http://localhost:11434';
      case 'anthropic':
        return 'https://api.anthropic.com';
      case 'google':
        return 'https://generativelanguage.googleapis.com';
      default:
        return 'https://api.openai.com/v1';
    }
  }
  
}