import 'dart:async';
import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:peers_touch_base/ai_proxy/provider/provider_manager_interface.dart';
import 'package:peers_touch_base/ai_proxy/provider/provider_manager_local.dart';
import 'package:peers_touch_base/ai_proxy/service/ai_box_mode.dart'; // 使用我们自己的枚举定义
import 'package:peers_touch_base/logger/logging_service.dart';
import 'package:peers_touch_base/model/domain/ai_box/chat.pb.dart';
import 'package:peers_touch_base/model/domain/ai_box/provider.pb.dart';

/// AI Box门面服务 - 为上层应用提供统一的AI服务接口
/// 封装了provider管理、模型管理、聊天功能等所有AI相关操作
class AiBoxFacadeService {

  /// 构造函数，通过[mode]参数决定服务模式
  ///
  /// 默认为[AiBoxMode.local]，使用纯本地存储。
  /// 当需要与服务器同步时，请使用[AiBoxMode.remote]。
  AiBoxFacadeService({AiBoxMode mode = AiBoxMode.local})
      : this.internal(_createManagerForMode(mode));

  /// Internal constructor for testing purposes.
  AiBoxFacadeService.internal(this._providerManager, {Dio? dioForTest})
      : _dioForTest = dioForTest;
  final IProviderManager _providerManager;
  final Dio? _dioForTest;

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
    await _providerManager.setCurrentProvider(providerId);
  }

  /// 获取会话级当前提供商
  Future<Provider?> getCurrentProviderForSession(String sessionId) async {
    return await _providerManager.getCurrentProviderForSession(sessionId);
  }

  /// 设置会话级当前提供商
  Future<void> setCurrentProviderForSession(String sessionId, String providerId) async {
    await _providerManager.setCurrentProviderForSession(sessionId, providerId);
  }

  /// 模型管理相关接口
  
  /// 获取提供商的模型列表
  Future<List<String>> getProviderModels(String providerId) async {
    final provider = await getProvider(providerId);
    if (provider == null) {
      throw Exception('Provider not found: $providerId');
    }

    try {
      final baseUrl = _getBaseUrl(provider);
      
      // 从settingsJson中获取API密钥
      final apiKey = _getApiKey(provider);

      if (baseUrl.isEmpty || Uri.tryParse(baseUrl) == null || !Uri.tryParse(baseUrl)!.isAbsolute) {
        return [];
      }

      final dio = _dioForTest ??
          Dio(
            BaseOptions(
              baseUrl: baseUrl,
              connectTimeout: const Duration(seconds: 15),
              receiveTimeout: const Duration(seconds: 15),
            ),
          );

      String modelsPath;
      final providerType = provider.sourceType;
      switch (providerType) {
        case 'ollama':
          modelsPath = '/api/tags';
          break;
        case 'openai':
        case 'deepseek':
          modelsPath = '/models';
          dio.options.headers['Authorization'] = 'Bearer $apiKey';
          break;
        default:
          return []; // 不支持的提供商类型
      }

      final response = await dio.get(modelsPath);

      if (response.statusCode == 200) {
        final data = response.data;
        switch (providerType) {
          case 'ollama':
            // Ollama 返回 {"models": [{"name": "..."}, ...]}
            if (data is Map && data.containsKey('models')) {
              final models = (data['models'] as List)
                  .map((m) => m['name'] as String)
                  .toList();
              return models;
            }
            break;
          case 'openai':
          case 'deepseek':
            // OpenAI-compatible APIs 返回 {"data": [{"id": "..."}, ...]}
            if (data is Map && data.containsKey('data')) {
              final models = (data['data'] as List)
                  .map((m) => m['id'] as String)
                  .toList();
              return models;
            }
            break;
        }
      }
    } catch (e) {
      // 发生任何错误都返回空列表
      LoggingService.error('Failed to fetch models for provider $providerId: $e');
      return [];
    }

    return []; // 默认返回空列表
  }

  /// 测试提供商连接
  Future<bool> testProviderConnection(String providerId) async {
    final provider = await getProvider(providerId);
    if (provider == null) {
      return false;
    }

    try {
      final baseUrl = _getBaseUrl(provider);
      
      // 从settingsJson中获取API密钥
      final apiKey = _getApiKey(provider);

      if (baseUrl.isEmpty || Uri.tryParse(baseUrl) == null || !Uri.tryParse(baseUrl)!.isAbsolute) {
        return false;
      }

      final dio = _dioForTest ??
          Dio(
            BaseOptions(
              baseUrl: baseUrl,
              connectTimeout: const Duration(seconds: 10),
              receiveTimeout: const Duration(seconds: 10),
            ),
          );

      String testPath;
      final providerType = provider.sourceType;
      switch (providerType) {
        case 'ollama':
          testPath = '/api/tags';
          break;
        case 'openai':
        case 'deepseek':
          testPath = '/models';
          dio.options.headers['Authorization'] = 'Bearer $apiKey';
          break;
        default:
          testPath = '/';
          break;
      }

      final response = await dio.get(testPath);
      return response.statusCode == 200;
    } catch (e) {
      // 任何异常都认为连接失败
      return false;
    }
  }

  String _getBaseUrl(Provider provider) {
    try {
      // 优先从 settingsJson 获取
      if (provider.settingsJson.isNotEmpty) {
        final s = jsonDecode(provider.settingsJson);
        var base = s['proxyUrl'] ?? s['defaultProxyUrl'] ?? s['baseUrl'] ?? '';
        base = _sanitizeUrl(base?.toString() ?? '');
        if (base.isNotEmpty) return base;
      }
      // 回退到 configJson
      if (provider.configJson.isNotEmpty) {
        final c = jsonDecode(provider.configJson);
        var base = c['base_url'] ?? c['baseUrl'] ?? '';
        base = _sanitizeUrl(base?.toString() ?? '');
        return base;
      }
    } catch (_) {}
    return '';
  }

  String _getApiKey(Provider provider) {
    try {
      if (provider.settingsJson.isNotEmpty) {
        final s = jsonDecode(provider.settingsJson);
        final key = (s['apiKey'] ?? s['api_key'] ?? '').toString();
        return key;
      }
    } catch (_) {}
    return '';
  }

  String _sanitizeUrl(String raw) {
    var s = raw.trim();
    if (s.startsWith('`') && s.endsWith('`')) {
      s = s.substring(1, s.length - 1);
    }
    s = s.replaceAll('`', '').trim();
    return s;
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
    return await _providerManager.getCurrentProvider();
  }
}
