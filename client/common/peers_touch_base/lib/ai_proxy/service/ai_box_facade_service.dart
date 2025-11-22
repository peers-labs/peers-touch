import 'dart:async';
import 'dart:convert';
import 'package:peers_touch_base/model/domain/ai_box/provider.pb.dart';
import 'package:peers_touch_base/model/domain/ai_box/chat.pb.dart';
import 'package:peers_touch_base/ai_proxy/provider/i_provider_manager.dart';
import 'package:peers_touch_base/ai_proxy/provider/local_provider_manager.dart';
import 'ai_box_mode.dart'; // 使用我们自己的枚举定义

/// AI Box门面服务 - 为上层应用提供统一的AI服务接口
/// 封装了provider管理、模型管理、聊天功能等所有AI相关操作
class AiBoxFacadeService {
  final IProviderManager _providerManager;

  /// 构造函数，通过[mode]参数决定服务模式
  ///
  /// 默认为[AiBoxMode.local]，使用纯本地存储。
  /// 当需要与服务器同步时，请使用[AiBoxMode.remote]。
  AiBoxFacadeService({AiBoxMode mode = AiBoxMode.local})
      : this.internal(_createManagerForMode(mode));

  /// Internal constructor for testing purposes.
  AiBoxFacadeService.internal(this._providerManager);

  /// 根据模式创建对应的Provider管理器
  static IProviderManager _createManagerForMode(AiBoxMode mode) {
    switch (mode) {
      case AiBoxMode.remote:
        // 远程模式暂时不支持，抛出异常
        throw UnsupportedError('远程模式暂未实现，请使用本地模式');
      case AiBoxMode.local:
      default:
        // 离线模式，只使用本地存储
        return LocalProviderManager();
    }
  }

  /// Provider管理相关接口
  
  /// 获取所有提供商
  Future<List<Provider>> getProviders() async {
    return await _providerManager.listProviders();
  }

  /// 获取单个提供商
  Future<Provider?> getProvider(String providerId) async {
    return await _providerManager.getProvider(providerId);
  }

  /// 创建提供商
  Future<void> createProvider(Provider provider) async {
    await _providerManager.createProvider(provider);
  }

  /// 更新提供商
  Future<void> updateProvider(Provider provider) async {
    await _providerManager.updateProvider(provider);
  }

  /// 删除提供商
  Future<void> deleteProvider(String providerId) async {
    await _providerManager.deleteProvider(providerId);
  }

  /// 获取默认提供商
  Future<Provider?> getDefaultProvider() async {
    return await _providerManager.getDefaultProvider();
  }

  /// 设置默认提供商
  Future<void> setDefaultProvider(String providerId) async {
    await _providerManager.setDefaultProvider(providerId);
  }

  /// 设置当前提供商（在本地模式下等同于设置默认提供商）
  Future<void> setCurrentProvider(String providerId) async {
    await _providerManager.setDefaultProvider(providerId);
  }

  /// 模型管理相关接口
  
  /// 获取提供商的模型列表
  Future<List<String>> getProviderModels(String providerId) async {
    final provider = await getProvider(providerId);
    if (provider == null) {
      throw Exception('Provider not found: $providerId');
    }
    
    // 本地模式下返回预设的模型列表
    final providerType = provider.sourceType;
    switch (providerType) {
      case 'openai':
        return ['gpt-4o', 'gpt-4-turbo', 'gpt-3.5-turbo'];
      case 'ollama':
        return ['llama3', 'llama2', 'mistral', 'codellama'];
      case 'deepseek':
        return ['deepseek-chat', 'deepseek-coder'];
      default:
        return ['custom-model'];
    }
  }

  /// 测试提供商连接
  Future<bool> testProviderConnection(String providerId) async {
    final provider = await getProvider(providerId);
    if (provider == null) {
      return false;
    }
    
    try {
      // 从provider配置中提取URL
      final configJson = provider.configJson;
      if (configJson.isEmpty) {
        return false;
      }
      
      final config = jsonDecode(configJson);
      final baseUrl = config['base_url'] ?? config['baseUrl'] ?? '';
      final apiKey = config['api_key'] ?? config['apiKey'] ?? '';
      
      if (baseUrl.isEmpty) {
        return false;
      }
      
      // 本地模式下，只检查配置是否有效
      // 检查URL格式是否有效
      final urlPattern = RegExp(r'^https?://.+');
      if (!urlPattern.hasMatch(baseUrl)) {
        return false;
      }
      
      // 检查是否有API密钥（对于需要认证的提供商）
      final providerType = provider.sourceType;
      if (providerType == 'openai' || providerType == 'deepseek') {
        // 对于需要认证的提供商，检查API密钥
        if (apiKey.isEmpty) {
          return false;
        }
        
        // 检查API密钥格式
        if (apiKey.length < 10) {
          return false;
        }
      }
      
      // 本地模式下，配置有效即认为连接可能成功
      return true;
    } catch (e) {
      // 任何异常都认为连接失败
      return false;
    }
  }

  /// 聊天功能相关接口
  
  /// 发送消息（流式响应）
  Stream<ChatCompletionResponse> sendMessageStream({
    required String providerId,
    required String message,
    String? model,
    double? temperature,
    List<Map<String, dynamic>>? openAIContent,
    List<String>? imagesBase64,
  }) {
    // 本地模式下不支持流式聊天功能
    throw UnsupportedError('流式聊天功能在本地模式下不可用');
  }

  /// 发送消息（非流式响应）
  Future<ChatCompletionResponse> sendMessage({
    required String providerId,
    required String message,
    String? model,
    double? temperature,
    List<Map<String, dynamic>>? openAIContent,
    List<String>? imagesBase64,
  }) async {
    // 本地模式下不支持聊天功能
    throw UnsupportedError('聊天功能在本地模式下不可用');
  }

  /// 获取当前提供商（带缓存逻辑）
  Future<Provider?> getCurrentProvider() async {
    // 先尝试获取默认提供商
    final defaultProvider = await getDefaultProvider();
    if (defaultProvider != null) {
      return defaultProvider;
    }

    // 如果没有默认提供商，返回第一个启用的提供商
    final providers = await getProviders();
    return providers.firstWhere(
      (p) => p.enabled,
      orElse: () => providers.isNotEmpty ? providers.first : throw Exception('No provider found'),
    );
  }
}